import Ajv from "ajv";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPageType } from "../../config/index.server";
import type { IntentFacet } from "../../config/types";
import { SEED_PRODUCTS } from "../catalog/seed-data";
import { deriveFacets } from "../catalog/products.server";
import type { CatalogProduct } from "../catalog/types";
import { matchProducts } from "../matching/match.server";
import {
  buildExampleSeo,
  exampleProduct,
  EXAMPLE_SHOP,
} from "../../test-support/example-fixtures";
import { examplePage, siblingsOf } from "../../test-support/example-store";

/**
 * The `examples/` files are a deliverable: three full pipeline outputs a
 * reviewer reads to see what the app produces.
 *
 * They are checked here rather than trusted. The AI content is committed
 * (it was generated once), but the product selection and the entire SEO
 * payload are re-derived by the real matcher and the real assembler and
 * compared against the file. So an example cannot claim behaviour the app no
 * longer has, and cannot describe internal links or hreflang that would not
 * actually be produced.
 *
 * Run with UPDATE_EXAMPLES=1 to rewrite the derived halves after an
 * intentional change.
 */

const UPDATE = process.env.UPDATE_EXAMPLES === "1";
const EXAMPLES_DIR = join(process.cwd(), "examples");

const FILES = [
  { file: "style-room.en-US.json", slug: "en-us-botanical-wallpaper-living-room" },
  { file: "style-room.de-DE.json", slug: "de-de-botanische-tapete-wohnzimmer" },
  { file: "use-case.en-US.json", slug: "en-us-peel-and-stick-wallpaper-renters" },
] as const;

/** The seeded demo catalog as the catalog layer presents it. */
function seededCatalog(locale: string): CatalogProduct[] {
  return SEED_PRODUCTS.map((seed) => exampleProduct(seed.handle, locale));
}

function readExample(file: string) {
  return JSON.parse(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
}

/** Rebuild the derived halves of an example from its committed intent and content. */
function rebuild(file: string, slug: string) {
  const committed = readExample(file);
  const page = examplePage(slug);
  const pageTypeId = page.pageTypeId!;

  // Products come from the real matcher against the real seeded catalog, so a
  // listed product cannot be one the app would have rejected.
  const match = matchProducts(seededCatalog(page.locale), page.intent, 6);
  const productHandles = match.matches.map((scored) => scored.product.handle);

  const seo = buildExampleSeo({
    pageTypeId,
    slug,
    locale: page.locale,
    clusterKey: page.clusterKey,
    intent: page.intent,
    content: committed.content,
    productHandles,
    canonicalSlug: null,
    siblings: siblingsOf(slug),
  });

  return {
    committed,
    rebuilt: {
      ...committed,
      keyword: page.intent.keyword,
      locale: page.locale,
      page_type: pageTypeId,
      intent: page.intent,
      matched_products: {
        count: productHandles.length,
        threshold: 6,
        handles: productHandles,
      },
      seo,
    },
    match,
  };
}

describe.each(FILES)("examples/$file", ({ file, slug }) => {
  const { committed, rebuilt, match } = rebuild(file, slug);

  if (UPDATE) {
    it("rewritten from the current pipeline", () => {
      writeFileSync(
        join(EXAMPLES_DIR, file),
        `${JSON.stringify(rebuilt, null, 2)}\n`,
        "utf8",
      );
      expect(true).toBe(true);
    });
    return;
  }

  it("content validates against its page type's output_schema", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(getPageType(rebuilt.page_type).output_schema);

    expect(validate(committed.content), ajv.errorsText(validate.errors)).toBe(
      true,
    );
  });

  it("matches what the pipeline produces today", () => {
    expect(committed).toEqual(rebuilt);
  });

  it("clears the product threshold", () => {
    expect(match.meetsThreshold).toBe(true);
  });

  it("has alt text for every product on the page", () => {
    const covered = new Set(
      committed.content.product_alt_texts.map(
        (entry: { product_id: string }) => entry.product_id,
      ),
    );
    for (const handle of rebuilt.matched_products.handles) {
      expect(
        covered.has(`gid://shopify/Product/${handle}`) || covered.has(handle),
      ).toBe(true);
    }
  });

  it("carries the full JSON-LD stack with a real ItemList", () => {
    const types = rebuilt.seo.jsonLd.map(
      (node: Record<string, unknown>) => node["@type"],
    );
    expect(types).toEqual(["CollectionPage", "FAQPage", "BreadcrumbList"]);

    const collectionPage = rebuilt.seo.jsonLd[0] as Record<string, any>;
    expect(collectionPage.mainEntity["@type"]).toBe("ItemList");
    expect(collectionPage.mainEntity.itemListElement).toHaveLength(
      rebuilt.matched_products.count,
    );
    expect(collectionPage.mainEntity.itemListElement[0].item.offers.price).toBeTruthy();
  });

  it("quotes the market's currency in every offer", () => {
    const expected = { "en-US": "USD", "de-DE": "EUR" }[
      rebuilt.locale as "en-US" | "de-DE"
    ];
    const collectionPage = rebuilt.seo.jsonLd[0] as Record<string, any>;

    for (const element of collectionPage.mainEntity.itemListElement) {
      expect(element.item.offers.priceCurrency).toBe(expected);
    }
  });

  it("is self-canonical, with hreflang carrying every locale variant", () => {
    const self = `https://${EXAMPLE_SHOP}/blogs/seo-plp/${slug}`;
    expect(rebuilt.seo.canonicalUrl).toBe(self);
    expect(rebuilt.seo.hreflang).toContainEqual({
      locale: rebuilt.intent.locale,
      url: self,
    });
  });

  it("only links to pages that genuinely share an intent facet", () => {
    for (const link of rebuilt.seo.internalLinks) {
      const target = examplePage(link.slug);
      expect(target.locale).toBe(rebuilt.locale);
      expect(link.sharedFacets.length).toBeGreaterThan(0);

      for (const shared of link.sharedFacets) {
        // `facet:value`, where the value itself may contain a colon.
        const [facet, value] = shared.split(/:(.*)/s) as [IntentFacet, string];
        expect(target.intent.facets[facet]).toContain(value);
        expect(rebuilt.intent.facets[facet]).toContain(value);
      }
    }
  });

  it("is not marked noindex, since it is published", () => {
    expect(rebuilt.seo.noindex).toBe(false);
  });
});

describe("the example store", () => {
  it("derives the same facets from seed tags that the catalog layer would", () => {
    const fern = SEED_PRODUCTS.find((seed) => seed.handle === "fern-study")!;
    const derived = deriveFacets({
      tags: fern.tags,
      title: fern.title,
      productType: "Wallpaper",
      collections: [],
    });

    expect(derived.facets.style).toContain("botanical");
    expect(derived.facets.room).toContain("living room");
  });
});
