import { deriveFacets } from "../services/catalog/products.server";
import type { CatalogProduct, ProductCollection } from "../services/catalog/types";
import type { IntentProfile } from "../services/intent/types";

/**
 * Fixtures for tests that need catalog products or parsed intents.
 *
 * `product()` runs the real facet derivation rather than letting a test hand
 * `facets` and `facetOrigins` in directly, so a test that says "tagged
 * botanical" is exercising the same path production uses and cannot drift
 * away from it.
 */

export interface ProductFixture {
  handle?: string;
  title?: string;
  description?: string;
  productType?: string;
  tags?: string[];
  collections?: ProductCollection[];
  price?: number;
  currencyCode?: string;
}

let sequence = 0;

export function product(fixture: ProductFixture = {}): CatalogProduct {
  const handle = fixture.handle ?? `product-${++sequence}`;
  const tags = fixture.tags ?? [];
  const title = fixture.title ?? handle;
  const productType = fixture.productType ?? "Wallpaper";
  const collections = fixture.collections ?? [];

  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title,
    description: fixture.description ?? "",
    vendor: "Wild Palace",
    productType,
    tags,
    collections,
    price: fixture.price ?? 89,
    currencyCode: fixture.currencyCode ?? "USD",
    imageUrl: null,
    imageAltText: null,
    onlineStoreUrl: null,
    ...deriveFacets({ tags, title, productType, collections }),
  };
}

/** Convenience: a product whose facets come purely from namespaced tags. */
export function tagged(...tags: string[]): CatalogProduct {
  return product({ tags });
}

export function intent(
  facets: IntentProfile["facets"],
  overrides: Partial<IntentProfile> = {},
): IntentProfile {
  return {
    keyword: overrides.keyword ?? "test keyword",
    locale: overrides.locale ?? "en-US",
    facets,
    pageTypeId: overrides.pageTypeId ?? "style-room",
    confidence: overrides.confidence ?? 1,
    method: overrides.method ?? "rules",
  };
}
