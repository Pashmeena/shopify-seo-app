import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  SerializeFrom,
} from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  FormLayout,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Select,
  Spinner,
  Tag,
  Text,
  TextField,
  Tooltip,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { listLocales } from "../config/index.server";
import { AiOutputInvalidError } from "../services/ai/json-client.server";
import { getAiStatus } from "../services/ai/provider.server";
import { fetchCatalog } from "../services/catalog/products.server";
import { discoverKeywords } from "../services/discovery/discover.server";
import { buildLexicon } from "../services/intent/lexicon.server";
import { parseIntent } from "../services/intent/parse.server";
import { matchProducts } from "../services/matching/match.server";
import {
  addKeywords,
  listKeywords,
  updateKeyword,
  type KeywordInput,
} from "../services/plp/repository.server";
import {
  generatePageForKeyword,
  PipelineRejection,
} from "../services/plp/pipeline.server";
import {
  describeSkipped,
  describeSource,
  importKeywordSources,
  MAX_IMPORT_BATCH,
} from "../services/ingest/keyword-import.server";
import {
  KEYWORD_TEMPLATE_CSV,
  KEYWORD_TEMPLATE_FILENAME,
} from "../services/ingest/template";
import { clusterKey } from "../services/seo/similarity.server";
import { getSettings } from "../services/settings/settings.server";
import { authenticate } from "../shopify.server";
import {
  ActionDetails,
  AiConfigBanner,
  DownloadTextButton,
  ExcludedProductRow,
  IntentChips,
  ProductChoiceRow,
  StatusBadge,
} from "../components/shared";
import type { loader as previewLoader } from "./app.keywords.$id.preview";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const [keywords, settings, catalog] = await Promise.all([
    listKeywords(shop),
    getSettings(shop),
    fetchCatalog(admin),
  ]);

  // Match counts are recomputed live against the current catalog on every
  // view — the stored count is a snapshot that drifts as products change.
  // Early counts are advisory (merchant decisions); generation re-matches
  // authoritatively. Drifted stored values are healed in place.
  const freshKeywords = await Promise.all(
    keywords.map(async (keyword) => {
      if (!keyword.intent) return keyword;
      const count = matchProducts(catalog, keyword.intent, settings.minProducts)
        .matches.length;
      if (count !== keyword.matchCount) {
        await updateKeyword(shop, keyword.id, { matchCount: count });
      }
      return { ...keyword, matchCount: count };
    }),
  );

  const locales = listLocales().filter((locale) =>
    settings.enabledLocaleCodes.includes(locale.code),
  );
  return {
    keywords: freshKeywords,
    locales: locales.map((locale) => ({
      code: locale.code,
      label: locale.label,
    })),
    defaultLocale: settings.defaultLocale,
    minProducts: settings.minProducts,
    ai: getAiStatus(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("_action"));

  try {
    switch (intent) {
      case "add": {
        const settings = await getSettings(shop);
        const requestedLocale = String(formData.get("locale") || "");
        // The select only offers enabled locales, but a crafted post must
        // not be able to smuggle in a disabled or unknown market.
        const fallbackLocale = settings.enabledLocaleCodes.includes(
          requestedLocale,
        )
          ? requestedLocale
          : settings.defaultLocale;

        const pasted = String(formData.get("keywords") || "");
        const file = formData.get("csv");
        const uploaded =
          file instanceof File && file.size > 0 ? await file.text() : "";

        const report = await importKeywordSources(
          [
            { raw: pasted, source: "manual" },
            { raw: uploaded, source: "csv" },
          ],
          {
            enabledLocales: settings.enabledLocaleCodes,
            fallbackLocale,
          },
        );

        const notes = report.sources
          .map(describeSource)
          .filter((note): note is string => note !== null);
        const warnings = describeSkipped(report.skipped);

        if (report.entries.length === 0) {
          return {
            error: report.skipped.length
              ? "No usable keywords found in the input."
              : "No keywords found in the input.",
            notes,
            warnings,
          };
        }
        if (report.entries.length > MAX_IMPORT_BATCH) {
          return {
            error: `That's ${report.entries.length} keywords. Please add at most ${MAX_IMPORT_BATCH} per batch.`,
            notes,
          };
        }

        // Parse intent immediately so the queue shows structured facets.
        const catalog = await fetchCatalog(admin);
        const lexicon = buildLexicon(catalog);
        const inputs: KeywordInput[] = [];
        for (const entry of report.entries) {
          const parsed = await parseIntent(entry.phrase, entry.locale, lexicon);
          const match = matchProducts(catalog, parsed, settings.minProducts);
          inputs.push({
            phrase: entry.phrase,
            locale: entry.locale,
            source: entry.source,
            status: "suggested",
            intent: parsed,
            pageTypeId: parsed.pageTypeId,
            clusterKey: clusterKey(parsed),
            matchCount: match.matches.length,
          });
        }
        const created = await addKeywords(shop, inputs);
        const alreadyKnown = report.entries.length - created;
        return {
          success:
            `Added ${created} keyword(s)` +
            (alreadyKnown > 0 ? ` (${alreadyKnown} already known).` : "."),
          notes,
          warnings,
        };
      }
      case "discover": {
        const result = await discoverKeywords(admin, shop);
        return {
          success: `Discovery scanned ${result.scanned} facet combinations and queued ${result.suggested} suggestion(s); ${result.skippedExisting} already covered.`,
        };
      }
      case "approve":
      case "reject": {
        const id = String(formData.get("keywordId"));
        await updateKeyword(shop, id, {
          status: intent === "approve" ? "approved" : "rejected",
        });
        return {
          success:
            intent === "approve" ? "Keyword approved." : "Keyword rejected.",
        };
      }
      case "selection": {
        const id = String(formData.get("keywordId"));
        if (formData.get("reset")) {
          await updateKeyword(shop, id, { productOverrides: null });
          return {
            success:
              "Product selection reset. The automatic match will be used.",
          };
        }
        const productIds = formData.getAll("productIds").map(String);
        await updateKeyword(shop, id, { productOverrides: productIds });
        return {
          success: `Product selection saved (${productIds.length} products). Generation will use it.`,
        };
      }
      case "generate": {
        const id = String(formData.get("keywordId"));
        const outcome = await generatePageForKeyword(admin, shop, id);
        return redirect(`/app/pages/${outcome.page.id}`);
      }
      default:
        return { error: `Unknown action "${intent}"` };
    }
  } catch (error) {
    if (error instanceof PipelineRejection) {
      return { error: `Not generated: ${error.message}` };
    }
    if (error instanceof AiOutputInvalidError) {
      return {
        error:
          "Generation didn't pass the content quality gate: the AI response failed schema validation after 3 attempts, so nothing was created or published. Click Generate PLP to retry. The full technical detail is in the dev server log.",
      };
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export default function Keywords() {
  const { keywords, locales, defaultLocale, minProducts, ai } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const [pasted, setPasted] = useState("");
  const [locale, setLocale] = useState(defaultLocale);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvName, setCsvName] = useState<string | null>(null);

  // A successful import clears the input so the next batch starts clean.
  useEffect(() => {
    if (
      actionData &&
      "success" in actionData &&
      actionData.success?.startsWith("Added")
    ) {
      setPasted("");
      setCsvName(null);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  }, [actionData]);

  const busyAction =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("_action"))
      : null;
  const busyKeywordId =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("keywordId"))
      : null;

  // Import diagnostics: how each input was read, and every row skipped.
  const notes =
    actionData && "notes" in actionData ? (actionData.notes ?? []) : [];
  const warnings =
    actionData && "warnings" in actionData ? (actionData.warnings ?? []) : [];

  // ── Product match preview (pre-generation) ────────────────────────────
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const previewFetcher = useFetcher<typeof previewLoader>();
  const saveFetcher = useFetcher<{ success?: string; error?: string }>();
  const preview = previewFetcher.data;
  const selectedCount = Object.values(selection).filter(Boolean).length;

  const openPreview = (keywordId: string) => {
    setPreviewId(keywordId);
    setSelection({});
    previewFetcher.load(`/app/keywords/${keywordId}/preview`);
  };

  useEffect(() => {
    if (preview && "candidates" in preview) {
      setSelection(
        Object.fromEntries(
          preview.candidates.map((candidate) => [
            candidate.id,
            candidate.included,
          ]),
        ),
      );
    }
  }, [preview]);

  useEffect(() => {
    if (saveFetcher.state === "idle" && saveFetcher.data?.success) {
      setPreviewId(null);
    }
  }, [saveFetcher.state, saveFetcher.data]);

  const submitSelection = (reset: boolean) => {
    if (!previewId) return;
    const formData = new FormData();
    formData.set("_action", "selection");
    formData.set("keywordId", previewId);
    if (reset) {
      formData.set("reset", "1");
    } else {
      for (const [id, included] of Object.entries(selection)) {
        if (included) formData.append("productIds", id);
      }
    }
    saveFetcher.submit(formData, { method: "post" });
  };

  return (
    <Page>
      <TitleBar title="Keyword manager" />
      <BlockStack gap="400">
        <AiConfigBanner ai={ai} />
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title="Action failed">
            <BlockStack gap="200">
              <p>{actionData.error}</p>
              <ActionDetails notes={notes} warnings={warnings} />
            </BlockStack>
          </Banner>
        )}
        {actionData && "success" in actionData && actionData.success && (
          <Banner tone={warnings.length > 0 ? "warning" : "success"}>
            <BlockStack gap="200">
              <p>{actionData.success}</p>
              <ActionDetails notes={notes} warnings={warnings} />
            </BlockStack>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Add keywords
            </Text>

            <InlineStack gap="300" blockAlign="center" wrap>
              <Form method="post">
                <input type="hidden" name="_action" value="discover" />
                <Button
                  submit
                  size="large"
                  variant="primary"
                  loading={busyAction === "discover"}
                >
                  Auto-discover from catalog
                </Button>
              </Form>
              <Text as="span" tone="subdued" variant="bodySm">
                Scans tags, collections and titles, then suggests only
                combinations with ≥ {minProducts} matching products. Nothing
                publishes without your approval.
              </Text>
            </InlineStack>

            <Divider />

            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Or add your own
              </Text>
              <Form method="post" encType="multipart/form-data">
                <input type="hidden" name="_action" value="add" />
                <input type="hidden" name="locale" value={locale} />
                <input
                  ref={csvInputRef}
                  type="file"
                  name="csv"
                  accept=".csv,text/csv,text/plain"
                  hidden
                  onChange={(event) =>
                    setCsvName(event.currentTarget.files?.[0]?.name ?? null)
                  }
                />
                <FormLayout>
                  <TextField
                    label="Keywords"
                    labelAction={{
                      content: "Upload CSV",
                      onAction: () => csvInputRef.current?.click(),
                    }}
                    value={pasted}
                    onChange={setPasted}
                    name="keywords"
                    multiline={4}
                    autoComplete="off"
                    placeholder={
                      "botanical wallpaper living room\nselbstklebende tapete mietwohnung,de-DE"
                    }
                    helpText="One keyword per line, optionally `keyword,locale` to target a market. Uploaded files can be any keyword-tool export: extra columns are ignored, comma/semicolon/tab separators and quoted fields are handled, and the keyword column is found by name (or by AI when the header is unfamiliar)."
                  />
                  <InlineStack gap="200" blockAlign="center">
                    <DownloadTextButton
                      filename={KEYWORD_TEMPLATE_FILENAME}
                      content={KEYWORD_TEMPLATE_CSV}
                    >
                      Download CSV template
                    </DownloadTextButton>
                    <Text as="span" tone="subdued" variant="bodySm">
                      the canonical format, though your own export will work
                    </Text>
                  </InlineStack>
                  {csvName && (
                    <InlineStack gap="200" blockAlign="center">
                      <Tag
                        onRemove={() => {
                          if (csvInputRef.current)
                            csvInputRef.current.value = "";
                          setCsvName(null);
                        }}
                      >
                        {csvName}
                      </Tag>
                      <Text as="span" tone="subdued" variant="bodySm">
                        imported together with the pasted lines
                      </Text>
                    </InlineStack>
                  )}
                  <InlineStack gap="300" blockAlign="end" wrap>
                    <Select
                      label="Locale for lines without one"
                      options={locales.map((entry) => ({
                        label: entry.label,
                        value: entry.code,
                      }))}
                      value={locale}
                      onChange={setLocale}
                    />
                    <Button
                      submit
                      size="large"
                      variant="primary"
                      loading={busyAction === "add"}
                    >
                      Add & parse intent
                    </Button>
                  </InlineStack>
                </FormLayout>
              </Form>
            </BlockStack>
          </BlockStack>
        </Card>

        <Card padding="0">
          <IndexTable
            resourceName={{ singular: "keyword", plural: "keywords" }}
            itemCount={keywords.length}
            selectable={false}
            headings={[
              { title: "Keyword" },
              { title: "Parsed intent" },
              { title: "Type" },
              { title: "Matches" },
              { title: "Volume" },
              { title: "Status" },
              { title: "Actions" },
            ]}
          >
            {keywords.map((keyword, index) => {
              const effective =
                keyword.productOverrides?.length ?? keyword.matchCount;
              return (
                <IndexTable.Row
                  id={keyword.id}
                  key={keyword.id}
                  position={index}
                >
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text as="span" fontWeight="semibold">
                        {keyword.phrase}
                      </Text>
                      <InlineStack gap="100">
                        <Badge size="small">{keyword.locale}</Badge>
                        <Badge size="small" tone="info">
                          {keyword.source}
                        </Badge>
                      </InlineStack>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <IntentChips facets={keyword.intent?.facets ?? {}} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>{keyword.pageTypeId ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {effective == null ? (
                      "—"
                    ) : (
                      <InlineStack gap="100" blockAlign="center">
                        <Text
                          as="span"
                          tone={
                            effective < minProducts ? "critical" : "success"
                          }
                        >
                          {effective}
                        </Text>
                        {keyword.productOverrides != null && (
                          <Tooltip content="Merchant-adjusted selection. Generation uses it. Open Preview to change or reset.">
                            <Badge size="small">edited</Badge>
                          </Tooltip>
                        )}
                      </InlineStack>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Tooltip content="No search-volume API connected. See README (pluggable stub).">
                      <Text as="span" tone="subdued">
                        {keyword.volume ?? "—"}
                      </Text>
                    </Tooltip>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <StatusBadge status={keyword.status} />
                      {keyword.error && (
                        <Text as="span" tone="critical" variant="bodySm">
                          {keyword.error}
                        </Text>
                      )}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="100">
                      {keyword.status !== "generated" && keyword.intent && (
                        <Button
                          size="micro"
                          onClick={() => openPreview(keyword.id)}
                        >
                          Preview
                        </Button>
                      )}
                      {(keyword.status === "suggested" ||
                        keyword.status === "rejected") && (
                        <Form method="post">
                          <input type="hidden" name="_action" value="approve" />
                          <input
                            type="hidden"
                            name="keywordId"
                            value={keyword.id}
                          />
                          <Button
                            submit
                            size="micro"
                            loading={
                              busyAction === "approve" &&
                              busyKeywordId === keyword.id
                            }
                          >
                            Approve
                          </Button>
                        </Form>
                      )}
                      {(keyword.status === "suggested" ||
                        keyword.status === "approved") && (
                        <Form method="post">
                          <input type="hidden" name="_action" value="reject" />
                          <input
                            type="hidden"
                            name="keywordId"
                            value={keyword.id}
                          />
                          <Button
                            submit
                            size="micro"
                            tone="critical"
                            loading={
                              busyAction === "reject" &&
                              busyKeywordId === keyword.id
                            }
                          >
                            Reject
                          </Button>
                        </Form>
                      )}
                      {(keyword.status === "approved" ||
                        keyword.status === "failed") && (
                        <Form method="post">
                          <input
                            type="hidden"
                            name="_action"
                            value="generate"
                          />
                          <input
                            type="hidden"
                            name="keywordId"
                            value={keyword.id}
                          />
                          <Button
                            submit
                            size="micro"
                            variant="primary"
                            loading={
                              busyAction === "generate" &&
                              busyKeywordId === keyword.id
                            }
                          >
                            Generate PLP
                          </Button>
                        </Form>
                      )}
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>
        </Card>

        <Modal
          open={previewId != null}
          onClose={() => setPreviewId(null)}
          title={
            preview && "phrase" in preview
              ? `Product match: “${preview.phrase}”`
              : "Product match preview"
          }
          primaryAction={{
            content: `Save selection (${selectedCount})`,
            onAction: () => submitSelection(false),
            disabled: selectedCount === 0 || previewFetcher.state !== "idle",
            loading: saveFetcher.state !== "idle",
          }}
          secondaryActions={[
            {
              content: "Reset to automatic match",
              onAction: () => submitSelection(true),
              disabled: !(
                preview &&
                "overridden" in preview &&
                preview.overridden
              ),
            },
          ]}
        >
          <Modal.Section>
            {saveFetcher.state === "idle" && saveFetcher.data?.error && (
              <Banner tone="critical" title="Could not save selection">
                <p>{saveFetcher.data.error}</p>
              </Banner>
            )}
            {previewFetcher.state === "loading" && (
              <InlineStack gap="200" blockAlign="center">
                <Spinner
                  size="small"
                  accessibilityLabel="Loading product matches"
                />
                <Text as="span" tone="subdued">
                  Matching the current catalog…
                </Text>
              </InlineStack>
            )}
            {preview &&
              "candidates" in preview &&
              previewFetcher.state === "idle" && (
                <MatchPreviewBody
                  preview={preview}
                  selection={selection}
                  selectedCount={selectedCount}
                  onToggle={(id, checked) =>
                    setSelection((current) => ({ ...current, [id]: checked }))
                  }
                />
              )}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

type PreviewData = SerializeFrom<typeof previewLoader>;

/**
 * The preview modal's body. Facet values shared by every matched product
 * are already stated by the intent chips at the top — per-row text only
 * carries what distinguishes a product (price, strength, extra facets).
 */
const EXCLUDED_PREVIEW_COUNT = 8;

function MatchPreviewBody({
  preview,
  selection,
  selectedCount,
  onToggle,
}: {
  preview: PreviewData;
  selection: Record<string, boolean>;
  selectedCount: number;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const [showAllExcluded, setShowAllExcluded] = useState(false);
  const matched = preview.candidates.filter((candidate) => candidate.score > 0);
  const manual = preview.candidates.filter(
    (candidate) => candidate.score === 0,
  );

  const pairCounts = new Map<string, number>();
  for (const candidate of matched) {
    for (const [facet, values] of Object.entries(candidate.matchedFacets)) {
      for (const value of values ?? []) {
        const key = `${facet}: ${value}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const distinguishing = (candidate: PreviewData["candidates"][number]) =>
    Object.entries(candidate.matchedFacets)
      .flatMap(([facet, values]) =>
        (values ?? []).map((value) => `${facet}: ${value}`),
      )
      .filter((key) => pairCounts.get(key) !== matched.length);

  return (
    <BlockStack gap="400">
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center" wrap>
          <Text as="span" tone="subdued" variant="bodySm">
            Matching against
          </Text>
          <IntentChips facets={preview.facets} />
        </InlineStack>
        <InlineStack gap="200" blockAlign="center">
          <Badge
            tone={selectedCount >= preview.minProducts ? "success" : "critical"}
          >
            {`${selectedCount} / ${preview.minProducts} min`}
          </Badge>
          <Text as="span" tone="subdued" variant="bodySm">
            Live against the current catalog. Nothing is generated yet. Checked
            products are used when you generate this PLP.
          </Text>
        </InlineStack>
      </BlockStack>
      {selectedCount < preview.minProducts && (
        <Banner tone="warning">
          <p>
            Below the minimum of {preview.minProducts} products. The page would
            be held in “needs review” and never published thin.
          </p>
        </Banner>
      )}
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Matched products ({matched.length}), strongest first
        </Text>
        {matched.map((candidate) => {
          const extras = distinguishing(candidate);
          return (
            <ProductChoiceRow
              key={candidate.id}
              candidate={candidate}
              secondary={[
                candidate.price,
                `match score ${candidate.score}`,
                extras.length ? `also ${extras.join(", ")}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              checked={selection[candidate.id] ?? false}
              onToggle={(checked) => onToggle(candidate.id, checked)}
            />
          );
        })}
      </BlockStack>
      {manual.length > 0 && (
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            Added manually ({manual.length})
          </Text>
          {manual.map((candidate) => (
            <ProductChoiceRow
              key={candidate.id}
              candidate={candidate}
              secondary={`${candidate.price} · outside the automatic match`}
              checked={selection[candidate.id] ?? false}
              onToggle={(checked) => onToggle(candidate.id, checked)}
            />
          ))}
        </BlockStack>
      )}
      <Divider />
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Excluded by the matcher ({preview.excludedTotal})
        </Text>
        {(showAllExcluded
          ? preview.excluded
          : preview.excluded.slice(0, EXCLUDED_PREVIEW_COUNT)
        ).map((entry) => (
          <ExcludedProductRow
            key={entry.title}
            title={entry.title}
            reason={entry.reason}
            imageUrl={entry.imageUrl}
            url={entry.url}
          />
        ))}
        {preview.excluded.length > EXCLUDED_PREVIEW_COUNT && (
          <Button
            variant="plain"
            onClick={() => setShowAllExcluded((current) => !current)}
          >
            {showAllExcluded
              ? "Show fewer"
              : `Show all ${preview.excludedTotal}`}
          </Button>
        )}
      </BlockStack>
    </BlockStack>
  );
}
