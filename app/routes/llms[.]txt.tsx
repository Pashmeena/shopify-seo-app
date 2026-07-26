import type { LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { buildLlmsTxt } from "../services/ai-files/llms-txt.server";
import { fetchCatalog } from "../services/catalog/products.server";
import type { CatalogProduct } from "../services/catalog/types";
import { listPages } from "../services/plp/repository.server";
import { getSettings } from "../services/settings/settings.server";
import { resolveShop } from "../services/shopify/shop.server";

/**
 * Serves llms.txt from the app (local build). In production this route
 * would be exposed at the true store root via a Shopify App Proxy
 * (`https://store.com/llms.txt` → this handler) — see README.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await resolveShop(request);
  if (!shop) return new Response("No shop installed", { status: 404 });

  const settings = await getSettings(shop);
  const publishedPages = await listPages(shop, { status: "published" });

  let catalog: CatalogProduct[] = [];
  try {
    const { admin } = await unauthenticated.admin(shop);
    catalog = await fetchCatalog(admin);
  } catch {
    // No offline session (e.g. app not installed yet) — serve pages-only.
  }

  return new Response(buildLlmsTxt(shop, settings, catalog, publishedPages), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
