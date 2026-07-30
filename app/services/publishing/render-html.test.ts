import { describe, expect, it } from "vitest";
import { getLocale } from "../../config/index.server";
import { product } from "../../test-support/catalog";
import type { PlpContent } from "../generation/types";
import type { SeoPayload } from "../seo/types";
import { renderArticleHtml } from "./render-html.server";

/**
 * The article body. Two things matter here beyond appearance: the heading
 * hierarchy the SEO requirements specify, and the fact that every string in
 * this document is AI-written or merchant-supplied and therefore untrusted.
 */

function content(overrides: Partial<PlpContent> = {}): PlpContent {
  return {
    h1: "Botanical Wallpaper for Living Rooms",
    intro: "First paragraph.\n\nSecond paragraph.",
    sections: [
      { heading: "Pattern scale for a living room", body: "Section body." },
      { heading: "Colour and light", body: "Another body." },
    ],
    faq: [
      { question: "Is it washable?", answer: "Yes, this wallpaper is washable." },
      { question: "How many rolls?", answer: "Measure the wall in square feet." },
    ],
    meta: { title: "Botanical Wallpaper", description: "Description." },
    product_alt_texts: [],
    ...overrides,
  };
}

function seo(overrides: Partial<SeoPayload> = {}): SeoPayload {
  return {
    metaTitle: "Botanical Wallpaper",
    metaDescription: "Description.",
    keywords: [],
    canonicalUrl: "https://demo.myshopify.com/blogs/seo-plp/page",
    hreflang: [],
    jsonLd: [],
    internalLinks: [],
    noindex: false,
    ...overrides,
  };
}

const PRODUCT = product({
  handle: "fern-study",
  title: "Fern Study",
  price: 89,
  currencyCode: "USD",
  imageUrl: "https://cdn.example/fern-study.jpg",
});

function render(overrides: {
  content?: Partial<PlpContent>;
  seo?: Partial<SeoPayload>;
  products?: ReturnType<typeof product>[];
  locale?: string;
} = {}) {
  return renderArticleHtml({
    content: content(overrides.content),
    products: overrides.products ?? [PRODUCT],
    seo: seo(overrides.seo),
    locale: getLocale(overrides.locale ?? "en-US"),
  });
}

