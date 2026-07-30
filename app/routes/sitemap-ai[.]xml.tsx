import type { LoaderFunctionArgs } from "@remix-run/node";
import { serveAiSitemap } from "../services/ai-files/serve.server";
import { resolveShop } from "../services/shopify/shop.server";

/**
 * sitemap-ai.xml on the app's own domain, for development. The URL crawlers
 * should use is the App Proxy one on the store's domain
 * (`/apps/seo/sitemap-ai.xml`, see routes/proxy.sitemap-ai[.]xml.tsx).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await resolveShop(request);
  if (!shop) return new Response("No shop installed", { status: 404 });
  return serveAiSitemap(shop);
};
