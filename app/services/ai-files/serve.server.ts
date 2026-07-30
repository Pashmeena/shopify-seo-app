import { unauthenticated } from "../../shopify.server";
import { fetchCatalog } from "../catalog/products.server";
import type { CatalogProduct } from "../catalog/types";
import { listPages } from "../plp/repository.server";
import { getSettings } from "../settings/settings.server";
import { buildLlmsTxt } from "./llms-txt.server";
import { buildAiSitemap } from "./sitemap-ai.server";

/**
 * The two AI-discovery files, built once and served from two entry points:
 * the app's own domain (convenient in development) and the Shopify App Proxy
 * (the store's own domain, which is where crawlers will look).
 *
 * Both are generated from live data on every request rather than written to
 * a file, so publishing a PLP updates them with nothing to invalidate.
 */

/** Only published pages are listed. Drafts and held pages are not public. */
async function publishedPages(shop: string) {
  return listPages(shop, { status: "published" });
}

export async function serveLlmsTxt(shop: string): Promise<Response> {
  const [settings, pages] = await Promise.all([
    getSettings(shop),
    publishedPages(shop),
  ]);

  let catalog: CatalogProduct[] = [];
  try {
    const { admin } = await unauthenticated.admin(shop);
    catalog = await fetchCatalog(admin);
  } catch {
    // No offline session yet. The page index is still worth serving, so the
    // catalog summary is simply omitted rather than failing the request.
  }

  return new Response(buildLlmsTxt(shop, settings, catalog, pages), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Cheap to regenerate, but crawlers can hammer it.
      "Cache-Control": "public, max-age=300",
    },
  });
}

export async function serveAiSitemap(shop: string): Promise<Response> {
  return new Response(buildAiSitemap(await publishedPages(shop)), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
