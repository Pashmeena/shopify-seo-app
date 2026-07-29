import Papa from "papaparse";
import { listLocales } from "../../config/index.server";
import { truncate } from "../../lib/text";
import { resolveColumnMapping } from "./column-mapping.server";
import type {
  ColumnMapping,
  ImportEntry,
  ImportReport,
  KeywordSource,
  SkippedRow,
  SourceReport,
} from "./types";

/**
 * Turning merchant input (pasted lines or an uploaded file) into keyword
 * entries.
 *
 * Parsing is delegated to papaparse rather than hand-split, because real
 * files need it: quoted fields with commas inside them, semicolon-separated
 * European exports (the comma is their decimal separator), and the UTF-8
 * byte-order mark Excel writes, which would otherwise become part of the
 * first column name so no header could ever match.
 *
 * Nothing is dropped quietly. Rows that cannot be used come back with
 * their line number and the reason, and the column mapping comes back with
 * them, so the merchant is told what the app read rather than discovering
 * it from the results.
 */

/**
 * Keywords per submission. Intent parsing runs inline (and may call the
 * AI), so a batch is capped to keep one request comfortably fast.
 */
export const MAX_IMPORT_BATCH = 50;

/** Delimiters papaparse may choose between; the rest of its defaults are control codes. */
const DELIMITERS_TO_GUESS = [",", ";", "\t", "|"];

const MIN_PHRASE_LENGTH = 2;

/** Skipped rows quoted in a message before it turns into a wall of text. */
const SKIPPED_DETAIL_LIMIT = 8;

const SOURCE_LABEL: Record<KeywordSource, string> = {
  manual: "pasted keywords",
  csv: "uploaded file",
};

const METHOD_NOTE: Record<ColumnMapping["method"], string> = {
  synonym: "matched by column name",
  ai: "identified by AI",
  positional: "no header row, so the first column",
  fallback: "header not recognized, so the first column was assumed",
};

export interface ImportOptions {
  /** Locale codes enabled in Settings. Anything else is reported, never guessed. */
  enabledLocales: string[];
  /** Locale applied to rows that carry none. */
  fallbackLocale: string;
}

export interface SourceInput {
  raw: string;
  source: KeywordSource;
}

interface NumberedRow {
  cells: string[];
  line: number;
}

interface ParsedInput {
  rows: NumberedRow[];
  delimiter: string | null;
  /** Rows papaparse could not read. Source is stamped on by the caller. */
  malformed: Omit<SkippedRow, "source">[];
}

function parseInput(raw: string): ParsedInput {
  // Excel prefixes UTF-8 files with a byte-order mark; left in place it
  // becomes part of the first column name and no header ever matches.
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.trim()) return { rows: [], delimiter: null, malformed: [] };

  // Empty lines are deliberately kept so reported line numbers match the
  // merchant's file exactly; they are filtered below instead.
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    delimitersToGuess: DELIMITERS_TO_GUESS,
  });
  const delimiter = parsed.meta.delimiter || null;

  // A single-column paste has no delimiter to detect. That warning is
  // expected and is not a problem with any row.
  const malformedLines = new Map<number, string>();
  for (const error of parsed.errors) {
    if (error.code === "UndetectableDelimiter") continue;
    if (typeof error.row !== "number") continue;
    malformedLines.set(error.row + 1, error.message);
  }

  const rows = parsed.data
    .map((cells, index) => ({ cells, line: index + 1 }))
    .filter(
      (row) =>
        !malformedLines.has(row.line) &&
        row.cells.some((cell) => cell.trim() !== ""),
    );

  return {
    rows,
    delimiter,
    malformed: [...malformedLines].map(([line, message]) => ({
      line,
      value: (parsed.data[line - 1] ?? []).join(delimiter ?? ","),
      reason: `could not be parsed (${message})`,
    })),
  };
}

/** Resolve a locale code to its configured casing, or null if unknown. */
function canonicalLocaleCode(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  return (
    listLocales().find((locale) => locale.code.toLowerCase() === normalized)
      ?.code ?? null
  );
}

/**
 * The keyword text for a row. A pasted line that happens to contain a
 * comma ("botanical wallpaper, but moody") was split into columns that are
 * not columns, so when nothing but position identified the mapping the row
 * is rejoined rather than silently truncated at the first comma.
 */
function phraseFor(
  row: NumberedRow,
  mapping: ColumnMapping,
  delimiter: string | null,
): string {
  if (
    mapping.method === "positional" &&
    mapping.localeIndex === null &&
    row.cells.length > 1
  ) {
    // Trailing empties first, so a line typed with a stray final comma does
    // not come back with one attached.
    const cells = [...row.cells];
    while (cells.length > 1 && cells[cells.length - 1].trim() === "") {
      cells.pop();
    }
    return cells.join(delimiter ?? ",").trim();
  }
  return (row.cells[mapping.keywordIndex] ?? "").trim();
}

