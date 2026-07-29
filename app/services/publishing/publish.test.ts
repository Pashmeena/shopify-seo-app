import { describe, expect, it } from "vitest";
import { affectedByPublish } from "./publish.server";

/**
 * Which published pages a new publish invalidates. The cross-locale half of
 * this used to be missing, which left hreflang one-directional: the second
 * locale referenced the first, the first never referenced back, and a
 * non-reciprocal annotation is discarded by search engines.
 */

interface Candidate {
  id: string;
  status: string;
  locale: string;
  clusterKey: string | null;
  content: object | null;
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "other",
    status: "published",
    locale: "en-US",
    clusterKey: "room:living room|style:botanical",
    content: { h1: "Something" },
    ...overrides,
  };
}

const JUST_PUBLISHED = candidate({ id: "just-published" });

describe("affectedByPublish", () => {
  it("includes a same-locale page, which may gain an internal link", () => {
    const sibling = candidate({ id: "sibling", clusterKey: "other-cluster" });

    expect(affectedByPublish([sibling], JUST_PUBLISHED)).toEqual([sibling]);
  });

  it("includes a same-cluster page in another locale, for hreflang", () => {
    const variant = candidate({ id: "variant", locale: "de-DE" });

    expect(affectedByPublish([variant], JUST_PUBLISHED)).toEqual([variant]);
  });

  it("excludes an unrelated page in another locale", () => {
    const unrelated = candidate({
      id: "unrelated",
      locale: "de-DE",
      clusterKey: "room:bedroom|style:tropical",
    });

    expect(affectedByPublish([unrelated], JUST_PUBLISHED)).toEqual([]);
  });

  it("excludes the page that was just published", () => {
    expect(affectedByPublish([JUST_PUBLISHED], JUST_PUBLISHED)).toEqual([]);
  });

  it.each(["draft", "needs_review"])("excludes %s pages", (status) => {
    expect(affectedByPublish([candidate({ status })], JUST_PUBLISHED)).toEqual([]);
  });

  it("excludes a page with no generated content", () => {
    expect(
      affectedByPublish([candidate({ content: null })], JUST_PUBLISHED),
    ).toEqual([]);
  });

  it("does not pair two pages that both have no cluster key", () => {
    // Null is absence, not a value two pages can share.
    const orphan = candidate({ id: "orphan", locale: "de-DE", clusterKey: null });
    const publishedOrphan = candidate({
      id: "just-published",
      clusterKey: null,
    });

    expect(affectedByPublish([orphan], publishedOrphan)).toEqual([]);
  });
});
