import { describe, expect, it } from "vitest";
import { chooseCanonicalTarget, type CanonicalCandidate } from "./canonical.server";

/**
 * The canonical policy is the difference between a German page that ranks in
 * Germany and one that Google is told not to index at all, so each branch is
 * pinned down here.
 */

const CLUSTER = "room:living room|style:botanical";

function existing(
  overrides: Partial<CanonicalCandidate> & Pick<CanonicalCandidate, "locale">,
): CanonicalCandidate {
  return {
    id: `page-${overrides.locale}`,
    slug: `${overrides.locale.toLowerCase()}-botanical-wallpaper-living-room`,
    clusterKey: CLUSTER,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function decide(locale: string, pages: CanonicalCandidate[], defaultLocale = "en-US") {
  return chooseCanonicalTarget({ locale, clusterKey: CLUSTER }, defaultLocale, pages);
}

describe("different languages are separate pages", () => {
  it("keeps a German page self-canonical alongside an English one", () => {
    const decision = decide("de-DE", [existing({ locale: "en-US" })]);

    expect(decision.target).toBeNull();
    expect(decision.reason).toContain("Self-referencing");
  });

  it("keeps the English page self-canonical when German came first", () => {
    const decision = decide("en-US", [existing({ locale: "de-DE" })]);

    expect(decision.target).toBeNull();
  });

  it("is self-canonical when nothing else exists at all", () => {
    expect(decide("en-US", []).target).toBeNull();
  });
});

describe("same language, different market, consolidates", () => {
  it("points en-AU at the existing en-US page", () => {
    const usPage = existing({ locale: "en-US" });

    const decision = decide("en-AU", [usPage]);

    expect(decision.target).toBe(usPage);
    expect(decision.reason).toContain("same language");
  });

  it("prefers the default locale over an older same-language page", () => {
    const older = existing({
      locale: "en-GB",
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    const defaultLocalePage = existing({
      locale: "en-US",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });

    const decision = decide("en-AU", [older, defaultLocalePage], "en-US");

    expect(decision.target).toBe(defaultLocalePage);
  });

  it("falls back to the oldest same-language page when the default is absent", () => {
    const oldest = existing({
      locale: "en-AU",
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    const newer = existing({
      locale: "en-GB",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    // Default locale is German, so neither English page is the default.
    const decision = decide("en-US", [newer, oldest], "de-DE");

    expect(decision.target).toBe(oldest);
  });

  it("is stable regardless of the order pages arrive in", () => {
    const a = existing({
      locale: "en-AU",
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    const b = existing({
      locale: "en-GB",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(decide("en-US", [a, b], "de-DE").target?.id).toBe(
      decide("en-US", [b, a], "de-DE").target?.id,
    );
  });
});

describe("scoping", () => {
  it("ignores pages from a different intent cluster", () => {
    const other = existing({ locale: "en-AU", clusterKey: "room:bedroom|style:tropical" });

    expect(decide("en-US", [other]).target).toBeNull();
  });

  it("ignores pages with no cluster key", () => {
    expect(decide("en-US", [existing({ locale: "en-AU", clusterKey: null })]).target).toBeNull();
  });

  it("never designates a page in the same locale as itself", () => {
    expect(decide("en-US", [existing({ locale: "en-US" })]).target).toBeNull();
  });

  it("treats an unconfigured locale as self-canonical rather than throwing", () => {
    const decision = decide("xx-XX", [existing({ locale: "en-US" })]);

    expect(decision.target).toBeNull();
    expect(decision.reason).toContain("not a configured market");
  });

  it("ignores an existing page whose locale config no longer exists", () => {
    expect(decide("en-US", [existing({ locale: "zz-ZZ" })]).target).toBeNull();
  });
});
