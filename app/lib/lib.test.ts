import { describe, expect, it } from "vitest";
import { escapeHtml, paragraphs } from "./html";
import { extractJsonObject, parseJsonArray, safeParseJson } from "./json";
import { slugify } from "./slugify";
import { jaccard, tokenize, truncate } from "./text";

/**
 * The small pure helpers. They are boring individually and load-bearing
 * collectively: `truncate` enforces the meta-length limits, `extractJsonObject`
 * is the first thing every AI response passes through, and `escapeHtml` is the
 * only thing between AI copy and the published document.
 */

describe("truncate", () => {
  it("leaves text within the limit untouched", () => {
    expect(truncate("Botanical Wallpaper", 60)).toBe("Botanical Wallpaper");
  });

  it("never exceeds the limit", () => {
    const long = "Botanical Wallpaper for Living Rooms | Wild Palace Interiors";

    for (const limit of [10, 20, 30, 40, 50, 60]) {
      expect(truncate(long, limit).length).toBeLessThanOrEqual(limit);
    }
  });

  it("cuts on a word boundary when one is close enough to the limit", () => {
    expect(truncate("Botanical Wallpaper for Living Rooms", 25)).toBe(
      "Botanical Wallpaper for",
    );
  });

  it("cuts mid-word rather than losing most of the text", () => {
    // A single long word: a word-boundary cut would return almost nothing, so
    // a hard cut is preferred.
    expect(truncate("Unkonventionellerweise", 10)).toBe("Unkonventi");
  });

  it("does not leave trailing whitespace", () => {
    expect(truncate("Botanical Wallpaper   for Rooms", 22)).toBe(
      "Botanical Wallpaper",
    );
  });

  it("handles an empty string", () => {
    expect(truncate("", 60)).toBe("");
  });
});

describe("tokenize", () => {
  it("lowercases and drops stopwords", () => {
    expect(tokenize("Botanical Wallpaper for the Living Room")).toEqual([
      "botanical",
      "wallpaper",
      "living",
      "room",
    ]);
  });

  it("drops German stopwords too", () => {
    expect(tokenize("Botanische Tapete für das Wohnzimmer")).toEqual([
      "botanische",
      "tapete",
      "wohnzimmer",
    ]);
  });

  it("drops single characters and punctuation", () => {
    expect(tokenize("a b-c, green!")).toEqual(["green"]);
  });

  it("keeps accented letters intact", () => {
    expect(tokenize("Küche grün")).toEqual(["küche", "grün"]);
  });
});

describe("jaccard", () => {
  it("is 1 for identical sets", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(1);
  });

  it("is 0 for disjoint sets", () => {
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("is the intersection over the union", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });

  it("is 0 rather than NaN for two empty sets", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Botanical Wallpaper Living Room")).toBe(
      "botanical-wallpaper-living-room",
    );
  });

  it("transliterates German characters rather than dropping them", () => {
    expect(slugify("Küche & Grün")).toBe("kueche-gruen");
    expect(slugify("Ablösbare Tapete")).toBe("abloesbare-tapete");
    expect(slugify("Weiß")).toBe("weiss");
  });

  it("collapses runs of separators", () => {
    expect(slugify("a --- b")).toBe("a-b");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  -botanical-  ")).toBe("botanical");
  });

  it("produces URL-safe output for arbitrary punctuation", () => {
    expect(slugify("50% off! (today)")).toMatch(/^[a-z0-9-]*$/);
  });
});

describe("escapeHtml", () => {
  it("escapes every character that could change the markup", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes the ampersand first, so entities are not double-broken", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Botanical wallpaper, 53 cm × 10 m")).toBe(
      "Botanical wallpaper, 53 cm × 10 m",
    );
  });
});

describe("paragraphs", () => {
  it("splits on blank lines", () => {
    expect(paragraphs("One.\n\nTwo.")).toBe("<p>One.</p>\n<p>Two.</p>");
  });

  it("turns a single newline into a line break, not a new paragraph", () => {
    expect(paragraphs("One.\nStill one.")).toBe("<p>One.<br>Still one.</p>");
  });

  it("drops empty paragraphs from repeated blank lines", () => {
    expect(paragraphs("One.\n\n\n\nTwo.")).toBe("<p>One.</p>\n<p>Two.</p>");
  });

  it("escapes the text it wraps", () => {
    expect(paragraphs("<script>")).toBe("<p>&lt;script&gt;</p>");
  });

  it("returns nothing for empty input", () => {
    expect(paragraphs("   \n\n  ")).toBe("");
  });
});

describe("extractJsonObject", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(extractJsonObject('\n  {"a":1}\n')).toEqual({ a: 1 });
  });

  it("unwraps a fenced code block", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("unwraps a fence with no language tag", () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("recovers an object buried in prose", () => {
    expect(extractJsonObject('Sure thing!\n{"a":1}\nLet me know.')).toEqual({
      a: 1,
    });
  });

  it("takes the outermost braces, so nesting survives", () => {
    expect(extractJsonObject('prefix {"a":{"b":2}} suffix')).toEqual({
      a: { b: 2 },
    });
  });

  it("throws when there is no object at all", () => {
    expect(() => extractJsonObject("I cannot help with that.")).toThrow(
      /no parseable JSON object/,
    );
  });

  it("throws rather than returning half an object", () => {
    expect(() => extractJsonObject('{"a": ')).toThrow();
  });
});

describe("safeParseJson", () => {
  it("parses valid JSON", () => {
    expect(safeParseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns undefined instead of throwing on malformed JSON", () => {
    expect(safeParseJson("{not json")).toBeUndefined();
  });

  it.each([null, undefined, ""])("returns undefined for %p", (input) => {
    expect(safeParseJson(input)).toBeUndefined();
  });
});

describe("parseJsonArray", () => {
  it("parses a JSON array", () => {
    expect(parseJsonArray('["a","b"]')).toEqual(["a", "b"]);
  });

  it("defaults to an empty array for anything that is not one", () => {
    expect(parseJsonArray('{"a":1}')).toEqual([]);
    expect(parseJsonArray("not json")).toEqual([]);
    expect(parseJsonArray(null)).toEqual([]);
  });
});
