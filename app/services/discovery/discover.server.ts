import { getLocale, listLocales, localizeFacetValue } from "../../config/index.server";
import type { IntentFacet, LocaleConfig } from "../../config/types";
import { fetchCatalog } from "../catalog/products.server";
import type { CatalogProduct } from "../catalog/types";
import type { IntentProfile } from "../intent/types";
import { matchProducts } from "../matching/match.server";
import { routePageType } from "../intent/parse.server";
import { clusterKey } from "../seo/similarity.server";
import { getSettings } from "../settings/settings.server";
import type { AdminClient } from "../shopify/admin.server";
import { addKeywords, listKeywords, listPages, type KeywordInput } from "../plp/repository.server";
import { getVolumeProvider } from "./keyword-volume.server";

/**
 * Auto-discovery — product-first by design. Instead of guessing keywords
 * and checking whether products exist, candidate facet combinations are
 * derived from the catalog and only combinations that already clear the
 * product threshold become suggestions — no proposed page can be thin by
 * construction. Every candidate runs through the same matcher as real
 * generation (including kid-safety exclusions), so the suggested count is
 * the real count.
 *
 * Nothing publishes automatically: suggestions land in the keyword queue
 * as "suggested" for the merchant to approve or reject.
 */

/** Facet combinations that seed candidates, mapped to search-phrase shape. */
const CANDIDATE_SHAPES: { facets: [IntentFacet, ...IntentFacet[]] }[] = [
  { facets: ["style", "room"] },
  { facets: ["material", "useCase"] },
  { facets: ["attribute", "useCase"] },
  { facets: ["useCase"] },
];

interface Candidate {
  facets: IntentProfile["facets"];
  matchCount: number;
}

function distinctFacetValues(catalog: CatalogProduct[], facet: IntentFacet): string[] {
  const values = new Set<string>();
  for (const product of catalog) {
    for (const value of product.facets[facet] ?? []) values.add(value);
  }
  return [...values].sort();
}

function* facetCombinations(
  catalog: CatalogProduct[],
  facets: IntentFacet[],
): Generator<IntentProfile["facets"]> {
  const valueLists = facets.map((facet) => distinctFacetValues(catalog, facet));
  const build = function* (index: number, acc: IntentProfile["facets"]): Generator<IntentProfile["facets"]> {
    if (index === facets.length) {
      yield acc;
      return;
    }
    for (const value of valueLists[index]) {
      yield* build(index + 1, { ...acc, [facets[index]]: [value] });
    }
  };
  yield* build(0, {});
}

/**
 * Build the localized search phrase for a facet combination.
 * Descriptors (attribute/color/style/material) precede the product word,
 * targets (room/useCase) follow it; English inserts "for" before a use
 * case ("peel and stick wallpaper for renters"), German compounds without
 * glue ("selbstklebende tapete mietwohnung").
 */
export function phraseForFacets(facets: IntentProfile["facets"], locale: LocaleConfig): string {
  const localized = (facet: IntentFacet) =>
    (facets[facet] ?? []).map((value) => localizeFacetValue(value, locale));

  const before = [
    ...localized("attribute"),
    ...localized("color"),
    ...localized("style"),
    ...localized("material"),
  ];
  const rooms = localized("room");
  const useCases = localized("useCase");
  const glue = locale.languageCode === "en" && useCases.length > 0 ? ["for"] : [];

  return [...before, locale.tokens.wallpaper ?? "wallpaper", ...rooms, ...glue, ...useCases]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateIntent(facets: IntentProfile["facets"], phrase: string, locale: string): IntentProfile {
  return {
    keyword: phrase,
    locale,
    facets,
    pageTypeId: routePageType(facets, locale),
    confidence: 1,
    method: "rules",
  };
}

export interface DiscoveryResult {
  suggested: number;
  scanned: number;
  skippedExisting: number;
}

/** Scan the catalog and queue threshold-clearing keyword suggestions. */
export async function discoverKeywords(
  admin: AdminClient,
  shop: string,
  localeCodes?: string[],
): Promise<DiscoveryResult> {
  const settings = await getSettings(shop);
  const catalog = await fetchCatalog(admin);
  const volumeProvider = getVolumeProvider();

  const locales = (localeCodes ?? settings.enabledLocaleCodes)
    .filter((code) => listLocales().some((locale) => locale.code === code))
    .map((code) => getLocale(code));

  const existingPages = await listPages(shop);
  const existingKeywords = await listKeywords(shop);
  const coveredClusters = new Set(
    [...existingPages, ...existingKeywords]
      .filter((row) => row.clusterKey)
      .map((row) => `${"locale" in row ? row.locale : ""}::${row.clusterKey}`),
  );

  let scanned = 0;
  let skippedExisting = 0;
  const suggestions: KeywordInput[] = [];

  // Candidates are locale-independent (facets are canonical English);
  // evaluate once, then fan out per enabled locale.
  const viable: Candidate[] = [];
  const seenClusterKeys = new Set<string>();
  for (const shape of CANDIDATE_SHAPES) {
    for (const facets of facetCombinations(catalog, shape.facets)) {
      scanned++;
      // Routable in at least one enabled market. A combination can have no
      // page type in en-US and a locale-specific one in de-DE.
      const routable = locales.some(
        (locale) => routePageType(facets, locale.code) !== null,
      );
      if (!routable) continue;
      const intent = candidateIntent(facets, "candidate", locales[0].code);
      const key = clusterKey(intent);
      if (seenClusterKeys.has(key)) continue;
      seenClusterKeys.add(key);
      const match = matchProducts(catalog, intent, settings.minProducts);
      if (!match.meetsThreshold) continue;
      viable.push({ facets, matchCount: match.matches.length });
    }
  }

  for (const locale of locales) {
    const phrases = viable.map((candidate) => phraseForFacets(candidate.facets, locale));
    const volumes = await volumeProvider.getVolumes(phrases, locale.code);

    for (const [index, candidate] of viable.entries()) {
      const phrase = phrases[index];
      const intent = candidateIntent(candidate.facets, phrase, locale.code);
      if (!intent.pageTypeId) continue;
      const key = clusterKey(intent);
      if (coveredClusters.has(`${locale.code}::${key}`)) {
        skippedExisting++;
        continue;
      }
      suggestions.push({
        phrase,
        locale: locale.code,
        source: "auto",
        status: "suggested",
        intent,
        pageTypeId: intent.pageTypeId,
        clusterKey: key,
        matchCount: candidate.matchCount,
        // Always null from the stub provider; ready for a real volume API.
        volume: volumes.get(phrase) ?? null,
      });
    }
  }

  const suggested = await addKeywords(shop, suggestions);
  return { suggested, scanned, skippedExisting };
}
