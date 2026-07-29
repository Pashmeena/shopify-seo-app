import { completeValidatedJson, getValidator } from "../ai/json-client.server";
import { getAiProvider, getAiStatus } from "../ai/provider.server";
import type { ColumnMapping } from "./types";

/**
 * Working out which column of an uploaded keyword file holds what.
 *
 * Merchants upload exports from tools this app has never seen, with column
 * names in languages it cannot read, so the mapping resolves in tiers —
 * cheapest first, the same rules-then-AI shape the intent parser uses:
 *
 *   1. synonym    — header names the app already knows
 *   2. AI         — the header plus a few sample rows, only for headers
 *                   nothing recognized and only when a provider is set up
 *   3. positional — the first column is the keyword
 *
 * Tier 3 always answers, so an import never fails for want of a mapping.
 * Every tier records how it decided, so the merchant is told which column
 * was read instead of inferring it from the results.
 */

/** Rows shown to the model: enough to see the shape, small enough to be cheap. */
const AI_SAMPLE_ROWS = 6;

/** Share of a column's values that must look like locale codes to claim it. */
const LOCALE_COLUMN_CONFIDENCE = 0.6;

const KEYWORD_COLUMN_NAMES = new Set([
  "keyword",
  "keywords",
  "key word",
  "keyword phrase",
  "query",
  "queries",
  "search query",
  "search queries",
  "term",
  "terms",
  "search term",
  "search terms",
  "phrase",
  "phrases",
  "search",
  "searches",
  "topic",
]);

const LOCALE_COLUMN_NAMES = new Set([
  "locale",
  "locales",
  "market",
  "markets",
  "target market",
  "language",
  "languages",
  "lang",
  "country",
  "region",
  "hreflang",
]);

/**
 * Column names the app recognizes but does not use. They earn their place
 * here because their presence is what proves row 1 is a header rather than
 * the first keyword.
 */
const METRIC_COLUMN_NAMES = new Set([
  "volume",
  "search volume",
  "monthly searches",
  "avg monthly searches",
  "avg. monthly searches",
  "difficulty",
  "keyword difficulty",
  "kd",
  "competition",
  "cpc",
  "cost per click",
  "clicks",
  "impressions",
  "ctr",
  "position",
  "rank",
  "ranking",
  "url",
  "intent",
  "traffic",
  "results",
  "serp features",
  "parent topic",
  "trend",
]);

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * A locale code rather than prose. The region part is required so ordinary
 * two-letter words ("to", "on") can never be mistaken for a locale.
 */
export function looksLikeLocaleCode(value: string): boolean {
  return /^[a-z]{2,3}[-_][a-z0-9]{2,4}$/i.test(value.trim());
}

/** Tolerant of thousands separators and percent signs, as exports use both. */
function isNumericCell(value: string): boolean {
  const bare = value.trim().replace(/[%,\s]/g, "");
  return bare !== "" && Number.isFinite(Number(bare));
}

function indexOfName(header: string[], names: Set<string>): number | null {
  const index = header.findIndex((cell) => names.has(normalizeHeader(cell)));
  return index === -1 ? null : index;
}

function knownColumnCount(row: string[]): number {
  return row.filter((cell) => {
    const name = normalizeHeader(cell);
    return (
      KEYWORD_COLUMN_NAMES.has(name) ||
      LOCALE_COLUMN_NAMES.has(name) ||
      METRIC_COLUMN_NAMES.has(name)
    );
  }).length;
}

/**
 * Header detection for headers with no recognizable names: a header row is
 * all text while the data below it holds numbers in the same position.
 * That is the shape of every keyword-tool export (phrase, volume,
 * difficulty) regardless of what the columns are called.
 */
function hasNumericShapeShift(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const [header, ...dataRows] = rows;
  if (header.some(isNumericCell)) return false;
  return header.some((_, column) =>
    dataRows.some((row) => column < row.length && isNumericCell(row[column])),
  );
}

function looksLikeHeaderRow(rows: string[][]): boolean {
  return knownColumnCount(rows[0]) > 0 || hasNumericShapeShift(rows);
}

/** The column whose values are predominantly locale codes, if there is one. */
function findLocaleColumn(dataRows: string[][], keywordIndex: number): number | null {
  const columnCount = Math.max(...dataRows.map((row) => row.length));
  for (let column = 0; column < columnCount; column++) {
    if (column === keywordIndex) continue;
    const values = dataRows
      .map((row) => (row[column] ?? "").trim())
      .filter(Boolean);
    if (values.length === 0) continue;
    const hits = values.filter(looksLikeLocaleCode).length;
    if (hits / values.length >= LOCALE_COLUMN_CONFIDENCE) return column;
  }
  return null;
}

