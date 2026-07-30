import { getLocale, getPageType } from "../../config/index.server";
import { truncate } from "../../lib/text";
import { AiOutputInvalidError } from "../ai/json-client.server";
import { fetchCatalog } from "../catalog/products.server";
import { priceForMarket } from "../catalog/pricing.server";
import type { CatalogProduct } from "../catalog/types";
import { generatePlpContent } from "../generation/generate.server";
import { buildLexicon } from "../intent/lexicon.server";
import { parseIntent } from "../intent/parse.server";
import type { IntentProfile } from "../intent/types";
import { matchProducts, type MatchResult } from "../matching/match.server";
import { publishPage } from "../publishing/publish.server";
import { assembleSeoPayload } from "../seo/assemble.server";
import { resolveMeta } from "../seo/meta.server";
import { chooseCanonicalTarget } from "../seo/canonical.server";
import { checkSimilarity, clusterKey } from "../seo/similarity.server";
import { buildSlug } from "../seo/slug.server";
import { getSettings } from "../settings/settings.server";
import type { AdminClient } from "../shopify/admin.server";
import {
  createPage,
  findPageByCluster,
  findPageBySlug,
  getKeyword,
  getPage,
  listPages,
  updateKeyword,
  updatePage,
  type PageRecord,
} from "./repository.server";
import {
  REVIEW_MARKER,
  altTextBackfillReason,
  cannibalizationReason,
  joinReviewReasons,
  thinPageReason,
  withoutReason,
} from "./review-reasons";
import { LIVE_PAGE_STATUSES } from "./status";

/**
 * The core loop, orchestrated:
 *
 *   keyword → intent parsing → clustering/dedup gates → product matching
 *   (threshold) → AI generation (schema-validated) → SEO assembly → page
 *
 * Pages are only ever created as `draft` (clean) or `needs_review`
 * (below threshold / flagged similar / other caveat). Publishing is a
 * separate, explicit merchant action.
 */

export class PipelineRejection extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "no-page-type"
      | "duplicate"
      | "blocked-similar"
      | "slug-taken"
      | "not-approved",
  ) {
    super(message);
  }
}

export interface PipelineOutcome {
  page: PageRecord;
  match: MatchResult;
}

/** Run the full pipeline for an approved keyword, producing a PLP page. */
export async function generatePageForKeyword(
  admin: AdminClient,
  shop: string,
  keywordId: string,
): Promise<PipelineOutcome> {
  const keyword = await getKeyword(shop, keywordId);
  if (!keyword) throw new Error(`Keyword ${keywordId} not found`);

  // The brief puts approve/reject *before* generation, so the gate belongs
  // here rather than only in which buttons the UI renders. `failed` is
  // allowed because retrying a failed generation is the same approval.
  if (keyword.status !== "approved" && keyword.status !== "failed") {
    throw new PipelineRejection(
      `"${keyword.phrase}" is ${keyword.status}, not approved. Approve the keyword before generating a page for it.`,
      "not-approved",
    );
  }

  const settings = await getSettings(shop);
  const catalog = await fetchCatalog(admin);

  try {
    const intent =
      keyword.intent ??
      (await parseIntent(
        keyword.phrase,
        keyword.locale,
        buildLexicon(catalog),
      ));

    const outcome = await runPipeline(
      admin,
      shop,
      keyword.id,
      intent,
      catalog,
      settings,
      keyword.productOverrides,
    );
    await updateKeyword(shop, keywordId, {
      status: "generated",
      intent,
      pageTypeId: intent.pageTypeId,
      clusterKey: outcome.page.clusterKey,
      matchCount: outcome.match.matches.length,
      error: null,
    });
    return outcome;
  } catch (error) {
    // Full detail goes to the server log; the merchant-facing row gets a
    // short, actionable message.
    console.error(
      `PLP generation failed for keyword "${keyword.phrase}":`,
      error,
    );
    const message =
      error instanceof AiOutputInvalidError
        ? "The AI response didn't match the required content structure after 3 attempts, so nothing was created. This is usually transient — click Generate PLP to retry."
        : truncate(error instanceof Error ? error.message : String(error), 300);
    await updateKeyword(shop, keywordId, { status: "failed", error: message });
    throw error;
  }
}

type Settings = Awaited<ReturnType<typeof getSettings>>;

/**
 * Re-run generation for an existing page against its current product
 * selection (e.g. after the merchant adjusted products). Keeps identity
 * (slug, cluster, canonical) and re-evaluates review status.
 *
 * A page that is already live is republished as part of this, so the
 * storefront never lags behind what the admin screen shows.
 */
