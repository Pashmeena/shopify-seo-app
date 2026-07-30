# Issues and improvements

Companion to [README.md](README.md): everything this app knowingly does not do. Three kinds of entry, kept apart on purpose:

- **[Limitations](#limitations)** — deliberate simplifications. Each one is a choice with a reason, not an oversight.
- **[Known issues](#known-issues)** — concrete bugs and gaps found reading the current code, grouped by the brief requirement they sit under. None block the demo; each names the file and the fix.
- **[Roadmap](#roadmap-what-id-build-next)** — what I would build next, in priority order.

---

## Limitations

Simplifications, not oversights.

1. **No search-volume data.** Discovery is catalog-only and therefore **supply-biased**: it proposes what the store can support, not what people search for. `KeywordVolumeProvider` is the plug point; the keywords table shows the column wired to the stub.
2. **Synchronous generation.** Runs inside the request, roughly 30–90s with retries. Right for a local demo, wrong at scale. See [roadmap item 3](#roadmap-what-id-build-next) for why it was left rather than half-built.
3. **The theme extension is the one piece not verified against a real store.** The payload shape and its emit/omit rules are unit tested; the Liquid is not. It also needs the merchant to enable an app embed once, and the metafield definition to exist — creation failure logs and continues, so the worst case is missing hreflang rather than a failed publish.
4. **Canonical consolidation is a 301, not a `rel=canonical` tag** — see [Q4 in the README](README.md#4-why-did-you-choose-your-publishing-mechanism) for why that is the stronger of the two on Shopify, and `publishing/consolidation.server.ts` for the guards. The honest limitation is what it costs: the consolidated page stops existing as a page, so a merchant who disagrees with the similarity verdict has to say so explicitly (there is a one-click override on the page, which removes the redirect and returns the page to draft). An earlier build recorded the decision in a `plp:canonical` element in `sitemap-ai.xml` instead; that was a private vocabulary no crawler reads, i.e. a decision written down rather than acted on, and it has been removed.
5. **`llms.txt` is not at the true store root**, because Shopify does not permit it. It is on the store domain under `/apps/seo/`; a merchant-added redirect closes the last hop.
6. **Contextual pricing needs Shopify Markets** configured for the country. Without it, prices fall back to shop currency — logged, not silent.
7. **Blog-article publishing** means `CollectionPage` JSON-LD on an article document, and no head ownership. Defensible for a curated listing; not a production choice.
8. **Facet inference is only as good as its vocabulary.** A store whose products are named in terms the vocabulary does not know gets fewer inferred facets. Tags and collections still work, and the vocabulary is one file.
9. **Four page types is coverage, not completeness.** `style × room`, `attribute × room`, `use case` (± material) and the German rental page cover the query shapes the seeded catalog can support. A room on its own ("wallpaper for hallways") still routes nowhere unless the keyword also carries a style, an attribute or a use case — deliberate, because a room-only page has no angle beyond the room and is the shape most likely to cannibalize the others. Adding one is a JSON file, which is the point of the config format.
10. **AI alt text lives on the PLP only**, not written back to product media in Shopify. A production build would offer that as an opt-in bulk action.
11. **Placeholder product imagery** (picsum.photos, deterministic per handle); seeding degrades to imageless products if unreachable.
12. **Local SQLite** session/app storage, per the template default.
13. **The dev-only `/llms.txt` route guesses the shop** when no `?shop=` is given, by taking the first stored session. The proxy route it mirrors is signed and does not guess.

---

## Known issues

### Keyword ingestion

Short, concrete bugs found in the current ingestion code. None block the demo, but they should be closed before calling the feature production-ready.

1. **Loader mutates the database on every GET.** `app/routes/app.keywords.tsx` recomputes and writes `matchCount` inside the Remix loader. Loaders should be read-only; move the refresh to an explicit action or a background job.
2. **Manual paste drops commas when a locale is present.** A line like `botanical wallpaper, but moody,en-US` is parsed as three columns, the locale is detected, and `phraseFor` returns only the first cell. The keyword becomes `botanical wallpaper`. Fix: rejoin all cells before the detected locale column when the mapping is positional.
3. **Cross-submission duplicates are possible.** Ingestion deduplicates case-insensitively within one submission, but the Prisma `@@unique([shop, phrase, locale])` is case-sensitive on SQLite. Submitting `Botanical Wallpaper` today and `botanical wallpaper` tomorrow creates two keyword rows. Fix: normalize phrase casing at storage or add a case-insensitive unique constraint.
4. **A first keyword that is exactly a column synonym is misread as a header.** A single-column paste starting with `keyword` is treated as a header row and dropped. Fix: require stronger evidence for a header when the file has only one column.
5. **No file-size / row-count guard before parsing.** `MAX_IMPORT_BATCH` is checked only after the full CSV is read and parsed, so a very large upload could exhaust memory or hang the request before being rejected.

### Intent parsing

Short, concrete bugs found in the current intent parser. The brief requirement itself is met (rules-first hybrid, worked example tested, routing to page types works); these are edge cases and quality issues to close.

1. **Apostrophes break the `children's room` synonym.** `app/services/facets/vocabulary.server.ts` replaces every character that is not a letter, number, space or hyphen with a space, so `children's room` becomes `children s room`. The vocabulary key `children's room` (two words) can never match the resulting three-token sequence. A query like `botanical wallpaper children's room` loses the room facet and fails to route to `style-room`. Fix: preserve apostrophes inside words during tokenization, or normalize `children s room` back to `children's room` before matching.
2. **AI enrichment artificially inflates confidence.** `app/services/intent/parse.server.ts` sets `confidence: Math.max(rules.confidence, 0.8)` after calling the model. A keyword the rules parser understood at 30% now reports 80% even if the AI added nothing useful. Fix: compute confidence honestly from the merged result, or expose both `rulesConfidence` and `finalConfidence`.
3. **No test coverage for apostrophe variants.** `app/services/facets/vocabulary.test.ts` and `app/services/intent/parse.test.ts` do not exercise keywords containing apostrophes, so bug 1 is undetected by the suite.

### Product matching

Short, concrete issues found in the matcher and preview panel. The brief requirement is almost fully met; these are the remaining gaps and polish items.

1. **Description keywords are not used for qualification.** The app deliberately does not derive facets from product descriptions, because descriptions contain negations like "not suitable for bathrooms". Descriptions still influence ranking via `textMatchBonus`. This is a documented deviation from the literal brief wording.
2. **Rejected products in the preview panel do not show partial matches.** `app/services/matching/panel.server.ts` clears `matchedFacets` for excluded products, so the merchant can only see the first failure reason, not the facets that did match. Fix: carry partial-match evidence into the panel.
3. **Only the first hard-facet failure is reported.** `app/services/matching/match.server.ts` breaks the facet loop on the first hard failure, so a product that fails both style and room only reports one reason. Fix: collect all failures.
4. **Kid-safety failure can hide a hard-facet mismatch.** The kid-safety check runs before the hard-facet loop in `app/services/matching/match.server.ts`, so a dramatic product with the wrong style only reports the kid-safety reason. Fix: collect both reasons.
5. **`overridden` flag is true even when the selection matches the matcher.** `app/services/matching/panel.server.ts` sets `overridden: selectedIds !== null`, so saving a preview without changing anything still shows the "edited" badge and "included against judgement" banner. Fix: compare the selection to the matcher's default set.
6. **Manual override can bypass kid-safety, and the pipeline does not re-check it.** `app/services/plp/pipeline.server.ts` adds merchant-selected products to the final list without a second kid-safety check. The UI shows a standing warning, so this is intentional, but it means a kids-room PLP can technically contain dark/moody products if the merchant insists.

### JSON config / page-type schemas

The brief requirement is met: every page type has a JSON config with metadata, generation prompts, and an `output_schema` that is validated before any content enters the pipeline. These are the remaining gaps.

1. **The schema does not enforce `section_count` and `faq_count` exactly.** The prompt asks for "exactly {section_count} sections" and "exactly {faq_count} FAQs", but the schema only sets `minItems` (sections: 3, faq: 4 or 5). No `maxItems` is declared. The AI can return 3 sections when asked for 4, or 4 FAQs when asked for 5 or 6, and still pass validation. Fix: add `minItems` and `maxItems` to match the counts in each page-type config.
2. **The schema does not cap `product_alt_texts` at the product count.** `app/config/page-types/*.json` sets `minItems: 1` but no `maxItems`. `app/services/generation/generate.server.ts` backfills missing entries but does not trim extras. Fix: add `maxItems` or trim in `ensureAltTextCoverage`.
3. **`schema_markup` is not part of the AI output schema.** The brief's example schema includes `schema_markup: { type: "object" }`. The app assembles JSON-LD in code instead. This is a documented design deviation, not an oversight.
4. **Config tests do not assert schema/prompt consistency.** `app/config/config.test.ts` checks that schemas compile and placeholders are known, but does not check that `section_count` matches `sections.minItems/maxItems` or that `faq_count` matches `faq.minItems/maxItems`. Fix: add assertions for count consistency.
5. **`extractJsonObject` can slice the wrong object if the response contains multiple `{...}` blocks.** `app/lib/json.ts` uses the first `{` and last `}` as a fallback. This only runs when the model misbehaves, and the retry loop catches parse failures, but a more robust extractor would be safer.

### Multi-locale support

The brief requirement is fully met. Locale is architectural, not bolted on, and adding a new market is almost entirely a configuration change. These are polish items and documented caveats rather than bugs.

1. **Keyword parsing for a new language is not config-only.** The rules vocabulary in `app/services/facets/vocabulary.server.ts` knows English and German synonyms. Adding `fr-FR.json` alone makes French pages generate and render correctly, but French keywords parse only through the AI enrichment fallback. This is a documented limitation, not an oversight.
2. **`sitemap-ai.xml` uses a placeholder namespace URL.** `app/services/ai-files/sitemap-ai.server.ts` uses `https://wildpalace.example/ns/plp`. The namespace is only an identifier and does not break anything, but it should be replaced with a real client-owned domain before production.
3. **No `x-default` hreflang.** The app emits one alternate per market (e.g. `en-US`, `en-GB`, `de-DE`) but does not emit an `x-default` alternate for unmatched users. Not required by the brief, but a common international-SEO best practice.
4. **Theme extension is the only hreflang delivery mechanism.** If the merchant forgets to enable the "PLP SEO tags" app embed, hreflang links are missing from `<head>`. The UI and README prompt the merchant to enable it; this is listed as a known limitation rather than a code bug.

### Technical SEO

The brief requirement is fully met. The JSON-LD stack, intent-based alt text, canonical/hreflang, noindex, cannibalization prevention, meta length limits, heading hierarchy and internal links are all implemented and tested. These are the remaining gaps and documented deviations.

1. **JSON-LD brand can be empty if a product has no vendor.** `app/services/seo/json-ld.server.ts` emits `brand: { "@type": "Brand", name: product.vendor }`. If `vendor` is an empty string, the structured data is invalid. Fix: fall back to `brandName` or omit the brand node.
2. **H1 keyword match and uniqueness are prompt-only, not enforced in code.** `app/services/plp/pipeline.server.ts` does not validate that the generated `content.h1` contains the target keyword or is unique across pages. The prompts ask for it, but a misbehaving model could pass schema validation and still produce a mismatch. Fix: add a post-generation validation step.
3. **All public URLs use the `.myshopify.com` subdomain.** `app/services/seo/urls.server.ts` hardcodes `https://${shop}`. If the merchant has a custom primary domain, canonical, hreflang, internal links, `llms.txt` and `sitemap-ai.xml` will point to the myshopify domain instead of the canonical one. Fix: query the shop's primary domain at install time and store it in settings.
4. **JSON-LD availability is hardcoded to `InStock`.** `app/services/seo/json-ld.server.ts` always emits `availability: "https://schema.org/InStock"`. The app does not read inventory, so out-of-stock products would be misreported. This is a documented limitation.
5. **Canonical consolidation is implemented as a 301 redirect, not a `<link rel="canonical">` tag.** This is a deliberate design choice (see `app/services/publishing/consolidation.server.ts`) because Shopify themes already emit a self-referencing canonical that an app extension cannot override. A 301 is a stronger signal and avoids a mixed canonical signal. It satisfies the brief's intent, but it is a deviation from the literal wording.

---

## Roadmap: what I'd build next

In priority order. This is the answer to [Q7 in the README](README.md#7-known-gaps-and-what-youd-build-next); the [Limitations](#limitations) above are what each item would close.

1. **Metaobject or template-based publishing** — own the head, native product cards, live pricing. Consolidation no longer needs it (a 301 covers that case better than a tag would), but owning the head would also let the app control `robots`, pagination hints and the page-type declaration instead of inheriting the theme's `Article` schema.
2. **Real search-volume + SERP data** behind the existing `KeywordVolumeProvider` interface — turns supply-biased discovery into demand-ranked discovery.
3. **Background job queue** for generation. Currently synchronous inside a Remix action (30–90s with retries): right for a local demo, wrong at the scale this app is premised on. Deliberately not attempted here — it is a real architectural change with no infrastructure to run on, and half-doing it would have been worse than documenting it.
4. **Embedding-based similarity** to complement facet Jaccard, catching semantic overlap between differently-faceted intents.
5. **Column-mapping UI for CSV import** — the AI tier covers unfamiliar headers well, but a mapping step with a preview is what a mature app ships, and it never guesses wrong.
6. **Performance tracking**: Search Console per PLP, auto-flagging cannibalization observed in the wild rather than only predicted.
7. **Webhook-driven freshness**: `products/update` re-runs matching for affected published pages and flags any that dropped below threshold.
