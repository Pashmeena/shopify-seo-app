import type { IntentFacet } from "../../config/types";
import { runGraphql, type AdminClient } from "../shopify/admin.server";
import { TAG_NAMESPACE_TO_FACET, type CatalogProduct } from "./types";

const PRODUCTS_PAGE_QUERY = `#graphql
  query PlpProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        description(truncateAt: 600)
        vendor
        productType
        tags
        onlineStoreUrl
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        featuredMedia {
          preview { image { url altText } }
        }
      }
    }
  }
`;

interface ProductsPageData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProductNode[];
  };
}

interface ProductNode {
  id: string;
  handle: string;
  title: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  onlineStoreUrl: string | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
}

/** Parse namespaced tags (`room:kids-room`) into facet lists. Values keep spaces. */
export function facetsFromTags(tags: string[]): CatalogProduct["facets"] {
  const facets: Partial<Record<IntentFacet, string[]>> = {};
  for (const tag of tags) {
    const separator = tag.indexOf(":");
    if (separator === -1) continue;
    const facet = TAG_NAMESPACE_TO_FACET[tag.slice(0, separator).trim().toLowerCase()];
    if (!facet) continue;
    const value = tag.slice(separator + 1).trim().toLowerCase().replace(/-/g, " ");
    if (!value) continue;
    (facets[facet] ??= []).push(value);
  }
  return facets;
}

function normalizeProduct(node: ProductNode): CatalogProduct {
  const image = node.featuredMedia?.preview?.image ?? null;
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    description: node.description,
    vendor: node.vendor,
    productType: node.productType,
    tags: node.tags,
    price: Number(node.priceRangeV2.minVariantPrice.amount),
    currencyCode: node.priceRangeV2.minVariantPrice.currencyCode,
    imageUrl: image?.url ?? null,
    imageAltText: image?.altText ?? null,
    onlineStoreUrl: node.onlineStoreUrl,
    facets: facetsFromTags(node.tags),
  };
}

/**
 * Fetch the full (active) catalog, normalized. Catalogs at PLP-app scale
 * are read often and change rarely; pagination keeps this correct beyond
 * 250 products, and callers treat the result as an immutable snapshot.
 */
export async function fetchCatalog(
  admin: AdminClient,
  options: { query?: string } = {},
): Promise<CatalogProduct[]> {
  const products: CatalogProduct[] = [];
  let after: string | null = null;
  do {
    const data: ProductsPageData = await runGraphql<ProductsPageData>(
      admin,
      PRODUCTS_PAGE_QUERY,
      { first: 100, after, query: options.query ?? "status:active" },
    );
    products.push(...data.products.nodes.map(normalizeProduct));
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  return products;
}

/** Fetch a catalog and index it by product GID. */
export async function fetchCatalogById(
  admin: AdminClient,
): Promise<Map<string, CatalogProduct>> {
  const catalog = await fetchCatalog(admin);
  return new Map(catalog.map((product) => [product.id, product]));
}
