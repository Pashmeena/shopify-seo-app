import type { LocaleConfig, PageTypeConfig } from "./types";

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
