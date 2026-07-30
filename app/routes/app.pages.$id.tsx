import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
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
import {
  deletePage,
  getPage,
  updatePage,
} from "../services/plp/repository.server";
import { deleteArticle } from "../services/publishing/blog.server";
import {
  PublishBlockedError,
  publishPage,
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

  const [settings, catalog] = await Promise.all([
    getSettings(shop),
    fetchCatalog(admin),
  ]);

  return {
    page,
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
        return { success: `Published to ${page.articleUrl}` };
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
        const productIds = formData.getAll("productIds").map(String);
        await applyProductSelection(shop, pageId, productIds);
        return {
          success: `Product selection saved (${productIds.length} products).`,
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
        const page = await getPage(shop, pageId);
        if (page?.articleId) {
          // Never orphan a live article — remove it from the store first.
          await deleteArticle(admin, page.articleId);
        }
        await deletePage(shop, pageId);
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
  const { page, panel, minProducts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busyAction =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("_action"))
      : null;

  const [selection, setSelection] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      [...panel.matched, ...panel.excluded].map((entry) => [
        entry.id,
        entry.included,
      ]),
    ),
  );
  const selectedIds = Object.entries(selection)
    .filter(([, included]) => included)
    .map(([id]) => id);
  const isPublished = page.status === "published";
  const content = page.content;

  return (
    <Page
      backAction={{ url: "/app" }}
      title={page.title}
      titleMetadata={<StatusBadge status={page.status} />}
      subtitle={`${page.pageTypeId} · ${page.locale} · /${page.slug}`}
      primaryAction={
        <Form method="post">
          <input type="hidden" name="_action" value="publish" />
          <Button
            submit
            variant="primary"
            disabled={page.status === "needs_review"}
            loading={busyAction === "publish"}
          >
            {isPublished ? "Republish" : "Publish as blog article"}
          </Button>
        </Form>
      }
      secondaryActions={
        <InlineStack gap="200">
          <Form method="post">
            <input type="hidden" name="_action" value="regenerate" />
            <Button submit loading={busyAction === "regenerate"}>
              Regenerate content
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="_action" value="delete" />
            <Button submit tone="critical" loading={busyAction === "delete"}>
              Delete
            </Button>
          </Form>
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
        {/* A caveat can be raised on a page that is already live, where it is
            advisory rather than blocking. Without this it would be recorded
            and never shown, since the banner above only covers needs_review. */}
        {isPublished && page.reviewReason && (
          <Banner title="Published, with a caveat" tone="warning">
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
