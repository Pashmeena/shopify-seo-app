import { getLocale } from "../../config/index.server";
import type { CatalogProduct } from "../catalog/types";
import type { PageRecord } from "../plp/repository.server";
import type { ResolvedSettings } from "../settings/settings.server";
import { storeBaseUrl } from "../seo/urls.server";

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
    const locale = getLocale(page.locale);
    lines.push(
      `- [${page.title}](${page.articleUrl ?? ""})`,
      `  - intent: ${intentLine(page)}`,
      `  - keyword: ${page.intent.keyword}`,
      `  - locale: ${locale.code} (${locale.market})`,
      `  - products: ${page.productIds.length}`,
    );
  }
  if (publishedPages.length === 0) {
    lines.push("(No pages published yet.)");
  }

  return lines.join("\n") + "\n";
}
