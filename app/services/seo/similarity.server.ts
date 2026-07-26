import { INTENT_FACETS, type IntentFacet } from "../../config/types";
import { jaccard } from "../../lib/text";
import type { IntentProfile } from "../intent/types";

/**
 * Cannibalization prevention, mechanism by mechanism:
 *
 * 1. Keyword clustering — `clusterKey` reduces an intent to its sorted
 *    hard-facet values. Keywords with the same key ("botanical wallpaper
 *    living room", "living room botanical wallpaper ideas") are the same
 *    page by construction; only one canonical page per (cluster, locale)
 *    is ever generated.
 * 2. Similarity check — before a new page is created, its intent is
 *    compared against existing pages in the same locale with a weighted
 *    per-facet Jaccard. ≥ BLOCK is treated as a duplicate; ≥ FLAG is
 *    held for merchant review.
 * 3. Canonical consolidation — the same cluster in another locale is a
 *    legitimate variant: it's linked via canonicalOf + hreflang instead
 *    of being blocked.
 *
 * "Too similar" is defined numerically below and explained in the README.
 */

export const SIMILARITY_BLOCK_THRESHOLD = 0.85;
export const SIMILARITY_FLAG_THRESHOLD = 0.6;

/** Facets that define page identity — mirrors the matcher's hard facets. */
const IDENTITY_FACETS: IntentFacet[] = ["style", "room", "color", "material", "useCase", "attribute"];

const FACET_WEIGHTS: Record<IntentFacet, number> = {
  style: 3,
  room: 3,
  useCase: 3,
  material: 2.5,
  color: 1.5,
  attribute: 1.5,
  audience: 0.5,
};

/** Deterministic identity of the page an intent resolves to. */
export function clusterKey(intent: IntentProfile): string {
  const parts = IDENTITY_FACETS.flatMap((facet) =>
    [...(intent.facets[facet] ?? [])].sort().map((value) => `${facet}:${value}`),
  ).sort();
  return parts.length ? parts.join("|") : `keyword:${intent.keyword.toLowerCase().trim()}`;
}

/** Weighted per-facet Jaccard similarity between two intents, 0..1. */
export function intentSimilarity(a: IntentProfile, b: IntentProfile): number {
  let weightedSum = 0;
  let weightTotal = 0;

  for (const facet of INTENT_FACETS) {
    const setA = new Set(a.facets[facet] ?? []);
    const setB = new Set(b.facets[facet] ?? []);
    if (setA.size === 0 && setB.size === 0) continue;
    const weight = FACET_WEIGHTS[facet];
    weightedSum += jaccard(setA, setB) * weight;
    weightTotal += weight;
  }
  return weightTotal === 0 ? 0 : weightedSum / weightTotal;
}

export type SimilarityVerdict =
  | { level: "ok" }
  | { level: "flag" | "block"; score: number; against: { title: string; slug: string } };

/** Compare a new intent against existing same-locale pages. */
export function checkSimilarity(
  intent: IntentProfile,
  existing: { title: string; slug: string; intent: IntentProfile }[],
): SimilarityVerdict {
  let worst: Extract<SimilarityVerdict, { level: "flag" | "block" }> | null = null;

  for (const page of existing) {
    const score = intentSimilarity(intent, page.intent);
    if (score >= SIMILARITY_BLOCK_THRESHOLD) {
      return { level: "block", score, against: { title: page.title, slug: page.slug } };
    }
    if (score >= SIMILARITY_FLAG_THRESHOLD && (!worst || score > worst.score)) {
      worst = { level: "flag", score, against: { title: page.title, slug: page.slug } };
    }
  }
  return worst ?? { level: "ok" };
}
