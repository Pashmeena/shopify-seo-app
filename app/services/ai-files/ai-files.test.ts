import { describe, expect, it } from "vitest";
import { intent, product } from "../../test-support/catalog";
import type { PageRecord } from "../plp/repository.server";
import type { ResolvedSettings } from "../settings/settings.server";
import { buildLlmsTxt } from "./llms-txt.server";
import { buildAiSitemap } from "./sitemap-ai.server";

/**
 * The two files aimed at AI crawlers rather than search engines. Both list
 * published pages only, and both are generated from live data, so the thing
 * worth asserting is that nothing unpublished can leak into them and that the
 * metadata a crawler is promised is actually there.
 */

const SHOP = "demo.myshopify.com";

const SETTINGS = { brandName: "Wild Palace" } as ResolvedSettings;

const CATALOG = [
  product({ tags: ["style:botanical", "room:living-room", "material:non-woven"] }),
  product({ tags: ["style:botanical", "room:bedroom", "material:non-woven"] }),
  product({ tags: ["style:tropical", "room:living-room", "material:vinyl"] }),
];

function page(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id: "page-1",
    shop: SHOP,
    keywordId: null,
    pageTypeId: "style-room",
    locale: "en-US",
    slug: "en-us-botanical-wallpaper-living-room",
    title: "Botanical Wallpaper for Living Rooms",
    status: "published",
    intent: intent(
      { style: ["botanical"], room: ["living room"] },
      { keyword: "botanical wallpaper living room" },
    ),
    productIds: ["gid://1", "gid://2", "gid://3", "gid://4", "gid://5", "gid://6"],
    content: null,
    seo: null,
    reviewReason: null,
    clusterKey: "room:living room|style:botanical",
    canonicalOfId: null,
    articleId: "gid://shopify/Article/1",
    articleUrl: `https://${SHOP}/blogs/seo-plp/en-us-botanical-wallpaper-living-room`,
    publishedAt: new Date("2026-07-01T12:00:00Z"),
    createdAt: new Date("2026-06-01T12:00:00Z"),
    updatedAt: new Date("2026-07-01T12:00:00Z"),
    ...overrides,
  } as PageRecord;
}

describe("llms.txt", () => {
  const output = buildLlmsTxt(SHOP, SETTINGS, CATALOG, [page()]);

  it("opens with the brand and a plain-language description of the store", () => {
    expect(output).toMatch(/^# Wild Palace\n/);
    expect(output).toContain("premium wallpaper brand");
  });

  it("summarizes the catalog's facet vocabulary with counts", () => {
    expect(output).toContain("## Styles");
    expect(output).toContain("- botanical (2 products)");
    expect(output).toContain("- tropical (1 products)");
    expect(output).toContain("## Rooms");
    expect(output).toContain("## Materials");
  });

  it("orders facet values by how much of the catalog they cover", () => {
    const styles = output.slice(output.indexOf("## Styles"), output.indexOf("## Rooms"));

    expect(styles.indexOf("botanical")).toBeLessThan(styles.indexOf("tropical"));
  });

  it("lists each page with its intent, keyword, locale and product count", () => {
    expect(output).toContain(
      "- [Botanical Wallpaper for Living Rooms](https://demo.myshopify.com/blogs/seo-plp/en-us-botanical-wallpaper-living-room)",
    );
    expect(output).toContain("intent: style: botanical, room: living room");
    expect(output).toContain("keyword: botanical wallpaper living room");
    expect(output).toContain("locale: en-US (United States)");
    expect(output).toContain("products: 6");
  });

  it("tells a crawler the answers are meant to be citable", () => {
    expect(output).toContain("self-contained and citable");
  });

  it("says so plainly when nothing is published yet", () => {
    const empty = buildLlmsTxt(SHOP, SETTINGS, CATALOG, []);

    expect(empty).toContain("(No pages published yet.)");
  });

  it("still describes the store when the catalog could not be loaded", () => {
    const output = buildLlmsTxt(SHOP, SETTINGS, [], [page()]);

    expect(output).toContain("Product type: Wallpaper (0 products)");
    expect(output).toContain("Botanical Wallpaper for Living Rooms");
  });

  it("ends with a newline, as a text file should", () => {
    expect(output.endsWith("\n")).toBe(true);
  });
});

describe("sitemap-ai.xml", () => {
  const output = buildAiSitemap([page()]);

  it("declares the namespaces it uses", () => {
    expect(output).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(output).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(output).toContain("xmlns:plp=");
  });

  it("carries the four metadata fields the brief asks for", () => {
    expect(output).toContain(
      "<plp:intent>style=botanical; room=living room</plp:intent>",
    );
    expect(output).toContain(
      "<plp:keyword>botanical wallpaper living room</plp:keyword>",
    );
    expect(output).toContain("<plp:productCount>6</plp:productCount>");
    expect(output).toContain("<plp:locale>en-US</plp:locale>");
  });

  it("uses the publish time as lastmod", () => {
    expect(output).toContain("<lastmod>2026-07-01T12:00:00.000Z</lastmod>");
  });

  it("falls back to the update time when a page has no publish time", () => {
    const output = buildAiSitemap([page({ publishedAt: null })]);

    expect(output).toContain("<lastmod>2026-07-01T12:00:00.000Z</lastmod>");
  });

  it("emits hreflang alternates from the stored payload", () => {
    const output = buildAiSitemap([
      page({
        seo: {
          metaTitle: "t",
          metaDescription: "d",
          keywords: [],
          canonicalUrl: "https://demo.myshopify.com/a",
          hreflang: [
            { locale: "en-US", url: "https://demo.myshopify.com/a" },
            { locale: "de-DE", url: "https://demo.myshopify.com/b" },
          ],
          jsonLd: [],
          internalLinks: [],
          noindex: false,
        },
      }),
    ]);

    expect(output).toContain(
      '<xhtml:link rel="alternate" hreflang="en-US" href="https://demo.myshopify.com/a"/>',
    );
    expect(output).toContain('hreflang="de-DE"');
  });

  it("skips a page that has no live URL, since a sitemap entry needs one", () => {
    const output = buildAiSitemap([page({ articleUrl: null })]);

    expect(output).not.toContain("<loc>");
  });

  it("escapes XML-significant characters in metadata", () => {
    const output = buildAiSitemap([
      page({
        intent: intent(
          { style: ["botanical"] },
          { keyword: 'wallpaper & "moody" <greens>' },
        ),
      }),
    ]);

    expect(output).toContain("&amp;");
    expect(output).toContain("&quot;");
    expect(output).toContain("&lt;greens&gt;");
    expect(output).not.toContain("<greens>");
  });

  it("produces a valid empty urlset when nothing is published", () => {
    const output = buildAiSitemap([]);

    expect(output).toContain("<urlset");
    expect(output).toContain("</urlset>");
    expect(output).not.toContain("<url>");
  });

  it("falls back to the keyword when an intent parsed no facets", () => {
    const output = buildAiSitemap([
      page({ intent: intent({}, { keyword: "unparseable phrase" }) }),
    ]);

    expect(output).toContain("<plp:intent>unparseable phrase</plp:intent>");
  });
});
