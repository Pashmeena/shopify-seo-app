import { describe, expect, it } from "vitest";
import { intent, tagged } from "../../test-support/catalog";
import type { PlpContent } from "../generation/types";
import type { ResolvedSettings } from "../settings/settings.server";
import { assembleSeoPayload, type SeoAssemblyInput } from "./assemble.server";

/**
 * SEO assembly is where canonical, hreflang, noindex and internal links are
 * decided together, so it is asserted as a whole rather than per builder.
 */

const SHOP = "demo.myshopify.com";
const CLUSTER = "room:living room|style:botanical";

const SETTINGS = {
  brandName: "Wild Palace",
  blogHandle: "seo-plp",
  defaultLocale: "en-US",
} as ResolvedSettings;

const CONTENT: PlpContent = {
  h1: "Botanical Wallpaper for Living Rooms",
  intro: "Intro copy.",
  sections: [{ heading: "Pattern scale", body: "Body copy." }],
  faq: [{ question: "Is it washable?", answer: "Yes, it is washable." }],
  meta: { title: "Botanical Wallpaper", description: "Description." },
  product_alt_texts: [],
};

interface PageFixture {
  slug: string;
  locale: string;
  status: string;
  clusterKey?: string | null;
  title?: string;
  facets?: Parameters<typeof intent>[0];
}

function page(fixture: PageFixture) {
  return {
    slug: fixture.slug,
    locale: fixture.locale,
    status: fixture.status,
    title: fixture.title ?? fixture.slug,
    clusterKey: fixture.clusterKey === undefined ? CLUSTER : fixture.clusterKey,
    intent: intent(
      fixture.facets ?? { style: ["botanical"], room: ["living room"] },
    ),
  };
}

type AssembleOverrides = Omit<Partial<SeoAssemblyInput>, "page"> & {
  page?: Partial<SeoAssemblyInput["page"]>;
};

function assemble(overrides: AssembleOverrides = {}) {
  return assembleSeoPayload({
    shop: SHOP,
    settings: SETTINGS,
    content: CONTENT,
    products: [tagged("style:botanical", "room:living-room")],
    meta: {
      title: "Botanical Wallpaper for Living Rooms",
      description: "Shop botanical wallpapers chosen for the living room.",
      keywords: ["botanical wallpaper living room"],
    },
    allPages: [],
    ...overrides,
    page: {
      slug: "en-us-botanical-wallpaper-living-room",
      locale: "en-US",
      intent: intent({ style: ["botanical"], room: ["living room"] }),
      clusterKey: CLUSTER,
      status: "published",
      canonicalSlug: null,
      ...overrides.page,
    },
  });
}

const url = (slug: string) => `https://${SHOP}/blogs/seo-plp/${slug}`;

describe("canonical", () => {
  it("is self-referencing by default", () => {
    expect(assemble().canonicalUrl).toBe(
      url("en-us-botanical-wallpaper-living-room"),
    );
  });

  it("points at the designated page when one is set", () => {
    const seo = assemble({
      page: { canonicalSlug: "en-us-botanical-wallpaper-lounge" },
    });

    expect(seo.canonicalUrl).toBe(url("en-us-botanical-wallpaper-lounge"));
  });
});

describe("hreflang", () => {
  it("includes self even when no sibling is published", () => {
    expect(assemble().hreflang).toEqual([
      { locale: "en-US", url: url("en-us-botanical-wallpaper-living-room") },
    ]);
  });

  it("references every published locale variant of the same cluster", () => {
    const seo = assemble({
      allPages: [
        page({ slug: "en-us-botanical-wallpaper-living-room", locale: "en-US", status: "published" }),
        page({ slug: "de-de-botanische-tapete-wohnzimmer", locale: "de-DE", status: "published" }),
      ],
    });

    expect(seo.hreflang).toEqual([
      { locale: "en-US", url: url("en-us-botanical-wallpaper-living-room") },
      { locale: "de-DE", url: url("de-de-botanische-tapete-wohnzimmer") },
    ]);
  });

  it("does not list itself twice when it is already in the published set", () => {
    const seo = assemble({
      allPages: [
        page({ slug: "en-us-botanical-wallpaper-living-room", locale: "en-US", status: "published" }),
      ],
    });

    expect(seo.hreflang).toHaveLength(1);
  });

  it("excludes a variant that is not live, since the URL would 404", () => {
    const seo = assemble({
      allPages: [
        page({ slug: "de-de-botanische-tapete-wohnzimmer", locale: "de-DE", status: "draft" }),
      ],
    });

    expect(seo.hreflang.map((entry) => entry.locale)).toEqual(["en-US"]);
  });

  it("excludes a published page from a different cluster", () => {
    const seo = assemble({
      allPages: [
        page({
          slug: "de-de-tropische-tapete-schlafzimmer",
          locale: "de-DE",
          status: "published",
          clusterKey: "room:bedroom|style:tropical",
        }),
      ],
    });

    expect(seo.hreflang.map((entry) => entry.locale)).toEqual(["en-US"]);
  });
});