describe("heading hierarchy", () => {
  it("starts at h2, because the article title supplies the single h1", () => {
    const html = render();

    expect(html).not.toContain("<h1");
    expect(html).toContain("<h2>Pattern scale for a living room</h2>");
  });

  it("puts FAQ questions at h3 under an h2", () => {
    const html = render();

    expect(html).toContain("<h2>Frequently asked questions</h2>");
    expect(html).toContain("<h3>Is it washable?</h3>");
  });

  it("splits the intro on blank lines into paragraphs", () => {
    const html = render();

    expect(html).toContain("<p>First paragraph.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });
});

describe("optional blocks", () => {
  it("omits the buying guide when the page type has none", () => {
    expect(render()).not.toContain("plp-buying-guide");
  });

  it("renders a buying guide as an ordered list", () => {
    const html = render({
      content: {
        buying_guide: {
          heading: "From measuring to finished wall",
          steps: [{ title: "Measure", body: "Measure the wall." }],
        },
      },
    });

    expect(html).toContain("<h2>From measuring to finished wall</h2>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<h3>Measure</h3>");
  });

  it("renders compliance notes from a locale-specific page type", () => {
    const html = render({
      content: {
        compliance_notes: {
          heading: "Was Mieter beachten müssen",
          points: ["Erster Punkt.", "Zweiter Punkt."],
        },
      },
    });

    expect(html).toContain("<h2>Was Mieter beachten müssen</h2>");
    expect(html).toContain("<li>Erster Punkt.</li>");
  });

  it("omits the related-guides nav when there are no internal links", () => {
    expect(render()).not.toContain("plp-related");
  });

  it("renders internal links as a labelled nav", () => {
    const html = render({
      seo: {
        internalLinks: [
          {
            title: "Botanical Wallpaper for Bedrooms",
            slug: "en-us-botanical-wallpaper-bedroom",
            url: "https://demo.myshopify.com/blogs/seo-plp/en-us-botanical-wallpaper-bedroom",
            sharedFacets: ["style:botanical"],
          },
        ],
      },
    });

    expect(html).toContain('aria-label="Related guides"');
    expect(html).toContain("Botanical Wallpaper for Bedrooms");
  });

  it("renders suitability notes as a definition list", () => {
    // attribute-room's differentiator: label plus explanation, so each point is
    // quotable on its own rather than as a bare bullet.
    const html = render({
      content: {
        suitability_notes: {
          heading: "Where washable stops being enough",
          points: [
            { label: "Splash zone", detail: "Behind a basin, expect standing water." },
          ],
        },
      },
    });

    expect(html).toContain("<h2>Where washable stops being enough</h2>");
    expect(html).toContain("<dt>Splash zone</dt>");
    expect(html).toContain("<dd><p>Behind a basin, expect standing water.</p></dd>");
  });

  it("omits suitability notes on page types that have none", () => {
    expect(render()).not.toContain("plp-suitability");
  });
});

describe("headings the app writes rather than the model", () => {
  /**
   * Every other string in the body comes from the model in the market's
   * language. These two come from the app, and hard-coding them put an English
   * "Related guides" h2 on every German page.
   */
  const withLinks = { internalLinks: [
    {
      title: "Botanische Tapete fürs Schlafzimmer",
      slug: "de-de-botanische-tapete-schlafzimmer",
      url: "https://demo.myshopify.com/blogs/seo-plp/de-de-botanische-tapete-schlafzimmer",
      sharedFacets: ["style:botanical"],
    },
  ] };

  it("takes both headings from the page's own locale", () => {
    const html = render({ locale: "de-DE", seo: withLinks });

    expect(html).toContain("<h2>Häufige Fragen</h2>");
    expect(html).toContain("<h2>Verwandte Ratgeber</h2>");
    expect(html).toContain('aria-label="Verwandte Ratgeber"');
  });

  it("leaves no English heading on a German page", () => {
    const html = render({ locale: "de-DE", seo: withLinks });

    expect(html).not.toContain("Related guides");
    expect(html).not.toContain("Frequently asked questions");
  });
});

describe("product cards", () => {
  it("uses the intent-based alt text when one exists", () => {
    const html = render({
      content: {
        product_alt_texts: [
          { product_id: PRODUCT.id, alt_text: "Fern botanical wallpaper in a living room" },
        ],
      },
    });

    expect(html).toContain('alt="Fern botanical wallpaper in a living room"');
  });

  it("matches alt text supplied by handle as well as by id", () => {
    const html = render({
      content: {
        product_alt_texts: [
          { product_id: "fern-study", alt_text: "Matched by handle instead" },
        ],
      },
    });

    expect(html).toContain('alt="Matched by handle instead"');
  });

  it("falls back to the product title rather than emitting empty alt", () => {
    expect(render()).toContain('alt="Fern Study"');
  });

  it("lazy-loads images, since a PLP is a grid of them", () => {
    expect(render()).toContain('loading="lazy"');
  });

  it("omits the image element entirely when a product has none", () => {
    const html = render({
      products: [{ ...PRODUCT, imageUrl: null }],
    });

    expect(html).not.toContain("<img");
    expect(html).toContain("Fern Study");
  });
});

describe("untrusted content", () => {
  it("escapes HTML in AI-written copy", () => {
    const html = render({
      content: {
        sections: [
          { heading: "<script>alert(1)</script>", body: "Body & more." },
        ],
      },
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("escapes quotes in an alt attribute so it cannot break out", () => {
    const html = render({
      content: {
        product_alt_texts: [
          { product_id: PRODUCT.id, alt_text: '" onerror="alert(1)' },
        ],
      },
    });

    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&quot;");
  });

  it("escapes a product title", () => {
    const html = render({
      products: [{ ...PRODUCT, title: "<b>Bold</b> Fern" }],
    });

    expect(html).toContain("&lt;b&gt;");
  });

  it("prevents a JSON-LD string from closing the script element", () => {
    // A literal </script> inside AI copy would otherwise end the block early
    // and spill the rest of the JSON into the document as markup.
    const html = render({
      seo: {
        jsonLd: [{ "@type": "FAQPage", name: "</script><img src=x onerror=1>" }],
      },
    });

    expect(html).toContain('<script type="application/ld+json">');
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script");
  });

  it("emits each JSON-LD node in its own script tag", () => {
    const html = render({
      seo: {
        jsonLd: [
          { "@type": "CollectionPage" },
          { "@type": "FAQPage" },
          { "@type": "BreadcrumbList" },
        ],
      },
    });

    expect(html.match(/<script type="application\/ld\+json">/g)).toHaveLength(3);
  });
});
