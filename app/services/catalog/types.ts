import type { IntentFacet } from "../../config/types";

/**
 * Normalized product used everywhere downstream (matching, generation,
 * JSON-LD). `facets` is parsed from namespaced tags — `style:botanical`,
 * `room:kids-room`, `use-case:renters` — which are the app's structured
 * source of truth about a product.
 */
export interface CatalogProduct {
  id: string;
  handle: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  price: number;
  currencyCode: string;
  imageUrl: string | null;
  imageAltText: string | null;
  onlineStoreUrl: string | null;
  facets: Partial<Record<IntentFacet, string[]>>;
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
