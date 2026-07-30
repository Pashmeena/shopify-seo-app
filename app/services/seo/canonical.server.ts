/**
 * Which page, if any, a PLP should point its canonical tag at.
 *
 * The brief asks for two things that pull in opposite directions: a
 * "self-referencing canonical tag" with hreflang between locale variants,
 * and "canonical consolidation — where near-duplicate pages must exist
 * (e.g. for locale reasons), designate one as canonical and point variants
 * to it".
 *
 * An earlier version of this file resolved that by consolidating same-
 * language markets: en-AU pointed at en-US, only different languages stayed
 * self-canonical. That was wrong, for three reasons:
 *
 * 1. It is the opposite of what Google documents for this case. Regional
 *    variants of one language are what hreflang exists for — Google's own
 *    example is "English-language content targeted to the US, GB, and
 *    Ireland" — and consolidation is reserved for content that is actually
 *    the same at two addresses. Practitioners list canonicalising regional
 *    pages onto a default as a common and costly mistake, because the
 *    consolidated page stops appearing in its own market.
 * 2. It contradicted its own justification. The old code argued a German
 *    page must stay self-canonical or the market it was generated for is
 *    forfeited. That argument is exactly as true of the Australian page,
 *    which this app deliberately generates with its own market briefing.
 * 3. It decided from a locale code, before generation, without ever looking
 *    at what the two pages said. Whether two pages duplicate each other is
 *    a property of their content, not of their market label.
 *
 * The policy now: **locale is never a reason to consolidate.** Every market
 * page is canonical for itself and its variants are paired by hreflang.
 * Consolidation is kept — the brief requires it — and pointed at the case
 * that genuinely is a near-duplicate: two pages *in the same market* whose
 * intents land in the similarity flag band. Those pages compete for the same
 * shoppers with the same products in the same language, which is the
 * definition the brief's mechanism was for.
 *
 * Only the upper part of the flag band consolidates. A 0.6 score means
 * "worth a human look"; burying a page is a strong action and wants stronger
 * evidence, so the threshold sits higher and the rest is flagged for review
 * without a canonical target.
 *
 * Pure and deterministic: same inputs always produce the same decision, so
 * re-running the pipeline never flips a canonical.
 */

/**
 * Minimum intent similarity for one same-market page to be consolidated onto
 * another. Sits inside the flag band (see similarity.server.ts): 0.6–0.75 is
 * reviewed, 0.75–0.85 is reviewed *and* consolidated, ≥ 0.85 never generates.
 */
export const CONSOLIDATE_THRESHOLD = 0.75;

/** An existing page a new page was found to be near-duplicate of. */
export interface NearDuplicate {
  id: string;
  slug: string;
  title: string;
  locale: string;
  score: number;
}

export interface CanonicalDecision {
  /** Null means "canonicalise to self". */
  target: { id: string; slug: string } | null;
  /** Merchant-readable explanation of the decision. */
  reason: string;
}

const SELF_REASON =
  "Self-referencing: this page is the canonical page for its market. " +
  "Variants in other markets are paired by hreflang, never consolidated — " +
  "consolidating them would remove this page from the market it was " +
  "generated for.";

export function chooseCanonicalTarget(
  page: { locale: string },
  nearDuplicate: NearDuplicate | null,
): CanonicalDecision {
  if (!nearDuplicate) {
    return { target: null, reason: SELF_REASON };
  }

  // Structural guarantee, not just a comment: the similarity check is scoped
  // to one market, so this branch should be unreachable. It exists so that a
  // future caller widening that scope cannot silently resurrect the old
  // locale-based consolidation.
  if (nearDuplicate.locale !== page.locale) {
    return {
      target: null,
      reason:
        `Self-referencing: the closest page (${nearDuplicate.locale}) is in a ` +
        "different market, and locale is never a reason to consolidate.",
    };
  }

  if (nearDuplicate.score < CONSOLIDATE_THRESHOLD) {
    return {
      target: null,
      reason:
        `Self-referencing: the closest page in this market scores ` +
        `${nearDuplicate.score.toFixed(2)}, below the ${CONSOLIDATE_THRESHOLD} ` +
        "consolidation threshold. Flagged for review, but not a duplicate.",
    };
  }

  return {
    target: { id: nearDuplicate.id, slug: nearDuplicate.slug },
    reason:
      `Consolidated onto /${nearDuplicate.slug} ("${nearDuplicate.title}"): ` +
      `same market, near-identical intent (${nearDuplicate.score.toFixed(2)}), ` +
      "so the two pages would compete for the same queries.",
  };
}
