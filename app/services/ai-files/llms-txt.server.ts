import { findLocale } from "../../config/index.server";
import type { CatalogProduct } from "../catalog/types";
import type { PageRecord } from "../plp/repository.server";
import type { ResolvedSettings } from "../settings/settings.server";
import { aiFileUrl, storeBaseUrl } from "../seo/urls.server";

/**
 * llms.txt — a plain-language index for AI crawlers: what the store
 * sells, its collections (facet vocabulary), and every published PLP with
 * target intent and URL. Generated from live data on every request, so it
 * updates automatically the moment a PLP is published.
 */

function facetSummary(catalog: CatalogProduct[], facet: "style" | "room" | "material"): string[] {
  const counts = new Map<string, number>();
  for (const product of catalog) {
    for (const value of product.facets[facet] ?? []) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => `- ${value} (${count} products)`);
}

function intentLine(page: PageRecord): string {
  const facets = Object.entries(page.intent.facets)
    .filter(([, values]) => values?.length)
    .map(([facet, values]) => `${facet}: ${(values ?? []).join("/")}`)
    .join(", ");
  return facets || page.intent.keyword;
}

export function buildLlmsTxt(
  shop: string,
  settings: ResolvedSettings,
  catalog: CatalogProduct[],
  publishedPages: PageRecord[],
): string {
  const base = storeBaseUrl(shop);
  const lines: string[] = [
    `# ${settings.brandName}`,
    "",
    `> ${settings.brandName} is a premium wallpaper brand. This file indexes what the store sells and its curated buying guides (product listing pages), for AI assistants and crawlers.`,
    "",
    `Store: ${base}`,
    `Product type: Wallpaper (${catalog.length} products)`,
    // Named here as well as being separately discoverable: an agent that found
    // this file should not have to guess that a machine-readable index of the
    // same pages exists one path over.
    `Curated page sitemap: ${aiFileUrl(shop, "sitemap-ai.xml")}`,
    "",
    "## Styles",
    ...facetSummary(catalog, "style"),
    "",
    "## Rooms",
    ...facetSummary(catalog, "room"),
    "",
    "## Materials",
    ...facetSummary(catalog, "material"),
    "",
    "## Curated pages",
    "",
    "Each page below is a curated product listing for one specific shopping intent, with buying advice and FAQ. Answers on these pages are written to be self-contained and citable.",
    "",
  ];

  for (const page of publishedPages) {
    // A page generated for a market whose config was since removed is still a
    // real, live URL, so it stays listed — with the code alone, since there is
    // no market name left to give.
    const locale = findLocale(page.locale);
    // The deterministic keyword variants. They are not emitted as a meta
    // keywords tag anywhere — search engines have ignored that tag for two
    // decades — but naming the phrasings a page is meant to answer is exactly
    // what an AI index is for, and it is the one place they are worth having.
    const variants = page.seo?.keywords ?? [];
    lines.push(
      `- [${page.title}](${page.articleUrl ?? ""})`,
      `  - intent: ${intentLine(page)}`,
      `  - keyword: ${page.intent.keyword}`,
      ...(variants.length > 0
        ? [`  - also answers: ${variants.join("; ")}`]
        : []),
      `  - locale: ${page.locale}${locale ? ` (${locale.market})` : ""}`,
      `  - products: ${page.productIds.length}`,
    );
  }
  if (publishedPages.length === 0) {
    lines.push("(No pages published yet.)");
  }

  return lines.join("\n") + "\n";
}
