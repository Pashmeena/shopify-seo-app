import type { IntentFacet } from "../../config/types";
import {
  extractFacets,
  productTextPhraseIndex,
} from "../facets/vocabulary.server";
import { runGraphql, type AdminClient } from "../shopify/admin.server";
import {
  facetOriginKey,
  TAG_NAMESPACE_TO_FACET,
  type CatalogProduct,
  type FacetOrigin,
  type ProductCollection,
} from "./types";

/**
 * Products per page and collections per product are chosen together:
 * Shopify costs a query by the number of nodes it could return, capped at
 * 1000, and a nested connection multiplies. 50 × 10 leaves generous headroom
 * where 100 × 20 would be rejected outright.
 */
const PRODUCTS_PER_PAGE = 50;
const COLLECTIONS_PER_PRODUCT = 10;

const PRODUCTS_PAGE_QUERY = `#graphql
  query PlpProducts($first: Int!, $after: String, $query: String, $collections: Int!) {
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
        collections(first: $collections) {
          nodes { handle title }
        }
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
  collections: { nodes: ProductCollection[] };
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
}

/**
 * Accumulates facet values with their origins, so a value found in more
 * than one place records all of them and the matcher can score by the
 * strongest.
 */
class FacetCollector {
  private readonly facets: Partial<Record<IntentFacet, string[]>> = {};
  private readonly origins: Record<string, FacetOrigin[]> = {};

  add(facet: IntentFacet, value: string, origin: FacetOrigin): void {
    const values = (this.facets[facet] ??= []);
    if (!values.includes(value)) values.push(value);

    const key = facetOriginKey(facet, value);
    const seen = (this.origins[key] ??= []);
    if (!seen.includes(origin)) seen.push(origin);
  }

  /** Add everything the vocabulary found in a piece of text. */
  addText(text: string, origin: FacetOrigin): void {
    if (!text.trim()) return;
    const { facets } = extractFacets(text, productTextPhraseIndex());
    for (const [facet, values] of Object.entries(facets)) {
      for (const value of values ?? []) {
        this.add(facet as IntentFacet, value, origin);
      }
    }
  }

  result(): Pick<CatalogProduct, "facets" | "facetOrigins"> {
    return { facets: this.facets, facetOrigins: this.origins };
  }
}

/** Parse namespaced tags (`room:kids-room`) into facet values. */
function addTagFacets(tags: string[], collector: FacetCollector): void {
  for (const tag of tags) {
    const separator = tag.indexOf(":");
    if (separator === -1) continue;
    const facet = TAG_NAMESPACE_TO_FACET[tag.slice(0, separator).trim().toLowerCase()];
    if (!facet) continue;
    const value = tag.slice(separator + 1).trim().toLowerCase().replace(/-/g, " ");
    if (!value) continue;
    collector.add(facet, value, "tag");
  }
}

/**
 * Derive a product's facets from everything the store says about it.
 *
 * Exported for testing: this is the function that decides whether the app
 * works on a store that never adopted the tag convention.
 */
export function deriveFacets(
  input: Pick<CatalogProduct, "tags" | "title" | "productType" | "collections">,
): Pick<CatalogProduct, "facets" | "facetOrigins"> {
  const collector = new FacetCollector();

  addTagFacets(input.tags, collector);

  for (const collection of input.collections) {
    // Handle as well as title: a collection titled "Living Room" and one
    // handled `living-room` are the same statement, and stores rename one
    // without the other.
    collector.addText(
      `${collection.title} ${collection.handle.replace(/-/g, " ")}`,
      "collection",
    );
  }

  collector.addText(input.title, "title");
  collector.addText(input.productType, "product-type");

  return collector.result();
}

function normalizeProduct(node: ProductNode): CatalogProduct {
  const image = node.featuredMedia?.preview?.image ?? null;
  const collections = node.collections?.nodes ?? [];
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    description: node.description,
    vendor: node.vendor,
    productType: node.productType,
    tags: node.tags,
    collections,
    price: Number(node.priceRangeV2.minVariantPrice.amount),
    currencyCode: node.priceRangeV2.minVariantPrice.currencyCode,
    imageUrl: image?.url ?? null,
    imageAltText: image?.altText ?? null,
    onlineStoreUrl: node.onlineStoreUrl,
    ...deriveFacets({
      tags: node.tags,
      title: node.title,
      productType: node.productType,
      collections,
    }),
  };
}

/**
 * Fetch the full (active) catalog, normalized. Catalogs at PLP-app scale
 * are read often and change rarely; pagination keeps this correct beyond
 * one page, and callers treat the result as an immutable snapshot.
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
      {
        first: PRODUCTS_PER_PAGE,
        after,
        query: options.query ?? "status:active",
        collections: COLLECTIONS_PER_PRODUCT,
      },
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
