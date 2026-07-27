import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>SEO PLP Generator</h1>
        <p className={styles.text}>
          Programmatic SEO for Shopify stores: turn long-tail keywords into
          published, schema-rich product listing pages, matched to your real
          catalog and validated before they ever go live.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Keyword to page, gated end to end</strong>. Auto-discovered
            or imported keywords are parsed into structured intent, matched
            against your products, and only generated once they clear similarity
            and minimum-product thresholds.
          </li>
          <li>
            <strong>Technical SEO built in</strong>. CollectionPage + ItemList +
            FAQPage + BreadcrumbList JSON-LD, intent-aware alt text, canonical
            and hreflang handling, automatic internal linking, plus llms.txt and
            sitemap-ai.xml for AI crawlers.
          </li>
          <li>
            <strong>Locale as configuration</strong>. Markets are JSON config
            files: language, measurement system, terminology and currency flow
            into every prompt; adding a market needs no code changes.
          </li>
        </ul>
      </div>
    </div>
  );
}
