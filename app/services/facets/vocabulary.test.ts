import { describe, expect, it } from "vitest";
import {
  buildPhraseIndex,
  extractFacets,
  productTextPhraseIndex,
} from "./vocabulary.server";

const keywordIndex = buildPhraseIndex();

function facetsOf(text: string, index = keywordIndex) {
  return extractFacets(text, index).facets;
}

describe("greedy longest-phrase matching", () => {
  it("prefers the longer phrase over a word inside it", () => {
    expect(facetsOf("sage green wallpaper")).toEqual({ color: ["sage green"] });
    expect(facetsOf("midnight blue wallpaper")).toEqual({
      color: ["midnight blue"],
    });
  });

  it("still matches the shorter phrase when the longer one is absent", () => {
    expect(facetsOf("green wallpaper")).toEqual({ color: ["green"] });
  });

  it("matches hyphenated and spaced spellings alike", () => {
    expect(facetsOf("peel-and-stick wallpaper")).toEqual({
      material: ["peel and stick"],
    });
    expect(facetsOf("peel and stick wallpaper")).toEqual({
      material: ["peel and stick"],
    });
  });

  it("collects several facets from one string", () => {
    expect(facetsOf("sustainable botanical wallpaper for the living room")).toEqual(
      {
        attribute: ["sustainable"],
        style: ["botanical"],
        room: ["living room"],
      },
    );
  });

  it("does not repeat a value reached by two different synonyms", () => {
    expect(facetsOf("botanical leafy greenery wallpaper")).toEqual({
      style: ["botanical"],
    });
  });

  it("reads German synonyms to the same canonical English values", () => {
    expect(facetsOf("nachhaltige botanische tapete wohnzimmer")).toEqual({
      attribute: ["sustainable"],
      style: ["botanical"],
      room: ["living room"],
    });
  });
});

describe("token accounting", () => {
  it("counts noise words as neither matched nor significant", () => {
    const { matchedTokens, significantTokens } = extractFacets(
      "best botanical wallpaper ideas",
      keywordIndex,
    );

    // "best", "wallpaper" and "ideas" are noise; only "botanical" counts.
    expect(matchedTokens).toBe(1);
    expect(significantTokens).toBe(1);
  });

  it("counts an unrecognized meaningful word as significant but unmatched", () => {
    const { matchedTokens, significantTokens } = extractFacets(
      "botanical brutalist wallpaper",
      keywordIndex,
    );

    expect(matchedTokens).toBe(1);
    expect(significantTokens).toBe(2);
  });

  it("reports zero significant tokens for pure noise", () => {
    expect(extractFacets("buy wallpaper online", keywordIndex)).toMatchObject({
      matchedTokens: 0,
      significantTokens: 0,
    });
  });

  it("ignores punctuation", () => {
    expect(facetsOf("botanical wallpaper — living room!")).toEqual({
      style: ["botanical"],
      room: ["living room"],
    });
  });
});

describe("query-only entries", () => {
  it("resolves ambiguous words when parsing a shopper's keyword", () => {
    expect(facetsOf("study wallpaper")).toEqual({ room: ["home office"] });
    expect(facetsOf("lounge wallpaper")).toEqual({ room: ["living room"] });
    expect(facetsOf("apartment wallpaper")).toEqual({ useCase: ["renters"] });
  });

  it("ignores them when reading product text", () => {
    const index = productTextPhraseIndex();

    // The motif still resolves; the ambiguous room/use-case word does not.
    // "Fern Study" is a drawing, not a home office.
    expect(facetsOf("Fern Study", index)).toEqual({ style: ["botanical"] });
    expect(facetsOf("Lounge Blooms", index)).toEqual({ style: ["floral"] });
    expect(facetsOf("Apartment Ivy", index)).toEqual({ style: ["botanical"] });
  });

  it("keeps unambiguous entries available to product text", () => {
    const index = productTextPhraseIndex();

    expect(facetsOf("Home Office Greenery", index)).toEqual({
      room: ["home office"],
      style: ["botanical"],
    });
    expect(facetsOf("Emerald Palm Canopy", index)).toEqual({
      style: ["tropical"],
    });
  });

  it("returns the same memoized product-text index each call", () => {
    expect(productTextPhraseIndex()).toBe(productTextPhraseIndex());
  });
});

describe("store-specific vocabulary", () => {
  it("learns catalog facet values that are not in the seed list", () => {
    const index = buildPhraseIndex([
      { facet: "color", value: "duck egg blue" },
    ]);

    expect(facetsOf("duck egg blue wallpaper", index)).toEqual({
      color: ["duck egg blue"],
    });
  });

  it("does not let a catalog value shadow a seed synonym", () => {
    // If a store tagged something `style:green`, "green" must still resolve
    // to the colour it means everywhere else in the app.
    const index = buildPhraseIndex([{ facet: "style", value: "green" }]);

    expect(facetsOf("green wallpaper", index)).toEqual({ color: ["green"] });
  });

  it("extends maxPhraseLength so long learned phrases can still match", () => {
    const index = buildPhraseIndex([
      { facet: "style", value: "hand painted chinoiserie panel" },
    ]);

    expect(index.maxPhraseLength).toBeGreaterThanOrEqual(4);
    expect(facetsOf("hand painted chinoiserie panel wallpaper", index)).toEqual({
      style: ["hand painted chinoiserie panel"],
    });
  });
});
