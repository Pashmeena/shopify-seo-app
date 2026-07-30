import type { LoaderFunctionArgs } from "@remix-run/node";
import { fetchCatalog } from "../services/catalog/products.server";
import { buildMatchPanel } from "../services/matching/panel.server";
import { getKeyword } from "../services/plp/repository.server";
import { getSettings } from "../services/settings/settings.server";
import { authenticate } from "../shopify.server";

/**
 * Resource route: live product-match preview for a keyword, fetched on
 * demand when the merchant opens the preview modal — before any generation
 * cost is spent. The panel itself is built by the shared builder, so this
 * screen and the page detail screen can never disagree about what the
 * matcher decided or why.
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

  const panel = buildMatchPanel({
    shop,
    catalog,
    intent: keyword.intent,
    minProducts: settings.minProducts,
    // Null keeps the matcher's own verdict until the merchant saves a choice.
    selectedIds: keyword.productOverrides,
  });

  return { phrase: keyword.phrase, ...panel };
};
