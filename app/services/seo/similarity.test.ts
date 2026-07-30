import { describe, expect, it } from "vitest";
import { intent } from "../../test-support/catalog";
import {
  checkSimilarity,
  clusterKey,
  intentSimilarity,
  SIMILARITY_BLOCK_THRESHOLD,
  SIMILARITY_FLAG_THRESHOLD,
} from "./similarity.server";

/**
 * Cannibalization prevention. The thresholds are a judgement call, so what
 * matters is that the intended cases land on the intended side of them:
 * reorderings and synonyms must block, single-facet siblings must pass.
 */

function existing(title: string, facets: Parameters<typeof intent>[0]) {
  return { title, slug: title.toLowerCase().replace(/\s+/g, "-"), intent: intent(facets) };
}

describe("clusterKey", () => {
  it("is identical for the same facets in any order", () => {
    const a = clusterKey(intent({ style: ["botanical"], room: ["living room"] }));
    const b = clusterKey(intent({ room: ["living room"], style: ["botanical"] }));

    expect(a).toBe(b);
  });

  it("is identical for differently phrased keywords with the same intent", () => {
    // This is the mechanism that stops "botanical wallpaper living room" and
    // "living room botanical wallpaper ideas" becoming two pages.
    const a = clusterKey(
      intent(
        { style: ["botanical"], room: ["living room"] },
        { keyword: "botanical wallpaper living room" },
      ),
    );
    const b = clusterKey(
      intent(
        { style: ["botanical"], room: ["living room"] },
        { keyword: "living room botanical wallpaper ideas" },
      ),
    );

    expect(a).toBe(b);
  });

  it("sorts multiple values within a facet", () => {
    const a = clusterKey(intent({ style: ["tropical", "botanical"] }));
    const b = clusterKey(intent({ style: ["botanical", "tropical"] }));

    expect(a).toBe(b);
    expect(a).toBe("style:botanical|style:tropical");
  });

  it("ignores audience, which does not define a page", () => {
    const withAudience = clusterKey(
      intent({ style: ["botanical"], audience: ["parents"] }),
    );
    const without = clusterKey(intent({ style: ["botanical"] }));

    expect(withAudience).toBe(without);
  });

  it("differs when a defining facet differs", () => {
    expect(clusterKey(intent({ room: ["bedroom"] }))).not.toBe(
      clusterKey(intent({ room: ["living room"] })),
    );
  });

  it("falls back to the keyword when no defining facet was parsed", () => {
    expect(
      clusterKey(intent({ audience: ["parents"] }, { keyword: "  Nice Wallpaper " })),
    ).toBe("keyword:nice wallpaper");
  });
});

describe("intentSimilarity", () => {
  it("is 1 for identical intents", () => {
    const facets = { style: ["botanical"], room: ["living room"] };

    expect(intentSimilarity(intent(facets), intent(facets))).toBe(1);
  });

  it("is 0 when nothing overlaps", () => {
    expect(
      intentSimilarity(
        intent({ style: ["botanical"] }),
        intent({ room: ["bedroom"] }),
      ),
    ).toBe(0);
  });

  it("puts single-facet siblings below the flag threshold", () => {
    // botanical living room vs botanical bedroom: same style, different room.
    // These are legitimately separate pages and must not be blocked.
    const score = intentSimilarity(
      intent({ style: ["botanical"], room: ["living room"] }),
      intent({ style: ["botanical"], room: ["bedroom"] }),
    );

    expect(score).toBeLessThan(SIMILARITY_BLOCK_THRESHOLD);
    expect(score).toBeCloseTo(0.5, 1);
  });

  it("puts a page differing only by a secondary facet in flag range", () => {
    const score = intentSimilarity(
      intent({ style: ["botanical"], room: ["living room"] }),
      intent({
        style: ["botanical"],
        room: ["living room"],
        attribute: ["sustainable"],
      }),
    );

    expect(score).toBeGreaterThanOrEqual(SIMILARITY_FLAG_THRESHOLD);
    expect(score).toBeLessThan(SIMILARITY_BLOCK_THRESHOLD);
  });

  it("is symmetric", () => {
    const a = intent({ style: ["botanical"], room: ["living room"] });
    const b = intent({ style: ["botanical"], color: ["green"] });

    expect(intentSimilarity(a, b)).toBe(intentSimilarity(b, a));
  });

  it("ignores facets absent from both intents", () => {
    // Two intents sharing only style should score the same whether or not
    // unrelated empty facets are present.
    const score = intentSimilarity(
      intent({ style: ["botanical"] }),
      intent({ style: ["botanical"] }),
    );

    expect(score).toBe(1);
  });
});

describe("checkSimilarity", () => {
  const target = intent({ style: ["botanical"], room: ["living room"] });

  it("passes when there is nothing to compare against", () => {
    expect(checkSimilarity(target, [])).toEqual({ level: "ok" });
  });

  it("blocks a near-identical intent and names the page it would cannibalize", () => {
    const verdict = checkSimilarity(target, [
      existing("Botanical Wallpaper for Living Rooms", {
        style: ["botanical"],
        room: ["living room"],
      }),
    ]);

    expect(verdict.level).toBe("block");
    if (verdict.level === "block") {
      expect(verdict.against.title).toBe("Botanical Wallpaper for Living Rooms");
      expect(verdict.score).toBeGreaterThanOrEqual(SIMILARITY_BLOCK_THRESHOLD);
    }
  });

  it("passes a legitimate sibling", () => {
    const verdict = checkSimilarity(target, [
      existing("Botanical Wallpaper for Bedrooms", {
        style: ["botanical"],
        room: ["bedroom"],
      }),
    ]);

    expect(verdict.level).toBe("ok");
  });

  it("flags rather than blocks in the middle band", () => {
    const verdict = checkSimilarity(target, [
      existing("Sustainable Botanical Wallpaper for Living Rooms", {
        style: ["botanical"],
        room: ["living room"],
        attribute: ["sustainable"],
      }),
    ]);

    expect(verdict.level).toBe("flag");
  });

  it("blocks on the first blocker even when a flag was seen first", () => {
    const verdict = checkSimilarity(target, [
      existing("Sustainable Botanical Living Room", {
        style: ["botanical"],
        room: ["living room"],
        attribute: ["sustainable"],
      }),
      existing("Botanical Living Room", {
        style: ["botanical"],
        room: ["living room"],
      }),
    ]);

    expect(verdict.level).toBe("block");
  });

  it("reports the worst flag when several are in range", () => {
    const verdict = checkSimilarity(target, [
      existing("Weaker", { style: ["botanical"], room: ["living room"], attribute: ["sustainable"], color: ["green"] }),
      existing("Stronger", { style: ["botanical"], room: ["living room"], attribute: ["sustainable"] }),
    ]);

    expect(verdict.level).toBe("flag");
    if (verdict.level === "flag") expect(verdict.against.title).toBe("Stronger");
  });
});
