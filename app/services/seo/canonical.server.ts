import { findLocale } from "../../config/index.server";

/**
 * Which page, if any, a locale variant should point its canonical tag at.
 *
 * The brief asks for two things that pull in opposite directions: a
 * self-referencing canonical with hreflang between locale variants, and
 * canonical consolidation "where near-duplicate pages must exist (e.g. for
 * locale reasons)". Resolving that tension by language is what makes both
 * true at once:
 *
 * - Different languages are not near-duplicates. A German page canonicalised
 *   onto an English one tells Google not to index the German page at all,
 *   which forfeits the German market — the opposite of why it was generated.
 *   These get a self-referencing canonical, paired by hreflang.
 * - Same language, different market (en-US vs en-AU) genuinely is the
 *   near-duplicate case: the copy differs in currency, measurements and
 *   idiom, but the text overlaps enough to compete. One is designated
 *   canonical and the others consolidate onto it, still paired by hreflang.
 *
 * Pure and deterministic: given the same inputs it always designates the
 * same page, so re-running the pipeline never flips a canonical.
 */

export interface CanonicalCandidate {
  id: string;
  slug: string;
  locale: string;
  clusterKey: string | null;
  createdAt: Date;
}

export interface CanonicalDecision {
  /** Null means "canonicalise to self". */
  target: CanonicalCandidate | null;
  /** Merchant-readable explanation of the decision. */
  reason: string;
}

function languageOf(localeCode: string): string | null {
  return findLocale(localeCode)?.languageCode ?? null;
}

export function chooseCanonicalTarget(
  page: { locale: string; clusterKey: string },
  defaultLocale: string,
  existingPages: CanonicalCandidate[],
): CanonicalDecision {
  const language = languageOf(page.locale);
  if (!language) {
    return {
      target: null,
      reason: `Self-referencing: "${page.locale}" is not a configured market.`,
    };
  }

  const sameLanguageVariants = existingPages.filter(
    (candidate) =>
      candidate.clusterKey !== null &&
      candidate.clusterKey === page.clusterKey &&
      candidate.locale !== page.locale &&
      languageOf(candidate.locale) === language,
  );

  if (sameLanguageVariants.length === 0) {
    return {
      target: null,
      reason:
        "Self-referencing: no same-language variant of this intent exists, so " +
        "this page is the canonical page for its market. Other-language " +
        "variants are paired by hreflang instead.",
    };
  }

  // The default locale is the natural canonical when it shares the language;
  // failing that, the oldest same-language page, which keeps the choice
  // stable as more markets are added.
  const target =
    sameLanguageVariants.find((candidate) => candidate.locale === defaultLocale) ??
    [...sameLanguageVariants].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0];

  return {
    target,
    reason:
      `Consolidated onto /${target.slug} (${target.locale}): same language, ` +
      "same intent, so the two pages would compete for the same queries.",
  };
}
