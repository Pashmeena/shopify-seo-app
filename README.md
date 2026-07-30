# Wild Palace — Programmatic SEO PLP App

A plug & play Shopify app (Remix + TypeScript) that generates SEO-optimized, AI-written Product Listing Pages at scale:

**Keyword input → Intent parsing → Product matching → Content generation → PLP published**

Installable on any Shopify dev store. LLM-agnostic (Claude / GPT-4o / Gemini via `.env`). Four markets ship as config: en-US, en-GB, en-AU, de-DE.

---

## Scope & Assumptions

- **PLPs publish as Shopify blog articles** via the Blog/Article Admin GraphQL API, plus a small theme app extension for the head tags an article body cannot carry. See [Why blog articles?](#4-why-did-you-choose-your-publishing-mechanism).
- **The app runs locally.** Clone, add an AI key to `.env`, `npm run dev`, install on your own dev store. There is no hosting story.
- **The catalog can be seeded by the app** (Settings → *Seed demo catalog*): 36 wallpaper products with namespaced tags. It is a convenience for demoing, not a requirement — the app also works on a store that has never heard of its tag convention (see [Q1](#1-how-do-you-prevent-thin-content-what-happens-when-a-query-matches-fewer-than-6-products)).
- **Nothing publishes automatically.** Discovered keywords need approval; generated pages need an explicit publish; below-threshold and flagged pages cannot be published at all.
- **No real search-volume data.** Discovery is catalog-only and supply-biased, with a documented plug point.
- Judgement calls are recorded in [Decisions](#decisions--judgment-calls) rather than left implicit.

---

## Quick start

```bash
npm install
cp .env.example .env        # AI_PROVIDER=anthropic | openai | gemini
                            # AI_API_KEY=...
                            # AI_MODEL=            (optional override)
npm run dev                 # Shopify CLI: log in, create/link the app, install on your dev store
```

Then, inside the embedded app:

1. **Settings → Seed demo catalog** — 36 tagged wallpaper products (idempotent). Skip this if you are testing against a store that already has products.
2. **Keywords → Auto-discover from catalog** — or paste keywords, or upload a CSV from any keyword tool.
3. Review the **parsed intent** chips and live match count. **Preview** shows exactly which products the page would contain, which the matcher rejected and why, and lets you change both — before any AI spend. Then **Approve** and **Generate PLP**.
4. On the page detail screen: content preview, the raw validated JSON, the SEO payload, the product match panel, meta/canonical/hreflang/internal links.
5. **Publish as blog article** — live at `/blogs/seo-plp/<slug>`; `llms.txt` and `sitemap-ai.xml` update immediately.
6. **Theme editor → App embeds → enable "PLP SEO tags"** — one switch, once. Required for hreflang link tags to render. Everything else works without it.

Suggested demo: seed → discover → generate `botanical wallpaper living room` (publishable) → generate a bathroom/humid-rooms keyword (3 products → **held for review, never published**) → add `selbstklebende tapete mietwohnung,de-DE` (routes to the de-DE-only page type, German content) → publish two English pages and watch the internal links and `llms.txt` update.

> Without an AI key: seeding, discovery, rules-based intent parsing and matching all work. Generation reports a clear configuration error.

```bash
npm test           # 377 unit tests
npm run typecheck
npm run lint
npm run build
```

---

## Architecture

```
app/
├── config/
│   ├── page-types/          # style-room, use-case, rental-compliance (de-DE only) —
│   │                        #   prompts, temperature, SEO templates, output_schema
│   ├── locales/             # en-US, en-GB, en-AU, de-DE — language, currency, country,
│   │                        #   measurement system, terminology, market briefing
│   └── index.server.ts      # glob-discovered registry, validated at startup
├── services/
│   ├── facets/              # the domain vocabulary + phrase matcher, shared by keyword
│   │                        #   parsing and catalog normalization
│   ├── ingest/              # CSV/paste import: papaparse, tiered column mapping, template
│   ├── ai/                  # provider interface, 3 adapters, ajv-validated JSON client
│   ├── intent/              # hybrid parser (rules first, AI on low confidence)
│   ├── catalog/             # normalized products, facet derivation with provenance,
│   │                        #   market pricing, seeder
│   ├── matching/            # hard-facet filtering, provenance-weighted scoring,
│   │                        #   kid-safety exclusions, the shared match panel
│   ├── discovery/           # product-first keyword discovery + volume-API stub
│   ├── generation/          # prompt assembly, schema-validated generation, alt-text coverage
│   ├── seo/                 # slugs, meta, JSON-LD, clustering/similarity, canonical policy,
│   │                        #   internal links, hreflang assembly
│   ├── publishing/          # article renderer, Blog/Article API, SEO head metafield,
│   │                        #   publish orchestration + affected-page refresh
│   ├── ai-files/            # llms.txt and sitemap-ai.xml
│   └── plp/                 # repository + pipeline orchestrator
├── routes/                  # dashboard, keywords, page detail, settings, app-proxy files
├── components/              # shared Polaris pieces
└── test-support/            # fixtures; the example outputs are built from these
extensions/
└── plp-seo-head/            # theme app extension: hreflang + noindex in <head>
```

**Pipeline** (`services/plp/pipeline.server.ts`): parse intent → route to page type (market-aware) → **Gate 1** cluster already has a page? → **Gate 2** intent too similar? → **Gate 3** slug already taken? → match products (threshold; a saved preview selection wins) → price for the market → canonical decision → generate (validated against `output_schema`, retried with the validator's errors, never published if invalid) → resolve meta → assemble SEO → save as `draft` or `needs_review`.

**Data model** (SQLite/Prisma): `Keyword` and `PlpPage`, with intent, content and SEO stored as JSON so the admin can always show the raw structured output.

---

## The seven questions

### 1. How do you prevent thin content? What happens when a query matches fewer than 6 products?

Four layers:

- **Discovery cannot propose a thin page.** It is product-first: candidates are derived *from* facet combinations that exist in the catalog, and only combinations already clearing the threshold become suggestions. Candidates run through the same matcher as real generation, so the suggested count is the real count.
- **Facets come from three sources, so the threshold is measured against a real catalog.** Namespaced tags (`style:botanical`), **collection membership**, and **product title / product type** read through the shared vocabulary. This is what makes the app work on a store that never adopted the tag convention: a store with a "Living Room" collection and products called "Fern Study" gets facets without touching a tag. Provenance is recorded, and a facet the merchant declared outranks one the app inferred — inference affects ranking, never eligibility.
  Descriptions are deliberately excluded as a facet source: *"not suitable for bathrooms"* contains "bathroom", and a page must never contain a product that contradicts its own H1. Descriptions still influence ranking through a small text bonus.
- **Matching never dilutes.** Every facet the shopper stated is a hard filter. A "botanical living room" page will not be padded with bedroom florals to reach 6.
- **Below-threshold pages are quarantined.** The page is still generated so the merchant can see what it would be, but it lands in `needs_review` with the reason recorded, publishing is blocked in the UI *and* server-side, the review can only be resolved once the count is met, `noindex` stays true, and it never appears in `llms.txt` or `sitemap-ai.xml`. The seeded catalog includes a 3-product `use-case: humid rooms` group so this path demos live.

Worth knowing before you try it: the brief's own example keyword, *"sustainable midnight blue wallpaper kids room"*, matches **one** product in the seeded catalog. All four facets are hard filters and only `starry-night-sky` carries all of them. That is the thin-content path working as designed, not a bug — but if you paste that keyword expecting a page, you will correctly get a held one.

### 2. How does your prompt strategy differentiate pages targeting adjacent queries?

- **Different page types are different briefs, with different schemas.** `style-room` prompts an interior-design persona toward pattern scale, light and furniture pairing. `use-case` prompts a practical home-improvement persona toward suitability, removal and cost, and its schema *requires* a `buying_guide` the other has no concept of. `rental-compliance` is written in German for German tenancy law and requires a `compliance_notes` block neither other type has. Adjacent pages of different types differ structurally, not lexically.
- **The intent JSON and the real product list are in the prompt, with a grounding mandate.** Every claim must be grounded in the specific products given; if the range skews dark and large-scale, the copy must say so. Two adjacent pages get different products, so different evidence.
- **Section headings must expand coverage, not restate the H1.** FAQ answers must be standalone. Meta title/description is a separate CTR objective from the body.
- **Near-duplicates never reach the prompt.** Clustering and the similarity gate stop two phrasings of one intent from ever becoming two generations.

Compare `examples/style-room.en-US.json` and `examples/use-case.en-US.json`: different structure, voice and evidence.

### 3. How do related PLPs link to each other internally?

Computed from **shared intent facet values**, never guessed by the AI. Same-locale published pages are ranked by how many facet values they share and the top 6 become a "Related guides" nav in the article body. *Botanical wallpaper living room* links to *botanical wallpaper bedroom* (shared style) and *tropical wallpaper living room* (shared room), exactly as the brief asks.

Links are **maintained, not frozen**. Publishing a page recomputes every page the publish invalidated and re-renders the ones whose visible body changed. Two distinct relationships are tracked, because missing either leaves stale markup:

- same locale → the new page joins the link graph
- same intent cluster in any locale → the new page is a locale variant, so hreflang changes

### 4. Why did you choose your publishing mechanism?

**Blog articles via the Blog/Article GraphQL API, plus a theme app extension for head tags.**

- *Why articles fit:* real theme-rendered URLs, editable body HTML that carries the full markup (product grid, FAQ, related-links nav, embedded JSON-LD), native SEO metafields, a native noindex mechanism (`seo.hidden`), and they work on any store with zero theme work.
- *Why the extension:* an article body cannot put a `<link>` in `<head>`, and Shopify emits hreflang only for its own Markets URLs. So locale variants had no way to reference each other. The extension reads a storefront-readable `wp_plp.seo` metafield the app writes on publish, and emits hreflang and a noindex fallback.
- *What the extension deliberately does not emit:* `<link rel="canonical">`. Themes already emit a self-referencing canonical for every article, which is what this app wants for every page except a same-language consolidation, and a second conflicting canonical is worse than none — search engines discard both hints. That one case stays recorded in the payload and the AI sitemap.
- *What production would do instead:* metaobject-backed templates or a full theme section, owning the head outright, with native product cards and Markets-aware pricing. Publishing is one isolated service behind the pipeline, so swapping the target changes nothing upstream.
- *Acknowledged wrinkle:* the JSON-LD declares `CollectionPage` while the host document is an article. Defensible for a curated listing, not what a production build would ship.

### 5. How does adding a new locale work — what does the merchant actually do?

Two steps, no code:

1. **Drop a JSON file** into `app/config/locales/`, e.g. `fr-FR.json`: language, market, currency, `country` (for Markets pricing), measurement system, slug prefix, hreflang code, a `promptContext` market briefing, `facetTranslations` and `tokens`. The registry discovers files by glob and validates them at startup, so a malformed or incomplete file fails loudly rather than silently.
2. **Enable it in Settings** — it appears in the checklist automatically.

Everything downstream is locale-parameterized: slugs (`fr-fr-papier-peint-botanique-salon` from the same template), prompts, meta templates, hreflang pairing, canonical policy, and market currency in schema markup.

en-GB and en-AU are the proof, and they carry real market briefings rather than spelling swaps — inverted seasons and fade resistance for Australia, Victorian chimney breasts and lining paper for the UK. A page type can also declare `locales` and exist for one market only; `rental-compliance` does, because German Schönheitsreparatur obligations have no counterpart in the other three markets.

### 6. How is your content structure optimized for AI retrieval, not just Google?

- **Standalone, citable FAQ answers**: the prompt requires every answer to restate its subject and make complete sense with zero surrounding context, with schema-enforced minimum lengths.
- **Topic declared in the first 100 words**: the intro must state style, room or use case, and what can be bought, before anything else.
- **`llms.txt`** at `https://<store>/apps/seo/llms.txt` — a plain-language index of what the store sells (facet vocabulary with counts) and every published PLP with intent, keyword, locale and product count. Generated from live data, so publishing updates it with nothing to invalidate.
- **`sitemap-ai.xml`** at `https://<store>/apps/seo/sitemap-ai.xml` — published pages only, annotated with intent summary, primary keyword, product count, locale and market, plus hreflang alternates.
- **Machine-legible body**: FAQPage JSON-LD mirrors the visible FAQ, ItemList enumerates the exact products with per-product Offers, headings follow a strict H1 → H2/H3 hierarchy.

Both files are served through a **Shopify App Proxy**, so they answer on the store's own domain and Shopify signs the request (the handler authenticates the shop rather than accepting it as a parameter). One honest correction to a claim an earlier draft of this README made: a proxy does **not** put them at the true store root. Shopify does not let an app claim `/llms.txt`. Reaching the root needs a redirect the merchant adds; the proxy gets you a stable, authenticated URL on the right domain, which is the part an app can actually own.

### 7. Known gaps and what you'd build next

See [Limitations](#limitations). In priority order:

1. **Metaobject or template-based publishing** — own the head, emit the consolidation canonical, native product cards, live pricing.
2. **Real search-volume + SERP data** behind the existing `KeywordVolumeProvider` interface — turns supply-biased discovery into demand-ranked discovery.
3. **Background job queue** for generation. Currently synchronous inside a Remix action (30–90s with retries): right for a local demo, wrong at the scale this app is premised on. Deliberately not attempted here — it is a real architectural change with no infrastructure to run on, and half-doing it would have been worse than documenting it.
4. **Embedding-based similarity** to complement facet Jaccard, catching semantic overlap between differently-faceted intents.
5. **Column-mapping UI for CSV import** — the AI tier covers unfamiliar headers well, but a mapping step with a preview is what a mature app ships, and it never guesses wrong.
6. **Performance tracking**: Search Console per PLP, auto-flagging cannibalization observed in the wild rather than only predicted.
7. **Webhook-driven freshness**: `products/update` re-runs matching for affected published pages and flags any that dropped below threshold.

---

## Decisions & judgment calls

| Decision | Choice | Why |
|---|---|---|
| Intent parsing | **Hybrid, rules-first.** Bilingual vocabulary (seed + catalog values), greedy longest-phrase matching; AI enrichment only when confidence < 0.6 or nothing routes; rules win conflicts; AI output schema-validated like all AI output. | Deterministic, free, offline and demo-safe for the common case; AI where it adds recall. |
| Facet sources | Tags and collection membership are **declared**; title and product type are **inferred**. Both qualify a product; declared scores 1.0, inferred 0.6. Descriptions never qualify. | "Installable on any store" is false if the app only understands its own tags. But a page must never contain a product contradicting its H1, and descriptions contain negations. |
| Query-only vocabulary | Words whose sense flips outside a search box (`study`, `office`, `lounge`, `apartment`, `steam`) are matched in keywords and ignored in product text. | Found by a failing test: "Fern Study" was being filed onto home-office pages. A drawing is not a room. |
| Matching strictness | **All stated facets are hard filters**; audience is soft; weighted score ranks the qualifying set. | "Right products on right PLPs." Thin results are surfaced, not papered over. |
| Manual adjustment | Rejected products are **selectable**, with the reason shown. Including one is allowed, unblocked, and raises a standing warning naming each override. | The brief allows manual adjustment; subtract-only adjustment is not that. A merchant who can see why the matcher disagreed is entitled to overrule it — visibly. |
| Kid safety | Kid-intent pages exclude `attribute:dramatic` always, and dark colourways unless the shopper asked for that colour by name. | The brief's own accuracy example, without breaking "midnight blue kids room". |
| "Too similar" | Weighted per-facet Jaccard. **≥ 0.85 blocks**, **0.6–0.85 flags** into review. Identical cluster keys never generate twice per locale. | Explainable to a merchant, cheap, deterministic. Thresholds chosen so single-facet siblings (≈ 0.5) pass while reorderings (≈ 1.0) block — asserted in tests. |
| Canonical policy | **Different language → self-canonical + hreflang. Same language, different market → consolidate onto one.** Among same-language markets the default locale wins, else the oldest. | The brief asks for both a self-referencing canonical *and* consolidation "for locale reasons". Splitting on language satisfies both. Canonicalising a German page onto an English one tells Google not to index the German page at all, forfeiting the market the page was generated for. |
| Schema markup ownership | JSON-LD is **assembled in code** from real catalog data; the AI supplies copy, never structured facts. The brief's example put `schema_markup` in the AI output schema — deliberately deviated. | Prices and URLs in structured data must be exact, and models hallucinate exactly those. |
| Market pricing | Prices resolved per page via Shopify Markets contextual pricing for the locale's country; degrades to shop currency with a log when the market is unavailable. | An `Offer` advertising USD to a German shopper is a factually wrong structured-data claim. Not every store has Markets configured, so it must not be fatal. |
| CSV column mapping | Three tiers: known header names → AI on the header plus five sample rows → first column. Every tier reports which column it read. | Merchants upload exports from tools we have never seen, with headers in languages we cannot read. Tier 3 always answers, so an import never fails for want of a mapping — and never guesses silently. |
| Validation failures | Up to 3 attempts with the validator's concrete errors fed back. Still invalid → keyword marked `failed`, **no page created**. | "Invalid or incomplete responses must be retried or flagged — never published." |
| Transient provider failures | Separate from content retries: 429/5xx/timeout/network retried twice with backoff (1s, 4s) at the shared client layer. Bad key, bad request and refusal fail immediately. | A momentary hiccup shouldn't fail a generation; a wrong API key shouldn't waste 5s pretending it might work. |
| Alt-text coverage | Enforced in code, since the schema cannot know the product count. Missing entries get a deterministic intent-based fallback and the page is flagged noting the backfill. | Guarantees every product image has alt text without failing a whole generation for one omission. |
| Noindex | Draft and review pages **never leave the database** — the strongest noindex. `seo.hidden` and a robots meta fallback in the theme extension cover anything that must exist unindexed. | Shopify indexes published content immediately; the safest draft is one that isn't there. |
| Example outputs | Committed AI content, but products and the entire SEO payload are **re-derived by the real matcher and assembler**, with a test asserting the files still match. | The examples are a deliverable a reviewer reads as evidence. Hand-written ones had already drifted into claiming a shared facet that the page they pointed at did not have. |
| SEO template tokens | Facets are offered in two forms: `{style}` as stored (lowercase, for mid-sentence use) and `{Style}` capitalized. | Values are stored lowercase because they also build slugs. A title needs them capitalized, and German needs them capitalized wherever a noun appears — so the config author chooses per position rather than the code guessing. |
| Default AI models | `claude-opus-5` / `gpt-4o` / `gemini-2.5-flash`, overridable via `AI_MODEL`. Temperature comes from page-type config where the provider supports it (Claude Opus 5 removed sampling parameters, so the Anthropic adapter does not send it). | Current defaults; one env var to change. |

---

## Limitations

Simplifications, not oversights.

1. **No search-volume data.** Discovery is catalog-only and therefore **supply-biased**: it proposes what the store can support, not what people search for. `KeywordVolumeProvider` is the plug point; the keywords table shows the column wired to the stub.
2. **Synchronous generation.** Runs inside the request, roughly 30–90s with retries. Right for a local demo, wrong at scale. See roadmap item 3 for why it was left rather than half-built.
3. **The theme extension is the one piece not verified against a real store.** The payload shape and its emit/omit rules are unit tested; the Liquid is not. It also needs the merchant to enable an app embed once, and the metafield definition to exist — creation failure logs and continues, so the worst case is missing hreflang rather than a failed publish.
4. **Canonical consolidation across same-language markets is recorded but not emitted** as a head tag, for the conflicting-canonical reason in Q4. It is in the stored payload and `sitemap-ai.xml`.
5. **`llms.txt` is not at the true store root**, because Shopify does not permit it. It is on the store domain under `/apps/seo/`; a merchant-added redirect closes the last hop.
6. **Contextual pricing needs Shopify Markets** configured for the country. Without it, prices fall back to shop currency — logged, not silent.
7. **Blog-article publishing** means `CollectionPage` JSON-LD on an article document, and no head ownership. Defensible for a curated listing; not a production choice.
8. **Facet inference is only as good as its vocabulary.** A store whose products are named in terms the vocabulary does not know gets fewer inferred facets. Tags and collections still work, and the vocabulary is one file.
9. **AI alt text lives on the PLP only**, not written back to product media in Shopify. A production build would offer that as an opt-in bulk action.
10. **Placeholder product imagery** (picsum.photos, deterministic per handle); seeding degrades to imageless products if unreachable.
11. **Local SQLite** session/app storage, per the template default.
12. **The dev-only `/llms.txt` route guesses the shop** when no `?shop=` is given, by taking the first stored session. The proxy route it mirrors is signed and does not guess.

---

## Testing

377 unit tests, no store or API key required: `npm test`.

Everything below the Shopify and AI boundaries is pure and tested — vocabulary and phrase matching, facet derivation, matching and scoring, cluster keys and similarity thresholds, canonical policy, slug localization, SEO assembly, CSV ingestion and column mapping, the validated-JSON client's retry and give-up behaviour, HTML escaping, `llms.txt` and `sitemap-ai.xml`, and the config registry's invariants.

The Shopify and AI boundaries are covered by injecting a fake client rather than mocking modules, so the real retry, validation and fallback paths execute.

`UPDATE_EXAMPLES=1 npm test` rewrites the derived halves of `examples/` after an intentional pipeline change.

CI runs typecheck, lint, tests and build on Node 20 and 22.

## Configuration reference

| File | Controls |
|---|---|
| `.env` | `AI_PROVIDER` (`anthropic` \| `openai` \| `gemini`), `AI_API_KEY`, `AI_MODEL` |
| `app/config/page-types/*.json` | Identity, optional `locales` restriction, slug template, SEO templates, generation params, `output_schema` |
| `app/config/locales/*.json` | Language, currency, country, measurement system, slug prefix, hreflang, market briefing, facet translations, tokens |
| `app/services/facets/vocabulary.server.ts` | The domain vocabulary both keyword parsing and facet inference read |
| Settings screen | Brand name/tone, competitor URLs, enabled + default locales, blog handle, minimum product threshold, catalog seeding |

## Examples

Three full pipeline outputs. Content validates against the real page-type schemas; products and SEO payloads are re-derived by the real pipeline and verified by `app/services/plp/examples.test.ts`.

- `examples/style-room.en-US.json` — style-based: botanical × living room
- `examples/use-case.en-US.json` — use-case-based: peel and stick for renters (note the `buying_guide`, required only by this page type)
- `examples/style-room.de-DE.json` — non-English locale: market-aware German (Sie-Form, metric, EUR pricing in the `Offer`s, Schönheitsreparatur), self-canonical and paired with its en-US sibling by hreflang
