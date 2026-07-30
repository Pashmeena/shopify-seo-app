import { assertNoUserErrors, runGraphql, type AdminClient } from "../shopify/admin.server";

/**
 * Storefront URL redirects — the mechanism that makes a canonical
 * consolidation real. See consolidation.server.ts for why a 301 is used
 * rather than a `rel=canonical` tag.
 *
 * Every operation here is idempotent, because publishing is re-runnable and a
 * merchant may republish the same page any number of times. Idempotency is
 * achieved by looking the redirect up by path first rather than by catching a
 * duplicate-path error: `UrlRedirectErrorCode` has no "already taken" member
 * (a taken path surfaces as a generic `CREATE_FAILED`), so distinguishing it
 * would mean matching on an English error string. One extra query per publish
 * is a better trade than that.
 */

const REDIRECT_BY_PATH_QUERY = `#graphql
  query PlpRedirectByPath($query: String!, $first: Int!) {
    urlRedirects(first: $first, query: $query) {
      nodes { id path target }
    }
  }
`;

const REDIRECT_CREATE_MUTATION = `#graphql
  mutation PlpRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect { id path target }
      userErrors { field message code }
    }
  }
`;

const REDIRECT_UPDATE_MUTATION = `#graphql
  mutation PlpRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) {
    urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
      urlRedirect { id path target }
      userErrors { field message code }
    }
  }
`;

const REDIRECT_DELETE_MUTATION = `#graphql
  mutation PlpRedirectDelete($id: ID!) {
    urlRedirectDelete(id: $id) {
      deletedUrlRedirectId
      userErrors { field message code }
    }
  }
`;

/**
 * How many search hits to consider when resolving a path.
 *
 * `query: "path:…"` is a search, not an exact lookup: Shopify may return
 * near-matches, and `/blogs/seo-plp/botanical` is a prefix of
 * `/blogs/seo-plp/botanical-living-room`. So the result is always filtered to
 * an exact path match in code, and this bound only has to be wide enough to
 * contain the exact hit among its neighbours.
 */
const PATH_SEARCH_LIMIT = 50;

export interface StorefrontRedirect {
  id: string;
  path: string;
  target: string;
}

/** Escape a value for a Shopify search query string. */
function quoteSearchValue(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * The redirect registered for exactly `path`, or null.
 *
 * Exported because "is this path already redirecting?" is a question the
 * publish path asks for its own reasons, not only as a step of `ensure`.
 */
export async function findRedirectByPath(
  admin: AdminClient,
  path: string,
): Promise<StorefrontRedirect | null> {
  const data = await runGraphql<{ urlRedirects: { nodes: StorefrontRedirect[] } }>(
    admin,
    REDIRECT_BY_PATH_QUERY,
    { query: `path:${quoteSearchValue(path)}`, first: PATH_SEARCH_LIMIT },
  );
  return data.urlRedirects.nodes.find((node) => node.path === path) ?? null;
}

/** What `ensureRedirect` did, so callers can report it accurately. */
export type RedirectOutcome = "created" | "updated" | "unchanged";

/**
 * Guarantee that `path` redirects to `target`, whatever state the shop is in.
 *
 * Returns which of the three things happened rather than void: publishing
 * reports back to the merchant, and "already correct" is a different message
 * from "created".
 */
export async function ensureRedirect(
  admin: AdminClient,
  path: string,
  target: string,
): Promise<RedirectOutcome> {
  const existing = await findRedirectByPath(admin, path);

  if (!existing) {
    const data = await runGraphql<{
      urlRedirectCreate: {
        urlRedirect: StorefrontRedirect | null;
        userErrors: { field?: string[] | null; message: string }[];
      };
    }>(admin, REDIRECT_CREATE_MUTATION, { urlRedirect: { path, target } });
    assertNoUserErrors(data.urlRedirectCreate.userErrors, "urlRedirectCreate");
    if (!data.urlRedirectCreate.urlRedirect) {
      throw new Error(`urlRedirectCreate returned no redirect for ${path}`);
    }
    return "created";
  }

  if (existing.target === target) return "unchanged";

  const data = await runGraphql<{
    urlRedirectUpdate: {
      urlRedirect: StorefrontRedirect | null;
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(admin, REDIRECT_UPDATE_MUTATION, {
    id: existing.id,
    urlRedirect: { path, target },
  });
  assertNoUserErrors(data.urlRedirectUpdate.userErrors, "urlRedirectUpdate");
  return "updated";
}

/**
 * Remove the redirect at `path`, if there is one.
 *
 * This is not housekeeping — it is load-bearing. Shopify resolves redirects
 * *before* the theme renders, so a stale redirect permanently shadows any
 * article later published at the same handle. Every path that stops being a
 * consolidation must come through here, or the page can never go live again.
 */
export async function removeRedirect(
  admin: AdminClient,
  path: string,
): Promise<boolean> {
  const existing = await findRedirectByPath(admin, path);
  if (!existing) return false;

  const data = await runGraphql<{
    urlRedirectDelete: {
      deletedUrlRedirectId: string | null;
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(admin, REDIRECT_DELETE_MUTATION, { id: existing.id });
  assertNoUserErrors(data.urlRedirectDelete.userErrors, "urlRedirectDelete");
  return true;
}
