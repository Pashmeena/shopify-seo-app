import type { LocaleConfig } from "../../config/types";
import { runGraphql, type AdminClient } from "../shopify/admin.server";
import type { CatalogProduct } from "./types";

/**
 * Market-correct pricing for the products on one PLP.
 *
 * The brief requires meta content and schema markup to carry the target
 * market's currency, and a JSON-LD `Offer` that advertises USD to a German
 * shopper is a factually wrong structured-data claim, not a cosmetic one.
 *
 * Prices are resolved separately from the catalog fetch rather than folded
 * into it, for two reasons: matching does not care about price at all, and a
 * page has a handful of products where the catalog has all of them, so this
 * is one small query per page instead of a market-multiplied catalog scan.
 *
 * Contextual pricing depends on Shopify Markets being configured for the
 * country. When it is not — or on a store whose plan or API version does not
 * expose it — this degrades to the shop's own currency rather than failing
 * the page, and says so in the log.
 */

const CONTEXTUAL_PRICES_QUERY = `#graphql
  query PlpContextualPrices($ids: [ID!]!, $country: CountryCode!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        contextualPricing(context: { country: $country }) {
          priceRange {
            minVariantPrice { amount currencyCode }
          }
        }
      }
    }
  }
`;

interface ContextualPricesData {
  nodes: ({
    id: string;
    contextualPricing: {
      priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
    };
  } | null)[];
}

export interface MarketPrice {
  price: number;
  currencyCode: string;
}

/**
 * Look up each product's price in `country`. Returns an empty map when the
 * market is not available, which callers treat as "keep shop pricing".
 */
export async function fetchMarketPrices(
  admin: AdminClient,
  productIds: string[],
  country: string,
): Promise<Map<string, MarketPrice>> {
  const prices = new Map<string, MarketPrice>();
  if (productIds.length === 0) return prices;

  try {
    const data = await runGraphql<ContextualPricesData>(
      admin,
      CONTEXTUAL_PRICES_QUERY,
      { ids: productIds, country },
    );
    for (const node of data.nodes) {
      const money = node?.contextualPricing?.priceRange?.minVariantPrice;
      if (!node || !money) continue;
      prices.set(node.id, {
        price: Number(money.amount),
        currencyCode: money.currencyCode,
      });
    }
  } catch (error) {
    console.warn(
      `Contextual pricing unavailable for country "${country}" ` +
        "(Shopify Markets may not cover it); falling back to shop currency:",
      error instanceof Error ? error.message : error,
    );
  }
  return prices;
}

/** Overlay resolved market prices onto products. Pure. */
export function applyMarketPrices(
  products: CatalogProduct[],
  prices: Map<string, MarketPrice>,
): CatalogProduct[] {
  if (prices.size === 0) return products;
  return products.map((product) => {
    const market = prices.get(product.id);
    return market
      ? { ...product, price: market.price, currencyCode: market.currencyCode }
      : product;
  });
}

/**
 * The single entry point for "these products, priced for this market".
 *
 * Used by generation, regeneration and publishing so the prompt, the rendered
 * page and the JSON-LD `Offer` can never disagree about currency.
 */
export async function priceForMarket(
  admin: AdminClient,
  products: CatalogProduct[],
  locale: LocaleConfig,
): Promise<CatalogProduct[]> {
  const prices = await fetchMarketPrices(
    admin,
    products.map((product) => product.id),
    locale.country,
  );
  return applyMarketPrices(products, prices);
}
