import { useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Checkbox,
  Divider,
  InlineStack,
  Link,
  List,
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
  disabled = false,
}: {
  candidate: {
    id: string;
    title: string;
    imageUrl: string | null;
    url: string;
  };
  secondary: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <InlineStack
      gap="200"
      blockAlign="center"
      align="space-between"
      wrap={false}
    >
      <Checkbox
        label={
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <ProductThumb
              imageUrl={candidate.imageUrl}
              title={candidate.title}
            />
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
        disabled={disabled}
      />
      <Link url={candidate.url} target="_blank" removeUnderline>
        View
      </Link>
    </InlineStack>
  );
}

/** How many rejected products to show before collapsing the rest. */
const EXCLUDED_PREVIEW_COUNT = 8;

/**
 * The product-match panel: what the matcher accepted, what it rejected and
 * why, with both lists selectable so a merchant can overrule either way.
 *
 * Shared by the pre-generation preview and the page detail screen, which ask
 * the same question at two points in the pipeline.
 */
export function MatchPanelView({
  panel,
  selection,
  onToggle,
  readOnly = false,
}: {
  panel: {
    minProducts: number;
    matched: PanelProduct[];
    excluded: PanelProduct[];
  };
  selection: Record<string, boolean>;
  onToggle: (id: string, checked: boolean) => void;
  readOnly?: boolean;
}) {
  const [showAllExcluded, setShowAllExcluded] = useState(false);
  const selectedCount = Object.values(selection).filter(Boolean).length;
  const addedAnyway = panel.excluded.filter((entry) => selection[entry.id]);
  const visibleExcluded = showAllExcluded
    ? panel.excluded
    : panel.excluded.slice(0, EXCLUDED_PREVIEW_COUNT);

  return (
    <BlockStack gap="400">
      <InlineStack gap="200" blockAlign="center">
        <Badge
          tone={selectedCount >= panel.minProducts ? "success" : "critical"}
        >
          {`${selectedCount} / ${panel.minProducts} min`}
        </Badge>
        <Text as="span" tone="subdued" variant="bodySm">
          Checked products are the ones this page will contain.
        </Text>
      </InlineStack>

      {selectedCount < panel.minProducts && (
        <Banner tone="warning">
          <p>
            Below the minimum of {panel.minProducts} products. The page is held
            in “needs review” and cannot be published while it is thin.
          </p>
        </Banner>
      )}

      {addedAnyway.length > 0 && (
        <Banner tone="warning" title="Included against the matcher's judgement">
          <List type="bullet">
            {addedAnyway.map((entry) => (
              <List.Item key={entry.id}>
                {entry.title} — {entry.excludedReason}
              </List.Item>
            ))}
          </List>
        </Banner>
      )}

      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Matched by the app ({panel.matched.length}), strongest first
        </Text>
        {panel.matched.length === 0 && (
          <Text as="p" tone="subdued" variant="bodySm">
            Nothing matched this intent. Anything below can still be added by
            hand.
          </Text>
        )}
        {panel.matched.map((entry) => (
          <PanelRow
            key={entry.id}
            entry={entry}
            checked={selection[entry.id] ?? false}
            onToggle={onToggle}
            readOnly={readOnly}
          />
        ))}
      </BlockStack>

      <Divider />

      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h3" variant="headingSm">
            Not matched ({panel.excluded.length})
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Accuracy over volume: each product below failed a facet the keyword
            asked for. Tick one to include it anyway.
          </Text>
        </BlockStack>
        {visibleExcluded.map((entry) => (
          <PanelRow
            key={entry.id}
            entry={entry}
            checked={selection[entry.id] ?? false}
            onToggle={onToggle}
            readOnly={readOnly}
          />
        ))}
        {panel.excluded.length > EXCLUDED_PREVIEW_COUNT && (
          <Button
            variant="plain"
            onClick={() => setShowAllExcluded((current) => !current)}
          >
            {showAllExcluded
              ? "Show fewer"
              : `Show all ${panel.excluded.length}`}
          </Button>
        )}
      </BlockStack>
    </BlockStack>
  );
}

export interface PanelProduct {
  id: string;
  title: string;
  price: string;
  imageUrl: string | null;
  url: string;
  score: number;
  matchedFacets: Partial<Record<string, string[]>>;
  inferredFacets: string[];
  excludedReason: string | null;
  included: boolean;
}

/** One row of the match panel, with the evidence for or against it. */
function PanelRow({
  entry,
  checked,
  onToggle,
  readOnly,
}: {
  entry: PanelProduct;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
  readOnly: boolean;
}) {
  const secondary = entry.excludedReason
    ? `${entry.price} · ${entry.excludedReason}`
    : [
        entry.price,
        `match score ${entry.score}`,
        entry.inferredFacets.length
          ? `inferred from product text: ${entry.inferredFacets.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <ProductChoiceRow
      candidate={entry}
      secondary={secondary}
      checked={checked}
      onToggle={(next) => onToggle(entry.id, next)}
      disabled={readOnly}
    />
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

/**
 * Downloads a string as a file. A blob URL keeps this entirely client-side:
 * embedded apps run in an iframe where a plain link to a server route would
 * have to re-authenticate, and the content is static anyway.
 */
export function DownloadTextButton({
  filename,
  content,
  contentType = "text/csv;charset=utf-8",
  children,
}: {
  filename: string;
  content: string;
  contentType?: string;
  /** Polaris buttons take text, not arbitrary nodes. */
  children: string;
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([content], { type: contentType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Button variant="plain" onClick={download}>
      {children}
    </Button>
  );
}

/**
 * Notes and warnings attached to an action result — how an import was read,
 * and which rows it could not use. Rendered as lists so a long tail of
 * skipped rows stays scannable.
 */
export function ActionDetails({
  notes,
  warnings,
}: {
  notes?: string[];
  warnings?: string[];
}) {
  if (!notes?.length && !warnings?.length) return null;
  return (
    <BlockStack gap="200">
      {notes && notes.length > 0 && (
        <List type="bullet">
          {notes.map((note) => (
            <List.Item key={note}>{note}</List.Item>
          ))}
        </List>
      )}
      {warnings && warnings.length > 0 && (
        <BlockStack gap="100">
          <Text as="p" fontWeight="semibold">
            Skipped rows
          </Text>
          <List type="bullet">
            {warnings.map((warning) => (
              <List.Item key={warning}>{warning}</List.Item>
            ))}
          </List>
        </BlockStack>
      )}
    </BlockStack>
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
