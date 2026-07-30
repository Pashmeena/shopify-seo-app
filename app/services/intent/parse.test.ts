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
      routePageType(
        {
          style: ["botanical"],
          room: ["kids room"],
          useCase: ["kids"],
        },
        "en-US",
      ),
    ).toBe("style-room");
  });

  it("routes an attribute plus a room to the attribute-room page type", () => {
    // A stated property plus a room is a requirement, not a taste, and no
    // style-led page answers it. Before this page type existed the query
    // resolved to no page type at all.
    expect(parse("washable wallpaper bathroom").pageTypeId).toBe("attribute-room");
    expect(parse("abwaschbare tapete badezimmer", "de-DE").pageTypeId).toBe(
      "attribute-room",
    );
  });

  it("prefers style over attribute when a keyword carries both plus a room", () => {
    // style-room and attribute-room are structurally identical — two required
    // facets, no constraints, no market restriction — so the tie falls to
    // routing_priority. Someone searching "sustainable botanical wallpaper
    // living room" is shopping a style that happens to be sustainable.
    expect(
      routePageType(
        {
          style: ["botanical"],
          attribute: ["sustainable"],
          room: ["living room"],
        },
        "en-US",
      ),
    ).toBe("style-room");
  });

  it("routes nothing when no page type's required facets are present", () => {
    expect(parse("green wallpaper").pageTypeId).toBeNull();
    expect(routePageType({}, "en-US")).toBeNull();
  });

  it("is decided by configuration, never by which file loaded first", () => {
    // The sort used to end at facet count and market restriction, so a full tie
    // was broken by glob order — meaning renaming a config file could silently
    // re-route live keywords. The last comparison is now the page type id.
    const facets = { attribute: ["washable"], room: ["bathroom"] };

    expect(
      new Set(
        Array.from({ length: 25 }, () => routePageType(facets, "en-US")),
      ).size,
    ).toBe(1);
  });
});

describe("locale-specific page types", () => {
  const renterIntent = { useCase: ["renters"] };

  it("prefers a market-specific page type over a general one in that market", () => {
    // rental-compliance exists only for de-DE, where German tenancy law makes
    // residue-free removal a contractual argument. It and use-case both need
    // one facet, but rental-compliance also constrains that facet's value, so
    // it is the more specific of the two.
    expect(routePageType(renterIntent, "de-DE")).toBe("rental-compliance");
  });

  it("does not claim a German use case that is not renting", () => {
    // The bug this closes. rental-compliance needs a useCase, and so does
    // use-case; with no value constraint the market-specific page type won
    // every tie, so *every* German use-case keyword was routed to a page about
    // tenancy law. A German kids-room keyword produced a page about deposit
    // recovery — right products, entirely wrong subject.
    for (const useCase of ["kids", "humid rooms", "high traffic"]) {
      expect(routePageType({ useCase: [useCase] }, "de-DE")).toBe("use-case");
    }
  });

  it("does not claim a German kids room via its derived use case", () => {
    // The path that made the bug easy to hit: "kids room" derives useCase
    // `kids` automatically, so the keyword never had to mention a use case to
    // be captured.
    const parsed = parse("tapete kinderzimmer", "de-DE");

    expect(parsed.facets.useCase).toEqual(["kids"]);
    expect(parsed.pageTypeId).not.toBe("rental-compliance");
  });

  it("still claims a German renting keyword phrased without the word Mietwohnung", () => {
    expect(parse("ablösbare tapete für mieter", "de-DE").pageTypeId).toBe(
      "rental-compliance",
    );
  });

  it("is invisible to every other market", () => {
    for (const locale of ["en-US", "en-AU", "en-GB"]) {
      expect(routePageType(renterIntent, locale)).toBe("use-case");
    }
  });

  it("routes a German renter keyword to it end to end", () => {
    expect(parse("selbstklebende tapete mietwohnung", "de-DE").pageTypeId).toBe(
      "rental-compliance",
    );
  });

  it("routes the same keyword's English equivalent to the general page type", () => {
    expect(parse("peel and stick wallpaper for renters").pageTypeId).toBe(
      "use-case",
    );
  });

  it("still prefers more required facets over market specificity", () => {
    // style-room needs two facets; rental-compliance needs one. Facet count
    // is the primary sort, so a German style x room keyword is not hijacked.
    expect(
      routePageType(
        { style: ["botanical"], room: ["living room"], useCase: ["renters"] },
        "de-DE",
      ),
    ).toBe("style-room");
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
