/**
 * Shape of validated AI-generated PLP content. Individual page types may
 * omit optional parts (e.g. buying_guide exists only on use-case pages) —
 * the authoritative contract per page type is its output_schema; this type
 * is the superset the app renders.
 */
export interface PlpContent {
  h1: string;
  intro: string;
  sections: { heading: string; body: string }[];
  buying_guide?: {
    heading: string;
    steps: { title: string; body: string }[];
  };
  /** Market-specific guidance. Required only by locale-specific page types. */
  compliance_notes?: {
    heading: string;
    points: string[];
  };
  faq: { question: string; answer: string }[];
  meta: { title: string; description: string };
  product_alt_texts: { product_id: string; alt_text: string }[];
}

export interface GenerationResult {
  content: PlpContent;
  provider: string;
  model: string;
  attempts: number;
  /** Product GIDs whose alt text had to be deterministically backfilled. */
  backfilledAltTextIds: string[];
}
