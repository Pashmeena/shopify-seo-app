import { assertNoUserErrors, runGraphql, type AdminClient } from "../shopify/admin.server";
import { SEED_PRODUCTS, SEED_TAG, type SeedProduct } from "./seed-data";

const PRODUCT_SET_MUTATION = `#graphql
  mutation SeedProductSet($input: ProductSetInput!) {
    productSet(synchronous: true, input: $input) {
      product { id handle }
      userErrors { field message }
    }
  }
`;

const EXISTING_SEED_PRODUCTS_QUERY = `#graphql
  query ExistingSeedProducts($query: String!) {
    products(first: 250, query: $query) {
      nodes { id handle }
    }
  }
`;

const PUBLICATIONS_QUERY = `#graphql
  query SeedPublications {
    publications(first: 50) {
      nodes { id name }
    }
  }
`;

const PUBLISHABLE_PUBLISH_MUTATION = `#graphql
  mutation SeedPublishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

export interface SeedResult {
  created: number;
  skipped: number;
  failed: { handle: string; error: string }[];
}

/** Deterministic placeholder artwork per product; failures are non-fatal. */
function imageSourceFor(product: SeedProduct): string {
  return `https://picsum.photos/seed/${product.handle}/900/1200.jpg`;
}

function toProductSetInput(product: SeedProduct, withImage: boolean) {
  return {
    title: product.title,
    handle: product.handle,
    descriptionHtml: `<p>${product.description}</p>`,
    vendor: "Wild Palace",
    productType: "Wallpaper",
    status: "ACTIVE",
    tags: [...product.tags, SEED_TAG],
    productOptions: [{ name: "Format", values: [{ name: "Roll" }] }],
    variants: [
      {
        optionValues: [{ optionName: "Format", name: "Roll" }],
        price: product.price,
        inventoryPolicy: "CONTINUE",
      },
    ],
    ...(withImage
      ? {
          files: [
            {
              originalSource: imageSourceFor(product),
              filename: `${product.handle}.jpg`,
              alt: product.title,
              contentType: "IMAGE",
            },
          ],
        }
      : {}),
  };
}

async function createSeedProduct(admin: AdminClient, product: SeedProduct): Promise<string> {
  let productId: string | undefined;
  try {
    const data = await runGraphql<{
      productSet: {
        product: { id: string; handle: string } | null;
        userErrors: { field?: string[] | null; message: string }[];
      };
    }>(admin, PRODUCT_SET_MUTATION, { input: toProductSetInput(product, true) });
    assertNoUserErrors(data.productSet.userErrors, `productSet(${product.handle})`);
    productId = data.productSet.product?.id;
  } catch (imageError) {
    // Placeholder image fetch can fail (external service) — the catalog
    // matters more than the artwork, so retry once without the file.
    const data = await runGraphql<{
      productSet: {
        product: { id: string; handle: string } | null;
        userErrors: { field?: string[] | null; message: string }[];
      };
    }>(admin, PRODUCT_SET_MUTATION, { input: toProductSetInput(product, false) });
    assertNoUserErrors(data.productSet.userErrors, `productSet(${product.handle})`);
    productId = data.productSet.product?.id;
  }
  if (!productId) throw new Error(`productSet(${product.handle}) returned no product id`);
  return productId;
}

async function getOnlineStorePublicationId(admin: AdminClient): Promise<string | null> {
  const data = await runGraphql<{ publications: { nodes: { id: string; name: string }[] } }>(
    admin,
    PUBLICATIONS_QUERY,
  );
  const onlineStore = data.publications.nodes.find((pub) => pub.name === "Online Store");
  return onlineStore?.id ?? null;
}

async function publishToOnlineStore(
  admin: AdminClient,
  productId: string,
  publicationId: string,
): Promise<void> {
  const data = await runGraphql<{
    publishablePublish: {
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(admin, PUBLISHABLE_PUBLISH_MUTATION, {
    id: productId,
    input: [{ publicationId }],
  });
  assertNoUserErrors(data.publishablePublish.userErrors, `publishablePublish(${productId})`);
}

/**
 * Seed the demo catalog. Idempotent: products whose handle already exists
 * with the seed tag are skipped for creation, but they are published to the
 * Online Store on every run so re-seeding also fixes visibility for products
 * created before the publication scope was granted.
 */
export async function seedCatalog(admin: AdminClient): Promise<SeedResult> {
  const publicationId = await getOnlineStorePublicationId(admin);
  if (!publicationId) {
    throw new Error(
      "Could not find the Online Store publication. " +
        "Make sure the app has the read_publications and write_publications scopes and is reinstalled.",
    );
  }

  const existing = await runGraphql<{ products: { nodes: { id: string; handle: string }[] } }>(
    admin,
    EXISTING_SEED_PRODUCTS_QUERY,
    { query: `tag:${SEED_TAG}` },
  );
  const existingByHandle = new Map(existing.products.nodes.map((n) => [n.handle, n.id]));

  const result: SeedResult = { created: 0, skipped: 0, failed: [] };
  for (const product of SEED_PRODUCTS) {
    const existingId = existingByHandle.get(product.handle);
    try {
      if (existingId) {
        await publishToOnlineStore(admin, existingId, publicationId);
        result.skipped++;
      } else {
        const createdId = await createSeedProduct(admin, product);
        await publishToOnlineStore(admin, createdId, publicationId);
        result.created++;
      }
    } catch (error) {
      result.failed.push({
        handle: product.handle,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
