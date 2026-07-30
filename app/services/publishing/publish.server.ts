import { fetchCatalogById } from "../catalog/products.server";
import {
  createMarketPriceResolver,
  type MarketPriceResolver,
} from "../catalog/pricing.server";
import type { CatalogProduct } from "../catalog/types";
import { getLocale, getPageType } from "../../config/index.server";
import { resolveMeta } from "../seo/meta.server";
import { assembleSeoPayload } from "../seo/assemble.server";
import { articlePath, articleUrl } from "../seo/urls.server";
import { getSettings, type ResolvedSettings } from "../settings/settings.server";
import type { AdminClient } from "../shopify/admin.server";
import {
  deletePage,
  getPage,
  listPages,
  updatePage,
  type PageRecord,
} from "../plp/repository.server";
import {
  REVIEW_MARKER,
  joinReviewReasons,
  withoutReason,
} from "../plp/review-reasons";
import { PAGE_STATUS } from "../plp/status";
import {
  createArticle,
  deleteArticle,
  ensureBlog,
  setArticleSeo,
  updateArticle,
} from "./blog.server";
import { dependentsOf, planConsolidation } from "./consolidation.server";
import { ensureRedirect, removeRedirect } from "./redirect.server";
import {
  ensureSeoHeadDefinition,
  setArticleSeoHead,
  toSeoHeadPayload,
} from "./seo-metafield.server";
import { renderArticleHtml } from "./render-html.server";

/**
 * Publishing. Only pages whose status is `draft` may publish — anything in
 * needs_review must be resolved by the merchant first, so below-threshold
 * or flagged pages can never reach the storefront.
 *
 * Publishing has two outcomes, not one:
 *
 * - a normal page becomes a blog article, with its SEO payload written to the
 *   article and its head metafield;
 * - a page carrying a consolidation target becomes a 301 redirect onto that
 *   target and never gets an article at all, so the two never compete. See
 *   consolidation.server.ts for why a redirect and not a canonical tag.
 *
 * Publishing also re-renders the internal-link sections of the other
 * published pages in the locale: links must stay current as the page set
 * grows, not frozen at each page's own publish time.
 */

export class PublishBlockedError extends Error {}

/**
 * The page's products, priced for the page's own market. Every caller here
 * goes through this, so a published article and its JSON-LD always quote the
 * same currency the copy was written in.
 */
async function resolveProducts(
  pricing: MarketPriceResolver,
  page: PageRecord,
  catalogById: Map<string, CatalogProduct>,
): Promise<CatalogProduct[]> {
  const products = page.productIds
    .map((id) => catalogById.get(id))
    .filter((product): product is CatalogProduct => Boolean(product));
  return pricing(products, getLocale(page.locale));
}

/** Rebuild a page's SEO payload against current published state. */
function rebuildSeo(
  shop: string,
  settings: ResolvedSettings,
  page: PageRecord,
  products: CatalogProduct[],
  allPages: PageRecord[],
  statusOverride?: string,
) {
  if (!page.content) throw new PublishBlockedError(`Page ${page.id} has no generated content`);
  const canonicalSlug = page.canonicalOfId
    ? (allPages.find((candidate) => candidate.id === page.canonicalOfId)?.slug ?? null)
    : null;
  const meta = resolveMeta(
    page.content,
    getPageType(page.pageTypeId),
    page.intent,
    getLocale(page.locale),
    settings.brandName,
    products.length,
  );
  return assembleSeoPayload({
    shop,
    settings,
    page: {
      slug: page.slug,
      locale: page.locale,
      intent: page.intent,
      clusterKey: page.clusterKey ?? "",
      status: statusOverride ?? page.status,
      canonicalSlug,
    },
    content: page.content,
    products,
    meta,
    allPages,
  });
}

