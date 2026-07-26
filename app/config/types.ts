/**
 * Shapes for the two JSON config families that drive the app:
 *
 * - Page-type configs (app/config/page-types/*.json) — one per PLP archetype.
 *   Control slug/SEO templates, generation parameters (prompts, temperature)
 *   and the JSON Schema every AI response is validated against.
 *
 * - Locale configs (app/config/locales/*.json) — one per target market.
 *   Adding a market means adding one JSON file here; no code changes.
 */

/** Facets an intent can carry. Keys double as tag namespaces in the catalog. */
export const INTENT_FACETS = [
  "style",
  "room",
  "color",
  "material",
  "attribute",
  "useCase",
  "audience",
] as const;

export type IntentFacet = (typeof INTENT_FACETS)[number];

export interface PageTypeConfig {
  id: string;
  category: string;
  meta: {
    title: string;
    description: string;
  };
  /**
   * Facets that must be present in a parsed intent for this page type to
   * apply. Used to route a keyword to the right page type.
   */
  required_facets: IntentFacet[];
  /**
   * Slug template. `{facet}` tokens resolve to locale-translated facet
   * values; `{wallpaper}` resolves through the locale's token table, so a
   * de-DE page gets `botanische-tapete-wohnzimmer` from the same template.
   */
  slug_template: string;
  seo: {
    /** Deterministic fallback — the AI-written meta (CTR-optimized) wins when valid. */
    title_template: string;
    description_template: string;
    keywords_template: string[];
  };
  generation: {
    temperature: number;
    section_count: number;
    faq_count: number;
    system_prompt: string;
    user_prompt_template: string;
  };
  /** JSON Schema (draft-07) every AI response must satisfy before it can proceed. */
  output_schema: Record<string, unknown>;
}

export interface LocaleConfig {
  code: string;
  label: string;
  languageCode: string;
  languageName: string;
  market: string;
  currency: string;
  measurementSystem: "imperial" | "metric";
  /** Prefixed onto slugs/handles, e.g. `de-de-botanische-tapete-wohnzimmer`. */
  slugPrefix: string;
  hreflang: string;
  /**
   * Market briefing injected verbatim into every generation prompt:
   * language register, measurement conventions, local terminology,
   * cultural references. This is what makes locale architectural rather
   * than "translate at the end".
   */
  promptContext: string;
  /** Canonical facet value → localized term, used in slugs and templates. */
  facetTranslations: Record<string, string>;
  /** Localized literals for template tokens like `{wallpaper}`. */
  tokens: Record<string, string>;
}