export async function regeneratePage(
  admin: AdminClient,
  shop: string,
  pageId: string,
): Promise<PageRecord> {
  const page = await getPage(shop, pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);

  const settings = await getSettings(shop);
  const catalog = await fetchCatalog(admin);
  const included = new Set(page.productIds);
  const pageType = getPageType(page.pageTypeId);
  const locale = getLocale(page.locale);
  const allPages = await listPages(shop);
  // Priced for this page's market, so the prompt, the rendered body and the
  // JSON-LD Offer all quote the same currency.
  const products = await priceForMarket(
    admin,
    catalog.filter((product) => included.has(product.id)),
    locale,
  );

  const generation = await generatePlpContent({
    pageType,
    locale,
    intent: page.intent,
    products,
    settings,
    relatedPages: allPages
      .filter(
        (candidate) =>
          candidate.status === "published" && candidate.locale === locale.code,
      )
      .slice(0, 8)
      .map((candidate) => ({
        title: candidate.title,
        slug: candidate.slug,
        sharedFacets: [],
      })),
  });

  const meta = resolveMeta(
    generation.content,
    pageType,
    page.intent,
    locale,
    settings.brandName,
    products.length,
  );
  const reviewReasons: string[] = [];
  if (products.length < settings.minProducts) {
    reviewReasons.push(
      thinPageReason(products.length, settings.minProducts),
    );
  }
  if (generation.backfilledAltTextIds.length > 0) {
    reviewReasons.push(
      altTextBackfillReason(generation.backfilledAltTextIds.length),
    );
  }
  // A page that is already live keeps its footing: regenerating content is
  // not a reason to take it down. That includes a consolidated page — its
  // content is stored and inspectable, but its URL is a 301, so regeneration
  // changes nothing a visitor sees and must not resurrect it as an article.
  const status = LIVE_PAGE_STATUSES.includes(page.status)
    ? page.status
    : reviewReasons.length
      ? "needs_review"
      : "draft";

  const seo = assembleSeoPayload({
    shop,
    settings,
    page: {
      slug: page.slug,
      locale: locale.code,
      intent: page.intent,
      clusterKey: page.clusterKey ?? clusterKey(page.intent),
      status,
      canonicalSlug: page.canonicalOfId
        ? (allPages.find((candidate) => candidate.id === page.canonicalOfId)
            ?.slug ?? null)
        : null,
    },
    content: generation.content,
    products,
    meta,
    allPages,
  });

  await updatePage(shop, pageId, {
    title: generation.content.h1,
    content: generation.content,
    seo,
    status,
    reviewReason: joinReviewReasons(reviewReasons),
  });

  // A live page must not silently diverge from what the admin now shows.
  // Republishing pushes the new body, meta and JSON-LD to the article and
  // refreshes whatever the change invalidated elsewhere.
  if (status === "published") {
    const republished = await publishPage(admin, shop, pageId);
    if (reviewReasons.length === 0) return republished;

    // Publishing clears the review note, because going live is what resolves
    // one. A caveat raised by this regeneration is still true, so it is
    // written back — advisory on a live page rather than blocking.
    await updatePage(shop, pageId, {
      reviewReason: joinReviewReasons(reviewReasons),
    });
  }

  const updated = await getPage(shop, pageId);
  if (!updated) throw new Error("Page vanished during regeneration");
  return updated;
}

/**
 * Apply a merchant's manual product adjustment and re-evaluate the
 * threshold. Published pages must be republished for storefront changes.
 */
export async function applyProductSelection(
  shop: string,
  pageId: string,
  productIds: string[],
): Promise<void> {
  const page = await getPage(shop, pageId);
  if (!page) throw new Error(`Page ${pageId} not found`);
  const settings = await getSettings(shop);

  // Preserve every other reason; replace or drop only the threshold one.
  const otherReasons = withoutReason(page.reviewReason, REVIEW_MARKER.THIN);
  const reasons =
    productIds.length < settings.minProducts
      ? [thinPageReason(productIds.length, settings.minProducts), ...otherReasons]
      : otherReasons;

  await updatePage(shop, pageId, {
    productIds,
    status: LIVE_PAGE_STATUSES.includes(page.status)
      ? page.status
      : reasons.length
        ? "needs_review"
        : "draft",
    reviewReason: joinReviewReasons(reasons),
  });
}

