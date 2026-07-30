import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { getLocale, listLocales, listPageTypes } from "./index.server";
import { buildSlug } from "../services/seo/slug.server";
import { INTENT_FACETS } from "./types";

/**
 * The config registry is the app's extension point: a page type or a market is
 * a JSON file and nothing else. That only holds if a malformed file fails
 * loudly, so these assert the invariants the registry promises.
 */

const pageTypes = listPageTypes();
const locales = listLocales();

describe("page types", () => {
  it("discovers every shipped page type", () => {
    expect(pageTypes.map((pageType) => pageType.id).sort()).toEqual([
      "rental-compliance",
      "style-room",
      "use-case",
    ]);
  });

  it.each(pageTypes.map((pageType) => [pageType.id, pageType] as const))(
    "%s has a compilable output_schema",
    (_id, pageType) => {
      const ajv = new Ajv({ allErrors: true, strict: false });
      expect(() => ajv.compile(pageType.output_schema)).not.toThrow();
    },
  );

  it.each(pageTypes.map((pageType) => [pageType.id, pageType] as const))(
    "%s requires only known facets",
    (_id, pageType) => {
      for (const facet of pageType.required_facets) {
        expect(INTENT_FACETS).toContain(facet);
      }
    },
  );

  it.each(pageTypes.map((pageType) => [pageType.id, pageType] as const))(
    "%s declares every placeholder its prompt uses",
    (_id, pageType) => {
      // A token with no value silently renders as an empty string, so a typo
      // would quietly strip part of the brief.
      const known = new Set([
        "keyword",
        "intent_json",
        "products_json",
        "locale_context",
        "brand_name",
        "brand_tone",
        "section_count",
        "faq_count",
        "related_pages_json",
        "competitor_urls",
        "product_count",
      ]);
      const used =
        pageType.generation.user_prompt_template.match(/\{([a-zA-Z0-9_]+)\}/g) ??
        [];
      for (const token of used) {
        expect(known).toContain(token.slice(1, -1));
      }
    },
  );

  it.each(pageTypes.map((pageType) => [pageType.id, pageType] as const))(
    "%s declares every placeholder its SEO templates use",
    (_id, pageType) => {
      // Facets come in two forms: `{style}` as stored, `{Style}` capitalized
      // for titles and for German, where nouns always are. A typo in either
      // renders as an empty string and silently drops part of the title.
      const facets = ["style", "room", "color", "material", "attribute", "useCase"];
      const known = new Set([
        ...facets,
        ...facets.map((facet) => facet[0].toUpperCase() + facet.slice(1)),
        "brand",
        "product_count",
      ]);
      const templates = [
        pageType.seo.title_template,
        pageType.seo.description_template,
        ...pageType.seo.keywords_template,
      ];

      for (const template of templates) {
        for (const token of template.match(/\{([a-zA-Z0-9_]+)\}/g) ?? []) {
          expect(known).toContain(token.slice(1, -1));
        }
      }
    },
  );

  it.each(pageTypes.map((pageType) => [pageType.id, pageType] as const))(
    "%s builds a URL-safe slug from its template",
    (_id, pageType) => {
      const locale = getLocale(pageType.locales?.[0] ?? "en-US");
      const facets = Object.fromEntries(
        pageType.required_facets.map((facet) => [facet, ["renters"]]),
      );

      expect(
        buildSlug(
          pageType,
          {
            keyword: "probe",
            locale: locale.code,
            facets,
            pageTypeId: pageType.id,
            confidence: 1,
            method: "rules",
          },
          locale,
        ),
      ).toMatch(/^[a-z0-9-]+$/);
    },
  );

  it("restricts locale-specific page types to configured markets", () => {
    for (const pageType of pageTypes) {
      for (const code of pageType.locales ?? []) {
        expect(() => getLocale(code)).not.toThrow();
      }
    }
  });
});

describe("locales", () => {
  it("discovers every shipped market", () => {
    expect(locales.map((locale) => locale.code).sort()).toEqual([
      "de-DE",
      "en-AU",
      "en-GB",
      "en-US",
    ]);
  });

  it.each(locales.map((locale) => [locale.code, locale] as const))(
    "%s carries a complete market definition",
    (_code, locale) => {
      expect(locale.country).toMatch(/^[A-Z]{2}$/);
      expect(locale.currency).toMatch(/^[A-Z]{3}$/);
      expect(["imperial", "metric"]).toContain(locale.measurementSystem);
      expect(locale.slugPrefix).toBe(locale.code.toLowerCase());
      expect(locale.tokens.wallpaper).toBeTruthy();
      // The briefing is what makes a market more than a translation.
      expect(locale.promptContext.length).toBeGreaterThan(200);
    },
  );

  it("gives each market a distinct slug prefix, so slugs cannot collide", () => {
    const prefixes = locales.map((locale) => locale.slugPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("rejects an unknown locale by name", () => {
    expect(() => getLocale("fr-FR")).toThrow(/Unknown locale/);
  });
});