// ── Tier 1: header names the app knows ───────────────────────────────────

function matchBySynonym(header: string[]): ColumnMapping | null {
  const keywordIndex = indexOfName(header, KEYWORD_COLUMN_NAMES);
  if (keywordIndex === null) return null;
  const localeIndex = indexOfName(header, LOCALE_COLUMN_NAMES);
  return {
    keywordIndex,
    localeIndex,
    hadHeader: true,
    keywordHeader: header[keywordIndex] ?? null,
    localeHeader: localeIndex === null ? null : (header[localeIndex] ?? null),
    method: "synonym",
  };
}

// ── Tier 2: ask the model ────────────────────────────────────────────────

const AI_MAPPING_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["has_header", "keyword_column_index"],
  properties: {
    has_header: { type: "boolean" },
    keyword_column_index: { type: "integer", minimum: 0 },
    locale_column_index: { type: ["integer", "null"], minimum: 0 },
  },
};

interface AiColumnMapping {
  has_header: boolean;
  keyword_column_index: number;
  locale_column_index?: number | null;
}

async function matchByAi(rows: string[][]): Promise<ColumnMapping | null> {
  const sample = rows.slice(0, AI_SAMPLE_ROWS);
  const columnCount = Math.max(...sample.map((row) => row.length));
  // A single-column file has nothing to decide; spending a call on it would
  // only add latency to the most common paste.
  if (columnCount < 2) return null;

  const { data } = await completeValidatedJson<AiColumnMapping>(
    getAiProvider(),
    {
      system:
        "You identify which columns of a spreadsheet hold search keywords and locale codes. " +
        "Respond with a single JSON object and nothing else.",
      user:
        `The first rows of a keyword file, as JSON arrays. Row and column indices are 0-based; ` +
        `rows have up to ${columnCount} columns.\n` +
        sample
          .map((row, index) => `Row ${index}: ${JSON.stringify(row)}`)
          .join("\n") +
        "\n\nDecide:\n" +
        "- has_header: true if row 0 holds column names rather than data.\n" +
        "- keyword_column_index: the column holding the search keyword or query phrase.\n" +
        '- locale_column_index: the column holding a locale, market, language or country code (e.g. "de-DE", "en"), or null if there is none.\n' +
        "Column names may be in any language. Return only the JSON object.",
      temperature: 0,
      maxTokens: 200,
    },
    getValidator("csv-column-mapping", AI_MAPPING_SCHEMA),
  );

  // The schema cannot know how wide the file is, so an out-of-range index
  // is rejected here and the caller falls through to the positional tier.
  const keywordIndex = data.keyword_column_index;
  if (keywordIndex >= columnCount) return null;

  const claimedLocale = data.locale_column_index;
  const localeIndex =
    typeof claimedLocale === "number" &&
    claimedLocale < columnCount &&
    claimedLocale !== keywordIndex
      ? claimedLocale
      : null;

  return {
    keywordIndex,
    localeIndex,
    hadHeader: data.has_header,
    keywordHeader: data.has_header ? (rows[0][keywordIndex] ?? null) : null,
    localeHeader:
      data.has_header && localeIndex !== null
        ? (rows[0][localeIndex] ?? null)
        : null,
    method: "ai",
  };
}

// ── Tier 3: position ─────────────────────────────────────────────────────

function matchPositionally(rows: string[][]): ColumnMapping {
  const hadHeader = looksLikeHeaderRow(rows);
  const dataRows = hadHeader ? rows.slice(1) : rows;
  const keywordIndex = 0;
  const localeIndex = dataRows.length
    ? findLocaleColumn(dataRows, keywordIndex)
    : null;

  return {
    keywordIndex,
    localeIndex,
    hadHeader,
    keywordHeader: hadHeader ? (rows[0][keywordIndex] ?? null) : null,
    localeHeader:
      hadHeader && localeIndex !== null ? (rows[0][localeIndex] ?? null) : null,
    // A header the app could not read means the first column is a guess,
    // and the merchant is told as much; no header means it is the format.
    method: hadHeader ? "fallback" : "positional",
  };
}

/** Resolve the column mapping for a parsed input. Never throws. */
export async function resolveColumnMapping(rows: string[][]): Promise<ColumnMapping> {
  const bySynonym = matchBySynonym(rows[0]);
  if (bySynonym) return bySynonym;

  if (getAiStatus().configured) {
    try {
      const byAi = await matchByAi(rows);
      if (byAi) return byAi;
    } catch (error) {
      // Column mapping is a convenience, not a gate: an AI failure must
      // never cost the merchant their import.
      console.warn(
        "AI column mapping failed; falling back to the first column:",
        error,
      );
    }
  }

  return matchPositionally(rows);
}