interface SourceOutcome {
  entries: ImportEntry[];
  skipped: SkippedRow[];
  report: SourceReport;
}

/**
 * `seen` spans every input in the submission, so a keyword pasted and also
 * present in the uploaded file is counted once and reported once.
 */
async function importSource(
  input: SourceInput,
  options: ImportOptions,
  seen: Set<string>,
): Promise<SourceOutcome> {
  const { rows, delimiter, malformed } = parseInput(input.raw);
  const skipped: SkippedRow[] = malformed.map((row) => ({
    ...row,
    source: input.source,
  }));

  if (rows.length === 0) {
    return {
      entries: [],
      skipped,
      report: {
        source: input.source,
        mapping: null,
        delimiter,
        dataRowCount: 0,
      },
    };
  }

  const mapping = await resolveColumnMapping(rows.map((row) => row.cells));
  const dataRows = mapping.hadHeader ? rows.slice(1) : rows;
  const enabled = new Set(options.enabledLocales);
  const entries: ImportEntry[] = [];

  for (const row of dataRows) {
    const skip = (value: string, reason: string) =>
      skipped.push({ source: input.source, line: row.line, value, reason });

    const phrase = phraseFor(row, mapping, delimiter);
    if (phrase.length < MIN_PHRASE_LENGTH) {
      skip(row.cells.join(delimiter ?? ","), "no keyword in this row");
      continue;
    }

    const rawLocale =
      mapping.localeIndex === null
        ? ""
        : (row.cells[mapping.localeIndex] ?? "").trim();

    let locale = options.fallbackLocale;
    if (rawLocale) {
      // Previously an unrecognized locale was folded into the keyword and
      // nobody found out. It is now a reported skip.
      const canonical = canonicalLocaleCode(rawLocale);
      if (!canonical) {
        skip(
          phrase,
          `locale "${rawLocale}" is not a configured market (add app/config/locales/${rawLocale}.json)`,
        );
        continue;
      }
      if (!enabled.has(canonical)) {
        skip(phrase, `locale "${canonical}" is not enabled in Settings`);
        continue;
      }
      locale = canonical;
    }

    const identity = `${phrase.toLowerCase()}::${locale}`;
    if (seen.has(identity)) {
      skip(phrase, "duplicate of an earlier row in this submission");
      continue;
    }
    seen.add(identity);
    entries.push({ phrase, locale, source: input.source });
  }

  return {
    entries,
    skipped,
    report: {
      source: input.source,
      mapping,
      delimiter,
      dataRowCount: dataRows.length,
    },
  };
}

/** Read every provided input into keyword entries, reporting what was skipped. */
export async function importKeywordSources(
  inputs: SourceInput[],
  options: ImportOptions,
): Promise<ImportReport> {
  const seen = new Set<string>();
  const report: ImportReport = { entries: [], skipped: [], sources: [] };

  for (const input of inputs) {
    if (!input.raw.trim()) continue;
    const outcome = await importSource(input, options, seen);
    report.entries.push(...outcome.entries);
    report.skipped.push(...outcome.skipped);
    report.sources.push(outcome.report);
  }
  return report;
}

/** One sentence telling the merchant how an input was read. */
export function describeSource(source: SourceReport): string | null {
  const { mapping } = source;
  if (!mapping) return null;

  const keywordColumn = mapping.keywordHeader
    ? `column "${mapping.keywordHeader}"`
    : `column ${mapping.keywordIndex + 1}`;
  const localeColumn =
    mapping.localeIndex === null
      ? "no locale column, so the selected locale was used"
      : `locale from ${
          mapping.localeHeader
            ? `column "${mapping.localeHeader}"`
            : `column ${mapping.localeIndex + 1}`
        }`;
  const separator =
    source.delimiter && source.delimiter !== ","
      ? `, separator "${source.delimiter === "\t" ? "tab" : source.delimiter}"`
      : "";

  return (
    `Read ${source.dataRowCount} row(s) from the ${SOURCE_LABEL[source.source]}: ` +
    `keyword from ${keywordColumn} (${METHOD_NOTE[mapping.method]}), ${localeColumn}${separator}.`
  );
}

/** One line per unusable row, capped so a bad file cannot flood the banner. */
export function describeSkipped(skipped: SkippedRow[]): string[] {
  const lines = skipped
    .slice(0, SKIPPED_DETAIL_LIMIT)
    .map(
      (row) =>
        `Line ${row.line} of the ${SOURCE_LABEL[row.source]}: ${row.reason}. Value: "${truncate(row.value, 60)}"`,
    );
  if (skipped.length > SKIPPED_DETAIL_LIMIT) {
    lines.push(
      `...and ${skipped.length - SKIPPED_DETAIL_LIMIT} more skipped row(s).`,
    );
  }
  return lines;
}
