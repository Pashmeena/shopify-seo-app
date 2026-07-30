import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import { useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  Link as PolarisLink,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { fetchCatalog } from "../services/catalog/products.server";
import { buildMatchPanel } from "../services/matching/panel.server";
import {
  applyProductSelection,
  regeneratePage,
} from "../services/plp/pipeline.server";
import { getPage, listPages, updatePage } from "../services/plp/repository.server";
import { PAGE_STATUS } from "../services/plp/status";
import { articlePath } from "../services/seo/urls.server";
import {
  PublishBlockedError,
  publishPage,
  releaseConsolidation,
  retirePage,
} from "../services/publishing/publish.server";
import { getSettings } from "../services/settings/settings.server";
import { authenticate } from "../shopify.server";
import {
  IntentChips,
  JsonView,
  MatchPanelView,
  StatusBadge,
} from "../components/shared";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const page = await getPage(shop, params.id as string);
  if (!page) throw new Response("Page not found", { status: 404 });

  const [settings, catalog, allPages] = await Promise.all([
    getSettings(shop),
    fetchCatalog(admin),
    listPages(shop),
  ]);

  // The consolidation target, named so the banner can explain the decision in
  // terms of a page the merchant recognises rather than an opaque id.
  const canonicalTarget = page.canonicalOfId
    ? (allPages.find((candidate) => candidate.id === page.canonicalOfId) ?? null)
    : null;

  return {
    page,
    canonicalTarget: canonicalTarget && {
      id: canonicalTarget.id,
      title: canonicalTarget.title,
      slug: canonicalTarget.slug,
      status: canonicalTarget.status,
      articleUrl: canonicalTarget.articleUrl,
    },
    redirectPath: articlePath(settings.blogHandle, page.slug),
    // The page's saved selection is authoritative, so the panel reflects
    // exactly what will be published rather than what the matcher would pick
    // today.
    panel: buildMatchPanel({
      shop,
      catalog,
      intent: page.intent,
      minProducts: settings.minProducts,
      selectedIds: page.productIds,
    }),
    minProducts: settings.minProducts,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const pageId = params.id as string;
  const formData = await request.formData();
  const intent = String(formData.get("_action"));

  try {
    switch (intent) {
      case "publish": {
        const page = await publishPage(admin, shop, pageId);
        if (page.status === PAGE_STATUS.CONSOLIDATED) {
          return {
            success:
              `Consolidated. /${page.slug} now serves a 301 redirect to its ` +
              "canonical page, so the two cannot compete for the same queries.",
          };
        }
        return { success: `Published to ${page.articleUrl}` };
      }
      case "release-consolidation": {
        const page = await releaseConsolidation(admin, shop, pageId);
        return {
          success:
            "Consolidation cleared and the redirect removed. " +
            (page.status === PAGE_STATUS.DRAFT
              ? `"${page.title}" is a draft — publish it to put it live as its own page.`
              : `"${page.title}" is still ${page.status.replace("_", " ")}; ` +
                "clearing a consolidation does not resolve anything else it is held for."),
        };
      }
      case "approve": {
        const page = await getPage(shop, pageId);
        const settings = await getSettings(shop);
        if (!page) throw new Error("Page not found");
        if (page.productIds.length < settings.minProducts) {
          return {
            error: `Cannot approve: ${page.productIds.length} products is below the minimum of ${settings.minProducts}. Add products or reject the page. Thin pages are never published.`,
          };
        }
        await updatePage(shop, pageId, { status: "draft", reviewReason: null });
        return {
          success: "Review resolved. The page is now a publishable draft.",
        };
      }
      case "products": {
        // Only real, distinct catalog products count. The form cannot send
        // anything else, but the threshold is decided from this list, so a
        // request that bypassed the form must not be able to clear it with
        // repeats or ids that resolve to nothing at render time.
        const catalog = await fetchCatalog(admin);
        const known = new Set(catalog.map((product) => product.id));
        const distinct = [...new Set(formData.getAll("productIds").map(String))];
        const productIds = distinct.filter((id) => known.has(id));
        // Counted separately: a repeated id and an id that is not in the
        // catalog are different mistakes, and reporting one as the other
        // would be a lie the merchant cannot check.
        const unknown = distinct.length - productIds.length;

        await applyProductSelection(shop, pageId, productIds);
        return {
          success:
            `Product selection saved (${productIds.length} products).` +
            (unknown > 0
              ? ` ${unknown} id${unknown === 1 ? "" : "s"} ignored — not in this catalog.`
              : ""),
        };
      }
      case "regenerate": {
        const page = await regeneratePage(admin, shop, pageId);
        return {
          success:
            page.status === "published"
              ? "Content regenerated, revalidated and republished to the storefront."
              : "Content regenerated and revalidated.",
        };
      }
      case "delete": {
        // Deleting a page has three consequences on the storefront — its own
        // article or redirect, the redirects of any pages consolidated onto
        // it, and the links and hreflang of its published siblings. All three
        // are handled together in retirePage.
        await retirePage(admin, shop, pageId);
        return redirect("/app");
      }
      default:
        return { error: `Unknown action "${intent}"` };
    }
  } catch (error) {
    if (error instanceof PublishBlockedError) return { error: error.message };
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export default function PageDetail() {
  const { page, panel, minProducts, canonicalTarget, redirectPath } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const busyAction =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("_action"))
      : null;
  const submitAction = (action: string) => {
    const formData = new FormData();
    formData.set("_action", action);
    submit(formData, { method: "post" });
  };

  const selectionFromLoader = () =>
    Object.fromEntries(
      [...panel.matched, ...panel.excluded].map((entry) => [
        entry.id,
        entry.included,
      ]),
    );

  const [selection, setSelection] =
    useState<Record<string, boolean>>(selectionFromLoader);

  // Remix reuses this component across navigations, so a `useState`
  // initializer alone would carry one page's checkbox state onto the next, and
  // would not pick up a selection changed by an action. Resetting when the
  // identity of the loaded page changes is the documented way to derive state
  // from props without an effect.
  const [syncedTo, setSyncedTo] = useState(`${page.id}:${page.updatedAt}`);
  const loadedPage = `${page.id}:${page.updatedAt}`;
  if (syncedTo !== loadedPage) {
    setSyncedTo(loadedPage);
    setSelection(selectionFromLoader());
  }

  const selectedIds = Object.entries(selection)
    .filter(([, included]) => included)
    .map(([id]) => id);
  const isPublished = page.status === "published";
  const isConsolidated = page.status === PAGE_STATUS.CONSOLIDATED;
  // A pending consolidation: the decision is recorded but the redirect is not
  // installed until the page is published.
  const willConsolidate = Boolean(page.canonicalOfId) && !isConsolidated;
  const content = page.content;

  return (
    <Page
      backAction={{ url: "/app" }}
      title={page.title}
      titleMetadata={<StatusBadge status={page.status} />}
      subtitle={`${page.pageTypeId} · ${page.locale} · /${page.slug}`}
      primaryAction={
        <Button
          variant="primary"
          disabled={page.status === "needs_review"}
          loading={busyAction === "publish"}
          onClick={() => submitAction("publish")}
        >
          {isConsolidated
            ? "Re-apply redirect"
            : willConsolidate
              ? "Publish as 301 redirect"
              : isPublished
                ? "Republish"
                : "Publish as blog article"}
        </Button>
      }
      secondaryActions={
        <InlineStack gap="200" blockAlign="center">
          <Button
            loading={busyAction === "regenerate"}
            onClick={() => submitAction("regenerate")}
          >
            Regenerate content
          </Button>
          <Button
            tone="critical"
            loading={busyAction === "delete"}
            onClick={() => submitAction("delete")}
          >
            Delete
          </Button>
        </InlineStack>
      }
    >
      <TitleBar title={page.title} />
      <BlockStack gap="400">
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
        {(willConsolidate || isConsolidated) && (
          <Banner
            tone={isConsolidated ? "info" : "warning"}
            title={
              isConsolidated
                ? "Consolidated onto its canonical page"
                : "Will publish as a redirect, not as a page"
            }
          >
            <BlockStack gap="200">
              <p>
                The similarity check found this page to be a near-duplicate of{" "}
                <strong>{canonicalTarget?.title ?? "another page"}</strong> in
                the same market, so{" "}
                <code>{redirectPath}</code>{" "}
                {isConsolidated ? "serves" : "will serve"} a 301 redirect to{" "}
                <code>/{canonicalTarget?.slug}</code> instead of becoming a
                second page competing for the same queries. A 301 consolidates
                link equity onto the canonical page; a canonical tag is not
                available here, because the theme owns it.
              </p>
              {canonicalTarget && canonicalTarget.status !== "published" && (
                <p>
                  <strong>Blocked:</strong> {canonicalTarget.title} is{" "}
                  {canonicalTarget.status}, not published. Publish it first, or
                  the redirect would lead to a page that does not exist.
                </p>
              )}
              {canonicalTarget?.articleUrl && (
                <p>
                  <PolarisLink url={canonicalTarget.articleUrl} target="_blank">
                    View the canonical page
                  </PolarisLink>
                </p>
              )}
              <Form method="post">
                <input
                  type="hidden"
                  name="_action"
                  value="release-consolidation"
                />
                <Button
                  submit
                  size="slim"
                  loading={busyAction === "release-consolidation"}
                >
                  Disagree — publish as its own page
                </Button>
              </Form>
            </BlockStack>
          </Banner>
        )}
        {page.status === "needs_review" && (
          <Banner
            title="Held for review (will not be published)"
            tone="warning"
          >
            <BlockStack gap="200">
              <p>{page.reviewReason}</p>
              <Form method="post">
                <input type="hidden" name="_action" value="approve" />
                <Button submit size="slim" loading={busyAction === "approve"}>
                  {`Resolve review (requires ≥ ${minProducts} products)`}
                </Button>
              </Form>
            </BlockStack>
          </Banner>
        )}
        {/* A caveat can outlive the review that raised it: on a live page, and
            on a draft whose consolidation the merchant overruled, it is
            advisory rather than blocking. needs_review has its own banner
            above, so this covers every other status — without it the reason
            would be recorded and never shown. */}
        {page.status !== "needs_review" && page.reviewReason && (
          <Banner
            title={isPublished ? "Published, with a caveat" : "Noted caveat"}
            tone="warning"
          >
            <p>{page.reviewReason}</p>
          </Banner>
        )}
        {isPublished && page.articleUrl && (
          <Banner tone="success" title="Live on the storefront">
            <p>
              <PolarisLink url={page.articleUrl} target="_blank">
                {page.articleUrl}
              </PolarisLink>
              . Regenerating republishes automatically; a product-selection
              change needs an explicit republish.
            </p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Target intent
                  </Text>
                  <Text as="p" tone="subdued">
                    Keyword: “{page.intent.keyword}” · parsed via{" "}
                    {page.intent.method} · cluster{" "}
                    <code>{page.clusterKey}</code>
                  </Text>
                  <IntentChips facets={page.intent.facets} />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Product match
                  </Text>
                  {isPublished ? (
                    <BlockStack gap="300">
                      <Text as="p" tone="subdued">
                        Published pages are read-only here. Adjust and republish
                        from a draft.
                      </Text>
                      <MatchPanelView
                        panel={panel}
                        selection={selection}
                        onToggle={() => undefined}
                        readOnly
                      />
                    </BlockStack>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="_action" value="products" />
                      {selectedIds.map((id) => (
                        <input
                          key={id}
                          type="hidden"
                          name="productIds"
                          value={id}
                        />
                      ))}
                      <BlockStack gap="300">
                        <MatchPanelView
                          panel={panel}
                          selection={selection}
                          onToggle={(id, checked) =>
                            setSelection((current) => ({
                              ...current,
                              [id]: checked,
                            }))
                          }
                        />
                        <Button
                          submit
                          size="slim"
                          loading={busyAction === "products"}
                        >
                          Save product selection
                        </Button>
                      </BlockStack>
                    </Form>
                  )}
                </BlockStack>
              </Card>

              {content && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Content preview
                    </Text>
                    <Text as="h3" variant="headingLg">
                      {content.h1}
                    </Text>
                    <Text as="p">{content.intro}</Text>
                    <Divider />
                    {content.sections.map((section) => (
                      <BlockStack gap="100" key={section.heading}>
                        <Text as="h4" variant="headingSm">
                          {section.heading}
                        </Text>
                        <Text as="p" tone="subdued">
                          {section.body}
                        </Text>
                      </BlockStack>
                    ))}
                    {/* The page-type-specific blocks. Each exists on exactly
                        one page type, and a block the preview skips is a block
                        the merchant reviews only by reading raw JSON — which is
                        not reviewing it. */}
                    {content.compliance_notes && (
                      <>
                        <Divider />
                        <Text as="h4" variant="headingSm">
                          {content.compliance_notes.heading}
                        </Text>
                        {content.compliance_notes.points.map((point) => (
                          <Text as="p" key={point} tone="subdued">
                            {point}
                          </Text>
                        ))}
                      </>
                    )}
                    {content.suitability_notes && (
                      <>
                        <Divider />
                        <Text as="h4" variant="headingSm">
                          {content.suitability_notes.heading}
                        </Text>
                        {content.suitability_notes.points.map((point) => (
                          <Text as="p" key={point.label} tone="subdued">
                            <strong>{point.label}</strong>: {point.detail}
                          </Text>
                        ))}
                      </>
                    )}
                    {content.buying_guide && (
                      <>
                        <Divider />
                        <Text as="h4" variant="headingSm">
                          {content.buying_guide.heading}
                        </Text>
                        {content.buying_guide.steps.map((step, index) => (
                          <Text as="p" key={step.title} tone="subdued">
                            {index + 1}. <strong>{step.title}</strong>:{" "}
                            {step.body}
                          </Text>
                        ))}
                      </>
                    )}
                    <Divider />
                    <Text as="h4" variant="headingSm">
                      FAQ ({content.faq.length})
                    </Text>
                    {content.faq.map((entry) => (
                      <BlockStack gap="050" key={entry.question}>
                        <Text as="p" fontWeight="semibold">
                          {entry.question}
                        </Text>
                        <Text as="p" tone="subdued">
                          {entry.answer}
                        </Text>
                      </BlockStack>
                    ))}
                  </BlockStack>
                </Card>
              )}

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Structured JSON: generated content
                  </Text>
                  <Text as="p" tone="subdued">
                    The validated AI output exactly as it passed the page type’s
                    output_schema.
                  </Text>
                  <JsonView value={content} />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Structured JSON: SEO payload
                  </Text>
                  <Text as="p" tone="subdued">
                    Meta, canonical, hreflang, internal links and the JSON-LD
                    stack (CollectionPage + ItemList, FAQPage, BreadcrumbList).
                  </Text>
                  <JsonView value={page.seo} />
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {page.seo && (
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      SEO summary
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>Meta title</strong> ({page.seo.metaTitle.length}
                      /60): {page.seo.metaTitle}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>Meta description</strong> (
                      {page.seo.metaDescription.length}
                      /155): {page.seo.metaDescription}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>Canonical:</strong> {page.seo.canonicalUrl}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>Noindex:</strong>{" "}
                      {page.seo.noindex ? "yes (not published)" : "no"}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>hreflang:</strong>{" "}
                      {page.seo.hreflang
                        .map((variant) => variant.locale)
                        .join(", ")}
                    </Text>
                    <Divider />
                    <Text as="h3" variant="headingSm">
                      Internal links ({page.seo.internalLinks.length})
                    </Text>
                    {page.seo.internalLinks.length === 0 && (
                      <Text as="p" tone="subdued" variant="bodySm">
                        Populated from published PLPs with shared intent facets;
                        refreshed on every publish.
                      </Text>
                    )}
                    {page.seo.internalLinks.map((link) => (
                      <Text as="p" variant="bodySm" key={link.slug}>
                        → {link.title}{" "}
                        <Text as="span" tone="subdued">
                          ({link.sharedFacets.join(", ")})
                        </Text>
                      </Text>
                    ))}
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
