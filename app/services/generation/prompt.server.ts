import type { LocaleConfig, PageTypeConfig } from "../../config/types";
import { truncate } from "../../lib/text";
import type { CatalogProduct } from "../catalog/types";
import type { IntentProfile } from "../intent/types";
import type { ResolvedSettings } from "../settings/settings.server";

/** Replace `{key}` tokens; unknown tokens resolve to an empty string. */
export function fillTemplate(
  template: string,
  values: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) =>
    values[key] !== undefined ? String(values[key]) : "",
  );
}

/** Compact, generation-relevant view of a product — no fields the model shouldn't invent around. */
export function productForPrompt(product: CatalogProduct) {
  return {
    id: product.id,
    title: product.title,
    price: `${product.price.toFixed(2)} ${product.currencyCode}`,
    styles: product.facets.style ?? [],
    rooms: product.facets.room ?? [],
    colors: product.facets.color ?? [],
    material: product.facets.material ?? [],
    attributes: product.facets.attribute ?? [],
    use_cases: product.facets.useCase ?? [],
    description: truncate(product.description, 300),
  };
}

/** The market briefing the model must write for — the heart of locale support. */
export function localeContextForPrompt(locale: LocaleConfig): string {
  return [
    `Market: ${locale.market} (${locale.code})`,
    `Language: ${locale.languageName}`,
    `Currency: ${locale.currency}`,
    `Measurement system: ${locale.measurementSystem}`,
    locale.promptContext,
  ].join("\n");
}

export interface RelatedPageRef {
  title: string;
  slug: string;
  sharedFacets: string[];
}

export interface PromptInput {
  pageType: PageTypeConfig;
  locale: LocaleConfig;
  intent: IntentProfile;
  products: CatalogProduct[];
  settings: ResolvedSettings;
  relatedPages: RelatedPageRef[];
}

export interface BuiltPrompt {
  system: string;
  user: string;
  temperature: number;
}

export function buildGenerationPrompt(input: PromptInput): BuiltPrompt {
  const { pageType, locale, intent, products, settings, relatedPages } = input;
  const generation = pageType.generation;

  const user = fillTemplate(generation.user_prompt_template, {
    keyword: intent.keyword,
    intent_json: JSON.stringify(intent.facets, null, 2),
    products_json: JSON.stringify(products.map(productForPrompt), null, 2),
    locale_context: localeContextForPrompt(locale),
    brand_name: settings.brandName,
    brand_tone: settings.brandTone,
    competitor_urls:
      settings.competitorUrlList.length > 0 ? settings.competitorUrlList.join(", ") : "none provided",
    section_count: generation.section_count,
    faq_count: generation.faq_count,
    related_pages_json: JSON.stringify(relatedPages, null, 2),
    product_count: products.length,
  });

  // The output_schema is included verbatim so the model produces the exact
  // shape rather than inferring it — without this, retries can't converge
  // on structural errors like "additionalProperties".
  const schemaBlock =
    "\n\nOUTPUT SCHEMA — your entire response must be ONE JSON object that validates against this JSON Schema. " +
    "Use exactly the property names and types declared here; never add properties the schema does not declare:\n" +
    JSON.stringify(pageType.output_schema, null, 2);

  return {
    system: generation.system_prompt,
    user: user + schemaBlock,
    temperature: generation.temperature,
  };
}
