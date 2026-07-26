/** URL builders — one place decides what public URLs look like. */

export function storeBaseUrl(shop: string): string {
  return `https://${shop}`;
}

export function articleUrl(shop: string, blogHandle: string, slug: string): string {
  return `${storeBaseUrl(shop)}/blogs/${blogHandle}/${slug}`;
}

export function productUrl(shop: string, handle: string): string {
  return `${storeBaseUrl(shop)}/products/${handle}`;
}
