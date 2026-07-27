import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  FormLayout,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Select,
  Spinner,
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
import { clusterKey } from "../services/seo/similarity.server";
import { getSettings } from "../services/settings/settings.server";
import { authenticate } from "../shopify.server";
import { AiConfigBanner, IntentChips, StatusBadge } from "../components/shared";
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

/** Parse pasted/uploaded keyword lines. Accepts `keyword` or `keyword,locale`. */
function parseKeywordLines(
  raw: string,
  fallbackLocale: string,
  validLocales: Set<string>,
): { phrase: string; locale: string }[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^keyword\s*,/i.test(line))
    .map((line) => {
      const lastComma = line.lastIndexOf(",");
      if (lastComma > 0) {
        const maybeLocale = line.slice(lastComma + 1).trim();
        if (validLocales.has(maybeLocale)) {
          return {
            phrase: line.slice(0, lastComma).trim(),
            locale: maybeLocale,
          };
        }
      }
      return { phrase: line, locale: fallbackLocale };
    })
    .filter((entry) => entry.phrase.length > 1);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("_action"));

  try {
    switch (intent) {
      case "add": {
        const settings = await getSettings(shop);
        const validLocales = new Set(settings.enabledLocaleCodes);
        const fallbackLocale = String(
          formData.get("locale") || settings.defaultLocale,
        );

        const pasted = String(formData.get("keywords") || "");
        const file = formData.get("csv");
        const uploaded =
          file instanceof File && file.size > 0 ? await file.text() : "";

        const entries = parseKeywordLines(
          `${pasted}\n${uploaded}`,
          fallbackLocale,
          validLocales,
        );
        if (entries.length === 0)
          return { error: "No keywords found in the input." };
        // Parsing happens inline (and may call the AI for fuzzy lines), so
        // one submission is capped to keep the request comfortably fast.
        const MAX_BATCH = 50;
        if (entries.length > MAX_BATCH) {
          return {
            error: `That's ${entries.length} keywords — please add at most ${MAX_BATCH} per batch.`,
          };
        }

        // Parse intent immediately so the queue shows structured facets.
        const catalog = await fetchCatalog(admin);
        const lexicon = buildLexicon(catalog);
        const source: KeywordInput["source"] = uploaded ? "csv" : "manual";
        const inputs: KeywordInput[] = [];
        for (const entry of entries) {
          const parsed = await parseIntent(entry.phrase, entry.locale, lexicon);
          const match = matchProducts(catalog, parsed, settings.minProducts);
          inputs.push({
            phrase: entry.phrase,
            locale: entry.locale,
            source,
            status: "suggested",
            intent: parsed,
            pageTypeId: parsed.pageTypeId,
            clusterKey: clusterKey(parsed),
            matchCount: match.matches.length,
          });
        }
        const created = await addKeywords(shop, inputs);
        return {
          success: `Added ${created} keyword(s) (${entries.length - created} already known).`,
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
              "Product selection reset — the automatic match will be used.",
          };
        }
        const productIds = formData.getAll("productIds").map(String);
        await updateKeyword(shop, id, { productOverrides: productIds });
        return {
          success: `Product selection saved (${productIds.length} products) — generation will use it.`,
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
      return { error: `Not generated — ${error.message}` };
    }
    if (error instanceof AiOutputInvalidError) {
      return {
        error:
          "Generation didn't pass the content quality gate: the AI response failed schema validation after 3 attempts, so nothing was created or published. Click Generate PLP to retry — the full technical detail is in the dev server log.",
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

  const busyAction =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("_action"))
      : null;
  const busyKeywordId =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("keywordId"))
      : null;

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
            <p>{actionData.error}</p>
          </Banner>
        )}
        {actionData && "success" in actionData && actionData.success && (
          <Banner tone="success">
            <p>{actionData.success}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Add keywords
            </Text>
            <Form method="post" encType="multipart/form-data">
              <input type="hidden" name="_action" value="add" />
              <input type="hidden" name="locale" value={locale} />
              <FormLayout>
                <TextField
                  label="Keywords (one per line, optionally `keyword,locale`)"
                  value={pasted}
                  onChange={setPasted}
                  name="keywords"
                  multiline={4}
                  autoComplete="off"
                  placeholder={
                    "botanical wallpaper living room\nselbstklebende tapete mietwohnung,de-DE"
                  }
                />
                <InlineStack gap="400" blockAlign="end" wrap>
                  <Select
                    label="Default locale for lines without one"
                    options={locales.map((entry) => ({
                      label: entry.label,
                      value: entry.code,
                    }))}
                    value={locale}
                    onChange={setLocale}
                  />
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" fontWeight="medium">
                      CSV upload (keyword[,locale] per line)
                    </Text>
                    <input
                      type="file"
                      name="csv"
                      accept=".csv,text/csv,text/plain"
                    />
                  </BlockStack>
                  <Button
                    submit
                    variant="primary"
                    loading={busyAction === "add"}
                  >
                    Add & parse intent
                  </Button>
                </InlineStack>
              </FormLayout>
            </Form>
            <InlineStack gap="200" blockAlign="center">
              <Form method="post">
                <input type="hidden" name="_action" value="discover" />
                <Button submit loading={busyAction === "discover"}>
                  Auto-discover from catalog
                </Button>
              </Form>
              <Text as="span" tone="subdued" variant="bodySm">
                Product-first: only facet combinations with ≥ {minProducts}{" "}
                matching products are suggested. Nothing publishes without your
                approval.
              </Text>
            </InlineStack>
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
                          <Tooltip content="Merchant-adjusted selection — generation uses it. Open Preview to change or reset.">
                            <Badge size="small">edited</Badge>
                          </Tooltip>
                        )}
                      </InlineStack>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Tooltip content="No search-volume API connected — see README (pluggable stub).">
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
              ? `Product match — “${preview.phrase}”`
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
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge
                      tone={
                        selectedCount >= preview.minProducts
                          ? "success"
                          : "critical"
                      }
                    >
                      {`${selectedCount} / ${preview.minProducts} min`}
                    </Badge>
                    <Text as="span" tone="subdued" variant="bodySm">
                      Live match against the current catalog — nothing is
                      generated yet. Checked products will be used when you
                      generate this PLP.
                    </Text>
                  </InlineStack>
                  {selectedCount < preview.minProducts && (
                    <Banner tone="warning">
                      <p>
                        Below the minimum of {preview.minProducts} products —
                        the page would be held in “needs review” and never
                        published thin.
                      </p>
                    </Banner>
                  )}
                  <BlockStack gap="200">
                    {preview.candidates.map((candidate) => (
                      <Checkbox
                        key={candidate.id}
                        label={`${candidate.title} · ${candidate.price}${
                          candidate.score > 0
                            ? ` (score ${candidate.score})`
                            : " (added manually)"
                        }`}
                        helpText={Object.entries(candidate.matchedFacets)
                          .map(
                            ([facet, values]) =>
                              `${facet}: ${(values ?? []).join(", ")}`,
                          )
                          .join(" · ")}
                        checked={selection[candidate.id] ?? false}
                        onChange={(checked) =>
                          setSelection((current) => ({
                            ...current,
                            [candidate.id]: checked,
                          }))
                        }
                      />
                    ))}
                  </BlockStack>
                  <Divider />
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      Excluded by matcher ({preview.excludedTotal})
                    </Text>
                    {preview.excluded.map((entry) => (
                      <Box key={entry.title}>
                        <Text as="p" variant="bodySm">
                          <strong>{entry.title}</strong>
                        </Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          {entry.reason}
                        </Text>
                      </Box>
                    ))}
                    {preview.excludedTotal > preview.excluded.length && (
                      <Text as="p" tone="subdued" variant="bodySm">
                        …and {preview.excludedTotal - preview.excluded.length}{" "}
                        more.
                      </Text>
                    )}
                  </BlockStack>
                </BlockStack>
              )}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
