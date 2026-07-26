import type { Keyword, PlpPage } from "@prisma/client";
import prisma from "../../db.server";
import { parseJsonArray, safeParseJson } from "../../lib/json";
import type { PlpContent } from "../generation/types";
import type { IntentProfile } from "../intent/types";
import type { SeoPayload } from "../seo/types";

/**
 * Typed access to Keyword/PlpPage rows. JSON columns are parsed exactly
 * once, here — everything above this module works with real types.
 */

export interface PageRecord extends Omit<PlpPage, "intent" | "productIds" | "content" | "seo"> {
  intent: IntentProfile;
  productIds: string[];
  content: PlpContent | null;
  seo: SeoPayload | null;
}

export interface KeywordRecord extends Omit<Keyword, "intent"> {
  intent: IntentProfile | null;
}

function toPageRecord(page: PlpPage): PageRecord {
  const intent = safeParseJson<IntentProfile>(page.intent);
  if (!intent) throw new Error(`PlpPage ${page.id} has unparseable intent JSON`);
  return {
    ...page,
    intent,
    productIds: parseJsonArray<string>(page.productIds),
    content: safeParseJson<PlpContent>(page.content) ?? null,
    seo: safeParseJson<SeoPayload>(page.seo) ?? null,
  };
}

function toKeywordRecord(keyword: Keyword): KeywordRecord {
  return { ...keyword, intent: safeParseJson<IntentProfile>(keyword.intent) ?? null };
}

// ── Keywords ─────────────────────────────────────────────────────────────

export async function listKeywords(
  shop: string,
  filter: { status?: string } = {},
): Promise<KeywordRecord[]> {
  const keywords = await prisma.keyword.findMany({
    where: { shop, ...(filter.status ? { status: filter.status } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return keywords.map(toKeywordRecord);
}

export async function getKeyword(shop: string, id: string): Promise<KeywordRecord | null> {
  const keyword = await prisma.keyword.findFirst({ where: { id, shop } });
  return keyword ? toKeywordRecord(keyword) : null;
}

export interface KeywordInput {
  phrase: string;
  locale: string;
  source: "manual" | "csv" | "auto";
  status?: string;
  intent?: IntentProfile;
  pageTypeId?: string | null;
  clusterKey?: string | null;
  matchCount?: number | null;
  volume?: number | null;
}

/** Insert keywords, silently skipping (shop, phrase, locale) duplicates. */
export async function addKeywords(shop: string, inputs: KeywordInput[]): Promise<number> {
  let created = 0;
  for (const input of inputs) {
    const phrase = input.phrase.trim();
    if (!phrase) continue;
    try {
      await prisma.keyword.create({
        data: {
          shop,
          phrase,
          locale: input.locale,
          source: input.source,
          status: input.status ?? "suggested",
          intent: input.intent ? JSON.stringify(input.intent) : null,
          pageTypeId: input.pageTypeId ?? null,
          clusterKey: input.clusterKey ?? null,
          matchCount: input.matchCount ?? null,
          volume: input.volume ?? null,
        },
      });
      created++;
    } catch {
      // unique constraint (shop, phrase, locale) — already known, skip
    }
  }
  return created;
}

export async function updateKeyword(
  shop: string,
  id: string,
  data: Partial<{
    status: string;
    intent: IntentProfile;
    pageTypeId: string | null;
    clusterKey: string | null;
    matchCount: number | null;
    error: string | null;
  }>,
): Promise<void> {
  const { intent, ...rest } = data;
  await prisma.keyword.updateMany({
    where: { id, shop },
    data: { ...rest, ...(intent ? { intent: JSON.stringify(intent) } : {}) },
  });
}

// ── Pages ────────────────────────────────────────────────────────────────

export async function listPages(
  shop: string,
  filter: { status?: string; locale?: string } = {},
): Promise<PageRecord[]> {
  const pages = await prisma.plpPage.findMany({
    where: {
      shop,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.locale ? { locale: filter.locale } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  return pages.map(toPageRecord);
}

export async function getPage(shop: string, id: string): Promise<PageRecord | null> {
  const page = await prisma.plpPage.findFirst({ where: { id, shop } });
  return page ? toPageRecord(page) : null;
}

export async function findPageByCluster(
  shop: string,
  clusterKey: string,
  locale: string,
): Promise<PageRecord | null> {
  const page = await prisma.plpPage.findFirst({ where: { shop, clusterKey, locale } });
  return page ? toPageRecord(page) : null;
}

export async function findPageBySlug(
  shop: string,
  slug: string,
  locale: string,
): Promise<PageRecord | null> {
  const page = await prisma.plpPage.findFirst({ where: { shop, slug, locale } });
  return page ? toPageRecord(page) : null;
}

export interface PageCreateInput {
  shop: string;
  keywordId: string | null;
  pageTypeId: string;
  locale: string;
  slug: string;
  title: string;
  status: string;
  intent: IntentProfile;
  productIds: string[];
  content: PlpContent | null;
  seo: SeoPayload | null;
  clusterKey: string;
  canonicalOfId: string | null;
  reviewReason: string | null;
}

export async function createPage(input: PageCreateInput): Promise<PageRecord> {
  const page = await prisma.plpPage.create({
    data: {
      ...input,
      intent: JSON.stringify(input.intent),
      productIds: JSON.stringify(input.productIds),
      content: input.content ? JSON.stringify(input.content) : null,
      seo: input.seo ? JSON.stringify(input.seo) : null,
    },
  });
  return toPageRecord(page);
}

export async function updatePage(
  shop: string,
  id: string,
  data: Partial<{
    status: string;
    title: string;
    slug: string;
    productIds: string[];
    content: PlpContent;
    seo: SeoPayload;
    reviewReason: string | null;
    articleId: string | null;
    articleUrl: string | null;
    publishedAt: Date | null;
    canonicalOfId: string | null;
  }>,
): Promise<void> {
  const { productIds, content, seo, ...rest } = data;
  await prisma.plpPage.updateMany({
    where: { id, shop },
    data: {
      ...rest,
      ...(productIds ? { productIds: JSON.stringify(productIds) } : {}),
      ...(content ? { content: JSON.stringify(content) } : {}),
      ...(seo ? { seo: JSON.stringify(seo) } : {}),
    },
  });
}

export async function deletePage(shop: string, id: string): Promise<void> {
  await prisma.plpPage.deleteMany({ where: { id, shop } });
}
