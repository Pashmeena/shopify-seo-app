import { listPageTypes } from "../../config/index.server";
import {
  INTENT_FACETS,
  type IntentFacet,
  type PageTypeConfig,
} from "../../config/types";
import { completeValidatedJson, getValidator } from "../ai/json-client.server";
import { getAiProvider, getAiStatus } from "../ai/provider.server";
import { addFacetValue, extractFacets } from "../facets/vocabulary.server";
import type { Lexicon } from "./lexicon.server";
import type { IntentProfile } from "./types";

/**
 * Hybrid intent parsing.
 *
 * Rules first: greedy longest-phrase matching against the lexicon. This is
 * deterministic, free, offline and — because the lexicon carries German
 * synonyms and catalog vocabulary — covers the overwhelming majority of
 * real queries.
 *
 * AI second: only when rules leave the keyword poorly understood
 * (low confidence or no routable page type) and a provider is configured,
 * the keyword is parsed by the LLM into the same facet structure,
 * validated against a JSON Schema, and merged (rules win on conflicts).
 */

const AI_CONFIDENCE_THRESHOLD = 0.6;

const INTENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    INTENT_FACETS.map((facet) => [
      facet,
      { type: "array", items: { type: "string" } },
    ]),
  ),
};

/** Greedy longest-phrase-first matching of the keyword against the lexicon. */
export function parseWithRules(
  keyword: string,
  locale: string,
  lexicon: Lexicon,
): IntentProfile {
  const { facets, matchedTokens, significantTokens } = extractFacets(
    keyword,
    lexicon,
  );
  applyDerivedFacets(facets);

  return {
    keyword,
    locale,
    facets,
    pageTypeId: routePageType(facets, locale),
    confidence: significantTokens === 0 ? 0 : matchedTokens / significantTokens,
    method: "rules",
  };
}

/** Facts that follow from other facts (kept minimal and explainable). */
function applyDerivedFacets(facets: IntentProfile["facets"]): void {
  if (facets.room?.includes("kids room")) {
    addFacetValue(facets, "useCase", "kids");
    addFacetValue(facets, "audience", "parents");
  }
  if (facets.useCase?.includes("renters")) {
    addFacetValue(facets, "audience", "renters");
  }
}

/**
 * Whether an intent satisfies everything a page type asks of it: each required
 * facet present, and — where the page type constrains a facet's values — at
 * least one of the intent's values for that facet on the allowed list.
 *
 * The constraint half is what keeps a narrow page type narrow. `useCase` alone
 * is satisfied by `kids` and `humid rooms` as readily as by `renters`, so
 * without it a page type about German tenancy law claims every German use-case
 * keyword.
 */
function pageTypeApplies(
  pageType: PageTypeConfig,
  facets: IntentProfile["facets"],
): boolean {
  return pageType.required_facets.every((facet) => {
    const values = facets[facet] ?? [];
    if (values.length === 0) return false;
    const allowed = pageType.required_facet_values?.[facet];
    return !allowed || values.some((value) => allowed.includes(value));
  });
}

/** Number of required facets this page type also constrains by value. */
function constraintCount(pageType: PageTypeConfig): number {
  return Object.keys(pageType.required_facet_values ?? {}).length;
}

/**
 * Route an intent to the most specific page type that applies in this market.
 *
 * Specificity is compared in a fixed order, most structural first:
 *
 * 1. more required facets — a page type keyed on style *and* room says more
 *    about the query than one keyed on a use case alone;
 * 2. more value-constrained facets — a page type that names the exact use case
 *    it serves is narrower than one that accepts any;
 * 3. restricted to markets — such a page type exists because its market has
 *    something the others do not, so it should win a genuine tie there;
 * 4. `routing_priority` — the explicit domain judgment, for page types that
 *    are structurally indistinguishable;
 * 5. id, so the outcome is deterministic. Without this last comparison the
 *    winner of a full tie came from glob order, i.e. from filenames — which
 *    means renaming a config file could silently re-route keywords.
 */
export function routePageType(
  facets: IntentProfile["facets"],
  locale: string,
): string | null {
  const candidates = listPageTypes()
    .filter((pageType) => !pageType.locales || pageType.locales.includes(locale))
    .filter((pageType) => pageTypeApplies(pageType, facets))
    .sort(
      (a, b) =>
        b.required_facets.length - a.required_facets.length ||
        constraintCount(b) - constraintCount(a) ||
        Number(Boolean(b.locales)) - Number(Boolean(a.locales)) ||
        (b.routing_priority ?? 0) - (a.routing_priority ?? 0) ||
        a.id.localeCompare(b.id),
    );
  return candidates[0]?.id ?? null;
}

async function enrichWithAi(rules: IntentProfile): Promise<IntentProfile> {
  const provider = getAiProvider();
  const validator = getValidator("intent-profile", INTENT_SCHEMA);

  const { data } = await completeValidatedJson<Partial<Record<IntentFacet, string[]>>>(
    provider,
    {
      system:
        "You classify wallpaper shopping search queries into structured facets for product matching. " +
        "Respond with a single JSON object and nothing else. Use lowercase, canonical ENGLISH facet values " +
        "regardless of the query language (e.g. 'wohnzimmer' → room: ['living room']). " +
        `Allowed keys: ${INTENT_FACETS.join(", ")}. Omit keys you cannot infer. ` +
        "Facet meanings: style = decorative style (botanical, floral, art deco…); room = target room; " +
        "color; material = wallpaper construction (peel and stick, non-woven, vinyl, paper); " +
        "attribute = product property (sustainable, washable, removable, dramatic); " +
        "useCase = practical scenario (renters, kids, high-traffic, humid rooms); audience = who is buying.",
      user: `Query: "${rules.keyword}"\nReturn only the JSON object.`,
      temperature: 0,
      maxTokens: 500,
    },
    validator,
  );

  const merged: IntentProfile["facets"] = { ...rules.facets };
  for (const [facet, values] of Object.entries(data)) {
    for (const value of values ?? []) {
      addFacetValue(merged, facet as IntentFacet, value.toLowerCase());
    }
  }
  applyDerivedFacets(merged);

  return {
    ...rules,
    facets: merged,
    pageTypeId: routePageType(merged, rules.locale),
    confidence: Math.max(rules.confidence, 0.8),
    method: "hybrid",
  };
}

/** Full hybrid parse. Never throws on AI failure — rules result stands. */
export async function parseIntent(
  keyword: string,
  locale: string,
  lexicon: Lexicon,
): Promise<IntentProfile> {
  const rules = parseWithRules(keyword, locale, lexicon);
  const needsAi = rules.confidence < AI_CONFIDENCE_THRESHOLD || rules.pageTypeId === null;
  if (!needsAi || !getAiStatus().configured) return rules;

  try {
    return await enrichWithAi(rules);
  } catch (error) {
    console.warn(`AI intent enrichment failed for "${keyword}":`, error);
    return rules;
  }
}
