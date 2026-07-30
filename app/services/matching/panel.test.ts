import { describe, expect, it } from "vitest";
import { intent, product } from "../../test-support/catalog";
import { buildMatchPanel, distinguishingFacets } from "./panel.server";

const SHOP = "demo.myshopify.com";

const CATALOG = [
  product({
    handle: "in-scope",
    title: "Fern Study",
    tags: ["style:botanical", "room:living-room"],
  }),
  product({
    handle: "wrong-room",
    title: "Wild Meadow",
    tags: ["style:botanical", "room:bedroom"],
  }),
  product({
    handle: "wrong-style",
    title: "Scandi Triangles",
    tags: ["style:geometric", "room:living-room"],
  }),
];

const INTENT = intent({ style: ["botanical"], room: ["living room"] });

function panel(selectedIds: string[] | null = null) {
  return buildMatchPanel({
    shop: SHOP,
    catalog: CATALOG,
    intent: INTENT,
    minProducts: 6,
    selectedIds,
  });
}

const idOf = (handle: string) => `gid://shopify/Product/${handle}`;

describe("splitting the catalog", () => {
  it("puts every product in exactly one list", () => {
    const result = panel();

    expect(result.matched.map((entry) => entry.title)).toEqual(["Fern Study"]);
    expect(result.excluded.map((entry) => entry.title)).toEqual([
      "Wild Meadow",
      "Scandi Triangles",
    ]);
    expect(result.matched.length + result.excluded.length).toBe(CATALOG.length);
  });

  it("carries the rejection reason on excluded products", () => {
    const result = panel();

    expect(result.excluded[0].excludedReason).toBe(
      "does not match room: living room",
    );
    expect(result.matched[0].excludedReason).toBeNull();
  });

  it("scores excluded products at zero", () => {
    expect(panel().excluded.every((entry) => entry.score === 0)).toBe(true);
  });
});

describe("default selection", () => {
  it("follows the matcher when the merchant has not chosen", () => {
    const result = panel(null);

    expect(result.matched.every((entry) => entry.included)).toBe(true);
    expect(result.excluded.every((entry) => !entry.included)).toBe(true);
    expect(result.overridden).toBe(false);
  });

  it("honours an explicit selection over the matcher's verdict", () => {
    // The merchant dropped the matched product and added a rejected one.
    const result = panel([idOf("wrong-room")]);

    expect(result.matched[0].included).toBe(false);
    expect(
      result.excluded.find((entry) => entry.title === "Wild Meadow")?.included,
    ).toBe(true);
    expect(result.overridden).toBe(true);
  });

  it("treats an empty selection as a real choice, not as absent", () => {
    const result = panel([]);

    expect(
      [...result.matched, ...result.excluded].every((entry) => !entry.included),
    ).toBe(true);
    expect(result.overridden).toBe(true);
  });

  it("lets a rejected product be included, which was previously impossible", () => {
    const result = panel([idOf("in-scope"), idOf("wrong-style")]);

    const added = result.excluded.find(
      (entry) => entry.title === "Scandi Triangles",
    );
    expect(added?.included).toBe(true);
    // The reason survives, so the UI can warn about the override.
    expect(added?.excludedReason).toBe("does not match style: botanical");
  });
});

describe("product links", () => {
  it("uses the storefront URL when the product is live", () => {
    const live = {
      ...product({ handle: "live", tags: ["style:botanical", "room:living-room"] }),
      onlineStoreUrl: "https://demo.myshopify.com/products/live",
    };

    const result = buildMatchPanel({
      shop: SHOP,
      catalog: [live],
      intent: INTENT,
      minProducts: 6,
      selectedIds: null,
    });

    expect(result.matched[0].url).toBe("https://demo.myshopify.com/products/live");
  });

  it("falls back to the admin product page so View always resolves", () => {
    expect(panel().matched[0].url).toBe(
      "https://demo.myshopify.com/admin/products/in-scope",
    );
  });
});

describe("distinguishingFacets", () => {
  it("hides facet values every matched product shares", () => {
    const matched = [
      {
        matchedFacets: { style: ["botanical"], room: ["living room"] },
      },
      {
        matchedFacets: { style: ["botanical"], room: ["living room"] },
      },
    ] as Parameters<typeof distinguishingFacets>[1];

    expect(distinguishingFacets(matched[0], matched)).toEqual([]);
  });

  it("keeps values that only some matched products have", () => {
    const matched = [
      { matchedFacets: { style: ["botanical"], color: ["green"] } },
      { matchedFacets: { style: ["botanical"] } },
    ] as Parameters<typeof distinguishingFacets>[1];

    expect(distinguishingFacets(matched[0], matched)).toEqual(["color: green"]);
  });
});

describe("threshold reporting", () => {
  it("passes the minimum through for the UI to compare against", () => {
    expect(panel().minProducts).toBe(6);
  });

  it("exposes the parsed facets so the panel can show what it matched on", () => {
    expect(panel().facets).toEqual(INTENT.facets);
  });
});
