import type { IntentFacet } from "../../config/types";
import type { CatalogProduct } from "../catalog/types";
import type { IntentProfile } from "../intent/types";
import { matchProducts } from "./match.server";

/**
 * The product-match panel shown before generation (keyword preview) and
 * after it (page detail).
 *
 * Both screens ask the same question — which products would be on this page,
 * why, and what can the merchant change — so they share one builder rather
 * than each assembling it from `matchProducts` separately.
 *
 * Every product in the catalog appears in exactly one of the two lists, and
 * both lists are selectable. That is the point: the matcher's verdict is a
 * strong default, not a cage. A merchant who can see precisely why a product
 * was rejected is entitled to overrule it, and previously could not — the
 * only products offered were the ones the matcher had already approved, so
 * adjustment could subtract but never add.
 */

export interface MatchPanelProduct {
  id: string;
  title: string;
  price: string;
  imageUrl: string | null;
  /** Storefront page when live, admin product page otherwise. */
  url: string;
  /** Matcher score; 0 for products the matcher rejected. */
  score: number;
  matchedFacets: Partial<Record<IntentFacet, string[]>>;
  /** Matched values evidenced only by product text, not a tag or collection. */
  inferredFacets: string[];
  /**
   * Matched values that not every matched product shares. The intent chips
   * above the list already state the common ones, so a row only needs to show
   * what actually distinguishes it.
   */
  distinguishingFacets: string[];
  /** Why the matcher rejected it. Null for products it accepted. */
  excludedReason: string | null;
  included: boolean;
}

export interface MatchPanel {
  facets: IntentProfile["facets"];
  minProducts: number;
  /** Matcher-approved products, strongest first. */
  matched: MatchPanelProduct[];
  /** Matcher-rejected products, each with the reason, selectable anyway. */
  excluded: MatchPanelProduct[];
  /** True when the merchant's selection differs from the matcher's verdict. */
  overridden: boolean;
}

export interface MatchPanelInput {
  shop: string;
  catalog: CatalogProduct[];
  intent: IntentProfile;
  minProducts: number;
  /**
   * The merchant's chosen product ids, or null to show the matcher's own
   * verdict (every accepted product included, every rejected one not).
   */
  selectedIds: string[] | null;
}

function productUrl(shop: string, product: CatalogProduct): string {
  return (
    product.onlineStoreUrl ??
    `https://${shop}/admin/products/${product.id.split("/").pop()}`
  );
}

export function buildMatchPanel(input: MatchPanelInput): MatchPanel {
  const { shop, catalog, intent, minProducts, selectedIds } = input;
  const result = matchProducts(catalog, intent, minProducts);
  const selected = selectedIds === null ? null : new Set(selectedIds);

  const matched: MatchPanelProduct[] = result.matches.map((scored) => ({
    id: scored.product.id,
    title: scored.product.title,
    price: `${scored.product.price.toFixed(2)} ${scored.product.currencyCode}`,
    imageUrl: scored.product.imageUrl,
    url: productUrl(shop, scored.product),
    score: Number(scored.score.toFixed(2)),
    matchedFacets: scored.matchedFacets,
    inferredFacets: scored.inferredFacets,
    distinguishingFacets: [],
    excludedReason: null,
    // No explicit selection yet means the matcher's verdict stands.
    included: selected === null ? true : selected.has(scored.product.id),
  }));

  const excluded: MatchPanelProduct[] = result.excluded.map((entry) => ({
    id: entry.product.id,
    title: entry.product.title,
    price: `${entry.product.price.toFixed(2)} ${entry.product.currencyCode}`,
    imageUrl: entry.product.imageUrl,
    url: productUrl(shop, entry.product),
    score: 0,
    matchedFacets: {},
    inferredFacets: [],
    distinguishingFacets: [],
    excludedReason: entry.reason,
    included: selected === null ? false : selected.has(entry.product.id),
  }));

  for (const product of matched) {
    product.distinguishingFacets = distinguishingFacets(product, matched);
  }

  return {
    facets: intent.facets,
    minProducts,
    matched,
    excluded,
    overridden: selectedIds !== null,
  };
}

/**
 * Facet values this product matched that not every matched product shares.
 * Exported for testing; consumers read the field it populates.
 */
export function distinguishingFacets(
  product: MatchPanelProduct,
  matched: MatchPanelProduct[],
): string[] {
  const counts = new Map<string, number>();
  for (const candidate of matched) {
    for (const [facet, values] of Object.entries(candidate.matchedFacets)) {
      for (const value of values ?? []) {
        const key = `${facet}: ${value}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return Object.entries(product.matchedFacets)
    .flatMap(([facet, values]) =>
      (values ?? []).map((value) => `${facet}: ${value}`),
    )
    .filter((key) => counts.get(key) !== matched.length);
}