export async function publishPage(
  admin: AdminClient,
  shop: string,
  pageId: string,
): Promise<PageRecord> {
  const page = await getPage(shop, pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);
  if (!page.content) throw new PublishBlockedError("Page has no generated content yet.");
  if (page.status === "needs_review") {
    throw new PublishBlockedError(
      `Page is held for review: ${page.reviewReason ?? "unresolved review reason"}. ` +
        "Resolve the review (adjust products or approve explicitly) before publishing.",
    );
  }

  const storedSettings = await getSettings(shop);
  const catalogById = await fetchCatalogById(admin);
  // One resolver for the whole publish, including the refresh of affected
  // pages, so overlapping products are priced once rather than once per page.
  const pricing = createMarketPriceResolver(admin);
  const products = await resolveProducts(pricing, page, catalogById);
  const blog = await ensureBlog(admin, storedSettings.blogHandle);
  // Shopify normalizes handles server-side — all URLs must be built from
  // the handle the blog actually has, not the raw setting.
  const settings: ResolvedSettings = { ...storedSettings, blogHandle: blog.handle };

  const assembleFor = async (slug: string, status: string) => {
    const allPages = await listPages(shop);
    const currentPage = { ...page, slug };
    // Assemble against the state this publish will produce, so siblings see
    // the page's new status when their hreflang and links are recomputed.
    const pagesAfterPublish = allPages.map((candidate) =>
      candidate.id === page.id ? { ...candidate, slug, status } : candidate,
    );
    const seo = rebuildSeo(shop, settings, currentPage, products, pagesAfterPublish, status);
    return {
      seo,
      articleInput: {
        title: currentPage.content!.h1,
        body: renderArticleHtml({
          content: currentPage.content!,
          products,
          seo,
          locale: getLocale(currentPage.locale),
        }),
        summary: seo.metaDescription,
        tags: ["wp-plp", page.pageTypeId, page.locale],
        authorName: settings.brandName,
      },
    };
  };

  // Consolidation is decided before any article work, because the two
  // outcomes are mutually exclusive: a consolidated page must never also
  // exist as a competing document.
  const allPagesNow = await listPages(shop);
  const plan = planConsolidation({
    page,
    target: page.canonicalOfId
      ? (allPagesNow.find((candidate) => candidate.id === page.canonicalOfId) ?? null)
      : null,
    blogHandle: settings.blogHandle,
  });

  if (plan.kind === "blocked") throw new PublishBlockedError(plan.reason);

  if (plan.kind === "redirect") {
    const { seo } = await assembleFor(page.slug, PAGE_STATUS.CONSOLIDATED);

    // Order matters. Shopify resolves redirects before the theme renders, so
    // an article left at this handle would be unreachable — but it would still
    // sit in Shopify's own sitemap.xml as a crawlable duplicate. Remove it
    // first, then install the redirect.
    if (page.articleId) await deleteArticle(admin, page.articleId);
    await ensureRedirect(admin, plan.fromPath, plan.toPath);

    await updatePage(shop, page.id, {
      status: PAGE_STATUS.CONSOLIDATED,
      seo,
      articleId: null,
      // Deliberately null: this page has no URL of its own any more. The
      // canonical target's URL lives in seo.canonicalUrl, and llms.txt and
      // sitemap-ai.xml both key off published pages, so neither lists it.
      articleUrl: null,
      publishedAt: new Date(),
      reviewReason: null,
    });

    await refreshAffectedPages(admin, shop, settings, catalogById, pricing, page);

    const consolidated = await getPage(shop, page.id);
    if (!consolidated) throw new Error("Page vanished during consolidation");
    return consolidated;
  }

  // A page that was consolidated and no longer is must have its redirect
  // removed before the article is created. A stale redirect resolves ahead of
  // the theme, so leaving it would shadow the new article permanently.
  if (page.status === PAGE_STATUS.CONSOLIDATED) {
    await removeRedirect(admin, articlePath(settings.blogHandle, page.slug));
  }

  let slug = page.slug;
  let { seo, articleInput } = await assembleFor(slug, "published");
  let articleId = page.articleId;

  if (articleId) {
    await updateArticle(admin, articleId, articleInput);
  } else {
    const article = await createArticle(admin, {
      ...articleInput,
      blogId: blog.id,
      handle: slug,
    });
    articleId = article.id;
    // A pre-existing article can force a suffixed handle; if so, the page
    // adopts the real handle and its body/SEO are rebuilt around it.
    if (article.handle !== slug) {
      slug = article.handle;
      await updatePage(shop, page.id, { slug });
      ({ seo, articleInput } = await assembleFor(slug, "published"));
      await updateArticle(admin, articleId, articleInput);
    }
  }
  await setArticleSeo(admin, articleId, {
    metaTitle: seo.metaTitle,
    metaDescription: seo.metaDescription,
    noindex: seo.noindex,
  });
  // hreflang has to be a head tag, which an article body cannot carry, so the
  // theme extension reads it from here. See seo-metafield.server.ts.
  await ensureSeoHeadDefinition(admin, shop);
  await setArticleSeoHead(admin, articleId, toSeoHeadPayload(seo));

  await updatePage(shop, page.id, {
    status: "published",
    seo,
    articleId,
    articleUrl: articleUrl(shop, settings.blogHandle, slug),
    publishedAt: new Date(),
    reviewReason: null,
  });

  await refreshAffectedPages(admin, shop, settings, catalogById, pricing, page);

  const published = await getPage(shop, page.id);
  if (!published) throw new Error("Page vanished during publish");
  return published;
}

