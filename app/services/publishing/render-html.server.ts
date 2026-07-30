import type { LocaleConfig } from "../../config/types";
import { escapeHtml, paragraphs } from "../../lib/html";
import type { CatalogProduct } from "../catalog/types";
import type { PlpContent } from "../generation/types";
import type { SeoPayload } from "../seo/types";

/**
 * Render validated PLP content into the article body HTML.
 *
 * Semantic structure mirrors the SEO requirements: single H1 (supplied by
 * the article title, so the body starts at the intro), H2 sections that
 * expand coverage, product cards with intent-based alt text, standalone
 * FAQ blocks, a related-pages nav (internal linking), and the JSON-LD
 * stack embedded as script tags.
 *
 * The locale is required, not optional. Almost every string here is written by
 * the model in the market's language, but two headings are written by the app —
 * and hard-coding them left an English "Related guides" as an H2 on every
 * German page. A heading the app supplies has to come from the same locale
 * config as everything else, and a required parameter is what guarantees a new
 * caller cannot forget it.
 */

interface RenderInput {
  content: PlpContent;
  products: CatalogProduct[];
  seo: SeoPayload;
  locale: LocaleConfig;
}

function altTextFor(content: PlpContent, product: CatalogProduct): string {
  return (
    content.product_alt_texts.find(
      (entry) => entry.product_id === product.id || entry.product_id === product.handle,
    )?.alt_text ?? product.title
  );
}

function renderProductCard(input: RenderInput, product: CatalogProduct): string {
  const url = product.onlineStoreUrl ?? `/products/${product.handle}`;
  const image = product.imageUrl
    ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(altTextFor(input.content, product))}" loading="lazy" width="300">`
    : "";
  return `<li class="plp-product">
  <a href="${escapeHtml(url)}">${image}
    <span class="plp-product-title">${escapeHtml(product.title)}</span>
    <span class="plp-product-price">${product.price.toFixed(2)} ${escapeHtml(product.currencyCode)}</span>
  </a>
</li>`;
}

function renderSections(content: PlpContent): string {
  return content.sections
    .map(
      (section) => `<section>
<h2>${escapeHtml(section.heading)}</h2>
${paragraphs(section.body)}
</section>`,
    )
    .join("\n");
}

function renderBuyingGuide(content: PlpContent): string {
  const guide = content.buying_guide;
  if (!guide) return "";
  const steps = guide.steps
    .map(
      (step) => `<li>
<h3>${escapeHtml(step.title)}</h3>
${paragraphs(step.body)}
</li>`,
    )
    .join("\n");
  return `<section class="plp-buying-guide">
<h2>${escapeHtml(guide.heading)}</h2>
<ol>
${steps}
</ol>
</section>`;
}

/** Market-specific guidance, from locale-specific page types. */
function renderComplianceNotes(content: PlpContent): string {
  const notes = content.compliance_notes;
  if (!notes) return "";
  const points = notes.points
    .map((point) => `<li>${escapeHtml(point)}</li>`)
    .join("\n");
  return `<section class="plp-compliance">
<h2>${escapeHtml(notes.heading)}</h2>
<ul>
${points}
</ul>
</section>`;
}

/**
 * Property limits, from `attribute-room`. A definition list rather than a
 * bullet list because each point is a label plus its explanation, and the pair
 * is what makes the point quotable on its own.
 */
function renderSuitabilityNotes(content: PlpContent): string {
  const notes = content.suitability_notes;
  if (!notes) return "";
  const points = notes.points
    .map(
      (point) => `<dt>${escapeHtml(point.label)}</dt>
<dd>${paragraphs(point.detail)}</dd>`,
    )
    .join("\n");
  return `<section class="plp-suitability">
<h2>${escapeHtml(notes.heading)}</h2>
<dl>
${points}
</dl>
</section>`;
}

function renderFaq(content: PlpContent, locale: LocaleConfig): string {
  const items = content.faq
    .map(
      (entry) => `<section class="plp-faq-item">
<h3>${escapeHtml(entry.question)}</h3>
${paragraphs(entry.answer)}
</section>`,
    )
    .join("\n");
  return `<section class="plp-faq">
<h2>${escapeHtml(locale.tokens.faq_heading)}</h2>
${items}
</section>`;
}

function renderInternalLinks(seo: SeoPayload, locale: LocaleConfig): string {
  if (seo.internalLinks.length === 0) return "";
  const heading = escapeHtml(locale.tokens.related_heading);
  const items = seo.internalLinks
    .map((link) => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.title)}</a></li>`)
    .join("\n");
  return `<nav class="plp-related" aria-label="${heading}">
<h2>${heading}</h2>
<ul>
${items}
</ul>
</nav>`;
}

function renderJsonLd(seo: SeoPayload): string {
  // `<` is escaped so no string inside the JSON (AI copy, product titles)
  // can break out of the script element with a literal "</script>".
  return seo.jsonLd
    .map(
      (node) =>
        `<script type="application/ld+json">${JSON.stringify(node).replace(/</g, "\\u003c")}</script>`,
    )
    .join("\n");
}

export function renderArticleHtml(input: RenderInput): string {
  const { content, products, seo, locale } = input;
  return [
    `<div class="plp-intro">${paragraphs(content.intro)}</div>`,
    `<ul class="plp-products">`,
    products.map((product) => renderProductCard(input, product)).join("\n"),
    `</ul>`,
    renderSections(content),
    renderComplianceNotes(content),
    renderSuitabilityNotes(content),
    renderBuyingGuide(content),
    renderFaq(content, locale),
    renderInternalLinks(seo, locale),
    renderJsonLd(seo),
  ]
    .filter(Boolean)
    .join("\n");
}
