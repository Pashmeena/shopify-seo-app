import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import {
  getLocale,
  listLocales,
  listPageTypes,
  seoTemplatesFor,
} from "./index.server";
import { buildSlug } from "../services/seo/slug.server";
import { INTENT_FACETS, REQUIRED_LOCALE_TOKENS, type PageTypeSeo } from "./types";

/**
 * The config registry is the app's extension point: a page type or a market is
 * a JSON file and nothing else. That only holds if a malformed file fails
 * loudly, so these assert the invariants the registry promises.
 */

const pageTypes = listPageTypes();
const locales = listLocales();

/** Facets a template may name, as stored and capitalized for titles. */
const TEMPLATE_FACETS = ["style", "room", "color", "material", "attribute", "useCase"];

function bothCases(names: readonly string[]): string[] {
  return [...names, ...names.map((name) => name[0].toUpperCase() + name.slice(1))];
}

/**
 * Tokens any template may use, in either case: the facets, the two literals the
 * resolver injects, and the locale tokens *every* market must define.
 */
const guaranteedTokens = new Set([
  ...bothCases(TEMPLATE_FACETS),
  ...bothCases(REQUIRED_LOCALE_TOKENS),
  "brand",
  "product_count",
]);

function seoTemplateStrings(seo: PageTypeSeo): string[] {
  return [seo.title_template, seo.description_template, ...seo.keywords_template];
}

function placeholdersIn(template: string): string[] {
  return (template.match(/\{([a-zA-Z0-9_]+)\}/g) ?? []).map((token) =>
    token.slice(1, -1),
  );
}

describe("page types", () => {
  it("discovers every shipped page type", () => {
    expect(pageTypes.map((pageType) => pageType.id).sort()).toEqual([
      "attribute-room",
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
      // A page type's own templates are shared by every market, so they may
      // only use tokens every market is guaranteed to define. A locale token
      // that only some locales happen to carry would render as an empty string
      // in the rest — silently dropping part of the title.
      for (const template of seoTemplateStrings(pageType.seo)) {
        for (const token of placeholdersIn(template)) {
          expect(guaranteedTokens).toContain(token);
        }
      }
    },
  );

  it("only routes a keyword to a page type whose value constraints it satisfies", () => {
    // The pairing that made this necessary: `rental-compliance` needs a
    // useCase, and so does `use-case`, so before the constraint existed every
    // German use-case keyword — kids rooms included — was routed to a page
    // about tenancy law.
    const rental = pageTypes.find((pageType) => pageType.id === "rental-compliance")!;

    expect(rental.required_facet_values?.useCase).toEqual(["renters"]);
    for (const facet of Object.keys(rental.required_facet_values ?? {})) {
      expect(rental.required_facets).toContain(facet);
    }
  });

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
      // The briefing is what makes a market more than a translation.
      expect(locale.promptContext.length).toBeGreaterThan(200);
    },
  );

  it.each(locales.map((locale) => [locale.code, locale] as const))(
    "%s supplies every token the app renders by name",
    (_code, locale) => {
      // These are the strings the app writes rather than the model: the FAQ and
      // related-guides headings, the breadcrumb labels, the product noun. An
      // omission does not throw at render time, it ships an English heading
      // onto a page in another language.
      for (const token of REQUIRED_LOCALE_TOKENS) {
        expect(locale.tokens[token], `${locale.code} tokens.${token}`).toBeTruthy();
      }
    },
  );

  it.each(locales.map((locale) => [locale.code, locale] as const))(
    "%s only uses placeholders it can actually resolve in its SEO overrides",
    (_code, locale) => {
      // A locale override may use that locale's own extra tokens as well as the
      // guaranteed set — but not a token it never defines.
      const resolvable = new Set([
        ...guaranteedTokens,
        ...bothCases(Object.keys(locale.tokens)),
      ]);

      for (const pageTypeId of Object.keys(locale.seoTemplates ?? {})) {
        const merged = seoTemplatesFor(
          pageTypes.find((pageType) => pageType.id === pageTypeId)!,
          locale,
        );
        for (const template of seoTemplateStrings(merged)) {
          for (const token of placeholdersIn(template)) {
            expect(resolvable, `${locale.code}/${pageTypeId}`).toContain(token);
          }
        }
      }
    },
  );

  it("leaves no English literal in a German SEO template", () => {
    // The bug this closes: `{style} wallpaper {room}` resolved for de-DE to
    // "botanische wallpaper wohnzimmer" — every value translated, the
    // vocabulary not. A German override that spelled the noun or the
    // preposition in English would be the same mistake in a different file.
    //
    // Placeholders are stripped first: `{wallpaper}` is the *token*, and it is
    // exactly what a correct override uses. Only the literal text is checked.
    const de = getLocale("de-DE");
    const english = /\b(wallpaper|wallpapers|for|the|and|best|ideas)\b/i;

    for (const [pageTypeId, override] of Object.entries(de.seoTemplates ?? {})) {
      for (const template of [
        override.title_template,
        override.description_template,
        ...(override.keywords_template ?? []),
      ]) {
        const literals = (template ?? "").replace(/\{[a-zA-Z0-9_]+\}/g, " ");
        expect(literals, `${pageTypeId}: "${template}"`).not.toMatch(english);
      }
    }
  });

  it("gives each market a distinct slug prefix, so slugs cannot collide", () => {
    const prefixes = locales.map((locale) => locale.slugPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("rejects an unknown locale by name", () => {
    expect(() => getLocale("fr-FR")).toThrow(/Unknown locale/);
  });
});
