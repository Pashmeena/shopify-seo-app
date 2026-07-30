import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Page,
  Tabs,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getAiStatus } from "../services/ai/provider.server";
import { listPages } from "../services/plp/repository.server";
import { PAGE_STATUS } from "../services/plp/status";
import { getSettings } from "../services/settings/settings.server";
import { authenticate } from "../shopify.server";
import { AiConfigBanner, StatusBadge } from "../components/shared";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [pages, settings] = await Promise.all([listPages(shop), getSettings(shop)]);
  return {
    shop,
    pages: pages.map((page) => ({
      id: page.id,
      title: page.title,
      slug: page.slug,
      locale: page.locale,
      pageTypeId: page.pageTypeId,
      status: page.status,
      productCount: page.productIds.length,
      reviewReason: page.reviewReason,
      articleUrl: page.articleUrl,
      updatedAt: page.updatedAt,
    })),
    minProducts: settings.minProducts,
    catalogSeeded: settings.catalogSeeded,
    ai: getAiStatus(),
  };
};

const STATUS_TABS = [
  { id: "all", content: "All" },
  { id: "draft", content: "Draft" },
  { id: "needs_review", content: "Needs review" },
  { id: "published", content: "Published" },
  // Pages live as a 301 onto their canonical page. Their own tab because they
  // are neither drafts nor competing pages, and a merchant auditing
  // cannibalization wants to see exactly which duplicates were folded away.
  { id: PAGE_STATUS.CONSOLIDATED, content: "Consolidated" },
];

export default function Dashboard() {
  const { pages, minProducts, catalogSeeded, ai } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const statusFilter = searchParams.get("status") ?? "all";
  const selectedTab = Math.max(
    0,
    STATUS_TABS.findIndex((tab) => tab.id === statusFilter),
  );
  const visiblePages =
    statusFilter === "all" ? pages : pages.filter((page) => page.status === statusFilter);

  return (
    <Page>
      <TitleBar title="SEO PLP Dashboard" />
      <BlockStack gap="400">
        <AiConfigBanner ai={ai} />
        {!catalogSeeded && pages.length === 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Get started
              </Text>
              <Text as="p" tone="subdued">
                1. Seed the demo catalog in Settings → 2. Discover or add keywords → 3. Generate,
                review and publish PLPs.
              </Text>
              <InlineStack gap="200">
                <Button url="/app/settings" variant="primary">
                  Go to Settings
                </Button>
                <Button url="/app/keywords">Go to Keywords</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}
        <Card padding="0">
          <Tabs
            tabs={STATUS_TABS}
            selected={selectedTab}
            onSelect={(index) => {
              const next = new URLSearchParams(searchParams);
              if (STATUS_TABS[index].id === "all") next.delete("status");
              else next.set("status", STATUS_TABS[index].id);
              setSearchParams(next, { replace: true });
            }}
          />
          {visiblePages.length === 0 ? (
            <EmptyState
              heading="No PLPs here yet"
              action={{ content: "Manage keywords", url: "/app/keywords" }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Approve a keyword and generate a page to see it listed.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "page", plural: "pages" }}
              itemCount={visiblePages.length}
              selectable={false}
              headings={[
                { title: "Page" },
                { title: "Locale" },
                { title: "Type" },
                { title: "Products" },
                { title: "Status" },
                { title: "Updated" },
              ]}
            >
              {visiblePages.map((page, index) => (
                <IndexTable.Row id={page.id} key={page.id} position={index}>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Link to={`/app/pages/${page.id}`}>
                        <Text as="span" fontWeight="semibold">
                          {page.title}
                        </Text>
                      </Link>
                      <Text as="span" tone="subdued" variant="bodySm">
                        {page.slug}
                      </Text>
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge>{page.locale}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{page.pageTypeId}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" tone={page.productCount < minProducts ? "critical" : undefined}>
                      {page.productCount} / {minProducts} min
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <StatusBadge status={page.status} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>{new Date(page.updatedAt).toLocaleString()}</IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
