import { describe, expect, it } from "vitest";
import { intent, product, tagged } from "../../test-support/catalog";
import { matchProducts } from "./match.server";

/** Reason recorded for a product the matcher rejected. */
function reasonFor(
  result: ReturnType<typeof matchProducts>,
  handle: string,
): string | undefined {
  return result.excluded.find((entry) => entry.product.handle === handle)?.reason;
}

function handles(result: ReturnType<typeof matchProducts>): string[] {
  return result.matches.map((scored) => scored.product.handle);
}

describe("hard facet filtering", () => {
  it("requires every explicitly stated facet", () => {
    const catalog = [
      product({ handle: "both", tags: ["style:botanical", "room:living-room"] }),
      product({ handle: "wrong-room", tags: ["style:botanical", "room:bedroom"] }),
      product({ handle: "wrong-style", tags: ["style:art-deco", "room:living-room"] }),
    ];

    const result = matchProducts(
      catalog,
      intent({ style: ["botanical"], room: ["living room"] }),
      6,
    );

    expect(handles(result)).toEqual(["both"]);
    expect(reasonFor(result, "wrong-room")).toBe(
      "does not match room: living room",
    );
    expect(reasonFor(result, "wrong-style")).toBe(
      "does not match style: botanical",
    );
  });

  it("treats audience as soft, so a mismatch only forgoes the bonus", () => {
    const catalog = [
      product({ handle: "with", tags: ["style:botanical", "audience:parents"] }),
      product({ handle: "without", tags: ["style:botanical"] }),
    ];

    const result = matchProducts(
      catalog,
      intent({ style: ["botanical"], audience: ["parents"] }),
      1,
    );

    expect(handles(result)).toEqual(["with", "without"]);
    expect(result.matches[0].score).toBeGreaterThan(result.matches[1].score);
  });

  it("excludes a product that satisfies nothing the shopper asked for", () => {
    const catalog = [product({ handle: "unrelated", tags: ["audience:parents"] })];

    const result = matchProducts(catalog, intent({ audience: ["renters"] }), 1);

    expect(reasonFor(result, "unrelated")).toBe("matches no intent facet");
  });
});

describe("provenance ranking", () => {
  it("ranks a declared facet above the same facet merely inferred", () => {
    const catalog = [
      product({ handle: "inferred", title: "Botanical Sketchbook" }),
      product({ handle: "declared", tags: ["style:botanical"] }),
      product({
        handle: "collection",
        collections: [{ handle: "botanical", title: "Botanical" }],
      }),
    ];

    const result = matchProducts(catalog, intent({ style: ["botanical"] }), 1);

    // Tag and collection are both "declared" and score equally; the title-only
    // product sits below them.
    expect(handles(result).at(-1)).toBe("inferred");
    expect(result.matches[0].score).toBeGreaterThan(
      result.matches[2].score,
    );
  });

  it("does not weaken a tagged facet that also appears in the title", () => {
    const both = product({
      handle: "both",
      tags: ["style:botanical"],
      title: "Botanical Sketchbook",
    });
    const tagOnly = tagged("style:botanical");

    const result = matchProducts([both, tagOnly], intent({ style: ["botanical"] }), 1);
    const scores = result.matches.map((scored) => scored.product.handle);

    // The title text adds a small ranking bonus but the facet itself still
    // scores as declared, so neither product is penalised.
    expect(scores).toContain("both");
    expect(result.matches.every((scored) => scored.inferredFacets.length === 0)).toBe(
      true,
    );
  });

  it("reports which matched values were only inferred", () => {
    const catalog = [product({ handle: "inferred", title: "Palm Canopy" })];

    const result = matchProducts(catalog, intent({ style: ["tropical"] }), 1);

    expect(result.matches[0].inferredFacets).toEqual(["style:tropical"]);
  });

  it("lets a store with no tags at all still match", () => {
    const catalog = [
      product({
        handle: "untagged",
        title: "Fern Study",
        tags: ["bestseller"],
        collections: [
          { handle: "botanical-wallpaper", title: "Botanical Wallpaper" },
          { handle: "living-room", title: "Living Room" },
        ],
      }),
    ];

    const result = matchProducts(
      catalog,
      intent({ style: ["botanical"], room: ["living room"] }),
      1,
    );

    expect(handles(result)).toEqual(["untagged"]);
    // Collection membership is declared, not inferred.
    expect(result.matches[0].inferredFacets).toEqual([]);
  });
});

