import type { IntentFacet } from "../../config/types";
import { tokenize } from "../../lib/text";
import type { CatalogProduct } from "../catalog/types";
import type { IntentProfile } from "../intent/types";

/**
 * Product matching. Accuracy beats volume:
 *
 * - HARD facets — every facet the shopper explicitly stated (style, room,
 *   color, material, useCase, attribute) must be satisfied by the product.
 *   A "botanical living room" page shows only products that are botanical
 *   AND suit living rooms; we never dilute a page to reach the threshold.
 * - SOFT facets (audience) plus title/description hits only influence the
 *   ranking score.
 * - Negative constraints — kid-intents exclude dramatic/dark designs even
 *   if a facet accidentally matches.
 *
 * Pages below `minProducts` are never published; they're surfaced to the
 * merchant as needs_review instead.
 */

const HARD_FACETS: IntentFacet[] = ["style", "room", "color", "material", "useCase", "attribute"];

const FACET_WEIGHTS: Record<IntentFacet, number> = {
  style: 3,
  room: 3,
  useCase: 3,
  material: 2.5,
  color: 1.5,
  attribute: 1.5,
  audience: 1,
};

/** Facet values that are unacceptable for child-oriented intents. */
const KID_UNSAFE = {
  attribute: new Set(["dramatic"]),
  color: new Set(["black", "charcoal", "navy"]),
};

export interface ScoredProduct {
  product: CatalogProduct;
  score: number;
  matchedFacets: Partial<Record<IntentFacet, string[]>>;
}

export interface MatchResult {
  matches: ScoredProduct[];
  excluded: { product: CatalogProduct; reason: string }[];
  meetsThreshold: boolean;
  threshold: number;
}

function isKidIntent(intent: IntentProfile): boolean {
  return (
    (intent.facets.room ?? []).includes("kids room") ||
    (intent.facets.useCase ?? []).includes("kids")
  );
}

function kidSafetyViolation(product: CatalogProduct, intent: IntentProfile): string | null {
  const dramatic = (product.facets.attribute ?? []).find((v) => KID_UNSAFE.attribute.has(v));
  if (dramatic) return `kid-unsafe attribute "${dramatic}"`;
  // A dark colour the shopper explicitly asked for (e.g. "midnight blue
  // kids room") is intent, not a violation — only unrequested dark
  // colourways are filtered.
  const requestedColors = new Set(intent.facets.color ?? []);
  const dark = (product.facets.color ?? []).find(
    (v) => KID_UNSAFE.color.has(v) && !requestedColors.has(v),
  );
  if (dark) return `dark colourway "${dark}" not suitable for kids pages`;
  return null;
}

/** Values of `facet` on the product that satisfy an intent value. */
function facetMatches(product: CatalogProduct, facet: IntentFacet, wanted: string[]): string[] {
  const productValues = product.facets[facet] ?? [];
  return wanted.filter((value) => productValues.includes(value));
}

function textMatchBonus(product: CatalogProduct, intent: IntentProfile): number {
  const haystack = new Set(tokenize(`${product.title} ${product.description}`));
  let hits = 0;
  for (const values of Object.values(intent.facets)) {
    for (const value of values ?? []) {
      if (tokenize(value).every((token) => haystack.has(token))) hits++;
    }
  }
  return Math.min(hits * 0.25, 1);
}

/** Match the catalog against an intent. Pure — no I/O. */
export function matchProducts(
  catalog: CatalogProduct[],
  intent: IntentProfile,
  threshold: number,
): MatchResult {
  const matches: ScoredProduct[] = [];
  const excluded: MatchResult["excluded"] = [];
  const kidIntent = isKidIntent(intent);

  for (const product of catalog) {
    if (kidIntent) {
      const violation = kidSafetyViolation(product, intent);
      if (violation) {
        excluded.push({ product, reason: violation });
        continue;
      }
    }

    const matchedFacets: ScoredProduct["matchedFacets"] = {};
    let score = 0;
    let hardFailure: string | null = null;

    for (const [facet, wanted] of Object.entries(intent.facets) as [IntentFacet, string[]][]) {
      if (!wanted?.length) continue;
      const matched = facetMatches(product, facet, wanted);
      if (matched.length > 0) {
        matchedFacets[facet] = matched;
        score += FACET_WEIGHTS[facet] * matched.length;
      } else if (HARD_FACETS.includes(facet)) {
        hardFailure = `does not match ${facet}: ${wanted.join(", ")}`;
        break;
      }
    }

    if (hardFailure) {
      excluded.push({ product, reason: hardFailure });
      continue;
    }
    if (score === 0) {
      excluded.push({ product, reason: "matches no intent facet" });
      continue;
    }

    matches.push({ product, score: score + textMatchBonus(product, intent), matchedFacets });
  }

  matches.sort((a, b) => b.score - a.score);

  return { matches, excluded, meetsThreshold: matches.length >= threshold, threshold };
}
