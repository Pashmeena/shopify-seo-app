import type { LocaleConfig } from "../../config/types";
import type { CatalogProduct } from "../catalog/types";
import type { PlpContent } from "../generation/types";
import { productUrl, storeBaseUrl } from "./urls.server";

/**
 * Deterministic JSON-LD builders. Schema markup carries facts (prices,
 * URLs, product names) that must be exact, so it is assembled in code
 * from real catalog data — the AI supplies copy (FAQ text, alt text),
 * never structured facts. ItemList/ListItem per product is what enables
 * product carousels in Google Search.
 */

interface JsonLdInput {
  shop: string;
  url: string;
  content: PlpContent;
  products: CatalogProduct[];
  locale: LocaleConfig;
  brandName: string;
  blogHandle: string;
}

function altTextFor(content: PlpContent, product: CatalogProduct): string | undefined {
  return content.product_alt_texts.find(
    (entry) => entry.product_id === product.id || entry.product_id === product.handle,
  )?.alt_text;
}

function productNode(input: JsonLdInput, product: CatalogProduct): Record<string, unknown> {
  const alt = altTextFor(input.content, product);
  return {
    "@type": "Product",
    name: product.title,
    url: product.onlineStoreUrl ?? productUrl(input.shop, product.handle),
    ...(product.imageUrl
      ? {
          image: {
            "@type": "ImageObject",
            url: product.imageUrl,
            ...(alt ? { description: alt } : {}),
          },
        }
      : {}),
    brand: { "@type": "Brand", name: product.vendor },
    offers: {
      "@type": "Offer",
      price: product.price.toFixed(2),
      priceCurrency: product.currencyCode,
      availability: "https://schema.org/InStock",
      url: product.onlineStoreUrl ?? productUrl(input.shop, product.handle),
    },
  };
}

export function buildCollectionPage(input: JsonLdInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": input.url,
    url: input.url,
    name: input.content.h1,
    description: input.content.meta.description,
    inLanguage: input.locale.hreflang,
    isPartOf: { "@type": "WebSite", name: input.brandName, url: storeBaseUrl(input.shop) },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: input.products.length,
      itemListElement: input.products.map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: productNode(input, product),
      })),
    },
  };
}

export function buildFaqPage(input: JsonLdInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: input.locale.hreflang,
    mainEntity: input.content.faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export function buildBreadcrumbList(input: JsonLdInput): Record<string, unknown> {
  const base = storeBaseUrl(input.shop);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: base },
      {
        "@type": "ListItem",
        position: 2,
        name: "Inspiration",
        item: `${base}/blogs/${input.blogHandle}`,
      },
      { "@type": "ListItem", position: 3, name: input.content.h1, item: input.url },
    ],
  };
}

/** The full stack, in render order. */
export function buildJsonLdStack(input: JsonLdInput): Record<string, unknown>[] {
  return [buildCollectionPage(input), buildFaqPage(input), buildBreadcrumbList(input)];
}
