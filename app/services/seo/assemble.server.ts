import { getLocale } from "../../config/index.server";
import type { CatalogProduct } from "../catalog/types";
import type { PlpContent } from "../generation/types";
import type { PageRecord } from "../plp/repository.server";
import type { ResolvedSettings } from "../settings/settings.server";
import { computeInternalLinks } from "./internal-links.server";
import { buildJsonLdStack } from "./json-ld.server";
import type { ResolvedMeta } from "./meta.server";
import type { SeoPayload } from "./types";
import { articleUrl } from "./urls.server";

/**
 * Assemble the complete SEO payload for a page from current state. Called
 * at generation time and re-run at publish time (and for affected sibling
 * pages) so canonical/hreflang/internal links always reflect the live set
 * of published pages.
 */

export interface SeoAssemblyInput {
  shop: string;
  settings: ResolvedSettings;
  page: {
    slug: string;
    locale: string;
    intent: PageRecord["intent"];
    clusterKey: string;
    status: string;
    canonicalSlug: string | null;
  };
  content: PlpContent;
  products: CatalogProduct[];
  meta: ResolvedMeta;
  /** All pages of this shop (the assembler filters what it needs). */
  allPages: Pick<PageRecord, "slug" | "locale" | "title" | "intent" | "clusterKey" | "status">[];
}

export function assembleSeoPayload(input: SeoAssemblyInput): SeoPayload {
  const { shop, settings, page, content, products, meta, allPages } = input;
  const blogHandle = settings.blogHandle;
  const selfUrl = articleUrl(shop, blogHandle, page.slug);
  const locale = getLocale(page.locale);

  // hreflang: every locale variant of this cluster references every other.
  // Only published siblings qualify — an alternate must resolve to a live
  // URL — plus self (the page being assembled is about to be live or is
  // being previewed as such).
  const variants = allPages
    .filter(
      (candidate) =>
        candidate.clusterKey === page.clusterKey && candidate.status === "published",
    )
    .map((candidate) => ({
      locale: getLocale(candidate.locale).hreflang,
      url: articleUrl(shop, blogHandle, candidate.slug),
    }));
  const hreflang = variants.some((v) => v.url === selfUrl)
    ? variants
    : [...variants, { locale: locale.hreflang, url: selfUrl }];

  // Canonical consolidation: a designated variant points at its canonical
  // page; everything else is self-referencing.
  const canonicalUrl = page.canonicalSlug
    ? articleUrl(shop, blogHandle, page.canonicalSlug)
    : selfUrl;

  const internalLinks = computeInternalLinks(
    page,
    allPages
      .filter((candidate) => candidate.status === "published")
      .map((candidate) => ({
        title: candidate.title,
        slug: candidate.slug,
        locale: candidate.locale,
        intent: candidate.intent,
      })),
    shop,
    blogHandle,
  );

  return {
    metaTitle: meta.title,
    metaDescription: meta.description,
    keywords: meta.keywords,
    canonicalUrl,
    hreflang,
    jsonLd: buildJsonLdStack({
      shop,
      url: selfUrl,
      content,
      products,
      locale,
      brandName: settings.brandName,
      blogHandle,
    }),
    internalLinks,
    noindex: page.status !== "published",
  };
}
