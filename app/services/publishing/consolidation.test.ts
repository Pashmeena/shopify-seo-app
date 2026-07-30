import { describe, expect, it } from "vitest";
import {
  dependentsOf,
  planConsolidation,
  type ConsolidationParty,
} from "./consolidation.server";

/**
 * Consolidation is the one decision in this app that can take a live page
 * down, so every guard has a test. A wrong redirect is worse than no
 * consolidation: it removes a working URL and replaces it with a 301 to
 * somewhere useless.
 */

const BLOG = "seo-plp";

function party(overrides: Partial<ConsolidationParty> = {}): ConsolidationParty {
  return {
    id: "target",
    slug: "en-us-botanical-wallpaper-living-room",
    title: "Botanical Wallpaper for Living Rooms",
    locale: "en-US",
    status: "published",
    canonicalOfId: null,
    ...overrides,
  };
}

function page(overrides: Partial<ConsolidationParty> = {}): ConsolidationParty {
  return party({
    id: "duplicate",
    slug: "en-us-botanical-living-room-wallpaper",
    title: "Botanical Living Room Wallpaper",
    status: "draft",
    ...overrides,
  });
}

describe("planConsolidation", () => {
  it("publishes a normal page as an article", () => {
    expect(
      planConsolidation({ page: page(), target: null, blogHandle: BLOG }),
    ).toEqual({ kind: "article" });
  });

  it("redirects a flagged duplicate onto its published canonical", () => {
    expect(
      planConsolidation({
        page: page({ canonicalOfId: "target" }),
        target: party(),
        blogHandle: BLOG,
      }),
    ).toEqual({
      kind: "redirect",
      target: {
        id: "target",
        slug: "en-us-botanical-wallpaper-living-room",
        title: "Botanical Wallpaper for Living Rooms",
      },
      fromPath: "/blogs/seo-plp/en-us-botanical-living-room-wallpaper",
      toPath: "/blogs/seo-plp/en-us-botanical-wallpaper-living-room",
    });
  });

  it("builds both paths from the blog handle it is given", () => {
    const plan = planConsolidation({
      page: page({ canonicalOfId: "target" }),
      target: party(),
      // Shopify normalises blog handles server-side, so publishing passes the
      // handle the blog actually has rather than the raw setting.
      blogHandle: "inspiration-1",
    });

    expect(plan).toMatchObject({
      fromPath: "/blogs/inspiration-1/en-us-botanical-living-room-wallpaper",
      toPath: "/blogs/inspiration-1/en-us-botanical-wallpaper-living-room",
    });
  });

  describe("refuses to publish", () => {
    /** Every blocked case, with the substring a merchant needs to see. */
    const blocked: [name: string, input: Parameters<typeof planConsolidation>[0], hint: string][] = [
      [
        "a page consolidated onto itself",
        {
          page: page({ id: "self", canonicalOfId: "self" }),
          target: party({ id: "self" }),
          blogHandle: BLOG,
        },
        "duplicate of itself",
      ],
      [
        "a target that has been deleted",
        { page: page({ canonicalOfId: "gone" }), target: null, blogHandle: BLOG },
        "no longer exists",
      ],
      [
        "a target in another market",
        {
          page: page({ canonicalOfId: "target" }),
          target: party({ locale: "de-DE" }),
          blogHandle: BLOG,
        },
        "Locale is never a reason to consolidate",
      ],
      [
        "a target that is itself consolidated, which would chain redirects",
        {
          page: page({ canonicalOfId: "target" }),
          target: party({ canonicalOfId: "third-page" }),
          blogHandle: BLOG,
        },
        "redirect chain",
      ],
      [
        "a target that is not published yet",
        {
          page: page({ canonicalOfId: "target" }),
          target: party({ status: "draft" }),
          blogHandle: BLOG,
        },
        "Publish",
      ],
      [
        "a target that is only held for review",
        {
          page: page({ canonicalOfId: "target" }),
          target: party({ status: "needs_review" }),
          blogHandle: BLOG,
        },
        "not published",
      ],
      [
        "two pages that resolve to the same URL",
        {
          page: page({ canonicalOfId: "target", slug: "same-slug" }),
          target: party({ slug: "same-slug" }),
          blogHandle: BLOG,
        },
        "same URL",
      ],
    ];

    it.each(blocked)("%s", (_name, input, hint) => {
      const plan = planConsolidation(input);

      expect(plan.kind).toBe("blocked");
      expect(plan.kind === "blocked" && plan.reason).toContain(hint);
    });
  });

  it("names the offending page in every blocked reason it can", () => {
    // The merchant has to be able to act on the message without reading logs.
    const plan = planConsolidation({
      page: page({ canonicalOfId: "target" }),
      target: party({ status: "draft" }),
      blogHandle: BLOG,
    });

    expect(plan.kind === "blocked" && plan.reason).toContain(
      "Botanical Wallpaper for Living Rooms",
    );
  });

  it("checks locale before publication status", () => {
    // A cross-market target that also happens to be a draft must report the
    // locale problem: clearing the consolidation is the fix, not publishing
    // the other page.
    const plan = planConsolidation({
      page: page({ canonicalOfId: "target" }),
      target: party({ locale: "de-DE", status: "draft" }),
      blogHandle: BLOG,
    });

    expect(plan.kind === "blocked" && plan.reason).toContain(
      "Locale is never a reason to consolidate",
    );
  });
});

describe("dependentsOf", () => {
  const pages = [
    { id: "canonical", canonicalOfId: null },
    { id: "dupe-a", canonicalOfId: "canonical" },
    { id: "dupe-b", canonicalOfId: "canonical" },
    { id: "unrelated", canonicalOfId: "somewhere-else" },
  ];

  it("finds every page consolidated onto the given page", () => {
    expect(dependentsOf(pages, "canonical").map((page) => page.id)).toEqual([
      "dupe-a",
      "dupe-b",
    ]);
  });

  it("returns nothing for a page nothing points at", () => {
    expect(dependentsOf(pages, "dupe-a")).toEqual([]);
  });

  it("never returns the page itself", () => {
    // A self-referencing row is refused at publish time, but it can exist in
    // the database, and deleting it must not try to release it from itself.
    const selfReferencing = [{ id: "loop", canonicalOfId: "loop" }];

    expect(dependentsOf(selfReferencing, "loop")).toEqual([]);
  });
});