/**
 * Undo a consolidation, because the merchant disagrees with it.
 *
 * The similarity check is a heuristic, and this app's stance everywhere else
 * is that its verdicts are strong defaults rather than cages — so the
 * merchant can insist a flagged page is genuinely its own page. Doing that
 * has to remove the redirect: Shopify resolves redirects ahead of the theme,
 * so a page whose consolidation was cleared but whose redirect survived could
 * never be published again.
 *
 * The cannibalization warning is kept as an advisory note rather than erased.
 * Overruling the check is allowed; hiding that it fired is not — and only that
 * one reason is dropped, because a page can be held for more than one thing at
 * once and clearing a consolidation is not permission to publish a thin page.
 */
export async function releaseConsolidation(
  admin: AdminClient,
  shop: string,
  pageId: string,
): Promise<PageRecord> {
  const page = await getPage(shop, pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);

  const wasConsolidated = page.status === PAGE_STATUS.CONSOLIDATED;
  if (!page.canonicalOfId && !wasConsolidated) {
    throw new PublishBlockedError("This page is not consolidated onto another page.");
  }

  const settings = await getSettings(shop);
  const blog = await ensureBlog(admin, settings.blogHandle);
  const allPages = await listPages(shop);
  const target = allPages.find((candidate) => candidate.id === page.canonicalOfId);

  // Unconditional and idempotent: a page can carry a consolidation that was
  // decided but never published, and a half-finished earlier run could have
  // left a redirect behind. Either way the path must end up clear, or the page
  // can never be published as itself.
  await removeRedirect(admin, articlePath(blog.handle, page.slug));

  // Drop only the cannibalization note. Anything else the page was held for —
  // a thin product count above all — is still true, and must keep holding it.
  const overrideNote =
    "Publishing as its own page by merchant override: the similarity check had " +
    `flagged it as a near-duplicate of ` +
    `${target ? `"${target.title}"` : "another page in this market"}, so watch ` +
    "both pages for cannibalization in Search Console.";
  const reasons = [
    ...withoutReason(page.reviewReason, REVIEW_MARKER.CANNIBALIZATION),
    overrideNote,
  ];

  await updatePage(shop, pageId, {
    canonicalOfId: null,
    // A consolidated page has no article, so releasing it genuinely takes it
    // off the storefront and it must be published again explicitly. A page that
    // was never consolidated keeps whatever status it had, so releasing a
    // still-held page cannot smuggle it past its own review.
    ...(wasConsolidated
      ? {
          status: PAGE_STATUS.DRAFT,
          articleId: null,
          articleUrl: null,
          publishedAt: null,
        }
      : {}),
    reviewReason: joinReviewReasons(reasons),
  });

  const released = await getPage(shop, pageId);
  if (!released) throw new Error("Page vanished while releasing its consolidation");
  return released;
}

/**
 * Remove a page from Shopify and from the local set, leaving nothing stale
 * behind.
 *
 * Deletion is where consolidation can do real damage if it is handled
 * casually, so all three consequences are dealt with here rather than in the
 * route:
 *
 * - pages consolidated *onto* this one would keep a 301 pointing at a URL
 *   that now 404s, so they are released first;
 * - this page's own article or redirect has to go, whichever it has;
 * - published siblings still link to it and may still name it in hreflang, so
 *   the same refresh a publish triggers has to run for a deletion too.
 */
