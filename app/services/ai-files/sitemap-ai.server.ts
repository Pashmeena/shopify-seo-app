import { findLocale } from "../../config/index.server";
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
  // A live URL stays listed even if its market config was removed; the market
  // name is simply omitted rather than crashing the whole sitemap.
  const locale = findLocale(page.locale);
  const alternates = (page.seo?.hreflang ?? [])
    .map(
      (variant) =>
        `    <xhtml:link rel="alternate" hreflang="${escapeHtml(variant.locale)}" href="${escapeHtml(variant.url)}"/>`,
    )
    .join("\n");

  // No canonical element here, deliberately. An earlier version recorded the
  // consolidation decision in a `plp:canonical` tag — a private vocabulary no
  // crawler reads, which meant the decision was written down rather than acted
  // on. Consolidation is now a real 301 (publishing/consolidation.server.ts),
  // so a consolidated page has no URL of its own and never reaches this file.
  // Every page listed here is canonical for itself, which is why `loc` alone
  // is the whole truth about it.
  return `  <url>
    <loc>${escapeHtml(page.articleUrl)}</loc>
    <lastmod>${(page.publishedAt ?? page.updatedAt).toISOString()}</lastmod>
${alternates ? alternates + "\n" : ""}    <plp:intent>${escapeHtml(intentSummary(page))}</plp:intent>
    <plp:keyword>${escapeHtml(page.intent.keyword)}</plp:keyword>
    <plp:productCount>${page.productIds.length}</plp:productCount>
    <plp:locale>${escapeHtml(page.locale)}</plp:locale>
${locale ? `    <plp:market>${escapeHtml(locale.market)}</plp:market>\n` : ""}  </url>`;
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
