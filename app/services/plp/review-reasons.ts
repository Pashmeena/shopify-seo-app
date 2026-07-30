/**
 * The notes that hold a page back from publishing, and the rules for editing
 * that list.
 *
 * A page can be held for several independent things at once — too few
 * products, an intent too close to an existing page, alt text that had to be
 * backfilled — and resolving one must not silently clear the others. The
 * reasons are stored as one string because that is what the merchant reads, so
 * removing a single reason means matching it back out of that string.
 *
 * That matching is why this module exists rather than each caller doing it
 * inline. The text a reason is written with and the text used to find it again
 * have to agree exactly; when both were spelled out at their call sites, a
 * reworded message would have quietly stopped being removable, leaving a page
 * held forever for a reason that no longer applied. Here the writer and the
 * matcher share one constant, so they cannot drift.
 *
 * The invariant every writer below must keep: **one reason is exactly one
 * sentence.** Reasons are split apart on the boundary after a full stop, so a
 * reason spanning two sentences becomes two entries, only one of which carries
 * a marker — and the other would then outlive every removal as an orphan clause
 * with nothing to identify it. Use a semicolon, not a second sentence.
 */

/**
 * Stable fragments identifying each kind of reason. Part of the merchant-facing
 * sentence, so changing one changes the copy — deliberately, since the copy is
 * the identifier.
 */
export const REVIEW_MARKER = {
  THIN: "thin page, held from publishing",
  CANNIBALIZATION: "review for cannibalization",
  ALT_TEXT_BACKFILL: "backfilled deterministically",
} as const;

export type ReviewMarker = (typeof REVIEW_MARKER)[keyof typeof REVIEW_MARKER];

/** Below the minimum product count. */
export function thinPageReason(productCount: number, minimum: number): string {
  return `Only ${productCount} matching products (minimum ${minimum}) — ${REVIEW_MARKER.THIN}.`;
}

/**
 * Intent close enough to an existing page to compete with it.
 *
 * One sentence, even in the consolidated case, because a reason is identified
 * and removed as a whole: a second sentence would be split off into a reason of
 * its own that carries no marker, and would then survive every removal as an
 * orphan clause the merchant could never clear.
 */
export function cannibalizationReason(
  score: number,
  againstTitle: string,
  consolidatedOntoIt: boolean,
): string {
  return (
    `Similar (${score.toFixed(2)}) to "${againstTitle}" — ${REVIEW_MARKER.CANNIBALIZATION}` +
    (consolidatedOntoIt
      ? "; it will publish as a 301 redirect onto that page rather than as a " +
        "competing page, so the two cannot split the same queries"
      : "") +
    "."
  );
}

/** Alt text the model omitted and the app had to synthesise. */
export function altTextBackfillReason(count: number): string {
  return `Alt text for ${count} product(s) was ${REVIEW_MARKER.ALT_TEXT_BACKFILL}.`;
}

/**
 * Split a stored reason string back into individual reasons.
 *
 * Reasons are joined with a space and each ends in a full stop, so the split
 * is on the boundary after one — a lookbehind rather than splitting on ". ",
 * which would eat the stop and corrupt every reason but the last.
 */
export function splitReviewReasons(reviewReason: string | null): string[] {
  return (reviewReason ?? "").split(/(?<=\.)\s+/).filter(Boolean);
}

/** Every reason except those identified by `marker`. */
export function withoutReason(
  reviewReason: string | null,
  marker: ReviewMarker,
): string[] {
  return splitReviewReasons(reviewReason).filter(
    (reason) => !reason.includes(marker),
  );
}

/** Join reasons for storage. Null when there is nothing left to say. */
export function joinReviewReasons(reasons: string[]): string | null {
  const kept = reasons.filter(Boolean);
  return kept.length ? kept.join(" ") : null;
}
