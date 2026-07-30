import type { LoaderFunctionArgs } from "@remix-run/node";
import { serveLlmsTxt } from "../services/ai-files/serve.server";
import { authenticate } from "../shopify.server";

/**
 * llms.txt on the store's own domain, via the Shopify App Proxy configured in
 * shopify.app.toml: `https://<store>/apps/seo/llms.txt`.
 *
 * The proxy signs every request, so the shop is authenticated rather than
 * taken from a query parameter — no guessing, and no way to ask this handler
 * about a store the app is not installed on.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return new Response("App is not installed", { status: 404 });
  return serveLlmsTxt(session.shop);
};
