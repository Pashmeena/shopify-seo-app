/**
 * Shapes for keyword ingestion (CSV upload / manual paste).
 *
 * A file the app did not create can carry any column names, any delimiter
 * and any number of columns it does not care about, so ingestion reports
 * what it decided rather than assuming: which column it read, how it
 * worked that out, and every row it could not use.
 */

export type KeywordSource = "manual" | "csv";

/** How the keyword column was identified, cheapest tier first. */
export type ColumnMappingMethod =
  /** A header name the app already knows ("keyword", "search term", …). */
  | "synonym"
  /** The AI read the header plus sample rows and picked the column. */
  | "ai"
  /** No header row: the first column is the keyword by convention. */
  | "positional"
  /** There was a header but nothing recognized it — first column, unverified. */
  | "fallback";

export interface ColumnMapping {
  keywordIndex: number;
  /** Column holding a locale code, when the input has one. */
  localeIndex: number | null;
  /** True when the first row held column names rather than data. */
  hadHeader: boolean;
  /** Header text of the chosen columns, when there was a header row. */
  keywordHeader: string | null;
  localeHeader: string | null;
  method: ColumnMappingMethod;
}

export interface ImportEntry {
  phrase: string;
  locale: string;
  source: KeywordSource;
}

export interface SkippedRow {
  source: KeywordSource;
  /** 1-based line in that input, so the merchant can find the row. */
  line: number;
  value: string;
  reason: string;
}

export interface SourceReport {
  source: KeywordSource;
  /** Null when the input held no usable rows at all. */
  mapping: ColumnMapping | null;
  /** Delimiter papaparse settled on, for the message. */
  delimiter: string | null;
  dataRowCount: number;
}

export interface ImportReport {
  entries: ImportEntry[];
  skipped: SkippedRow[];
  sources: SourceReport[];
}
