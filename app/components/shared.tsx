import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Checkbox,
  InlineStack,
  Tag,
  Text,
  Thumbnail,
} from "@shopify/polaris";

/** Shared presentation pieces for the admin routes. */

function ProductThumb({
  imageUrl,
  title,
}: {
  imageUrl: string | null;
  title: string;
}) {
  return imageUrl ? (
    <Thumbnail source={imageUrl} alt={title} size="small" />
  ) : (
    <Box
      background="bg-surface-secondary"
      borderRadius="100"
      minWidth="40px"
      minHeight="40px"
    />
  );
}

/**
 * A selectable product row: thumbnail, title and one subdued context line.
 * Used wherever the merchant includes/excludes products from a PLP.
 */
export function ProductChoiceRow({
  candidate,
  secondary,
  checked,
  onToggle,
}: {
  candidate: { id: string; title: string; imageUrl: string | null };
  secondary: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      label={
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <ProductThumb imageUrl={candidate.imageUrl} title={candidate.title} />
          <BlockStack gap="025">
            <Text as="span" fontWeight="medium">
              {candidate.title}
            </Text>
            <Text as="span" tone="subdued" variant="bodySm">
              {secondary}
            </Text>
          </BlockStack>
        </InlineStack>
      }
      checked={checked}
      onChange={onToggle}
    />
  );
}

/** A non-selectable product row with the matcher's exclusion reason. */
export function ExcludedProductRow({
  title,
  reason,
  imageUrl,
}: {
  title: string;
  reason: string;
  imageUrl: string | null;
}) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <ProductThumb imageUrl={imageUrl} title={title} />
      <BlockStack gap="025">
        <Text as="span" variant="bodySm" fontWeight="medium">
          {title}
        </Text>
        <Text as="span" tone="subdued" variant="bodySm">
          {reason}
        </Text>
      </BlockStack>
    </InlineStack>
  );
}

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "published":
      return <Badge tone="success">Published</Badge>;
    case "needs_review":
      return <Badge tone="attention">Needs review</Badge>;
    case "draft":
      return <Badge tone="info">Draft</Badge>;
    case "approved":
      return <Badge tone="info">Approved</Badge>;
    case "suggested":
      return <Badge>Suggested</Badge>;
    case "rejected":
      return <Badge tone="critical">Rejected</Badge>;
    case "generated":
      return <Badge tone="success">Generated</Badge>;
    case "failed":
      return <Badge tone="critical">Failed</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

export function AiConfigBanner({
  ai,
}: {
  ai: { provider: string; model: string | null; configured: boolean };
}) {
  if (ai.configured) return null;
  return (
    <Banner title="AI provider not configured" tone="warning">
      <p>
        Set <code>AI_PROVIDER</code> and <code>AI_API_KEY</code> in{" "}
        <code>.env</code> (see <code>.env.example</code>) and restart the dev
        server. Keyword parsing falls back to rules without it, but content
        generation requires it.
      </p>
    </Banner>
  );
}

/** Facet chips for a parsed intent, e.g. `style: botanical`. */
export function IntentChips({
  facets,
}: {
  facets: Partial<Record<string, string[]>>;
}) {
  const entries = Object.entries(facets).filter(([, values]) => values?.length);
  if (entries.length === 0) {
    return (
      <Text as="span" tone="subdued">
        no facets parsed
      </Text>
    );
  }
  return (
    <InlineStack gap="100" wrap>
      {entries.flatMap(([facet, values]) =>
        (values ?? []).map((value) => (
          <Tag key={`${facet}:${value}`}>{`${facet}: ${value}`}</Tag>
        )),
      )}
    </InlineStack>
  );
}

/** Monospace, scrollable raw-JSON view — the structured output, unrendered. */
export function JsonView({ value }: { value: unknown }) {
  return (
    <Box
      background="bg-surface-secondary"
      padding="300"
      borderRadius="200"
      overflowX="scroll"
      maxWidth="100%"
    >
      <pre
        style={{
          margin: 0,
          fontSize: "12px",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </Box>
  );
}
