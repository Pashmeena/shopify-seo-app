import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  ChoiceList,
  Divider,
  FormLayout,
  InlineStack,
  Layout,
  Link as PolarisLink,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { listLocales } from "../config/index.server";
import { slugify } from "../lib/slugify";
import { getAiStatus } from "../services/ai/provider.server";
import { seedCatalog } from "../services/catalog/seed.server";
import {
  getSettings,
  updateSettings,
} from "../services/settings/settings.server";
import { authenticate } from "../shopify.server";
import { AiConfigBanner } from "../components/shared";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return {
    shop: session.shop,
    settings,
    locales: listLocales().map((locale) => ({
      code: locale.code,
      label: locale.label,
    })),
    ai: getAiStatus(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("_action"));

  try {
    if (intent === "seed") {
      const result = await seedCatalog(admin);
      if (result.created > 0 || result.skipped > 0) {
        await updateSettings(shop, { catalogSeeded: true });
      }
      const failures = result.failed
        .map((f) => `${f.handle}: ${f.error}`)
        .join("; ");
      return {
        success: `Seed complete: ${result.created} created, ${result.skipped} already present${
          result.failed.length
            ? `, ${result.failed.length} failed (${failures})`
            : ""
        }.`,
      };
    }

    if (intent === "save") {
      const enabledLocaleCodes = formData.getAll("enabledLocales").map(String);
      const defaultLocale = String(formData.get("defaultLocale"));
      if (!enabledLocaleCodes.includes(defaultLocale)) {
        return {
          error: "The default locale must be one of the enabled locales.",
        };
      }
      const minProducts = Number(formData.get("minProducts"));
      if (!Number.isInteger(minProducts) || minProducts < 1) {
        return { error: "Minimum products must be a positive integer." };
      }
      await updateSettings(shop, {
        brandName: String(formData.get("brandName") || "Wild Palace"),
        brandTone: String(formData.get("brandTone") || ""),
        defaultLocale,
        enabledLocaleCodes,
        // Normalized the same way Shopify normalizes handles, so lookups
        // and URLs stay in agreement with the created blog.
        blogHandle:
          slugify(String(formData.get("blogHandle") || "")) || "seo-plp",
        minProducts,
        competitorUrlList: String(formData.get("competitorUrls") || "")
          .split(/\r?\n/)
          .map((url) => url.trim())
          .filter(Boolean),
      });
      return { success: "Settings saved." };
    }

    return { error: `Unknown action "${intent}"` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export default function Settings() {
  const { shop, settings, locales, ai } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busyAction =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("_action"))
      : null;

  const [brandName, setBrandName] = useState(settings.brandName);
  const [brandTone, setBrandTone] = useState(settings.brandTone);
  const [blogHandle, setBlogHandle] = useState(settings.blogHandle);
  const [minProducts, setMinProducts] = useState(String(settings.minProducts));
  const [defaultLocale, setDefaultLocale] = useState(settings.defaultLocale);
  const [enabledLocales, setEnabledLocales] = useState<string[]>(
    settings.enabledLocaleCodes,
  );
  const [competitorUrls, setCompetitorUrls] = useState(
    settings.competitorUrlList.join("\n"),
  );

  return (
    <Page>
      <TitleBar title="Settings" />
      <BlockStack gap="400">
        <AiConfigBanner ai={ai} />
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title="Could not save">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {actionData && "success" in actionData && actionData.success && (
          <Banner tone="success">
            <p>{actionData.success}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Form method="post">
              <input type="hidden" name="_action" value="save" />
              <input type="hidden" name="defaultLocale" value={defaultLocale} />
              {enabledLocales.map((code) => (
                <input
                  type="hidden"
                  name="enabledLocales"
                  value={code}
                  key={code}
                />
              ))}
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Brand
                    </Text>
                    <FormLayout>
                      <TextField
                        label="Brand name (used in titles, schema and prompts)"
                        value={brandName}
                        onChange={setBrandName}
                        name="brandName"
                        autoComplete="off"
                      />
                      <TextField
                        label="Brand tone (injected into every generation prompt)"
                        value={brandTone}
                        onChange={setBrandTone}
                        name="brandTone"
                        multiline={3}
                        autoComplete="off"
                      />
                      <TextField
                        label="Competitor URLs (one per line, prompt context)"
                        value={competitorUrls}
                        onChange={setCompetitorUrls}
                        name="competitorUrls"
                        multiline={3}
                        autoComplete="off"
                      />
                    </FormLayout>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Locales
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Markets are config files (app/config/locales). Adding one
                      there makes it appear here, with no code changes.
                    </Text>
                    <ChoiceList
                      allowMultiple
                      title="Enabled locales"
                      choices={locales.map((locale) => ({
                        label: locale.label,
                        value: locale.code,
                      }))}
                      selected={enabledLocales}
                      onChange={setEnabledLocales}
                    />
                    <Select
                      label="Default locale (canonical for cross-locale duplicates)"
                      options={locales
                        .filter((locale) =>
                          enabledLocales.includes(locale.code),
                        )
                        .map((locale) => ({
                          label: locale.label,
                          value: locale.code,
                        }))}
                      value={defaultLocale}
                      onChange={setDefaultLocale}
                    />
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Publishing
                    </Text>
                    <FormLayout>
                      <TextField
                        label="Blog handle for published PLPs"
                        value={blogHandle}
                        onChange={setBlogHandle}
                        name="blogHandle"
                        autoComplete="off"
                      />
                      <TextField
                        label="Minimum products per page (thin-content threshold)"
                        value={minProducts}
                        onChange={setMinProducts}
                        name="minProducts"
                        type="number"
                        autoComplete="off"
                      />
                    </FormLayout>
                  </BlockStack>
                </Card>

                <InlineStack align="end">
                  <Button
                    submit
                    variant="primary"
                    loading={busyAction === "save"}
                  >
                    Save settings
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    AI provider
                  </Text>
                  <InlineStack gap="200">
                    <Badge tone={ai.configured ? "success" : "critical"}>
                      {ai.configured ? "Configured" : "Missing key"}
                    </Badge>
                    <Badge>{ai.provider}</Badge>
                    {ai.model && <Badge>{ai.model}</Badge>}
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Provider, key and model live in <code>.env</code>{" "}
                    (AI_PROVIDER / AI_API_KEY / AI_MODEL) per the brief.
                    Switching Claude ↔ GPT-4o ↔ Gemini is a config change only.
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Demo catalog
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Seeds 36 wallpaper products with structured tags
                    (style:/room:/material:/ attribute:/use-case:). Idempotent:
                    re-running fills gaps only.
                  </Text>
                  <Form method="post">
                    <input type="hidden" name="_action" value="seed" />
                    <Button
                      submit
                      loading={busyAction === "seed"}
                      variant={settings.catalogSeeded ? undefined : "primary"}
                    >
                      {settings.catalogSeeded
                        ? "Re-run seed"
                        : "Seed demo catalog"}
                    </Button>
                  </Form>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    AI presence files
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Live on your own domain, via App Proxy. These are the URLs
                    to give crawlers.
                  </Text>
                  <Text as="p" variant="bodySm">
                    <PolarisLink
                      url={`https://${shop}/apps/seo/llms.txt`}
                      target="_blank"
                    >
                      /apps/seo/llms.txt
                    </PolarisLink>
                  </Text>
                  <Text as="p" variant="bodySm">
                    <PolarisLink
                      url={`https://${shop}/apps/seo/sitemap-ai.xml`}
                      target="_blank"
                    >
                      /apps/seo/sitemap-ai.xml
                    </PolarisLink>
                  </Text>
                  <Divider />
                  <Text as="p" tone="subdued" variant="bodySm">
                    Both update the moment a PLP is published. To answer at the
                    true store root, add a redirect from <code>/llms.txt</code>{" "}
                    to the proxy path — an app cannot claim the root itself.
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Unsigned dev copies:{" "}
                    <PolarisLink url={`/llms.txt?shop=${shop}`} target="_blank">
                      llms.txt
                    </PolarisLink>
                    {" · "}
                    <PolarisLink
                      url={`/sitemap-ai.xml?shop=${shop}`}
                      target="_blank"
                    >
                      sitemap-ai.xml
                    </PolarisLink>
                  </Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
