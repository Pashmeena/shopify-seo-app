import { describe, expect, it } from "vitest";
import {
  describeSkipped,
  describeSource,
  importKeywordSources,
} from "./keyword-import.server";

/**
 * Ingestion tests. No AI provider is configured under test, so the column
 * mapping resolves through the synonym and positional tiers only — which is
 * what these assert. The AI tier is covered in column-mapping.test.ts with
 * an injected provider.
 */

const OPTIONS = {
  enabledLocales: ["en-US", "de-DE"],
  fallbackLocale: "en-US",
};

/** Import a single pasted/uploaded body. */
function importOne(raw: string, source: "manual" | "csv" = "csv") {
  return importKeywordSources([{ raw, source }], OPTIONS);
}

describe("plain keyword lists", () => {
  it("reads one keyword per line and applies the fallback locale", async () => {
    const report = await importOne(
      "botanical wallpaper living room\npeel and stick wallpaper for renters",
      "manual",
    );

    expect(report.entries).toEqual([
      {
        phrase: "botanical wallpaper living room",
        locale: "en-US",
        source: "manual",
      },
      {
        phrase: "peel and stick wallpaper for renters",
        locale: "en-US",
        source: "manual",
      },
    ]);
    expect(report.skipped).toEqual([]);
  });

  it("reads a trailing locale code per line", async () => {
    const report = await importOne(
      "botanical wallpaper living room,en-US\nbotanische tapete wohnzimmer,de-DE",
    );

    expect(report.entries.map((entry) => entry.locale)).toEqual([
      "en-US",
      "de-DE",
    ]);
  });

  it("keeps a comma that belongs to the phrase rather than truncating it", async () => {
    const report = await importOne("botanical wallpaper, but moody", "manual");

    expect(report.entries[0].phrase).toBe("botanical wallpaper, but moody");
  });

  it("does not carry a stray trailing comma into the phrase", async () => {
    const report = await importOne(
      "botanical wallpaper living room,\ntropical wallpaper bedroom,,",
      "manual",
    );

    expect(report.entries.map((entry) => entry.phrase)).toEqual([
      "botanical wallpaper living room",
      "tropical wallpaper bedroom",
    ]);
  });

  it("ignores blank lines without shifting reported line numbers", async () => {
    const report = await importOne("first keyword\n\n\nx\nsecond keyword");

    expect(report.entries.map((entry) => entry.phrase)).toEqual([
      "first keyword",
      "second keyword",
    ]);
    // "x" is on line 4 of the merchant's file, not line 2 of the parsed rows.
    expect(report.skipped).toEqual([
      {
        source: "csv",
        line: 4,
        value: "x",
        reason: "no keyword in this row",
      },
    ]);
  });
});

describe("headers", () => {
  it("finds the keyword column by name regardless of position", async () => {
    const report = await importOne(
      "Volume,Keyword,KD\n2400,botanical wallpaper living room,31",
    );

    expect(report.entries[0].phrase).toBe("botanical wallpaper living room");
    expect(report.sources[0].mapping).toMatchObject({
      keywordIndex: 1,
      keywordHeader: "Keyword",
      hadHeader: true,
      method: "synonym",
    });
  });

  it("accepts header synonyms and normalizes spacing and case", async () => {
    const report = await importOne(
      "Search Term;Avg. Monthly Searches\ntropical wallpaper bedroom;1900",
    );

    expect(report.entries[0].phrase).toBe("tropical wallpaper bedroom");
    expect(report.sources[0].mapping?.method).toBe("synonym");
  });

  it("maps a locale column by name", async () => {
    const report = await importOne(
      "keyword,market\nbotanische tapete wohnzimmer,de-DE",
    );

    expect(report.entries[0]).toMatchObject({ locale: "de-DE" });
    expect(report.sources[0].mapping).toMatchObject({
      localeIndex: 1,
      localeHeader: "market",
    });
  });

  it("does not mistake a keyword containing 'keyword' for a header", async () => {
    const report = await importOne("keyword ideas for hallways\nhallway wallpaper");

    expect(report.entries.map((entry) => entry.phrase)).toEqual([
      "keyword ideas for hallways",
      "hallway wallpaper",
    ]);
    expect(report.sources[0].mapping?.hadHeader).toBe(false);
  });

  it("detects an unrecognized header from the numeric shape of the data", async () => {
    // No AI configured under test, so this falls to the positional tier —
    // but the header row must still be recognized as a header and dropped.
    const report = await importOne(
      "Suchbegriff,Volumen\nbotanische tapete wohnzimmer,2400\ntapete flur,880",
    );

    expect(report.entries.map((entry) => entry.phrase)).toEqual([
      "botanische tapete wohnzimmer",
      "tapete flur",
    ]);
    expect(report.sources[0].mapping).toMatchObject({
      hadHeader: true,
      keywordIndex: 0,
      method: "fallback",
    });
  });
});

