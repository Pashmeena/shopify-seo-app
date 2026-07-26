import { getLocale, localizeFacetValue } from "../../config/index.server";
import type { LocaleConfig, PageTypeConfig } from "../../config/types";
import { slugify } from "../../lib/slugify";
import type { IntentProfile } from "../intent/types";

/**
 * Localized slug building. One slug_template per page type; every token
 * resolves through the locale config, so the same template yields
 * `en-us-botanical-wallpaper-living-room` and
 * `de-de-botanische-tapete-wohnzimmer` with zero code per market.
 *
 * Tokens: `{facet}` → localized primary facet value (`{facet?}` variants
 * drop silently when the intent lacks the facet); bare words like
 * `{wallpaper}` resolve through the locale's token table.
 */
export function buildSlug(
  pageType: PageTypeConfig,
  intent: IntentProfile,
  locale: LocaleConfig,
): string {
  const body = pageType.slug_template.replace(
    /\{([a-zA-Z]+)(\?)?\}/g,
    (_, token: string, optional?: string) => {
      const localizedToken = locale.tokens[token.toLowerCase()];
      if (localizedToken) return localizedToken;

      const facetValue = intent.facets[token as keyof IntentProfile["facets"]]?.[0];
      if (facetValue) return localizeFacetValue(facetValue, locale);

      if (optional) return "";
      // Required facet missing — keep the English token so the gap is visible.
      return token;
    },
  );

  return `${locale.slugPrefix}-${slugify(body)}`;
}

/** The slug an equivalent page would have in another locale (for hreflang pairing). */
export function slugForLocale(
  pageType: PageTypeConfig,
  intent: IntentProfile,
  localeCode: string,
): string {
  return buildSlug(pageType, intent, getLocale(localeCode));
}
