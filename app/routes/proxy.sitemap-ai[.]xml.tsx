import type { LoaderFunctionArgs } from "@remix-run/node";
import { serveAiSitemap } from "../services/ai-files/serve.server";
import { authenticate } from "../shopify.server";

/**
 * sitemap-ai.xml on the store's own domain, via the App Proxy:
 * `https://<store>/apps/seo/sitemap-ai.xml`. Signed by Shopify, so the shop
 * is authenticated rather than supplied.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return new Response("App is not installed", { status: 404 });
  return serveAiSitemap(session.shop);
};
