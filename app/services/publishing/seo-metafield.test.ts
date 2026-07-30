import { describe, expect, it } from "vitest";
import type { SeoPayload } from "../seo/types";
import { toSeoHeadPayload } from "./seo-metafield.server";

/**
 * The head payload is the contract between the app and the Liquid block, so
 * the shape and the emit/omit decisions are pinned here. A mistake shows up as
 * silently missing hreflang on a live page, which is invisible without this.
 */

function seo(overrides: Partial<SeoPayload> = {}): SeoPayload {
  return {
    metaTitle: "Botanical Wallpaper for Living Rooms",
    metaDescription: "Description.",
    keywords: [],
    canonicalUrl: "https://demo.myshopify.com/blogs/seo-plp/en-us-page",
    hreflang: [
      { locale: "en-US", url: "https://demo.myshopify.com/blogs/seo-plp/en-us-page" },
    ],
    jsonLd: [],
    internalLinks: [],
    noindex: false,
    ...overrides,
  };
}

describe("toSeoHeadPayload", () => {
  it("omits hreflang when the page is its own only variant", () => {
    // A lone self-referencing alternate tells a crawler nothing, so there is
    // no reason to put it in the head.
    expect(toSeoHeadPayload(seo()).hreflang).toEqual([]);
  });

  it("emits every alternate once a real variant exists", () => {
    const alternates = [
      { locale: "en-US", url: "https://demo.myshopify.com/blogs/seo-plp/en-us-page" },
      { locale: "de-DE", url: "https://demo.myshopify.com/blogs/seo-plp/de-de-page" },
    ];

    expect(toSeoHeadPayload(seo({ hreflang: alternates })).hreflang).toEqual(
      alternates,
    );
  });

  it("carries no canonical, because the block must not emit one", () => {
    // The theme already emits a self-referencing canonical for every article
    // and an app extension cannot remove it; a second one naming a different
    // URL is a mixed signal Google may discard entirely. Shipping the field
    // to a block that never reads it only implies otherwise.
    expect(toSeoHeadPayload(seo())).not.toHaveProperty("canonical");
  });

  it("carries noindex through", () => {
    expect(toSeoHeadPayload(seo({ noindex: true })).noindex).toBe(true);
    expect(toSeoHeadPayload(seo({ noindex: false })).noindex).toBe(false);
  });

  it("produces exactly the two keys the Liquid block reads", () => {
    expect(Object.keys(toSeoHeadPayload(seo())).sort()).toEqual([
      "hreflang",
      "noindex",
    ]);
  });

  it("survives a JSON round trip, since it is stored as a json metafield", () => {
    const payload = toSeoHeadPayload(
      seo({
        hreflang: [
          { locale: "en-US", url: "https://demo.myshopify.com/a" },
          { locale: "de-DE", url: "https://demo.myshopify.com/b" },
        ],
      }),
    );

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
