import { getLocale, getPageType } from "../../config/index.server";
import { truncate } from "../../lib/text";
import { AiOutputInvalidError } from "../ai/json-client.server";
import { fetchCatalog } from "../catalog/products.server";
import type { CatalogProduct } from "../catalog/types";
import { generatePlpContent } from "../generation/generate.server";
import { buildLexicon } from "../intent/lexicon.server";
import { parseIntent } from "../intent/parse.server";
import type { IntentProfile } from "../intent/types";
import { matchProducts, type MatchResult } from "../matching/match.server";
import { assembleSeoPayload } from "../seo/assemble.server";
import { resolveMeta } from "../seo/meta.server";
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
      "no-page-type" | "duplicate" | "blocked-similar" | "slug-taken",
  ) {
    super(message);
  }
}

export interface PipelineOutcome {
  page: PageRecord;
  match: MatchResult;
}

/** Parse (or re-parse) a keyword's intent and persist it. */
export async function analyzeKeyword(
  admin: AdminClient,
  shop: string,
  keywordId: string,
): Promise<IntentProfile> {
  const keyword = await getKeyword(shop, keywordId);
  if (!keyword) throw new Error(`Keyword ${keywordId} not found`);

  const settings = await getSettings(shop);
  const catalog = await fetchCatalog(admin);
  const intent = await parseIntent(
    keyword.phrase,
    keyword.locale,
    buildLexicon(catalog),
  );
  const match = matchProducts(catalog, intent, settings.minProducts);

  await updateKeyword(shop, keywordId, {
    intent,
    pageTypeId: intent.pageTypeId,
    clusterKey: clusterKey(intent),
    matchCount: match.matches.length,
  });
  return intent;
}

/** Run the full pipeline for an approved keyword, producing a PLP page. */
export async function generatePageForKeyword(
  admin: AdminClient,
  shop: string,
  keywordId: string,
): Promise<PipelineOutcome> {
  const keyword = await getKeyword(shop, keywordId);
  if (!keyword) throw new Error(`Keyword ${keywordId} not found`);

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
  const products = catalog.filter((product) => included.has(product.id));
  const pageType = getPageType(page.pageTypeId);
  const locale = getLocale(page.locale);
  const allPages = await listPages(shop);

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
      `Only ${products.length} matching products (minimum ${settings.minProducts}) — thin page, held from publishing.`,
    );
  }
  if (generation.backfilledAltTextIds.length > 0) {
    reviewReasons.push(
      `Alt text for ${generation.backfilledAltTextIds.length} product(s) was backfilled deterministically.`,
    );
  }
  const status =
    page.status === "published"
      ? "published"
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
    reviewReason: reviewReasons.length ? reviewReasons.join(" ") : null,
  });

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

  const belowThreshold = productIds.length < settings.minProducts;
  const thresholdReason = `Only ${productIds.length} matching products (minimum ${settings.minProducts}) — thin page, held from publishing.`;

  // Preserve non-threshold reasons; replace/remove the threshold one.
  const otherReasons = (page.reviewReason ?? "")
    .split(/(?<=\.)\s+/)
    .filter(
      (reason) => reason && !reason.includes("thin page, held from publishing"),
    );
  const reasons = belowThreshold
    ? [thresholdReason, ...otherReasons]
    : otherReasons;

  await updatePage(shop, pageId, {
    productIds,
    status:
      page.status === "published"
        ? "published"
        : reasons.length
          ? "needs_review"
          : "draft",
    reviewReason: reasons.length ? reasons.join(" ") : null,
  });
}

async function runPipeline(
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

  // Canonical consolidation — an equivalent page in the default locale
  // becomes the canonical; this page is its locale variant.
  const canonicalPage =
    locale.code !== settings.defaultLocale
      ? await findPageByCluster(shop, key, settings.defaultLocale)
      : null;

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
      `Only ${products.length} matching products (minimum ${settings.minProducts}) — thin page, held from publishing.`,
    );
  }
  if (similarity.level === "flag") {
    reviewReasons.push(
      `Similar (${similarity.score.toFixed(2)}) to "${similarity.against.title}" — review for cannibalization.`,
    );
  }
  if (generation.backfilledAltTextIds.length > 0) {
    reviewReasons.push(
      `Alt text for ${generation.backfilledAltTextIds.length} product(s) was backfilled deterministically.`,
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
      canonicalSlug: canonicalPage?.slug ?? null,
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
    canonicalOfId: canonicalPage?.id ?? null,
    reviewReason: reviewReasons.length ? reviewReasons.join(" ") : null,
  });

  return { page, match };
}
