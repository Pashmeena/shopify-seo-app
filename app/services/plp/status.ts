/**
 * The statuses a PLP page can hold.
 *
 * Deliberately not a `.server` module: the admin UI renders these, the
 * pipeline decides them and publishing writes them, so a single shared
 * definition is the only way the three cannot drift. Importing them from a
 * server module would pull the publishing stack into the client bundle.
 *
 * They are plain strings because Prisma stores the column as `String` and
 * rows written by an older build must keep parsing — a TypeScript enum would
 * promise an exhaustiveness the database cannot honour.
 */
export const PAGE_STATUS = {
  /** Generated, clean, and publishable. */
  DRAFT: "draft",
  /** Held back: thin, flagged for cannibalization, or otherwise caveated. */
  NEEDS_REVIEW: "needs_review",
  /** Live on the storefront as a blog article at its own URL. */
  PUBLISHED: "published",
  /**
   * Live as a 301 onto its canonical page rather than as an article of its
   * own. It holds no URL, so it is excluded from hreflang, internal links,
   * `llms.txt` and `sitemap-ai.xml`.
   */
  CONSOLIDATED: "consolidated",
} as const;

export type PageStatus = (typeof PAGE_STATUS)[keyof typeof PAGE_STATUS];

/**
 * Statuses that mean "this page already has a presence on the storefront".
 *
 * Re-running part of the pipeline against one of these must not quietly demote
 * it to a draft: regenerating content is not a reason to take a page down, and
 * for a consolidated page it must not resurrect it as an article either.
 */
export const LIVE_PAGE_STATUSES: readonly string[] = [
  PAGE_STATUS.PUBLISHED,
  PAGE_STATUS.CONSOLIDATED,
];
