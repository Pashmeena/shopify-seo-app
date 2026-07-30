import { describe, expect, it } from "vitest";
import {
  REVIEW_MARKER,
  altTextBackfillReason,
  cannibalizationReason,
  joinReviewReasons,
  splitReviewReasons,
  thinPageReason,
  withoutReason,
} from "./review-reasons";

/**
 * The invariant worth protecting: every reason this module writes must be
 * findable again by its own marker. If a message is reworded and the marker is
 * not, a page stays held for a reason that no longer applies and no screen can
 * clear it.
 */

describe("every written reason is findable by its marker", () => {
  it.each([
    [REVIEW_MARKER.THIN, thinPageReason(3, 6)],
    [REVIEW_MARKER.CANNIBALIZATION, cannibalizationReason(0.8, "Other Page", false)],
    [REVIEW_MARKER.CANNIBALIZATION, cannibalizationReason(0.8, "Other Page", true)],
    [REVIEW_MARKER.ALT_TEXT_BACKFILL, altTextBackfillReason(2)],
  ])("%s", (marker, written) => {
    expect(written).toContain(marker);
    expect(withoutReason(written, marker)).toEqual([]);
  });
});

describe("reason text", () => {
  it("names the real counts, so the merchant knows what to fix", () => {
    expect(thinPageReason(3, 6)).toBe(
      "Only 3 matching products (minimum 6) — thin page, held from publishing.",
    );
  });

  it("explains the redirect when the page is being consolidated", () => {
    expect(cannibalizationReason(0.82, "Botanical Living Rooms", true)).toContain(
      "301 redirect",
    );
  });

  it("says nothing about a redirect when the page stays its own", () => {
    // 0.6–0.75 is reviewed but not consolidated. Promising a redirect that is
    // not coming would be worse than saying nothing.
    expect(cannibalizationReason(0.65, "Botanical Living Rooms", false)).not.toContain(
      "301",
    );
  });
});

describe("splitReviewReasons", () => {
  it("splits on the boundary after a full stop, keeping the stop", () => {
    const reasons = [thinPageReason(3, 6), altTextBackfillReason(2)];

    expect(splitReviewReasons(reasons.join(" "))).toEqual(reasons);
  });

  it("keeps a decimal point inside one reason intact", () => {
    // "Similar (0.82) to …" contains a full stop that is not a sentence end.
    // Splitting on ". " would tear it in half.
    const reason = cannibalizationReason(0.82, "Other Page", false);

    expect(splitReviewReasons(reason)).toEqual([reason]);
  });

  it("treats no reason as no reasons", () => {
    expect(splitReviewReasons(null)).toEqual([]);
    expect(splitReviewReasons("")).toEqual([]);
  });
});

describe("withoutReason", () => {
  it("removes only the named reason and keeps the rest", () => {
    // The case that matters: overruling a cannibalization flag must not
    // release a page that is also too thin to publish.
    const stored = joinReviewReasons([
      thinPageReason(3, 6),
      cannibalizationReason(0.8, "Other Page", true),
    ]);

    expect(withoutReason(stored, REVIEW_MARKER.CANNIBALIZATION)).toEqual([
      thinPageReason(3, 6),
    ]);
  });

  it("leaves a list alone when the named reason is absent", () => {
    const stored = joinReviewReasons([thinPageReason(3, 6)]);

    expect(withoutReason(stored, REVIEW_MARKER.CANNIBALIZATION)).toEqual([
      thinPageReason(3, 6),
    ]);
  });

  it("removes every instance, not just the first", () => {
    const stored = [thinPageReason(3, 6), thinPageReason(4, 6)].join(" ");

    expect(withoutReason(stored, REVIEW_MARKER.THIN)).toEqual([]);
  });
});

describe("joinReviewReasons", () => {
  it("returns null for nothing, so the column clears rather than storing ''", () => {
    expect(joinReviewReasons([])).toBeNull();
    expect(joinReviewReasons([""])).toBeNull();
  });

  it("round-trips through a split", () => {
    const reasons = [thinPageReason(3, 6), altTextBackfillReason(1)];

    expect(splitReviewReasons(joinReviewReasons(reasons))).toEqual(reasons);
  });
});
