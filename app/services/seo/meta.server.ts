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
  return {
    style: localizedFacet("style"),
    room: localizedFacet("room"),
    color: localizedFacet("color"),
    material: localizedFacet("material"),
    attribute: localizedFacet("attribute"),
    useCase: localizedFacet("useCase"),
    brand,
    product_count: productCount,
  };
}

export interface ResolvedMeta {
  title: string;
  description: string;
  keywords: string[];
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

  const fallbackTitle = fillTemplate(pageType.seo.title_template, values);
  const fallbackDescription = fillTemplate(pageType.seo.description_template, values);

  return {
    title: truncate(content.meta?.title || fallbackTitle, MAX_TITLE),
    description: truncate(content.meta?.description || fallbackDescription, MAX_DESCRIPTION),
    keywords: pageType.seo.keywords_template
      .map((template) => fillTemplate(template, values).replace(/\s+/g, " ").trim())
      .filter((keyword) => keyword.length > 0),
  };
}
