import type { LoaderFunctionArgs } from "@remix-run/node";
import { serveLlmsTxt } from "../services/ai-files/serve.server";
import { resolveShop } from "../services/shopify/shop.server";

/**
 * llms.txt on the app's own domain, for development.
 *
 * The canonical URL crawlers should use is the App Proxy one on the store's
 * domain (`/apps/seo/llms.txt`, see routes/proxy.llms[.]txt.tsx). This entry
 * point exists because the proxy requires a signed request, which is
 * inconvenient to hit by hand while building.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await resolveShop(request);
  if (!shop) return new Response("No shop installed", { status: 404 });
  return serveLlmsTxt(shop);
};
