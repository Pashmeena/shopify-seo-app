import { articlePath } from "../seo/urls.server";

/**
 * How a canonical consolidation decision becomes something a search engine
 * actually acts on.
 *
 * `seo/canonical.server.ts` decides *whether* a page is a near-duplicate of
 * another in the same market. This module decides what publishing that page
 * means, and it is deliberately the only place that answer lives.
 *
 * Why a redirect rather than a canonical tag
 * -----------------------------------------
 * The obvious implementation is `<link rel="canonical" href="…">` in the
 * document head. On Shopify, publishing PLPs as blog articles, that is not
 * available: every Theme Store theme emits `<link rel="canonical"
 * href="{{ canonical_url }}">` from `layout/theme.liquid`, a theme app
 * extension renders *after* it and cannot remove it, and Google discards all
 * `rel=canonical` hints on a page that declares more than one. Emitting a
 * second tag would therefore destroy the self-referencing canonical the
 * theme already gets right, and gain nothing. Editing the theme to remove it
 * is not something an app should do to a merchant's storefront.
 *
 * A Shopify URL redirect has none of those problems and is a strictly
 * stronger signal. Shopify serves redirects as HTTP 301 and resolves them
 * before the theme renders, so the duplicate URL never produces a competing
 * document at all: link equity consolidates onto the canonical page, the
 * shopper lands somewhere useful, and there is no second page in Shopify's
 * own `sitemap.xml` to crawl. A `rel=canonical` is a hint Google may
 * override; a 301 is not.
 *
 * The cost is that the duplicate stops existing as a page. That is the right
 * trade here precisely because this app never consolidates for locale
 * reasons — the only pages that reach this module are same-market
 * near-duplicates, which is to say pages that should not have separate URLs.
 *
 * Everything below is pure so that the guards are testable without a store.
 * They matter: a redirect published against the wrong target is worse than
 * no consolidation, because it takes a live page down.
 */

/** The minimum a page must expose for a consolidation decision to be made. */
export interface ConsolidationParty {
  id: string;
  slug: string;
  title: string;
  locale: string;
  status: string;
  /** Set when this page is itself consolidated onto another. */
  canonicalOfId: string | null;
}

export type ConsolidationPlan =
  /** No consolidation: publish normally, as its own article. */
  | { kind: "article" }
  /**
   * Consolidate: publish as a 301 from this page's path onto the target's,
   * and make sure no competing article is left behind.
   */
  | {
      kind: "redirect";
      target: { id: string; slug: string; title: string };
      fromPath: string;
      toPath: string;
    }
  /** The consolidation cannot be honoured safely. Publishing must not proceed. */
  | { kind: "blocked"; reason: string };

export interface ConsolidationInput {
  page: ConsolidationParty;
  /**
   * The page `page.canonicalOfId` refers to, or null when the id resolves to
   * nothing (it was deleted). Undefined is not accepted: the caller must have
   * looked, so that "not found" is a decision and not an oversight.
   */
  target: ConsolidationParty | null;
  blogHandle: string;
}

/**
 * Decide what publishing `page` means, given its consolidation target.
 *
 * A blocked plan is not a failure of this function — it is the answer. It
 * exists so that publishing surfaces a merchant-readable reason instead of
 * quietly writing a redirect that breaks the storefront.
 */
export function planConsolidation(input: ConsolidationInput): ConsolidationPlan {
  const { page, target, blogHandle } = input;

  if (!page.canonicalOfId) return { kind: "article" };

  if (page.canonicalOfId === page.id) {
    return {
      kind: "blocked",
      reason:
        "This page is recorded as a duplicate of itself, which cannot be " +
        "published either way. Clear the consolidation and publish it as its " +
        "own page.",
    };
  }

  if (!target) {
    return {
      kind: "blocked",
      reason:
        "This page was consolidated onto another page that no longer exists, " +
        "so the redirect would lead nowhere. Clear the consolidation to " +
        "publish it as its own page.",
    };
  }

  // Mirrors the guarantee in seo/canonical.server.ts. Locale is never a reason
  // to consolidate, and a cross-market redirect would remove a market's page
  // from that market entirely — the exact mistake the canonical policy exists
  // to prevent. Enforced here too, because this is the module that would do
  // the damage.
  if (target.locale !== page.locale) {
    return {
      kind: "blocked",
      reason:
        `The consolidation target "${target.title}" is in ${target.locale}, ` +
        `not ${page.locale}. Locale is never a reason to consolidate: market ` +
        "variants are paired by hreflang instead. Clear the consolidation.",
    };
  }

  // Redirect chains (A → B → C) lose signal at every hop and Shopify will
  // happily create them. Point at the end of the chain instead.
  if (target.canonicalOfId) {
    return {
      kind: "blocked",
      reason:
        `The consolidation target "${target.title}" is itself consolidated ` +
        "onto another page, which would create a redirect chain. Consolidate " +
        "onto that final page instead.",
    };
  }

  if (target.status !== "published") {
    return {
      kind: "blocked",
      reason:
        `The consolidation target "${target.title}" is ${target.status}, not ` +
        "published, so the redirect would lead to a page that does not exist " +
        `yet. Publish "${target.title}" first, then publish this page.`,
    };
  }

  const fromPath = articlePath(blogHandle, page.slug);
  const toPath = articlePath(blogHandle, target.slug);

  // Distinct ids can still share a path if a slug was rewritten by Shopify's
  // handle normalisation. A self-redirect is an infinite loop on the
  // storefront, so it is refused rather than written.
  if (fromPath === toPath) {
    return {
      kind: "blocked",
      reason:
        `This page and "${target.title}" resolve to the same URL ` +
        `(${fromPath}), so one cannot redirect to the other. Delete whichever ` +
        "of the two is redundant.",
    };
  }

  return {
    kind: "redirect",
    target: { id: target.id, slug: target.slug, title: target.title },
    fromPath,
    toPath,
  };
}

/**
 * Pages that would be left pointing at nothing if `pageId` went away.
 *
 * Deleting a consolidation target orphans every redirect aimed at it, so the
 * dependents have to be released rather than silently broken.
 */
export function dependentsOf<T extends { id: string; canonicalOfId: string | null }>(
  pages: T[],
  pageId: string,
): T[] {
  return pages.filter((page) => page.id !== pageId && page.canonicalOfId === pageId);
}
