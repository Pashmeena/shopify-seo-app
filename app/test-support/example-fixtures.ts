import { getLocale, getPageType } from "../config/index.server";
import { deriveFacets } from "../services/catalog/products.server";
import { SEED_PRODUCTS } from "../services/catalog/seed-data";
import type { CatalogProduct } from "../services/catalog/types";
import type { PlpContent } from "../services/generation/types";
import { assembleSeoPayload } from "../services/seo/assemble.server";
import { resolveMeta } from "../services/seo/meta.server";
import type { SeoPayload } from "../services/seo/types";
import type { ResolvedSettings } from "../services/settings/settings.server";
import type { IntentProfile } from "../services/intent/types";

/**
 * Shared machinery for the `examples/` files.
 *
 * The point is that the examples are not written by hand. Each one declares
 * its intent, its product handles and the AI content, and the `seo` block is
 * produced by the same builders the pipeline uses. A test then asserts the
 * committed file still matches, so an example cannot drift into describing
 * behaviour the app no longer has.
 */

export const EXAMPLE_SHOP = "your-store.myshopify.com";
export const EXAMPLE_BLOG_HANDLE = "seo-plp";

export const EXAMPLE_SETTINGS = {
  brandName: "Wild Palace",
  blogHandle: EXAMPLE_BLOG_HANDLE,
  defaultLocale: "en-US",
} as ResolvedSettings;

/** Market currency, so an example shows contextual pricing rather than USD everywhere. */
const MARKET_RATE: Record<string, { rate: number; currency: string }> = {
  US: { rate: 1, currency: "USD" },
  DE: { rate: 0.94, currency: "EUR" },
  GB: { rate: 0.79, currency: "GBP" },
  AU: { rate: 1.52, currency: "AUD" },
};

/**
 * A seeded product as the catalog layer would present it, priced for a market.
 * Rates are illustrative: a real store gets these from Shopify Markets.
 */
export function exampleProduct(handle: string, localeCode: string): CatalogProduct {
  const seed = SEED_PRODUCTS.find((product) => product.handle === handle);
  if (!seed) throw new Error(`No seed product "${handle}"`);

  const locale = getLocale(localeCode);
  const market = MARKET_RATE[locale.country] ?? { rate: 1, currency: locale.currency };
  const productType = "Wallpaper";

  return {
    id: `gid://shopify/Product/${handle}`,
    handle,
    title: seed.title,
    description: seed.description,
    vendor: "Wild Palace",
    productType,
    tags: seed.tags,
    collections: [],
    price: Math.round(Number(seed.price) * market.rate * 100) / 100,
    currencyCode: market.currency,
    imageUrl: `https://picsum.photos/seed/${handle}/900/1200.jpg`,
    imageAltText: seed.title,
    onlineStoreUrl: `https://${EXAMPLE_SHOP}/products/${handle}`,
    ...deriveFacets({ tags: seed.tags, title: seed.title, productType, collections: [] }),
  };
}

export interface ExampleInput {
  pageTypeId: string;
  slug: string;
  locale: string;
  clusterKey: string;
  intent: IntentProfile;
  content: PlpContent;
  productHandles: string[];
  /** Slug this page consolidates onto, or null for self-canonical. */
  canonicalSlug: string | null;
  /** Other pages in the store, so hreflang and internal links are real. */
  siblings: {
    slug: string;
    locale: string;
    title: string;
    clusterKey: string;
    status: string;
    intent: IntentProfile;
  }[];
}

/** Build an example's SEO payload exactly as the pipeline would. */
export function buildExampleSeo(input: ExampleInput): SeoPayload {
  const products = input.productHandles.map((handle) =>
    exampleProduct(handle, input.locale),
  );
  const locale = getLocale(input.locale);
  const meta = resolveMeta(
    input.content,
    getPageType(input.pageTypeId),
    input.intent,
    locale,
    EXAMPLE_SETTINGS.brandName,
    products.length,
  );

  return assembleSeoPayload({
    shop: EXAMPLE_SHOP,
    settings: EXAMPLE_SETTINGS,
    page: {
      slug: input.slug,
      locale: input.locale,
      intent: input.intent,
      clusterKey: input.clusterKey,
      status: "published",
      canonicalSlug: input.canonicalSlug,
    },
    content: input.content,
    products,
    meta,
    allPages: [
      {
        slug: input.slug,
        locale: input.locale,
        title: input.content.h1,
        clusterKey: input.clusterKey,
        status: "published",
        intent: input.intent,
      },
      ...input.siblings,
    ],
  });
}
