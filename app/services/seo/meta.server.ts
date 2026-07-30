import { localizeFacetValue } from "../../config/index.server";
import type { LocaleConfig, PageTypeConfig } from "../../config/types";
import { truncate } from "../../lib/text";
import { fillTemplate } from "../generation/prompt.server";
import type { PlpContent } from "../generation/types";
import type { IntentProfile } from "../intent/types";

/**
 * Meta title/description resolution. The AI-written meta (a separate,
 * CTR-focused objective in the prompt, schema-capped at 60/155 chars) is
 * primary; the page type's deterministic templates are the fallback and
 * the source for the keywords list. Hard length limits are enforced here
 * regardless of source.
 */

const MAX_TITLE = 60;
const MAX_DESCRIPTION = 155;

/** Facet values are stored lowercase because they also build slugs. */
function capitalizeWords(value: string): string {
  return value.replace(/(^|[\s-])(\p{Ll})/gu, (_, boundary, letter) =>
    `${boundary}${letter.toUpperCase()}`,
  );
}

/**
 * Template values, each facet in two forms.
 *
 * `{style}` is the value as stored — lowercase, right for mid-sentence use in
 * an English description. `{Style}` is capitalized, right for a title, and
 * required rather than optional in German, where nouns are capitalized
 * wherever they appear. Which one to use is the config author's call, so both
 * are offered instead of guessing per position.
 */
function templateValues(
  intent: IntentProfile,
  locale: LocaleConfig,
  brand: string,
  productCount: number,
): Record<string, string | number> {
  const localizedFacet = (facet: keyof IntentProfile["facets"]): string => {
    const value = intent.facets[facet]?.[0];
    return value ? localizeFacetValue(value, locale) : "";
  };

  const facets = ["style", "room", "color", "material", "attribute", "useCase"] as const;
  const values: Record<string, string | number> = {
    brand,
    product_count: productCount,
  };
  for (const facet of facets) {
    const value = localizedFacet(facet);
    values[facet] = value;
    values[capitalizeWords(facet.slice(0, 1)) + facet.slice(1)] =
      capitalizeWords(value);
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

  const fallbackTitle = tidy(fillTemplate(pageType.seo.title_template, values));
  const fallbackDescription = tidy(
    fillTemplate(pageType.seo.description_template, values),
  );

  return {
    title: truncate(content.meta?.title || fallbackTitle, MAX_TITLE),
    description: truncate(content.meta?.description || fallbackDescription, MAX_DESCRIPTION),
    keywords: pageType.seo.keywords_template
      .map((template) => tidy(fillTemplate(template, values)))
      .filter((keyword) => keyword.length > 0),
  };
}
