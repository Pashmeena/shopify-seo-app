import { describe, expect, it } from "vitest";
import type { AdminClient } from "../shopify/admin.server";
import {
  ensureRedirect,
  findRedirectByPath,
  removeRedirect,
} from "./redirect.server";

/**
 * The redirect layer is what makes a canonical consolidation real, so it is
 * exercised against a fake Admin client rather than mocked out: the actual
 * queries, the exact-match filtering and the create/update/delete branching
 * all run.
 *
 * The fake also records what was sent, because the interesting failures here
 * are "wrote the wrong thing" and "wrote twice", not "threw".
 */

interface Redirect {
  id: string;
  path: string;
  target: string;
}

interface FakeShop {
  admin: AdminClient;
  /** Operations in the order they were sent, by mutation/query name. */
  calls: string[];
  redirects: Redirect[];
}

function operationName(query: string): string {
  return query.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "unknown";
}

/**
 * An Admin API that behaves like Shopify for redirects: `path` is unique, and
 * the `query: "path:…"` search is deliberately implemented as a *prefix*
 * match, which is the behaviour the production code has to defend against.
 */
function fakeShop(initial: Redirect[] = []): FakeShop {
  const shop: FakeShop = {
    calls: [],
    redirects: [...initial],
    admin: { graphql: async () => new Response("{}") },
  };
  let nextId = initial.length + 1;

  shop.admin = {
    async graphql(query, options) {
      const name = operationName(query);
      const variables = (options?.variables ?? {}) as Record<string, never>;
      shop.calls.push(name);

      const json = (data: unknown) =>
        new Response(JSON.stringify({ data }), {
          headers: { "Content-Type": "application/json" },
        });

      if (name === "PlpRedirectByPath") {
        const needle = String(variables.query).replace(/^path:"|"$/g, "");
        return json({
          urlRedirects: {
            nodes: shop.redirects.filter((redirect) =>
              redirect.path.startsWith(needle),
            ),
          },
        });
      }

      if (name === "PlpRedirectCreate") {
        const input = variables.urlRedirect as unknown as Omit<Redirect, "id">;
        if (shop.redirects.some((redirect) => redirect.path === input.path)) {
          return json({
            urlRedirectCreate: {
              urlRedirect: null,
              userErrors: [
                { field: ["path"], message: "Path has already been taken", code: "CREATE_FAILED" },
              ],
            },
          });
        }
        const created = { id: `gid://shopify/UrlRedirect/${nextId++}`, ...input };
        shop.redirects.push(created);
        return json({ urlRedirectCreate: { urlRedirect: created, userErrors: [] } });
      }

      if (name === "PlpRedirectUpdate") {
        const input = variables.urlRedirect as unknown as Omit<Redirect, "id">;
        const existing = shop.redirects.find((redirect) => redirect.id === variables.id);
        if (!existing) {
          return json({
            urlRedirectUpdate: {
              urlRedirect: null,
              userErrors: [{ message: "Redirect does not exist", code: "DOES_NOT_EXIST" }],
            },
          });
        }
        existing.path = input.path;
        existing.target = input.target;
        return json({ urlRedirectUpdate: { urlRedirect: existing, userErrors: [] } });
      }

      if (name === "PlpRedirectDelete") {
        const index = shop.redirects.findIndex((redirect) => redirect.id === variables.id);
        if (index === -1) {
          return json({
            urlRedirectDelete: {
              deletedUrlRedirectId: null,
              userErrors: [{ message: "Redirect does not exist", code: "DOES_NOT_EXIST" }],
            },
          });
        }
        const [removed] = shop.redirects.splice(index, 1);
        return json({
          urlRedirectDelete: { deletedUrlRedirectId: removed.id, userErrors: [] },
        });
      }

      throw new Error(`Unexpected operation ${name}`);
    },
  };

  return shop;
}

const FROM = "/blogs/seo-plp/en-us-botanical-living-room-wallpaper";
const TO = "/blogs/seo-plp/en-us-botanical-wallpaper-living-room";