describe("delimiters, quoting and encoding", () => {
  it("handles semicolon-separated files (European exports)", async () => {
    const report = await importOne(
      "keyword;volume\nbotanical wallpaper living room;2400",
    );

    expect(report.entries[0].phrase).toBe("botanical wallpaper living room");
    expect(report.sources[0].delimiter).toBe(";");
  });

  it("handles tab-separated files", async () => {
    const report = await importOne(
      "keyword\tvolume\nbotanical wallpaper living room\t2400",
    );

    expect(report.entries[0].phrase).toBe("botanical wallpaper living room");
    expect(report.sources[0].delimiter).toBe("\t");
  });

  it("keeps commas inside quoted fields", async () => {
    const report = await importOne(
      'keyword,volume\n"wallpaper for kitchens, bathrooms and utility rooms",320',
    );

    expect(report.entries[0].phrase).toBe(
      "wallpaper for kitchens, bathrooms and utility rooms",
    );
  });

  it("strips the UTF-8 byte-order mark Excel writes", async () => {
    const report = await importOne(
      "﻿keyword,locale\nbotanical wallpaper living room,en-US",
    );

    // Without stripping, the first header reads as "﻿keyword" and the
    // synonym tier would never match it.
    expect(report.sources[0].mapping?.method).toBe("synonym");
    expect(report.entries[0].phrase).toBe("botanical wallpaper living room");
  });
});

describe("locale validation", () => {
  it("reports an unconfigured locale instead of folding it into the keyword", async () => {
    const report = await importOne(
      "keyword,locale\nbotanical wallpaper living room,fr-FR",
    );

    expect(report.entries).toEqual([]);
    expect(report.skipped[0]).toMatchObject({
      line: 2,
      reason: expect.stringContaining('locale "fr-FR" is not a configured market'),
    });
  });

  it("reports a configured but disabled locale distinctly", async () => {
    const report = await importKeywordSources(
      [{ raw: "keyword,locale\nbotanische tapete wohnzimmer,de-DE", source: "csv" }],
      { enabledLocales: ["en-US"], fallbackLocale: "en-US" },
    );

    expect(report.entries).toEqual([]);
    expect(report.skipped[0].reason).toBe(
      'locale "de-DE" is not enabled in Settings',
    );
  });

  it("accepts locale codes in any casing or with an underscore", async () => {
    const report = await importOne(
      "keyword,locale\nbotanische tapete wohnzimmer,de_de\ntapete flur,DE-DE",
    );

    expect(report.entries.map((entry) => entry.locale)).toEqual([
      "de-DE",
      "de-DE",
    ]);
  });

  it("treats a trailing value that is not a locale code as part of the phrase", async () => {
    const report = await importOne("wallpaper,cheap and cheerful", "manual");

    expect(report.entries[0].phrase).toBe("wallpaper,cheap and cheerful");
    expect(report.skipped).toEqual([]);
  });
});

describe("deduplication across a submission", () => {
  it("keeps the first occurrence and reports the rest", async () => {
    const report = await importOne(
      "botanical wallpaper living room\nBotanical Wallpaper Living Room",
    );

    expect(report.entries).toHaveLength(1);
    expect(report.skipped[0].reason).toBe(
      "duplicate of an earlier row in this submission",
    );
  });

  it("deduplicates across the pasted box and the uploaded file", async () => {
    const report = await importKeywordSources(
      [
        { raw: "botanical wallpaper living room", source: "manual" },
        { raw: "botanical wallpaper living room", source: "csv" },
      ],
      OPTIONS,
    );

    expect(report.entries).toEqual([
      {
        phrase: "botanical wallpaper living room",
        locale: "en-US",
        source: "manual",
      },
    ]);
    expect(report.skipped[0].source).toBe("csv");
  });

  it("treats the same phrase in different locales as distinct pages", async () => {
    const report = await importOne(
      "keyword,locale\nbotanical wallpaper,en-US\nbotanical wallpaper,de-DE",
    );

    expect(report.entries).toHaveLength(2);
  });
});

describe("empty and whitespace-only input", () => {
  it("returns nothing for empty input without recording a source", async () => {
    const report = await importKeywordSources(
      [
        { raw: "", source: "manual" },
        { raw: "   \n\n", source: "csv" },
      ],
      OPTIONS,
    );

    expect(report).toEqual({ entries: [], skipped: [], sources: [] });
  });
});

describe("merchant-facing descriptions", () => {
  it("names the column, how it was identified, and a non-comma separator", async () => {
    const report = await importOne(
      "Volume;Keyword\n2400;botanical wallpaper living room",
    );

    expect(describeSource(report.sources[0])).toBe(
      'Read 1 row(s) from the uploaded file: keyword from column "Keyword" ' +
        "(matched by column name), no locale column, so the selected locale " +
        'was used, separator ";".',
    );
  });

  it("warns explicitly when the first column was only assumed", async () => {
    const report = await importOne(
      "Suchbegriff,Volumen\nbotanische tapete wohnzimmer,2400",
    );

    expect(describeSource(report.sources[0])).toContain(
      "header not recognized, so the first column was assumed",
    );
  });

  it("caps quoted skipped rows and reports the remainder as a count", async () => {
    const skipped = Array.from({ length: 11 }, (_, index) => ({
      source: "csv" as const,
      line: index + 1,
      value: `row ${index}`,
      reason: "no keyword in this row",
    }));

    const lines = describeSkipped(skipped);

    expect(lines).toHaveLength(9);
    expect(lines[8]).toBe("...and 3 more skipped row(s).");
  });
});
