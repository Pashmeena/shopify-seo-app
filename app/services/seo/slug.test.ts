import { describe, expect, it } from "vitest";
import { getLocale, getPageType } from "../../config/index.server";
import { intent } from "../../test-support/catalog";
import { buildSlug, slugForLocale } from "./slug.server";

/**
 * Localized slugs are the claim that adding a market is configuration rather
 * than code: one template per page type, resolved through each locale's own
 * token and facet tables.
 */

const styleRoom = getPageType("style-room");
const useCase = getPageType("use-case");

describe("localization", () => {
  const botanicalLivingRoom = intent({
    style: ["botanical"],
    room: ["living room"],
  });

  it("resolves an English slug from the template", () => {
    expect(buildSlug(styleRoom, botanicalLivingRoom, getLocale("en-US"))).toBe(
      "en-us-botanical-wallpaper-living-room",
    );
  });

  it("resolves the same template into German with no code path of its own", () => {
    expect(buildSlug(styleRoom, botanicalLivingRoom, getLocale("de-DE"))).toBe(
      "de-de-botanische-tapete-wohnzimmer",
    );
  });

  it("gives each English market its own prefix so slugs cannot collide", () => {
    const slugs = ["en-US", "en-GB", "en-AU"].map((code) =>
      buildSlug(styleRoom, botanicalLivingRoom, getLocale(code)),
    );

    expect(slugs).toEqual([
      "en-us-botanical-wallpaper-living-room",
      "en-gb-botanical-wallpaper-living-room",
      "en-au-botanical-wallpaper-living-room",
    ]);
    expect(new Set(slugs).size).toBe(3);
  });

  it("falls back to the canonical English value when a locale has no translation", () => {
    // de-DE has no facetTranslations entry for "chinoiserie".
    expect(
      buildSlug(
        styleRoom,
        intent({ style: ["chinoiserie"], room: ["bedroom"] }),
        getLocale("de-DE"),
      ),
    ).toBe("de-de-chinoiserie-tapete-schlafzimmer");
  });
});

describe("optional tokens", () => {
  it("drops an optional facet the intent does not carry", () => {
    // use-case's template is {material?}-{wallpaper}-{useCase}.
    expect(
      buildSlug(useCase, intent({ useCase: ["renters"] }), getLocale("en-US")),
    ).toBe("en-us-wallpaper-renters");
  });

  it("includes the optional facet when present", () => {
    expect(
      buildSlug(
        useCase,
        intent({ material: ["peel and stick"], useCase: ["renters"] }),
        getLocale("en-US"),
      ),
    ).toBe("en-us-peel-and-stick-wallpaper-renters");
  });

  it("localizes an optional facet too", () => {
    expect(
      buildSlug(
        useCase,
        intent({ material: ["peel and stick"], useCase: ["renters"] }),
        getLocale("de-DE"),
      ),
    ).toBe("de-de-selbstklebende-tapete-mietwohnung");
  });
});

describe("slug hygiene", () => {
  it("keeps a required facet's token visible when the intent lacks it", () => {
    // Leaving "room" in the slug makes the gap obvious rather than silently
    // producing a slug that collides with every other roomless page.
    expect(
      buildSlug(styleRoom, intent({ style: ["botanical"] }), getLocale("en-US")),
    ).toBe("en-us-botanical-wallpaper-room");
  });

  it("collapses the separators a multi-word facet value introduces", () => {
    const slug = buildSlug(
      styleRoom,
      intent({ style: ["art deco"], room: ["home office"] }),
      getLocale("en-US"),
    );

    expect(slug).toBe("en-us-art-deco-wallpaper-home-office");
    expect(slug).not.toMatch(/--/);
  });

  it("produces a slug safe for a URL", () => {
    expect(
      buildSlug(styleRoom, intent({ style: ["botanical"], room: ["kids room"] }), getLocale("de-DE")),
    ).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("slugForLocale", () => {
  it("gives the slug an equivalent page would have in another market", () => {
    const source = intent({ style: ["botanical"], room: ["living room"] });

    expect(slugForLocale(styleRoom, source, "de-DE")).toBe(
      buildSlug(styleRoom, source, getLocale("de-DE")),
    );
  });

  it("throws for a market that has no config, rather than inventing one", () => {
    expect(() =>
      slugForLocale(styleRoom, intent({ style: ["botanical"] }), "fr-FR"),
    ).toThrow(/Unknown locale/);
  });
});
