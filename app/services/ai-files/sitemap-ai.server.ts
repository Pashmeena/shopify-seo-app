import { getLocale } from "../../config/index.server";
import { escapeHtml } from "../../lib/html";
import type { PageRecord } from "../plp/repository.server";

/**
 * sitemap-ai.xml — a curated, metadata-rich sitemap for AI crawlers.
 * Contains only quality-approved (published) PLPs, each annotated with
 * intent summary, primary keyword, product count and locale via a custom
 * `plp:` namespace, plus xhtml:link hreflang alternates connecting locale
 * variants. Shopify's built-in sitemap.xml continues to serve classic
 * search-engine discovery; this file is additive.
 */

const PLP_NS = "https://wildpalace.example/ns/plp";

function intentSummary(page: PageRecord): string {
  return (
    Object.entries(page.intent.facets)
      .filter(([, values]) => values?.length)
      .map(([facet, values]) => `${facet}=${(values ?? []).join("|")}`)
      .join("; ") || page.intent.keyword
  );
}

function urlEntry(page: PageRecord): string {
  if (!page.articleUrl) return "";
  const locale = getLocale(page.locale);
  const alternates = (page.seo?.hreflang ?? [])
    .map(
      (variant) =>
        `    <xhtml:link rel="alternate" hreflang="${escapeHtml(variant.locale)}" href="${escapeHtml(variant.url)}"/>`,
    )
    .join("\n");

  return `  <url>
    <loc>${escapeHtml(page.articleUrl)}</loc>
    <lastmod>${(page.publishedAt ?? page.updatedAt).toISOString()}</lastmod>
${alternates ? alternates + "\n" : ""}    <plp:intent>${escapeHtml(intentSummary(page))}</plp:intent>
    <plp:keyword>${escapeHtml(page.intent.keyword)}</plp:keyword>
    <plp:productCount>${page.productIds.length}</plp:productCount>
    <plp:locale>${escapeHtml(locale.code)}</plp:locale>
    <plp:market>${escapeHtml(locale.market)}</plp:market>
  </url>`;
}

export function buildAiSitemap(publishedPages: PageRecord[]): string {
  const entries = publishedPages
    .map(urlEntry)
    .filter(Boolean)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:plp="${PLP_NS}">
${entries}
</urlset>
`;
}
