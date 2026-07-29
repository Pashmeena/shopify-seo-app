import type { IntentFacet } from "../../config/types";

/**
 * Where a facet value on a product came from.
 *
 * Provenance is kept because it is the difference between a merchant
 * saying so and the app inferring it. Both can qualify a product for a
 * page, but a product the store actually filed under `style:botanical`
 * outranks one that merely has "Botanical" in its name.
 */
export type FacetOrigin = "tag" | "collection" | "title" | "product-type";

/** Origins the merchant curated, rather than ones read out of free text. */
export const DECLARED_ORIGINS: readonly FacetOrigin[] = ["tag", "collection"];

/**
 * Normalized product used everywhere downstream (matching, generation,
 * JSON-LD).
 *
 * `facets` is the union of three sources, so the app works on a store that
 * never adopted its tag convention:
 *
 * - namespaced tags (`style:botanical`, `room:kids-room`) — the explicit,
 *   structured contract, and what the seeded demo catalog uses
 * - collection membership — a store's own merchandising structure is a
 *   statement about what a product is for
 * - product title and product type — read through the shared facet
 *   vocabulary
 *
 * Descriptions are deliberately *not* a source. "Not suitable for
 * bathrooms" contains "bathroom", and a page must never include a product
 * that contradicts its own H1. Descriptions still influence ranking, via
 * the matcher's text bonus.
 */
export interface CatalogProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  collections: ProductCollection[];
  price: number;
  currencyCode: string;
  imageUrl: string | null;
  imageAltText: string | null;
  onlineStoreUrl: string | null;
  facets: Partial<Record<IntentFacet, string[]>>;
  /** Origins per facet value, keyed by `facetOriginKey(facet, value)`. */
  facetOrigins: Record<string, FacetOrigin[]>;
}

export interface ProductCollection {
  handle: string;
  title: string;
}

/** Stable key for the `facetOrigins` map. */
export function facetOriginKey(facet: IntentFacet, value: string): string {
  return `${facet}:${value}`;
}

/** Tag namespace → intent facet. `use-case:` maps to the camelCase facet. */
export const TAG_NAMESPACE_TO_FACET: Record<string, IntentFacet> = {
  style: "style",
  room: "room",
  color: "color",
  material: "material",
  attribute: "attribute",
  "use-case": "useCase",
  audience: "audience",
};
