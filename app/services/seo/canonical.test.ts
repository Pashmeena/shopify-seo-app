import { describe, expect, it } from "vitest";
import {
  CONSOLIDATE_THRESHOLD,
  chooseCanonicalTarget,
  type NearDuplicate,
} from "./canonical.server";

/**
 * The canonical policy is the difference between a page that ranks in its own
 * market and one Google is told to ignore, so each branch is pinned down here.
 *
 * The headline guarantee — locale alone never consolidates — has its own
 * describe block, because it is the exact mistake this file used to make.
 */

function nearDuplicate(overrides: Partial<NearDuplicate> = {}): NearDuplicate {
  return {
    id: "page-1",
    slug: "en-us-botanical-wallpaper-living-room",
    title: "Botanical Wallpaper for Living Rooms",
    locale: "en-US",
    score: 0.8,
    ...overrides,
  };
}

describe("a page with no near-duplicate is canonical for itself", () => {
  it("self-references when nothing similar exists", () => {
    const decision = chooseCanonicalTarget({ locale: "en-US" }, null);

    expect(decision.target).toBeNull();
    expect(decision.reason).toContain("Self-referencing");
  });

  it("explains that other markets are paired by hreflang instead", () => {
    expect(chooseCanonicalTarget({ locale: "de-DE" }, null).reason).toContain(
      "hreflang",
    );
  });
});

describe("locale is never a reason to consolidate", () => {
  // The old policy pointed en-AU at en-US. Google documents hreflang, not
  // canonical, for regional variants of one language, and the consolidated
  // page stops appearing in its own market.
  it("keeps an Australian page self-canonical against an English sibling", () => {
    const decision = chooseCanonicalTarget(
      { locale: "en-AU" },
      nearDuplicate({ locale: "en-US", score: 1 }),
    );

    expect(decision.target).toBeNull();
    expect(decision.reason).toContain("different market");
  });

  it("keeps a German page self-canonical against an English sibling", () => {
    expect(
      chooseCanonicalTarget(
        { locale: "de-DE" },
        nearDuplicate({ locale: "en-US", score: 1 }),
      ).target,
    ).toBeNull();
  });

  it("refuses a cross-market target even at a perfect similarity score", () => {
    expect(
      chooseCanonicalTarget(
        { locale: "en-GB" },
        nearDuplicate({ locale: "en-AU", score: 1 }),
      ).target,
    ).toBeNull();
  });
});

describe("same-market near-duplicates consolidate", () => {
  it("points a flagged page at the page it duplicates", () => {
    const decision = chooseCanonicalTarget({ locale: "en-US" }, nearDuplicate());

    expect(decision.target).toEqual({
      id: "page-1",
      slug: "en-us-botanical-wallpaper-living-room",
    });
    expect(decision.reason).toContain("same market");
  });

  it("names the page and the score so a merchant can judge the call", () => {
    const reason = chooseCanonicalTarget({ locale: "en-US" }, nearDuplicate())
      .reason;

    expect(reason).toContain("Botanical Wallpaper for Living Rooms");
    expect(reason).toContain("0.80");
  });

  it("consolidates exactly at the threshold", () => {
    expect(
      chooseCanonicalTarget(
        { locale: "en-US" },
        nearDuplicate({ score: CONSOLIDATE_THRESHOLD }),
      ).target,
    ).not.toBeNull();
  });

  it("reviews but does not consolidate below the threshold", () => {
    const decision = chooseCanonicalTarget(
      { locale: "en-US" },
      nearDuplicate({ score: CONSOLIDATE_THRESHOLD - 0.01 }),
    );

    expect(decision.target).toBeNull();
    expect(decision.reason).toContain("not a duplicate");
  });

  it("sits inside the flag band rather than replacing it", () => {
    // 0.6 flags for review, 0.85 blocks outright; consolidation is a strong
    // action, so it wants more evidence than the bottom of that band.
    expect(CONSOLIDATE_THRESHOLD).toBeGreaterThan(0.6);
    expect(CONSOLIDATE_THRESHOLD).toBeLessThan(0.85);
  });
});

describe("determinism", () => {
  it("returns the same decision for the same inputs", () => {
    const input = nearDuplicate();

    expect(chooseCanonicalTarget({ locale: "en-US" }, input)).toEqual(
      chooseCanonicalTarget({ locale: "en-US" }, input),
    );
  });
});