describe("findRedirectByPath", () => {
  it("returns the redirect registered for exactly that path", async () => {
    const shop = fakeShop([{ id: "gid://1", path: FROM, target: TO }]);

    expect(await findRedirectByPath(shop.admin, FROM)).toEqual({
      id: "gid://1",
      path: FROM,
      target: TO,
    });
  });

  it("ignores a longer path the search happens to return", async () => {
    // This is the whole reason the result is filtered in code. Shopify's
    // `query: "path:…"` is a search, and this app's slugs are systematically
    // prefixes of each other: `…-living-room` sits inside
    // `…-living-room-ideas`. Trusting the first hit would rewrite or delete
    // the wrong page's redirect.
    const shop = fakeShop([
      { id: "gid://2", path: `${FROM}-ideas`, target: TO },
    ]);

    expect(await findRedirectByPath(shop.admin, FROM)).toBeNull();
  });

  it("returns null when nothing matches", async () => {
    expect(await findRedirectByPath(fakeShop().admin, FROM)).toBeNull();
  });
});

describe("ensureRedirect", () => {
  it("creates the redirect when the path is free", async () => {
    const shop = fakeShop();

    expect(await ensureRedirect(shop.admin, FROM, TO)).toBe("created");
    expect(shop.redirects).toEqual([
      { id: "gid://shopify/UrlRedirect/1", path: FROM, target: TO },
    ]);
  });

  it("is idempotent — republishing the same page writes nothing", async () => {
    const shop = fakeShop();
    await ensureRedirect(shop.admin, FROM, TO);
    shop.calls.length = 0;

    expect(await ensureRedirect(shop.admin, FROM, TO)).toBe("unchanged");
    expect(shop.calls).toEqual(["PlpRedirectByPath"]);
    expect(shop.redirects).toHaveLength(1);
  });

  it("retargets an existing redirect instead of duplicating the path", async () => {
    // Happens when the canonical page's slug is rewritten by Shopify's handle
    // normalisation, or when the merchant re-points a duplicate elsewhere.
    const shop = fakeShop([{ id: "gid://3", path: FROM, target: "/blogs/seo-plp/old" }]);

    expect(await ensureRedirect(shop.admin, FROM, TO)).toBe("updated");
    expect(shop.calls).toEqual(["PlpRedirectByPath", "PlpRedirectUpdate"]);
    expect(shop.redirects).toEqual([{ id: "gid://3", path: FROM, target: TO }]);
  });

  it("never creates a second redirect for a path Shopify already holds", async () => {
    // `UrlRedirectErrorCode` has no "already taken" member — a taken path
    // surfaces as a generic CREATE_FAILED — so the code looks the path up
    // rather than trying to create and interpreting the failure. If that ever
    // regressed, this test would see the create attempt.
    const shop = fakeShop([{ id: "gid://4", path: FROM, target: TO }]);
    await ensureRedirect(shop.admin, FROM, TO);

    expect(shop.calls).not.toContain("PlpRedirectCreate");
  });

  it("surfaces a create failure rather than reporting success", async () => {
    const shop = fakeShop();
    shop.admin = {
      async graphql(query) {
        if (operationName(query) === "PlpRedirectByPath") {
          return new Response(JSON.stringify({ data: { urlRedirects: { nodes: [] } } }));
        }
        return new Response(
          JSON.stringify({
            data: {
              urlRedirectCreate: {
                urlRedirect: null,
                userErrors: [{ field: ["path"], message: "Path is invalid" }],
              },
            },
          }),
        );
      },
    };

    await expect(ensureRedirect(shop.admin, FROM, TO)).rejects.toThrow(/Path is invalid/);
  });
});

describe("removeRedirect", () => {
  it("deletes the redirect and reports that it did", async () => {
    const shop = fakeShop([{ id: "gid://5", path: FROM, target: TO }]);

    expect(await removeRedirect(shop.admin, FROM)).toBe(true);
    expect(shop.redirects).toEqual([]);
  });

  it("is a no-op when there is nothing to remove", async () => {
    const shop = fakeShop();

    expect(await removeRedirect(shop.admin, FROM)).toBe(false);
    expect(shop.calls).toEqual(["PlpRedirectByPath"]);
  });

  it("leaves a neighbouring path alone", async () => {
    // Same prefix hazard as the lookup: removing a consolidation must not
    // strip the redirect belonging to a longer slug.
    const shop = fakeShop([{ id: "gid://6", path: `${FROM}-ideas`, target: TO }]);

    expect(await removeRedirect(shop.admin, FROM)).toBe(false);
    expect(shop.redirects).toHaveLength(1);
  });
});
