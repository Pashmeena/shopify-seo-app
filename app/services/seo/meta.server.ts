import { localizeFacetValue, seoTemplatesFor } from "../../config/index.server";
import type { LocaleConfig, PageTypeConfig } from "../../config/types";
import { truncate } from "../../lib/text";
import { fillTemplate } from "../generation/prompt.server";
import type { PlpContent } from "../generation/types";
import type { IntentProfile } from "../intent/types";

/**
 * Meta title/description resolution. The AI-written meta (a separate,
 * CTR-focused objective in the prompt, schema-capped at 60/155 chars) is
 * primary; the deterministic templates are the fallback and the sole source
 * for the keywords list. Hard length limits are enforced here regardless of
 * source.
 *
 * Which templates apply is a function of both the page type and the market:
 * see `seoTemplatesFor`. Templates may use `{facet}` tokens and any of the
 * locale's own `tokens`, so `{wallpaper}` is "wallpaper" in en-US and "tapete"
 * in de-DE from one template — the same mechanism the slug builder uses, for
 * the same reason.
 */

const MAX_TITLE = 60;
const MAX_DESCRIPTION = 155;

/** Facets available to templates, in both lowercase and capitalized form. */
const TEMPLATE_FACETS = [
  "style",
  "room",
  "color",
  "material",
  "attribute",
  "useCase",
] as const;

/** Facet values and locale tokens are stored lowercase; titles need otherwise. */
function capitalizeWords(value: string): string {
  return value.replace(/(^|[\s-])(\p{Ll})/gu, (_, boundary, letter) =>
    `${boundary}${letter.toUpperCase()}`,
  );
}

/** `style` → `Style`, `useCase` → `UseCase`. */
function capitalizedToken(name: string): string {
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

/**
 * Template values, each in two forms.
 *
 * `{style}` is the value as stored — lowercase, right for mid-sentence use in
 * an English description. `{Style}` is capitalized, right for a title, and
 * required rather than optional in German, where nouns are capitalized
 * wherever they appear. Which one to use is the config author's call, so both
 * are offered instead of guessing per position.
 *
 * Locale tokens are offered the same way. A shared template that spells the
 * product noun in English localizes its values and not its vocabulary, which
 * is how de-DE once resolved "{Style} Wallpaper for {Room}s" to "Botanische
 * Wallpaper for Wohnzimmers".
 */
function templateValues(
  intent: IntentProfile,
  locale: LocaleConfig,
  brand: string,
  productCount: number,
): Record<string, string | number> {
  // Written in ascending precedence, so a collision resolves the way a config
  // author would expect: the locale's vocabulary is the broadest source, the
  // two literals the resolver injects are more specific, and the facet values —
  // the page's actual subject — win outright. Assigning in the other order
  // would let a locale that happened to define a `brand` token rename the shop.
  const values: Record<string, string | number> = {};

  for (const [token, value] of Object.entries(locale.tokens)) {
    values[token] = value;
    values[capitalizedToken(token)] = capitalizeWords(value);
  }

  values.brand = brand;
  values.product_count = productCount;

  for (const facet of TEMPLATE_FACETS) {
    const stored = intent.facets[facet]?.[0];
    const value = stored ? localizeFacetValue(stored, locale) : "";
    values[facet] = value;
    values[capitalizedToken(facet)] = capitalizeWords(value);
  }

  return values;
}

export interface ResolvedMeta {
  title: string;
  description: string;
  keywords: string[];
}

/**
 * A token the intent does not carry resolves to an empty string, which leaves
 * a doubled or leading space behind. Templates are written for the fully
 * populated case, so tidying up here is cheaper than making every template
 * defensive.
 */
function tidy(text: string): string {
  return (
    text
      .replace(/\s+/g, " ")
      // Punctuation that hugs the preceding word. Not the pipe: it separates
      // the title from the brand and wants a space on both sides.
      .replace(/\s+([,.:;!?])/g, "$1")
      .trim()
  );
}

export function resolveMeta(
  content: PlpContent,
  pageType: PageTypeConfig,
  intent: IntentProfile,
  locale: LocaleConfig,
  brand: string,
  productCount: number,
): ResolvedMeta {
  const values = templateValues(intent, locale, brand, productCount);
  const templates = seoTemplatesFor(pageType, locale);

  const fallbackTitle = tidy(fillTemplate(templates.title_template, values));
  const fallbackDescription = tidy(
    fillTemplate(templates.description_template, values),
  );

  return {
    title: truncate(content.meta?.title || fallbackTitle, MAX_TITLE),
    description: truncate(content.meta?.description || fallbackDescription, MAX_DESCRIPTION),
    keywords: templates.keywords_template
      .map((template) => tidy(fillTemplate(template, values)))
      .filter((keyword) => keyword.length > 0),
  };
}
