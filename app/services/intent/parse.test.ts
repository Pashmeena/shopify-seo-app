import { describe, expect, it } from "vitest";
import { product } from "../../test-support/catalog";
import { buildLexicon } from "./lexicon.server";
import { parseWithRules, routePageType } from "./parse.server";

const lexicon = buildLexicon([]);

function parse(keyword: string, locale = "en-US") {
  return parseWithRules(keyword, locale, lexicon);
}

describe("facet extraction", () => {
  it("parses the brief's worked example", () => {
    const parsed = parse("sustainable midnight blue wallpaper kids room");

    expect(parsed.facets).toEqual({
      attribute: ["sustainable"],
      color: ["midnight blue"],
      room: ["kids room"],
      // Derived: a kids-room intent implies the use case and the buyer.
      useCase: ["kids"],
      audience: ["parents"],
    });
  });

  it("parses a German keyword to canonical English facets", () => {
    const parsed = parse("selbstklebende tapete mietwohnung", "de-DE");

    expect(parsed.facets).toEqual({
      material: ["peel and stick"],
      useCase: ["renters"],
      audience: ["renters"],
    });
    expect(parsed.locale).toBe("de-DE");
  });

  it("keeps the original keyword verbatim", () => {
    expect(parse("Botanical Wallpaper Living Room").keyword).toBe(
      "Botanical Wallpaper Living Room",
    );
  });
});

describe("derived facets", () => {
  it("adds the kids use case and parent audience from a kids room", () => {
    expect(parse("botanical wallpaper kids room").facets).toMatchObject({
      useCase: ["kids"],
      audience: ["parents"],
    });
  });

  it("adds a renter audience from a renter use case", () => {
    expect(parse("peel and stick wallpaper for renters").facets).toMatchObject({
      useCase: ["renters"],
      audience: ["renters"],
    });
  });

  it("does not invent an audience where none follows", () => {
    expect(parse("botanical wallpaper living room").facets.audience).toBeUndefined();
  });
});

describe("confidence", () => {
  it("is 1 when every meaningful token resolved", () => {
    expect(parse("botanical wallpaper living room").confidence).toBe(1);
  });

  it("falls when the keyword carries words the vocabulary does not know", () => {
    const parsed = parse("brutalist concrete wallpaper living room");

    expect(parsed.confidence).toBeGreaterThan(0);
    expect(parsed.confidence).toBeLessThan(1);
  });

  it("is 0 when the keyword is nothing but noise", () => {
    expect(parse("buy wallpaper online").confidence).toBe(0);
  });

  it("is 0 for an empty keyword rather than NaN", () => {
    expect(parse("").confidence).toBe(0);
  });
});

describe("page type routing", () => {
  it("routes style plus room to the style-room page type", () => {
    expect(parse("botanical wallpaper living room").pageTypeId).toBe("style-room");
  });

  it("routes a bare use case to the use-case page type", () => {
    expect(parse("wallpaper for renters").pageTypeId).toBe("use-case");
  });

  it("prefers the most specific page type when several apply", () => {
    // A kids-room keyword satisfies use-case (via the derived kids use case)
    // and style-room; style-room requires more facets, so it wins.
    expect(
      routePageType({
        style: ["botanical"],
        room: ["kids room"],
        useCase: ["kids"],
      }),
    ).toBe("style-room");
  });

  it("routes nothing when no page type's required facets are present", () => {
    expect(parse("green wallpaper").pageTypeId).toBeNull();
    expect(routePageType({})).toBeNull();
  });
});

describe("store vocabulary", () => {
  it("recognizes a facet value that exists only in this store's catalog", () => {
    const storeLexicon = buildLexicon([
      product({ tags: ["color:duck-egg-blue", "room:living-room"] }),
    ]);

    const parsed = parseWithRules(
      "duck egg blue wallpaper living room",
      "en-US",
      storeLexicon,
    );

    expect(parsed.facets).toMatchObject({
      color: ["duck egg blue"],
      room: ["living room"],
    });
    expect(parsed.confidence).toBe(1);
  });
});
