import { fetchCatalogById } from "../catalog/products.server";
import type { CatalogProduct } from "../catalog/types";
import { getLocale, getPageType } from "../../config/index.server";
import { resolveMeta } from "../seo/meta.server";
import { assembleSeoPayload } from "../seo/assemble.server";
import { articleUrl } from "../seo/urls.server";
import { getSettings, type ResolvedSettings } from "../settings/settings.server";
import type { AdminClient } from "../shopify/admin.server";
import { getPage, listPages, updatePage, type PageRecord } from "../plp/repository.server";
import { createArticle, ensureBlog, setArticleSeo, updateArticle } from "./blog.server";
import { renderArticleHtml } from "./render-html.server";

/**
 * Publishing. Only pages whose status is `draft` may publish — anything in
 * needs_review must be resolved by the merchant first, so below-threshold
 * or flagged pages can never reach the storefront.
 *
 * Publishing also re-renders the internal-link sections of the other
 * published pages in the locale: links must stay current as the page set
 * grows, not frozen at each page's own publish time.
 */

export class PublishBlockedError extends Error {}

function resolveProducts(
  page: PageRecord,
  catalogById: Map<string, CatalogProduct>,
): CatalogProduct[] {
  return page.productIds
    .map((id) => catalogById.get(id))
    .filter((product): product is CatalogProduct => Boolean(product));
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
  const products = resolveProducts(page, catalogById);
  const blog = await ensureBlog(admin, storedSettings.blogHandle);
  // Shopify normalizes handles server-side — all URLs must be built from
  // the handle the blog actually has, not the raw setting.
  const settings: ResolvedSettings = { ...storedSettings, blogHandle: blog.handle };

  const assembleFor = async (slug: string) => {
    const allPages = await listPages(shop);
    const currentPage = { ...page, slug };
    // Assemble against the state that includes this page as published.
    const pagesAfterPublish = allPages.map((candidate) =>
      candidate.id === page.id ? { ...candidate, slug, status: "published" } : candidate,
    );
    const seo = rebuildSeo(shop, settings, currentPage, products, pagesAfterPublish, "published");
    return {
      seo,
      articleInput: {
        title: currentPage.content!.h1,
        body: renderArticleHtml({ content: currentPage.content!, products, seo }),
        summary: seo.metaDescription,
        tags: ["wp-plp", page.pageTypeId, page.locale],
        authorName: settings.brandName,
      },
    };
  };

  let slug = page.slug;
  let { seo, articleInput } = await assembleFor(slug);
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
      ({ seo, articleInput } = await assembleFor(slug));
      await updateArticle(admin, articleId, articleInput);
    }
  }
  await setArticleSeo(admin, articleId, {
    metaTitle: seo.metaTitle,
    metaDescription: seo.metaDescription,
    noindex: seo.noindex,
  });

  await updatePage(shop, page.id, {
    status: "published",
    seo,
    articleId,
    articleUrl: articleUrl(shop, settings.blogHandle, slug),
    publishedAt: new Date(),
    reviewReason: null,
  });

  await refreshSiblingLinks(admin, shop, settings, catalogById, page);

  const published = await getPage(shop, page.id);
  if (!published) throw new Error("Page vanished during publish");
  return published;
}

/**
 * Re-render every other published page in the locale whose internal links
 * changed now that the new page exists.
 */
async function refreshSiblingLinks(
  admin: AdminClient,
  shop: string,
  settings: ResolvedSettings,
  catalogById: Map<string, CatalogProduct>,
  justPublished: PageRecord,
): Promise<void> {
  const allPages = await listPages(shop);
  const siblings = allPages.filter(
    (page) =>
      page.status === "published" &&
      page.locale === justPublished.locale &&
      page.id !== justPublished.id &&
      page.articleId &&
      page.content,
  );

  for (const sibling of siblings) {
    const products = resolveProducts(sibling, catalogById);
    const seo = rebuildSeo(shop, settings, sibling, products, allPages);
    const previousLinks = JSON.stringify(sibling.seo?.internalLinks ?? []);
    if (previousLinks === JSON.stringify(seo.internalLinks)) continue;

    await updateArticle(admin, sibling.articleId as string, {
      title: sibling.content!.h1,
      body: renderArticleHtml({ content: sibling.content!, products, seo }),
      summary: seo.metaDescription,
      tags: ["wp-plp", sibling.pageTypeId, sibling.locale],
      authorName: settings.brandName,
    });
    await updatePage(shop, sibling.id, { seo });
  }
}
