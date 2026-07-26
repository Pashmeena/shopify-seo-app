/**
 * Minimal structural type for the authenticated Admin GraphQL client that
 * `authenticate.admin(request)` returns. Typed structurally so services
 * stay decoupled from @shopify/shopify-app-remix's generics.
 */
export interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface GraphqlUserError {
  field?: string[] | null;
  message: string;
}

/**
 * Run a query/mutation and return `data`, throwing on transport or GraphQL
 * errors so callers deal in results, not envelopes.
 */
export async function runGraphql<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const payload = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (payload.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${payload.errors.map((e) => e.message).join("; ")}`);
  }
  if (!payload.data) throw new Error("Shopify GraphQL returned no data");
  return payload.data;
}

/** Throw a readable error when a mutation payload carries userErrors. */
export function assertNoUserErrors(
  userErrors: GraphqlUserError[] | undefined,
  context: string,
): void {
  if (userErrors?.length) {
    const details = userErrors
      .map((e) => `${e.field?.join(".") ?? ""}: ${e.message}`)
      .join("; ");
    throw new Error(`${context} failed: ${details}`);
  }
}
