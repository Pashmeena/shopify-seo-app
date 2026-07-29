import type { IntentFacet } from "../../config/types";
import { tokenize } from "../../lib/text";
import {
  DECLARED_ORIGINS,
  facetOriginKey,
  type CatalogProduct,
  type FacetOrigin,
} from "../catalog/types";
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
 * - Provenance ranks the qualifying set. A facet the store declared (a
 *   namespaced tag, or collection membership) counts for more than one the
 *   app read out of a product title, so a properly merchandised product
 *   sits above a lexical coincidence — without excluding the latter, which
 *   is what makes the app useful on a store that never adopted the tag
 *   convention.
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

/**
 * Multiplier applied to a facet's weight by where the value came from.
 * Declared facets score in full; inferred ones qualify a product but rank
 * below an equivalent product the store filed deliberately.
 */
const INFERRED_CONFIDENCE = 0.6;

/** Facet values that are unacceptable for child-oriented intents. */
const KID_UNSAFE = {
  attribute: new Set(["dramatic"]),
  color: new Set(["black", "charcoal", "navy"]),
};

export interface ScoredProduct {
  product: CatalogProduct;
  score: number;
  matchedFacets: Partial<Record<IntentFacet, string[]>>;
  /**
   * Matched values whose only evidence was product text, shown in the match
   * preview so the merchant can see what was inferred rather than declared.
   */
  inferredFacets: string[];
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

function originsFor(
  product: CatalogProduct,
  facet: IntentFacet,
  value: string,
): FacetOrigin[] {
  return product.facetOrigins[facetOriginKey(facet, value)] ?? [];
}

/** True when the store filed this facet itself rather than the app reading it. */
function isDeclared(product: CatalogProduct, facet: IntentFacet, value: string): boolean {
  return originsFor(product, facet, value).some((origin) =>
    DECLARED_ORIGINS.includes(origin),
  );
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
    const inferredFacets: string[] = [];
    let score = 0;
    let hardFailure: string | null = null;

    for (const [facet, wanted] of Object.entries(intent.facets) as [IntentFacet, string[]][]) {
      if (!wanted?.length) continue;
      const matched = facetMatches(product, facet, wanted);
      if (matched.length > 0) {
        matchedFacets[facet] = matched;
        for (const value of matched) {
          const declared = isDeclared(product, facet, value);
          if (!declared) inferredFacets.push(facetOriginKey(facet, value));
          score += FACET_WEIGHTS[facet] * (declared ? 1 : INFERRED_CONFIDENCE);
        }
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

    matches.push({
      product,
      score: score + textMatchBonus(product, intent),
      matchedFacets,
      inferredFacets,
    });
  }

  matches.sort((a, b) => b.score - a.score);

  return { matches, excluded, meetsThreshold: matches.length >= threshold, threshold };
}
