/** URL builders — one place decides what public URLs look like. */

export function storeBaseUrl(shop: string): string {
  return `https://${shop}`;
}

/**
 * Store-root-relative path of a published PLP.
 *
 * Kept separate from `articleUrl` because Shopify's URL redirects are
 * expressed as paths on the store's own domain, not absolute URLs. Using the
 * path for both sides of a redirect means the redirect is domain-agnostic:
 * it keeps working when the merchant changes their primary domain, and it
 * cannot accidentally send a shopper to a different host.
 */
export function articlePath(blogHandle: string, slug: string): string {
  return `/blogs/${blogHandle}/${slug}`;
}

export function articleUrl(shop: string, blogHandle: string, slug: string): string {
  return `${storeBaseUrl(shop)}${articlePath(blogHandle, slug)}`;
}

export function productUrl(shop: string, handle: string): string {
  return `${storeBaseUrl(shop)}/products/${handle}`;
}

/**
 * Where the AI-discovery files answer on the store's own domain.
 *
 * Mirrors the App Proxy `prefix`/`subpath` in shopify.app.toml, which is the
 * one thing about these URLs the app cannot read at runtime. Defined once here
 * so the Settings screen, `llms.txt` and the README cannot drift apart — three
 * places previously spelled `/apps/seo/` out by hand.
 */
export const AI_FILES_PROXY_PATH = "/apps/seo";

export function aiFileUrl(shop: string, filename: string): string {
  return `${storeBaseUrl(shop)}${AI_FILES_PROXY_PATH}/${filename}`;
}
