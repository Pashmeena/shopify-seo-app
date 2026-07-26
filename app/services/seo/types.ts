/** Everything technical-SEO for one PLP, stored as JSON on PlpPage.seo. */
export interface SeoPayload {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  canonicalUrl: string;
  /** All locale variants of this page (including itself) for hreflang. */
  hreflang: { locale: string; url: string }[];
  /** Full JSON-LD stack: CollectionPage(+ItemList), FAQPage, BreadcrumbList. */
  jsonLd: Record<string, unknown>[];
  internalLinks: InternalLink[];
  noindex: boolean;
}

export interface InternalLink {
  title: string;
  slug: string;
  url: string;
  sharedFacets: string[];
}