async function runPipeline(
  admin: AdminClient,
  shop: string,
  keywordId: string,
  intent: IntentProfile,
  catalog: CatalogProduct[],
  settings: Settings,
  overrideProductIds: string[] | null = null,
): Promise<PipelineOutcome> {
  if (!intent.pageTypeId) {
    throw new PipelineRejection(
      `No page type applies — parsed facets: ${JSON.stringify(intent.facets)}. ` +
        "The keyword needs at least style+room (style-room) or a use case (use-case).",
      "no-page-type",
    );
  }
  const pageType = getPageType(intent.pageTypeId);
  const locale = getLocale(intent.locale);
  const key = clusterKey(intent);

  // Gate 1 — clustering: one canonical page per (cluster, locale).
  const existingInCluster = await findPageByCluster(shop, key, locale.code);
  if (existingInCluster) {
    throw new PipelineRejection(
      `A page for this intent cluster already exists: "${existingInCluster.title}" (${existingInCluster.slug}).`,
      "duplicate",
    );
  }

  // Gate 2 — similarity against existing same-locale pages.
  const allPages = await listPages(shop);
  const sameLocalePages = allPages.filter(
    (page) => page.locale === locale.code,
  );
  const similarity = checkSimilarity(
    intent,
    sameLocalePages.map((page) => ({
      id: page.id,
      title: page.title,
      slug: page.slug,
      intent: page.intent,
    })),
  );
  if (similarity.level === "block") {
    throw new PipelineRejection(
      `Intent is near-identical (similarity ${similarity.score.toFixed(2)}) to "${similarity.against.title}" — generating it would cannibalize that page.`,
      "blocked-similar",
    );
  }

  // Gate 3 — slug identity. Intents can differ by a secondary facet yet
  // resolve to the same URL (the slug template uses primary facets only);
  // caught here, before any generation cost is spent.
  const slug = buildSlug(pageType, intent, locale);
  const slugOwner = await findPageBySlug(shop, slug, locale.code);
  if (slugOwner) {
    throw new PipelineRejection(
      `This intent resolves to the same URL (/${slug}) as "${slugOwner.title}" — refine the keyword or extend the page type's slug_template.`,
      "slug-taken",
    );
  }

  // Product matching with the minimum threshold. A merchant's saved
  // pre-generation selection (match preview) wins over the raw matcher —
  // matcher order is kept for ranked products, manual additions follow.
  const match = matchProducts(catalog, intent, settings.minProducts);
  let products = match.matches.map((scored) => scored.product);
  if (overrideProductIds) {
    const wanted = new Set(overrideProductIds);
    const ranked = products.filter((product) => wanted.has(product.id));
    const rankedIds = new Set(ranked.map((product) => product.id));
    const additions = catalog.filter(
      (product) => wanted.has(product.id) && !rankedIds.has(product.id),
    );
    products = [...ranked, ...additions];
  }

  // Priced for this page's market before anything reads a price, so the
  // prompt, the rendered body and the JSON-LD Offer cannot disagree.
  products = await priceForMarket(admin, products, locale);

  // Canonical consolidation. Locale is never a reason to consolidate — every
  // market page is canonical for itself and its variants are paired by
  // hreflang. Consolidation applies to same-market near-duplicates, which is
  // exactly what the similarity flag above detects. See seo/canonical.server.ts.
  const canonical = chooseCanonicalTarget(
    { locale: locale.code },
    similarity.level === "flag"
      ? { ...similarity.against, locale: locale.code, score: similarity.score }
      : null,
  );

  // AI generation, validated against the page type's output_schema.
  const generation = await generatePlpContent({
    pageType,
    locale,
    intent,
    products,
    settings,
    relatedPages: sameLocalePages
      .filter((page) => page.status === "published")
      .slice(0, 8)
      .map((page) => ({
        title: page.title,
        slug: page.slug,
        sharedFacets: [],
      })),
  });

  const meta = resolveMeta(
    generation.content,
    pageType,
    intent,
    locale,
    settings.brandName,
    products.length,
  );

  const reviewReasons: string[] = [];
  if (products.length < settings.minProducts) {
    reviewReasons.push(
      thinPageReason(products.length, settings.minProducts),
    );
  }
  if (similarity.level === "flag") {
    // The consolidated variant may now promise the pages will not compete,
    // because publishing installs a real 301 rather than recording an
    // intention. See publishing/consolidation.server.ts.
    reviewReasons.push(
      cannibalizationReason(
        similarity.score,
        similarity.against.title,
        Boolean(canonical.target),
      ),
    );
  }
  if (generation.backfilledAltTextIds.length > 0) {
    reviewReasons.push(
      altTextBackfillReason(generation.backfilledAltTextIds.length),
    );
  }
  const status = reviewReasons.length > 0 ? "needs_review" : "draft";

  const seo = assembleSeoPayload({
    shop,
    settings,
    page: {
      slug,
      locale: locale.code,
      intent,
      clusterKey: key,
      status,
      canonicalSlug: canonical.target?.slug ?? null,
    },
    content: generation.content,
    products,
    meta,
    allPages,
  });

  const page = await createPage({
    shop,
    keywordId,
    pageTypeId: pageType.id,
    locale: locale.code,
    slug,
    title: generation.content.h1,
    status,
    intent,
    productIds: products.map((product) => product.id),
    content: generation.content,
    seo,
    clusterKey: key,
    canonicalOfId: canonical.target?.id ?? null,
    reviewReason: joinReviewReasons(reviewReasons),
  });

  return { page, match };
}
