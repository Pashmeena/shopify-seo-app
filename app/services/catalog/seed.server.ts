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

const EXISTING_SEED_HANDLES_QUERY = `#graphql
  query ExistingSeedProducts($query: String!) {
    products(first: 250, query: $query) {
      nodes { handle }
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

async function createSeedProduct(admin: AdminClient, product: SeedProduct): Promise<void> {
  try {
    const data = await runGraphql<{ productSet: { userErrors: { field?: string[] | null; message: string }[] } }>(
      admin,
      PRODUCT_SET_MUTATION,
      { input: toProductSetInput(product, true) },
    );
    assertNoUserErrors(data.productSet.userErrors, `productSet(${product.handle})`);
  } catch (imageError) {
    // Placeholder image fetch can fail (external service) — the catalog
    // matters more than the artwork, so retry once without the file.
    const data = await runGraphql<{ productSet: { userErrors: { field?: string[] | null; message: string }[] } }>(
      admin,
      PRODUCT_SET_MUTATION,
      { input: toProductSetInput(product, false) },
    );
    assertNoUserErrors(data.productSet.userErrors, `productSet(${product.handle})`);
  }
}

/**
 * Seed the demo catalog. Idempotent: products whose handle already exists
 * with the seed tag are skipped, so re-running only fills gaps.
 */
export async function seedCatalog(admin: AdminClient): Promise<SeedResult> {
  const existing = await runGraphql<{ products: { nodes: { handle: string }[] } }>(
    admin,
    EXISTING_SEED_HANDLES_QUERY,
    { query: `tag:${SEED_TAG}` },
  );
  const existingHandles = new Set(existing.products.nodes.map((n) => n.handle));

  const result: SeedResult = { created: 0, skipped: 0, failed: [] };
  for (const product of SEED_PRODUCTS) {
    if (existingHandles.has(product.handle)) {
      result.skipped++;
      continue;
    }
    try {
      await createSeedProduct(admin, product);
      result.created++;
    } catch (error) {
      result.failed.push({
        handle: product.handle,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
