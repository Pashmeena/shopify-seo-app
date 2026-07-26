import { INTENT_FACETS } from "../../config/types";
import type { IntentProfile } from "../intent/types";
import type { InternalLink } from "./types";
import { articleUrl } from "./urls.server";

/**
 * Internal linking. Related PLPs are computed from shared intent facet
 * values at generation time and re-computed for every affected published
 * page whenever a new page is published — pages that aren't linked don't
 * accumulate PageRank, so this is part of publishing, not an afterthought.
 *
 * "Related" = same locale, at least one shared facet value; ranked by how
 * many values are shared, with adjacent pages (share style but differ in
 * room, or vice versa) rising naturally.
 */

const MAX_LINKS = 6;

export interface LinkablePage {
  title: string;
  slug: string;
  locale: string;
  intent: IntentProfile;
}

function sharedFacetValues(a: IntentProfile, b: IntentProfile): string[] {
  const shared: string[] = [];
  for (const facet of INTENT_FACETS) {
    const other = new Set(b.facets[facet] ?? []);
    for (const value of a.facets[facet] ?? []) {
      if (other.has(value)) shared.push(`${facet}:${value}`);
    }
  }
  return shared;
}

/** Compute the internal links for one page against the published set. */
export function computeInternalLinks(
  page: { slug: string; locale: string; intent: IntentProfile },
  publishedPages: LinkablePage[],
  shop: string,
  blogHandle: string,
): InternalLink[] {
  return publishedPages
    .filter((candidate) => candidate.locale === page.locale && candidate.slug !== page.slug)
    .map((candidate) => ({
      candidate,
      shared: sharedFacetValues(page.intent, candidate.intent),
    }))
    .filter(({ shared }) => shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length)
    .slice(0, MAX_LINKS)
    .map(({ candidate, shared }) => ({
      title: candidate.title,
      slug: candidate.slug,
      url: articleUrl(shop, blogHandle, candidate.slug),
      sharedFacets: shared,
    }));
}