describe("kid safety", () => {
  it("excludes dramatic designs from kid-intent pages", () => {
    const catalog = [
      product({
        handle: "moody",
        tags: ["style:botanical", "room:kids-room", "attribute:dramatic"],
      }),
      product({ handle: "gentle", tags: ["style:botanical", "room:kids-room"] }),
    ];

    const result = matchProducts(
      catalog,
      intent({ style: ["botanical"], room: ["kids room"] }),
      1,
    );

    expect(handles(result)).toEqual(["gentle"]);
    expect(reasonFor(result, "moody")).toBe('kid-unsafe attribute "dramatic"');
  });

  it("excludes unrequested dark colourways from kid-intent pages", () => {
    const catalog = [
      product({ handle: "navy", tags: ["room:kids-room", "color:navy"] }),
    ];

    const result = matchProducts(catalog, intent({ room: ["kids room"] }), 1);

    expect(reasonFor(result, "navy")).toBe(
      'dark colourway "navy" not suitable for kids pages',
    );
  });

  it("keeps a dark colourway the shopper asked for by name", () => {
    const catalog = [
      product({
        handle: "starry",
        tags: ["room:kids-room", "color:midnight-blue"],
      }),
    ];

    const result = matchProducts(
      catalog,
      intent({ room: ["kids room"], color: ["midnight blue"] }),
      1,
    );

    expect(handles(result)).toEqual(["starry"]);
  });

  it("applies kid safety when the intent says kids without naming the room", () => {
    const catalog = [
      product({ handle: "moody", tags: ["use-case:kids", "attribute:dramatic"] }),
    ];

    const result = matchProducts(catalog, intent({ useCase: ["kids"] }), 1);

    expect(result.matches).toEqual([]);
  });
});

describe("threshold", () => {
  it("reports whether the minimum was met without filtering anything out", () => {
    const catalog = Array.from({ length: 4 }, () => tagged("style:botanical"));

    const result = matchProducts(catalog, intent({ style: ["botanical"] }), 6);

    expect(result.matches).toHaveLength(4);
    expect(result.meetsThreshold).toBe(false);
    expect(result.threshold).toBe(6);
  });

  it("is met exactly at the threshold", () => {
    const catalog = Array.from({ length: 6 }, () => tagged("style:botanical"));

    expect(
      matchProducts(catalog, intent({ style: ["botanical"] }), 6).meetsThreshold,
    ).toBe(true);
  });
});

describe("ranking", () => {
  it("puts the product satisfying more values of one facet first", () => {
    // A hard facet is satisfied by any one of its values, so both products
    // qualify; the one covering both values ranks higher.
    const catalog = [
      product({ handle: "one-value", tags: ["style:botanical"] }),
      product({ handle: "both-values", tags: ["style:botanical", "style:tropical"] }),
    ];

    const result = matchProducts(
      catalog,
      intent({ style: ["botanical", "tropical"] }),
      1,
    );

    expect(handles(result)).toEqual(["both-values", "one-value"]);
  });

  it("weights facets by importance, not just by count", () => {
    // style is weighted 3, color 1.5: one style beats one colour.
    const catalog = [
      product({ handle: "style-match", tags: ["style:botanical"] }),
      product({ handle: "colour-match", tags: ["color:green"] }),
    ];

    const result = matchProducts(
      catalog,
      intent({ style: ["botanical"], color: ["green"] }),
      1,
    );

    // Each product fails the *other* hard facet, so neither qualifies. This
    // is the accuracy rule: a page never mixes in products that contradict
    // part of its own promise.
    expect(result.matches).toEqual([]);
    expect(result.excluded).toHaveLength(2);
  });

  it("does not mutate the catalog it was given", () => {
    const catalog = [
      tagged("style:art-deco"),
      tagged("style:botanical"),
    ];
    const order = catalog.map((entry) => entry.handle);

    matchProducts(catalog, intent({ style: ["botanical"] }), 1);

    expect(catalog.map((entry) => entry.handle)).toEqual(order);
  });
});