describe("noindex", () => {
  it.each([
    ["draft", true],
    ["needs_review", true],
    ["published", false],
  ])("is %s -> %s", (status, expected) => {
    expect(assemble({ page: { status } }).noindex).toBe(expected);
  });
});

describe("internal links", () => {
  it("links published same-locale pages that share a facet value", () => {
    const seo = assemble({
      allPages: [
        page({
          slug: "en-us-botanical-wallpaper-bedroom",
          locale: "en-US",
          status: "published",
          title: "Botanical Wallpaper for Bedrooms",
          clusterKey: "room:bedroom|style:botanical",
          facets: { style: ["botanical"], room: ["bedroom"] },
        }),
        page({
          slug: "en-us-tropical-wallpaper-living-room",
          locale: "en-US",
          status: "published",
          title: "Tropical Wallpaper for Living Rooms",
          clusterKey: "room:living room|style:tropical",
          facets: { style: ["tropical"], room: ["living room"] },
        }),
      ],
    });

    expect(seo.internalLinks).toEqual([
      {
        title: "Botanical Wallpaper for Bedrooms",
        slug: "en-us-botanical-wallpaper-bedroom",
        url: url("en-us-botanical-wallpaper-bedroom"),
        sharedFacets: ["style:botanical"],
      },
      {
        title: "Tropical Wallpaper for Living Rooms",
        slug: "en-us-tropical-wallpaper-living-room",
        url: url("en-us-tropical-wallpaper-living-room"),
        sharedFacets: ["room:living room"],
      },
    ]);
  });

  it("does not link across locales", () => {
    const seo = assemble({
      allPages: [
        page({
          slug: "de-de-botanische-tapete-schlafzimmer",
          locale: "de-DE",
          status: "published",
          clusterKey: "room:bedroom|style:botanical",
          facets: { style: ["botanical"], room: ["bedroom"] },
        }),
      ],
    });

    expect(seo.internalLinks).toEqual([]);
  });

  it("does not link a page to itself", () => {
    const seo = assemble({
      allPages: [
        page({ slug: "en-us-botanical-wallpaper-living-room", locale: "en-US", status: "published" }),
      ],
    });

    expect(seo.internalLinks).toEqual([]);
  });

  it("ranks by how many facet values are shared", () => {
    const seo = assemble({
      allPages: [
        page({
          slug: "one-shared",
          locale: "en-US",
          status: "published",
          clusterKey: "a",
          facets: { style: ["botanical"], room: ["bedroom"] },
        }),
        page({
          slug: "two-shared",
          locale: "en-US",
          status: "published",
          clusterKey: "b",
          facets: { style: ["botanical"], room: ["living room"], color: ["green"] },
        }),
      ],
    });

    expect(seo.internalLinks.map((link) => link.slug)).toEqual([
      "two-shared",
      "one-shared",
    ]);
  });
});

describe("JSON-LD stack", () => {
  it("emits CollectionPage with an ItemList, FAQPage and BreadcrumbList", () => {
    const seo = assemble();

    expect(seo.jsonLd.map((node) => node["@type"])).toEqual([
      "CollectionPage",
      "FAQPage",
      "BreadcrumbList",
    ]);
    const collectionPage = seo.jsonLd[0] as Record<string, any>;
    expect(collectionPage.mainEntity["@type"]).toBe("ItemList");
    expect(collectionPage.mainEntity.numberOfItems).toBe(1);
    expect(collectionPage.mainEntity.itemListElement[0]).toMatchObject({
      "@type": "ListItem",
      position: 1,
      item: { "@type": "Product" },
    });
  });
});
