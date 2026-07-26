import type { LoaderFunctionArgs } from "@remix-run/node";
import { buildAiSitemap } from "../services/ai-files/sitemap-ai.server";
import { listPages } from "../services/plp/repository.server";
import { resolveShop } from "../services/shopify/shop.server";

/**
 * Curated AI sitemap: quality-approved (published) PLPs only, with intent
 * metadata and hreflang alternates. Served from the app locally; a
 * Shopify App Proxy would expose it at the store root in production.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await resolveShop(request);
  if (!shop) return new Response("No shop installed", { status: 404 });

  const publishedPages = await listPages(shop, { status: "published" });
  return new Response(buildAiSitemap(publishedPages), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
