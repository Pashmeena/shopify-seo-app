import type { IntentFacet } from "../../config/types";

/**
 * Structured intent parsed from a keyword. Facet values are canonical
 * English (matching the catalog's tag vocabulary) regardless of the
 * keyword's language — locale only changes how content is generated,
 * not how products are matched.
 */
export interface IntentProfile {
  keyword: string;
  locale: string;
  facets: Partial<Record<IntentFacet, string[]>>;
  /** Page type this intent routes to, or null when no config applies. */
  pageTypeId: string | null;
  /** Share of meaningful keyword tokens the parser could account for, 0..1. */
  confidence: number;
  method: "rules" | "hybrid";
}

/** A single lexicon entry: one synonym mapping to a canonical facet value. */
export interface LexiconEntry {
  facet: IntentFacet;
  value: string;
}
