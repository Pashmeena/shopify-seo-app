import type { LoaderFunctionArgs } from "@remix-run/node";
import { fetchCatalog } from "../services/catalog/products.server";
import { matchProducts } from "../services/matching/match.server";
import { getKeyword } from "../services/plp/repository.server";
import { getSettings } from "../services/settings/settings.server";
import { authenticate } from "../shopify.server";

/**
 * Resource route: live product-match preview for a keyword, fetched on
 * demand when the merchant opens the preview modal — before any
 * generation cost is spent. Same candidate semantics as the page detail
 * screen: everything the matcher accepts, plus manual additions already
 * saved on the keyword (so a selection never silently disappears).
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const keyword = await getKeyword(shop, params.id as string);
  if (!keyword) throw new Response("Keyword not found", { status: 404 });
  if (!keyword.intent)
    throw new Response("Keyword has no parsed intent yet", { status: 422 });

  const [settings, catalog] = await Promise.all([
    getSettings(shop),
    fetchCatalog(admin),
  ]);
  const match = matchProducts(catalog, keyword.intent, settings.minProducts);

  const overrides = keyword.productOverrides;
  const overrideSet = overrides ? new Set(overrides) : null;
  const isIncluded = (id: string) => (overrideSet ? overrideSet.has(id) : true);

  // Storefront page when the product is published there, admin product
  // page otherwise, so "View" always lands somewhere useful.
  const productUrl = (product: { id: string; onlineStoreUrl: string | null }) =>
    product.onlineStoreUrl ??
    `https://${shop}/admin/products/${product.id.split("/").pop()}`;

  const matchedIds = new Set(match.matches.map((scored) => scored.product.id));
  const candidates = [
    ...match.matches.map((scored) => ({
      id: scored.product.id,
      title: scored.product.title,
      price: `${scored.product.price.toFixed(2)} ${scored.product.currencyCode}`,
      imageUrl: scored.product.imageUrl,
      url: productUrl(scored.product),
      score: Number(scored.score.toFixed(2)),
      matchedFacets: scored.matchedFacets,
      included: isIncluded(scored.product.id),
    })),
    ...catalog
      .filter(
        (product) =>
          overrideSet?.has(product.id) && !matchedIds.has(product.id),
      )
      .map((product) => ({
        id: product.id,
        title: product.title,
        price: `${product.price.toFixed(2)} ${product.currencyCode}`,
        imageUrl: product.imageUrl,
        url: productUrl(product),
        score: 0,
        matchedFacets: {} as Partial<Record<string, string[]>>,
        included: true,
      })),
  ];

  return {
    phrase: keyword.phrase,
    facets: keyword.intent.facets,
    candidates,
    excluded: match.excluded.map((entry) => ({
      title: entry.product.title,
      reason: entry.reason,
      imageUrl: entry.product.imageUrl,
      url: productUrl(entry.product),
    })),
    excludedTotal: match.excluded.length,
    minProducts: settings.minProducts,
    overridden: overrides != null,
  };
};
