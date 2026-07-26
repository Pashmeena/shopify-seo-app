import prisma from "../../db.server";

/**
 * Resolve which shop a public (unauthenticated) route is for.
 *
 * In production these routes would sit behind a Shopify App Proxy, which
 * passes `shop` on every request. Locally the app usually serves exactly
 * one dev store, so the single stored session is a safe fallback.
 */
export async function resolveShop(request: Request): Promise<string | null> {
  const shop = new URL(request.url).searchParams.get("shop");
  if (shop) {
    // Only serve shops the app is actually installed on — an arbitrary
    // ?shop= must never create settings rows or probe other domains.
    const installed = await prisma.session.findFirst({ where: { shop } });
    return installed ? shop : null;
  }
  const session = await prisma.session.findFirst();
  return session?.shop ?? null;
}
