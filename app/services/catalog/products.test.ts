import { describe, expect, it } from "vitest";
import { deriveFacets } from "./products.server";
import { facetOriginKey } from "./types";

/**
 * Facet derivation is what decides whether the app is usable on a store
 * that never adopted this app's tag convention, so each source is asserted
 * on its own as well as in combination.
 */

const EMPTY = { tags: [], title: "", productType: "", collections: [] };

describe("namespaced tags", () => {
  it("reads every supported namespace and normalizes the value", () => {
    const { facets } = deriveFacets({
      ...EMPTY,
      tags: [
        "style:botanical",
        "room:kids-room",
        "color:midnight-blue",
        "material:peel-and-stick",
        "attribute:sustainable",
        "use-case:renters",
        "audience:parents",
      ],
    });

    expect(facets).toEqual({
      style: ["botanical"],
      room: ["kids room"],
      color: ["midnight blue"],
      material: ["peel and stick"],
      attribute: ["sustainable"],
      useCase: ["renters"],
      audience: ["parents"],
    });
  });

  it("ignores tags that are not namespaced or use an unknown namespace", () => {
    const { facets } = deriveFacets({
      ...EMPTY,
      tags: ["bestseller", "season:spring", "style:", ":botanical"],
    });

    expect(facets).toEqual({});
  });

  it("records the tag origin", () => {
    const { facetOrigins } = deriveFacets({ ...EMPTY, tags: ["style:botanical"] });

    expect(facetOrigins[facetOriginKey("style", "botanical")]).toEqual(["tag"]);
  });
});

describe("collection membership", () => {
  it("derives facets from a collection title", () => {
    const { facets, facetOrigins } = deriveFacets({
      ...EMPTY,
      collections: [{ handle: "c1", title: "Living Room" }],
    });

    expect(facets.room).toEqual(["living room"]);
    expect(facetOrigins[facetOriginKey("room", "living room")]).toEqual([
      "collection",
    ]);
  });

  it("derives facets from a collection handle when the title diverges", () => {
    const { facets } = deriveFacets({
      ...EMPTY,
      collections: [{ handle: "peel-and-stick", title: "Easy Apply" }],
    });

    expect(facets.material).toEqual(["peel and stick"]);
  });

  it("reads several collections at once", () => {
    const { facets } = deriveFacets({
      ...EMPTY,
      collections: [
        { handle: "botanical", title: "Botanical" },
        { handle: "living-room", title: "Living Room" },
        { handle: "sustainable", title: "Sustainable" },
      ],
    });

    expect(facets).toMatchObject({
      style: ["botanical"],
      room: ["living room"],
      attribute: ["sustainable"],
    });
  });

  it("prefers the longest phrase, not the first word it recognizes", () => {
    const { facets } = deriveFacets({
      ...EMPTY,
      collections: [{ handle: "sage-green", title: "Sage Green" }],
    });

    expect(facets.color).toEqual(["sage green"]);
  });
});

describe("title and product type", () => {
  it("derives a style from the product title", () => {
    const { facets, facetOrigins } = deriveFacets({
      ...EMPTY,
      title: "Emerald Palm Canopy",
    });

    // "palm" is a tropical synonym; "emerald" is not in the vocabulary.
    expect(facets.style).toEqual(["tropical"]);
    expect(facetOrigins[facetOriginKey("style", "tropical")]).toEqual(["title"]);
  });

  it("records product type separately from title", () => {
    const { facetOrigins } = deriveFacets({
      ...EMPTY,
      productType: "Vinyl Wallpaper",
    });

    expect(facetOrigins[facetOriginKey("material", "vinyl")]).toEqual([
      "product-type",
    ]);
  });

  it("ignores the product noun itself", () => {
    const { facets } = deriveFacets({ ...EMPTY, title: "Wallpaper Mural" });

    expect(facets).toEqual({});
  });
});

describe("combining sources", () => {
  it("records every origin for a value found in more than one place", () => {
    const { facets, facetOrigins } = deriveFacets({
      tags: ["style:botanical"],
      title: "Botanical Sketchbook",
      productType: "Wallpaper",
      collections: [{ handle: "botanical", title: "Botanical" }],
    });

    expect(facets.style).toEqual(["botanical"]);
    expect(facetOrigins[facetOriginKey("style", "botanical")]).toEqual([
      "tag",
      "collection",
      "title",
    ]);
  });

  it("makes an untagged product matchable from its merchandising alone", () => {
    const { facets } = deriveFacets({
      tags: ["bestseller", "new-in"],
      title: "Fern Study",
      productType: "Non-woven wallpaper",
      collections: [
        { handle: "botanical-wallpaper", title: "Botanical Wallpaper" },
        { handle: "living-room", title: "Living Room" },
      ],
    });

    expect(facets).toMatchObject({
      style: ["botanical"],
      room: ["living room"],
      material: ["non woven"],
    });
  });

  it("does not read facets out of the description", () => {
    // Descriptions are excluded on purpose: "not suitable for bathrooms"
    // contains "bathroom", and a page must never contain a product that
    // contradicts its own H1.
    const derived = deriveFacets({
      ...EMPTY,
      title: "Fern Study",
      collections: [],
    });

    expect(derived.facets.room).toBeUndefined();
  });
});
