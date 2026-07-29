import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The AI tier of column mapping, with the provider injected.
 *
 * The real validated-JSON client and ajv run here — only the network call is
 * replaced — so a malformed or hallucinated model response is rejected by
 * the same code path production uses.
 */

const complete = vi.fn<(request: { user: string }) => Promise<string>>();
const configured = vi.fn(() => true);

vi.mock("../ai/provider.server", () => ({
  getAiProvider: () => ({ name: "anthropic", model: "test-model", complete }),
  getAiStatus: () => ({
    provider: "anthropic",
    model: "test-model",
    configured: configured(),
  }),
}));

const { looksLikeLocaleCode, resolveColumnMapping } = await import(
  "./column-mapping.server"
);

/** A file whose headers no synonym list could know. */
const UNKNOWN_HEADER_ROWS = [
  ["Suchbegriff", "Zielmarkt", "Volumen"],
  ["botanische tapete wohnzimmer", "de-DE", "2400"],
  ["tapete flur", "de-DE", "880"],
];

function respond(payload: unknown) {
  complete.mockResolvedValue(JSON.stringify(payload));
}

beforeEach(() => {
  complete.mockReset();
  configured.mockReturnValue(true);
});

describe("tier 1: header names the app knows", () => {
  it("resolves without calling the AI", async () => {
    const mapping = await resolveColumnMapping([
      ["Volume", "Keyword", "Locale"],
      ["2400", "botanical wallpaper living room", "en-US"],
    ]);

    expect(mapping).toMatchObject({
      method: "synonym",
      keywordIndex: 1,
      localeIndex: 2,
    });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("tier 2: the AI", () => {
  it("identifies columns whose names are in another language", async () => {
    respond({
      has_header: true,
      keyword_column_index: 0,
      locale_column_index: 1,
    });

    const mapping = await resolveColumnMapping(UNKNOWN_HEADER_ROWS);

    expect(mapping).toEqual({
      method: "ai",
      keywordIndex: 0,
      localeIndex: 1,
      hadHeader: true,
      keywordHeader: "Suchbegriff",
      localeHeader: "Zielmarkt",
    });
  });

  it("sends only a sample of rows, not the whole file", async () => {
    respond({ has_header: true, keyword_column_index: 0 });
    const rows = [
      ["Suchbegriff", "Volumen"],
      ...Array.from({ length: 40 }, (_, index) => [`begriff ${index}`, "100"]),
    ];

    await resolveColumnMapping(rows);

    const prompt = complete.mock.calls[0][0].user;
    expect(prompt).toContain("Row 5:");
    expect(prompt).not.toContain("Row 6:");
    expect(prompt).not.toContain("begriff 39");
  });

  it("is not consulted for a single-column input", async () => {
    const mapping = await resolveColumnMapping([
      ["botanical wallpaper living room"],
      ["tropical wallpaper bedroom"],
    ]);

    expect(complete).not.toHaveBeenCalled();
    expect(mapping.method).toBe("positional");
  });

  it("is not consulted when no provider is configured", async () => {
    configured.mockReturnValue(false);

    const mapping = await resolveColumnMapping(UNKNOWN_HEADER_ROWS);

    expect(complete).not.toHaveBeenCalled();
    expect(mapping.method).toBe("fallback");
  });

  it("reports a locale column it found even when the file has no header", async () => {
    respond({
      has_header: false,
      keyword_column_index: 1,
      locale_column_index: 0,
    });

    const mapping = await resolveColumnMapping([
      ["de-DE", "botanische tapete wohnzimmer"],
      ["de-DE", "tapete flur"],
    ]);

    expect(mapping).toMatchObject({
      keywordIndex: 1,
      localeIndex: 0,
      hadHeader: false,
      keywordHeader: null,
      localeHeader: null,
    });
  });
});

describe("tier 2 failures never cost the import", () => {
  it("rejects a column index beyond the width of the file", async () => {
    respond({ has_header: true, keyword_column_index: 7 });

    const mapping = await resolveColumnMapping(UNKNOWN_HEADER_ROWS);

    expect(mapping.method).toBe("fallback");
    expect(mapping.keywordIndex).toBe(0);
  });

  it("ignores a locale index that collides with the keyword column", async () => {
    respond({
      has_header: true,
      keyword_column_index: 0,
      locale_column_index: 0,
    });

    const mapping = await resolveColumnMapping(UNKNOWN_HEADER_ROWS);

    expect(mapping.method).toBe("ai");
    expect(mapping.localeIndex).toBeNull();
  });

  it("falls back when the response does not satisfy the schema", async () => {
    // Wrong types on both fields, three times over: the client retries, then
    // gives up, and mapping degrades rather than throwing.
    respond({ has_header: "yes", keyword_column_index: "first" });

    const mapping = await resolveColumnMapping(UNKNOWN_HEADER_ROWS);

    expect(complete).toHaveBeenCalledTimes(3);
    expect(mapping.method).toBe("fallback");
  });

  it("falls back when the provider throws", async () => {
    complete.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    );

    const mapping = await resolveColumnMapping(UNKNOWN_HEADER_ROWS);

    expect(mapping.method).toBe("fallback");
  });

  it("tolerates a fenced code block around the JSON", async () => {
    complete.mockResolvedValue(
      '```json\n{"has_header": true, "keyword_column_index": 0}\n```',
    );

    const mapping = await resolveColumnMapping(UNKNOWN_HEADER_ROWS);

    expect(mapping.method).toBe("ai");
  });
});

describe("tier 3: position", () => {
  it("claims a locale column when most of its values are locale codes", async () => {
    configured.mockReturnValue(false);

    const mapping = await resolveColumnMapping([
      ["botanical wallpaper living room", "en-US"],
      ["botanische tapete wohnzimmer", "de-DE"],
      ["tapete flur", ""],
    ]);

    expect(mapping).toMatchObject({
      method: "positional",
      keywordIndex: 0,
      localeIndex: 1,
      hadHeader: false,
    });
  });

  it("leaves a prose column alone", async () => {
    configured.mockReturnValue(false);

    const mapping = await resolveColumnMapping([
      ["botanical wallpaper", "great for north-facing rooms"],
      ["tropical wallpaper", "bold and green"],
    ]);

    expect(mapping.localeIndex).toBeNull();
  });
});

describe("looksLikeLocaleCode", () => {
  it.each(["en-US", "de-DE", "de_de", "pt-BR", "zh-Hans"])(
    "accepts %s",
    (value) => {
      expect(looksLikeLocaleCode(value)).toBe(true);
    },
  );

  it.each(["en", "to", "wallpaper", "great for north-facing rooms", "2400", ""])(
    "rejects %s",
    (value) => {
      expect(looksLikeLocaleCode(value)).toBe(false);
    },
  );
});
