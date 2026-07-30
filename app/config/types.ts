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

/** Slug/title/description/keyword templates. A locale may override these. */
export interface PageTypeSeo {
  /** Deterministic fallback — the AI-written meta (CTR-optimized) wins when valid. */
  title_template: string;
  description_template: string;
  keywords_template: string[];
}

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
   * Value constraints on facets listed in `required_facets`. A page type whose
   * subject is one narrow scenario has to say which one, or it claims every
   * intent that merely carries the facet.
   *
   * `rental-compliance` is the case that proves it: its subject is German
   * tenancy obligations, so it needs `useCase` — but `useCase` is also `kids`,
   * `humid rooms` and `high traffic`, and a kids-room keyword routed to a page
   * about deposit recovery is simply the wrong page. Constraining it to
   * `renters` is what keeps the page type narrow.
   *
   * Keys must appear in `required_facets`; a constraint on a facet that is not
   * required could never be evaluated. Matching is "any of": the intent
   * satisfies the constraint if at least one of its values for that facet is
   * listed.
   */
  required_facet_values?: Partial<Record<IntentFacet, string[]>>;
  /**
   * Markets this page type exists for. Omit for page types that apply
   * everywhere.
   *
   * This is what makes a page type locale-specific rather than merely
   * translated: a page whose reason to exist is a market's own law, housing
   * stock or buying conventions has no counterpart elsewhere, and generating
   * it for every locale would produce content with nothing to say. A page
   * type that names its markets is treated as more specific than one that
   * does not, so it wins the routing tie.
   */
  locales?: string[];
  /**
   * Tie-break between page types that are *equally* specific — same number of
   * required facets, same constraint count, same market scope. Higher wins;
   * default 0.
   *
   * It exists because that last comparison is a domain judgment no structural
   * rule can make. `style-room` and `attribute-room` both key off a room plus
   * one more facet, and someone searching "sustainable botanical wallpaper
   * living room" is shopping a style that happens to be sustainable, not a
   * property that happens to be botanical. Encoding that as a number the
   * config author sets is more honest than tie-breaking on filename, which is
   * what the sort did before this field existed.
   */
  routing_priority?: number;
  /**
   * Slug template. `{facet}` tokens resolve to locale-translated facet
   * values; `{wallpaper}` resolves through the locale's token table, so a
   * de-DE page gets `botanische-tapete-wohnzimmer` from the same template.
   */
  slug_template: string;
  seo: PageTypeSeo;
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
  /**
   * ISO 3166-1 alpha-2 country, used to resolve Shopify Markets
   * contextual pricing so schema markup carries the market currency.
   */
  country: string;
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
  /**
   * Localized literals for template tokens like `{wallpaper}`, and for the
   * headings the app itself writes rather than the model.
   *
   * `REQUIRED_LOCALE_TOKENS` lists the ones the app reads by name; the
   * registry rejects a locale that omits any of them, because the failure mode
   * is silent — an English heading on a German page, on a published storefront.
   */
  tokens: Record<string, string>;
  /**
   * Per-page-type overrides of `PageTypeConfig.seo`, keyed by page-type id.
   *
   * A page type's own templates are written in one language's word order.
   * "{Style} Wallpaper for {Room}s" localizes its *values* correctly and its
   * *grammar* not at all: de-DE resolved it to "Botanische Wallpaper for
   * Wohnzimmers". Rather than push every page type toward a lowest common
   * denominator that reads badly everywhere, a market supplies its own
   * phrasing here — and a market whose grammar the shared template already
   * fits (en-GB, en-AU) supplies nothing.
   *
   * Partial: a locale may override the keyword list alone and inherit the
   * title and description, which is the common case.
   */
  seoTemplates?: Record<string, Partial<PageTypeSeo>>;
}

/**
 * Token keys the app resolves by name. Anything else in `tokens` is available
 * to templates but not depended on by code.
 */
export const REQUIRED_LOCALE_TOKENS = [
  "wallpaper",
  "breadcrumb_home",
  "breadcrumb_blog",
  "faq_heading",
  "related_heading",
] as const;