export async function retirePage(
  admin: AdminClient,
  shop: string,
  pageId: string,
): Promise<void> {
  const page = await getPage(shop, pageId);
  if (!page) return;

  const settings = await getSettings(shop);
  const blog = await ensureBlog(admin, settings.blogHandle);
  const resolvedSettings: ResolvedSettings = { ...settings, blogHandle: blog.handle };
  const allPages = await listPages(shop);

  for (const dependent of dependentsOf(allPages, pageId)) {
    await removeRedirect(admin, articlePath(blog.handle, dependent.slug));
    await updatePage(shop, dependent.id, {
      canonicalOfId: null,
      status: "needs_review",
      articleId: null,
      articleUrl: null,
      publishedAt: null,
      reviewReason:
        `Was consolidated onto "${page.title}", which has been deleted. Its ` +
        "redirect is gone; decide whether this page should now stand on its own.",
    });
  }

  if (page.articleId) await deleteArticle(admin, page.articleId);
  if (page.status === PAGE_STATUS.CONSOLIDATED) {
    await removeRedirect(admin, articlePath(blog.handle, page.slug));
  }

  await deletePage(shop, pageId);

  // Siblings' bodies still contain a "Related guides" link to the page that
  // just disappeared, and same-cluster variants still name it in hreflang.
  const catalogById = await fetchCatalogById(admin);
  const pricing = createMarketPriceResolver(admin);
  await refreshAffectedPages(admin, shop, resolvedSettings, catalogById, pricing, page);
}

/**
 * Just enough of a page to decide what a publish invalidates. Structural
 * rather than `Pick<PageRecord, …>` because only the *presence* of content
 * matters here, not its shape.
 */
interface AffectedCandidate {
  id: string;
  status: string;
  locale: string;
  clusterKey: string | null;
  content: unknown;
}

/**
 * Published pages whose SEO payload is invalidated by another page going
 * live.
 *
 * Two distinct relationships, and missing either one leaves stale markup:
 *
 * - same locale — the new page joins the internal-link graph, so siblings
 *   may gain a "Related guides" entry
 * - same intent cluster, any locale — the new page is a locale variant, and
 *   hreflang has to be reciprocal or search engines discard the annotation
 *   entirely
 *
 * Pure and exported so the relationship is testable without a store.
 */
export function affectedByPublish<T extends AffectedCandidate>(
  pages: T[],
  justPublished: AffectedCandidate,
): T[] {
  return pages.filter(
    (page) =>
      page.status === "published" &&
      page.id !== justPublished.id &&
      page.content !== null &&
      (page.locale === justPublished.locale ||
        (page.clusterKey !== null &&
          page.clusterKey === justPublished.clusterKey)),
  );
}

/**
 * Rebuild the SEO payload of every page a publish invalidated, and re-render
 * the ones whose visible body actually changed.
 *
 * The two are separate on purpose: hreflang and canonical live in the stored
 * payload and the AI sitemap, so a locale variant appearing does not require
 * an Admin API write, while a new internal link does.
 */
async function refreshAffectedPages(
  admin: AdminClient,
  shop: string,
  settings: ResolvedSettings,
  catalogById: Map<string, CatalogProduct>,
  pricing: MarketPriceResolver,
  justPublished: PageRecord,
): Promise<void> {
  const allPages = await listPages(shop);

  for (const page of affectedByPublish(allPages, justPublished)) {
    const products = await resolveProducts(pricing, page, catalogById);
    const seo = rebuildSeo(shop, settings, page, products, allPages);
    if (JSON.stringify(seo) === JSON.stringify(page.seo)) continue;

    const bodyChanged =
      JSON.stringify(seo.internalLinks) !==
      JSON.stringify(page.seo?.internalLinks ?? []);
    if (page.articleId) {
      if (bodyChanged) {
        await updateArticle(admin, page.articleId, {
          title: page.content!.h1,
          body: renderArticleHtml({
            content: page.content!,
            products,
            seo,
            locale: getLocale(page.locale),
          }),
          summary: seo.metaDescription,
          tags: ["wp-plp", page.pageTypeId, page.locale],
          authorName: settings.brandName,
        });
      }
      // Always: the cross-locale half of this refresh exists precisely to
      // keep hreflang reciprocal, and hreflang lives in this metafield.
      await setArticleSeoHead(admin, page.articleId, toSeoHeadPayload(seo));
    }
    await updatePage(shop, page.id, { seo });
  }
}
