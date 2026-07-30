import {
  INTENT_FACETS,
  REQUIRED_LOCALE_TOKENS,
  type IntentFacet,
  type LocaleConfig,
  type PageTypeConfig,
  type PageTypeSeo,
} from "./types";

/**
 * Config registry. Page types and locales are discovered from the JSON
 * files in this directory via glob import — adding a market or page type
 * means adding one JSON file, with no code changes anywhere.
 */

const pageTypeModules = import.meta.glob<{ default: PageTypeConfig }>(
  "./page-types/*.json",
  { eager: true },
);

const localeModules = import.meta.glob<{ default: LocaleConfig }>(
  "./locales/*.json",
  { eager: true },
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid config: ${message}`);
}

function validatePageType(config: PageTypeConfig, file: string): PageTypeConfig {
  assert(config.id, `${file} is missing "id"`);
  assert(config.slug_template, `${config.id} is missing "slug_template"`);
  assert(config.required_facets?.length, `${config.id} is missing "required_facets"`);
  assert(config.generation?.system_prompt, `${config.id} is missing generation.system_prompt`);
  assert(config.generation?.user_prompt_template, `${config.id} is missing generation.user_prompt_template`);
  assert(config.output_schema?.type === "object", `${config.id} output_schema must describe an object`);
  assert(
    config.locales === undefined ||
      (Array.isArray(config.locales) && config.locales.length > 0),
    `${config.id} "locales" must be a non-empty array when present`,
  );
  assert(
    config.routing_priority === undefined ||
      Number.isFinite(config.routing_priority),
    `${config.id} "routing_priority" must be a number when present`,
  );

  for (const facet of config.required_facets) {
    assert(
      (INTENT_FACETS as readonly string[]).includes(facet),
      `${config.id} requires unknown facet "${facet}". Known facets: ${INTENT_FACETS.join(", ")}`,
    );
  }

  // A constraint on a facet the page type does not require could never be
  // evaluated, so it would look like a narrowing that silently does nothing.
  for (const [facet, values] of Object.entries(config.required_facet_values ?? {})) {
    assert(
      config.required_facets.includes(facet as IntentFacet),
      `${config.id} constrains "${facet}" in required_facet_values, but does not list it in required_facets`,
    );
    assert(
      Array.isArray(values) && values.length > 0,
      `${config.id} required_facet_values.${facet} must be a non-empty array`,
    );
    for (const value of values) {
      assert(
        value === value.toLowerCase(),
        `${config.id} required_facet_values.${facet} must be lowercase ("${value}"), because facet values are stored lowercase`,
      );
    }
  }

  return config;
}

function validateLocale(config: LocaleConfig, file: string): LocaleConfig {
  assert(config.code, `${file} is missing "code"`);
  assert(config.promptContext, `${config.code} is missing "promptContext"`);
  assert(config.currency, `${config.code} is missing "currency"`);
  assert(
    /^[A-Z]{2}$/.test(config.country ?? ""),
    `${config.code} needs a two-letter uppercase "country" (ISO 3166-1 alpha-2)`,
  );
  assert(
    config.measurementSystem === "imperial" || config.measurementSystem === "metric",
    `${config.code} measurementSystem must be "imperial" or "metric"`,
  );

  // Missing tokens fail silently and visibly: an English heading rendered onto
  // a published page in another language. Cheaper to refuse the config.
  for (const token of REQUIRED_LOCALE_TOKENS) {
    assert(
      config.tokens?.[token],
      `${config.code} is missing tokens.${token}. Every locale must supply it — the app renders it verbatim, so an omission ships as the wrong language.`,
    );
  }

  return config;
}

const pageTypes = new Map<string, PageTypeConfig>(
  Object.entries(pageTypeModules).map(([file, mod]) => {
    const config = validatePageType(mod.default, file);
    return [config.id, config];
  }),
);

const locales = new Map<string, LocaleConfig>(
  Object.entries(localeModules).map(([file, mod]) => {
    const config = validateLocale(mod.default, file);
    return [config.code, config];
  }),
);

for (const pageType of pageTypes.values()) {
  for (const code of pageType.locales ?? []) {
    assert(
      locales.has(code),
      `${pageType.id} is restricted to locale "${code}", which has no config in app/config/locales`,
    );
  }
}

// Cross-file invariants for the locale SEO overrides. Both failures are
// silent otherwise: an override for a renamed page type simply stops applying,
// and one for a page type that market never generates is dead config.
for (const locale of locales.values()) {
  for (const [pageTypeId, override] of Object.entries(locale.seoTemplates ?? {})) {
    const pageType = pageTypes.get(pageTypeId);
    assert(
      pageType,
      `${locale.code} overrides seoTemplates for "${pageTypeId}", which is not a page type. Available: ${[...pageTypes.keys()].join(", ")}`,
    );
    assert(
      !pageType.locales || pageType.locales.includes(locale.code),
      `${locale.code} overrides seoTemplates for "${pageTypeId}", which is restricted to ${pageType.locales?.join(", ")} and never generates in this market`,
    );
    assert(
      override.keywords_template === undefined ||
        (Array.isArray(override.keywords_template) &&
          override.keywords_template.length > 0),
      `${locale.code} seoTemplates.${pageTypeId}.keywords_template must be a non-empty array when present`,
    );
  }
}

export function listPageTypes(): PageTypeConfig[] {
  return [...pageTypes.values()];
}

export function getPageType(id: string): PageTypeConfig {
  const config = pageTypes.get(id);
  if (!config) throw new Error(`Unknown page type "${id}". Available: ${[...pageTypes.keys()].join(", ")}`);
  return config;
}

export function listLocales(): LocaleConfig[] {
  return [...locales.values()];
}

export function getLocale(code: string): LocaleConfig {
  const config = locales.get(code);
  if (!config) throw new Error(`Unknown locale "${code}". Available: ${[...locales.keys()].join(", ")}`);
  return config;
}

/**
 * Non-throwing lookup, for decisions that run over stored pages. A locale
 * config can be removed after pages were generated in it, and a pure
 * decision should treat that as "unknown market" rather than crash.
 */
export function findLocale(code: string): LocaleConfig | null {
  return locales.get(code) ?? null;
}

/** Localize a canonical facet value (falls back to the English value). */
export function localizeFacetValue(value: string, locale: LocaleConfig): string {
  return locale.facetTranslations[value.toLowerCase()] ?? value;
}

/**
 * The SEO templates to use for a page type in a market: the page type's own,
 * with any the locale overrides swapped in.
 *
 * Field-by-field rather than whole-object, so a market can supply just the
 * keyword list — the part that is always wrong in a foreign language, because
 * the shared templates hard-code English connectives — and inherit the rest.
 */
export function seoTemplatesFor(
  pageType: PageTypeConfig,
  locale: LocaleConfig,
): PageTypeSeo {
  const override = locale.seoTemplates?.[pageType.id];
  if (!override) return pageType.seo;
  return {
    title_template: override.title_template ?? pageType.seo.title_template,
    description_template:
      override.description_template ?? pageType.seo.description_template,
    keywords_template: override.keywords_template ?? pageType.seo.keywords_template,
  };
}
