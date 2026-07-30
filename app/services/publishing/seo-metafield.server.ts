import { assertNoUserErrors, runGraphql, type AdminClient } from "../shopify/admin.server";
import type { SeoPayload } from "../seo/types";

/**
 * The bridge between a published PLP and the tags a theme puts in `<head>`.
 *
 * JSON-LD, meta title and meta description can all travel in the article body
 * or in Shopify's own SEO metafields. hreflang cannot: it has to be a `<link>`
 * in the document head, and Shopify does not emit hreflang for blog articles.
 *
 * So the payload the theme needs is written to an article metafield, and the
 * theme app extension in extensions/plp-seo-head reads it. The metafield has
 * to be storefront-readable for Liquid to see it, which means a definition
 * rather than a bare `metafieldsSet`.
 */

export const SEO_HEAD_NAMESPACE = "wp_plp";
export const SEO_HEAD_KEY = "seo";

const METAFIELD_DEFINITION_CREATE = `#graphql
  mutation PlpSeoDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

const METAFIELDS_SET = `#graphql
  mutation PlpSeoHeadSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

/** Exactly what the Liquid block consumes. Kept minimal so the block stays trivial. */
export interface SeoHeadPayload {
  hreflang: { locale: string; url: string }[];
  canonical: string;
  noindex: boolean;
}

export function toSeoHeadPayload(seo: SeoPayload): SeoHeadPayload {
  return {
    // A single variant is only ever the page itself, and a lone self-
    // referencing hreflang says nothing, so it is not worth emitting.
    hreflang: seo.hreflang.length > 1 ? seo.hreflang : [],
    canonical: seo.canonicalUrl,
    noindex: seo.noindex,
  };
}

/**
 * Shops whose definition has been confirmed this process. Best-effort only:
 * losing it costs one redundant mutation, never correctness.
 */
const ensuredShops = new Set<string>();

/**
 * Create the storefront-readable definition for the head payload.
 *
 * Never throws. If the definition cannot be created — an older API version, a
 * permissions difference — the metafield is still written and every other SEO
 * surface still works; only the head tags go missing, which is the same
 * position the app was in before the extension existed.
 */
export async function ensureSeoHeadDefinition(
  admin: AdminClient,
  shop: string,
): Promise<void> {
  if (ensuredShops.has(shop)) return;

  try {
    const data = await runGraphql<{
      metafieldDefinitionCreate: {
        createdDefinition: { id: string } | null;
        userErrors: { field?: string[] | null; message: string; code?: string | null }[];
      };
    }>(admin, METAFIELD_DEFINITION_CREATE, {
      definition: {
        name: "PLP SEO head tags",
        namespace: SEO_HEAD_NAMESPACE,
        key: SEO_HEAD_KEY,
        description:
          "hreflang alternates, canonical and noindex for a generated product listing page. Written by the SEO PLP app and read by its theme extension.",
        type: "json",
        ownerType: "ARTICLE",
        access: { storefront: "PUBLIC_READ" },
      },
    });

    const errors = data.metafieldDefinitionCreate.userErrors;
    // Already defined is the expected outcome on every publish after the first.
    const onlyTaken = errors.every((error) => error.code === "TAKEN");
    if (errors.length > 0 && !onlyTaken) {
      assertNoUserErrors(errors, "metafieldDefinitionCreate(wp_plp.seo)");
    }
    ensuredShops.add(shop);
  } catch (error) {
    console.warn(
      "Could not ensure the wp_plp.seo metafield definition; head tags " +
        "(hreflang) will not render until it exists:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** Write the head payload onto a published article. */
export async function setArticleSeoHead(
  admin: AdminClient,
  articleId: string,
  payload: SeoHeadPayload,
): Promise<void> {
  const data = await runGraphql<{
    metafieldsSet: { userErrors: { field?: string[] | null; message: string }[] };
  }>(admin, METAFIELDS_SET, {
    metafields: [
      {
        ownerId: articleId,
        namespace: SEO_HEAD_NAMESPACE,
        key: SEO_HEAD_KEY,
        type: "json",
        value: JSON.stringify(payload),
      },
    ],
  });
  assertNoUserErrors(data.metafieldsSet.userErrors, "metafieldsSet(wp_plp.seo)");
}
