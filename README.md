# Wild Palace — Programmatic SEO PLP App

A plug & play Shopify app (Remix + TypeScript) that generates SEO-optimized, AI-written Product Listing Pages at scale:

**Keyword input → Intent parsing → Product matching → Content generation → PLP published**

Installable on any Shopify dev store. LLM-agnostic (Claude / GPT-4o / Gemini via `.env`). Locale-aware by architecture (en-US and de-DE ship as config).

---

## Scope & Assumptions

These decisions were confirmed up front and bound this build:

- **PLPs publish as Shopify blog articles** via the Blog/Article Admin GraphQL API. No theme templates or metaobjects are created. This is a deliberate simplification — see [Why blog articles?](#4-why-did-you-choose-your-publishing-mechanism) and [Honest stubs & limitations](#honest-stubs--limitations).
- **The app runs locally only.** You clone it, add an AI key to `.env`, run `npm run dev`, and install it on your own dev store. There is no hosting or deployment story.
- **The catalog is seeded by the app** (Settings → *Seed demo catalog*): 36 wallpaper products with structured, namespaced tags (`style:` `room:` `color:` `material:` `attribute:` `use-case:` `audience:`). No access to the live Wild Palace store is assumed.
- **German (de-DE) is the non-English locale example.** Adding further markets is a config file, not code.
- **The admin UI always exposes generated content as structured JSON**, not only rendered previews (see the page detail screen).
- **Nothing publishes automatically.** Auto-discovered keywords require merchant approval; generated pages require an explicit publish action; below-threshold and flagged pages are held in review and cannot be published at all.
- **No real search-volume data.** Discovery is catalog-only and supply-biased, with a documented plug-point for a volume API.
- Where the brief required a judgment call (similarity thresholds, matching strictness, prompt wording), a sensible choice was made and recorded in [Decisions & judgment calls](#decisions--judgment-calls).

---

## Quick start (reviewer flow)

```bash
npm install
cp .env.example .env        # add your AI key:
                            #   AI_PROVIDER=anthropic | openai | gemini
                            #   AI_API_KEY=...
                            #   AI_MODEL=            (optional override)
npm run dev                 # Shopify CLI: log in, create/link the app, install on your dev store
```

Then, inside the embedded app:

1. **Settings → Seed demo catalog** — creates 36 tagged wallpaper products (idempotent).
2. **Keywords → Auto-discover from catalog** — or paste keywords manually, e.g. `botanical wallpaper living room`. CSV upload (`keyword,locale` per line) works too.
3. Review the **parsed intent** chips, **Approve** a keyword, then **Generate PLP**.
4. On the page detail screen: content preview, **structured JSON** (content + SEO payload), product match with manual adjustment, exclusion reasons, meta/hreflang/internal links.
5. **Publish as blog article** — the page goes live at `/blogs/seo-plp/<slug>` on the dev store; `llms.txt` and `sitemap-ai.xml` update automatically (links in Settings).

Suggested live-demo script: seed → discover → generate `botanical wallpaper living room` (draft, publishable) → generate a `humid rooms`/bathroom keyword (only 3 products → **held for review, never published**) → add `botanische tapete wohnzimmer,de-DE` (German content, canonical consolidation onto the en-US page) → publish two English pages and show the internal links + `llms.txt` updating.

> Without an AI key the app still runs: seeding, discovery, intent parsing (rules) and matching all work; generation shows a clear configuration error.

---

## Architecture

```
app/
├── config/
│   ├── page-types/          # style-room.json, use-case.json — metadata, SEO templates,
│   │                        #   prompts, temperature, output_schema (JSON Schema)
│   ├── locales/             # en-US.json, de-DE.json — language, currency, measurement
│   │                        #   system, terminology, prompt briefing, facet translations
│   └── index.server.ts      # glob-discovered registry: add a file, no code changes
├── services/
│   ├── ai/                  # LLM-agnostic layer: provider interface, Anthropic/OpenAI/
│   │                        #   Gemini adapters, factory from .env, ajv-validated JSON
│   │                        #   client with error-feedback retries
│   ├── intent/              # bilingual lexicon (seed vocab + catalog tags) + hybrid
│   │                        #   parser (rules first, AI enrichment on low confidence)
│   ├── catalog/             # normalized product access, faceted tag parsing, seeder
│   ├── matching/            # hard-facet filtering, weighted scoring, kid-safety
│   │                        #   exclusions, threshold evaluation
│   ├── discovery/           # product-first keyword discovery + volume-API stub
│   ├── generation/          # prompt assembly from config, schema-validated generation,
│   │                        #   alt-text coverage enforcement
│   ├── seo/                 # slugs, meta, JSON-LD stack, similarity/clustering,
│   │                        #   internal links, hreflang/canonical assembly
│   ├── publishing/          # article HTML renderer, Blog/Article API, publish
│   │                        #   orchestration incl. sibling-link refresh
│   ├── ai-files/            # llms.txt and sitemap-ai.xml builders
│   └── plp/                 # repository (typed JSON columns) + pipeline orchestrator
├── routes/                  # thin Remix routes: dashboard, keywords, page detail,
│                            #   settings, public llms.txt & sitemap-ai.xml
└── components/              # shared Polaris pieces (status badges, JSON view, chips)
```

**Pipeline** (`services/plp/pipeline.server.ts`):
parse intent → route to page type → **Gate 1:** cluster key already has a page? → **Gate 2:** intent too similar to an existing page? → match products (threshold) → cross-locale canonical lookup → generate (validated against the page type's `output_schema`, retried with the validator's errors fed back, never published if invalid) → resolve meta → assemble SEO payload → save as `draft` or `needs_review`.

**Data model** (SQLite/Prisma): `Keyword` (phrase, locale, source, parsed intent, cluster key, match count, status) and `PlpPage` (slug, status, intent, product IDs, validated content JSON, SEO payload JSON, cluster key, canonical pointer, article ID). Content and SEO are stored as JSON precisely so the admin can always show the raw structured output.

---

## The seven questions

### 1. How do you prevent thin content? What happens when a query matches fewer than 6 products?

Three layers:

- **Discovery can't propose thin pages.** Auto-discovery is product-first: candidate pages are derived *from* facet combinations in the catalog, and only combinations that already clear the threshold (default 6, configurable in Settings) become suggestions. Candidates run through the exact same matcher as real generation, so the suggested count is the real count.
- **Matching never dilutes.** Every facet the shopper explicitly stated is a hard filter — the matcher will not pad a "botanical living room" page with bedroom florals to reach 6. Accuracy beats volume by design.
- **Below-threshold pages are quarantined.** If a manual keyword matches fewer than the minimum, the page is still generated (so the merchant can see what it would be) but lands in `needs_review` with the reason recorded. The publish action is disabled for reviewed pages, and the review can only be resolved once the product count meets the threshold (e.g. after re-tagging products or adjusting the selection). Its `noindex` flag stays true, and it is excluded from `llms.txt` and `sitemap-ai.xml`, which list published pages only. The seeded catalog deliberately includes a below-threshold group (`use-case: humid rooms`, 3 products) so this path can be demonstrated live.

### 2. How does your prompt strategy differentiate pages targeting adjacent queries?

Differentiation is engineered at four levels rather than hoped for:

- **Different page types have different briefs.** `style-room` prompts an interior-design persona toward pattern scale, light and furniture pairing with its own output schema; `use-case` prompts a practical home-improvement persona toward suitability, application, removal and cost — and its schema *requires* a `buying_guide` object the other type doesn't have. Adjacent pages of different types differ structurally, not just lexically.
- **The intent JSON and the real product list are in the prompt, with a grounding mandate.** The system prompt instructs: every claim must be grounded in the specific products given; if the range skews (mostly dark large-scale botanicals), the copy must reflect that reality. Two adjacent pages get different product sets, therefore different evidence to write from — and the model is explicitly told to cite products by name where it strengthens the advice.
- **Section headings must expand coverage, not restate the H1**, and FAQ answers must be standalone. The meta title/description is a *separate objective* in the prompt (SERP click-through) from the body copy.
- **Near-duplicates never reach the prompt.** Clustering and the similarity gate stop "botanical wallpaper living room" vs "living room botanical wallpaper ideas" from ever becoming two generations — differentiation starts by refusing to generate what cannot be differentiated.

Compare `examples/style-room.en-US.json` and `examples/use-case.en-US.json` to see the result: different structure, different voice, different evidence.

### 3. How do related PLPs link to each other internally?

Internal links are computed from **shared intent facet values**, not guessed by the AI. For each page, other same-locale published pages are ranked by how many facet values they share (`style:botanical`, `room:living room`, …) and the top 6 become a "Related guides" nav rendered into the article HTML. A page targeting *botanical wallpaper living room* therefore links to *botanical wallpaper bedroom* (shared style) and *tropical wallpaper living room* (shared room) exactly as the brief demands.

Crucially, links are **maintained, not frozen**: publishing a page re-computes the link sets of every other published page in that locale, and any page whose links changed has its article re-rendered and updated via the API in the same publish action (`services/publishing/publish.server.ts → refreshSiblingLinks`). New pages are woven into the existing link graph the moment they go live.

### 4. Why did you choose your publishing mechanism?

**Blog articles via the Blog/Article GraphQL API** — a scope decision made with eyes open:

- *Why it fits this build:* articles are first-class Online Store citizens — real theme-rendered URLs, editable body HTML that carries our full markup (product grid, FAQ, related-links nav, embedded JSON-LD scripts), native SEO metafields (`global.title_tag` / `global.description_tag`), a native noindex mechanism (`seo.hidden` metafield), and they work on *any* store with zero theme work — which is what "plug & play, installable on any store" means for a local test app. The Pages API would have been equally simple, but articles group naturally under one blog handle, keeping programmatic pages cleanly separated and easy to bulk-inspect.
- *What a production build would do instead:* metaobject-backed templates (or a theme app extension section) rendering native product cards from references — giving real `<head>` control (canonical/hreflang link tags), Markets-aware contextual pricing, live availability, and no HTML-in-body coupling. The app's architecture anticipates this: publishing is one isolated service behind the pipeline, and swapping the target changes nothing upstream.
- *Acknowledged wrinkle:* these are articles whose JSON-LD declares `CollectionPage` — see [Honest stubs & limitations](#honest-stubs--limitations).

### 5. How does adding a new locale work — what does the merchant actually do?

Two steps, no code:

1. **Drop a locale config file** into `app/config/locales/`, e.g. `fr-FR.json`: language, market, currency, measurement system, slug prefix, hreflang code, a `promptContext` market briefing (terminology, conventions, cultural context — the part that makes content market-aware rather than translated), `facetTranslations` (canonical facet value → local term, used in slugs and templates) and `tokens` (e.g. `wallpaper → papier peint`). The config registry discovers files by glob — nothing to register.
2. **Enable it in Settings** (the new locale appears in the checklist automatically) and approve keywords in that locale — discovery immediately proposes localized phrases for every viable facet combination.

Everything downstream is locale-parameterized: slugs (`fr-fr-papier-peint-botanique-salon` from the same slug template), prompts (language, register, metric/imperial, currency), meta templates, hreflang pairing, and canonical consolidation against the default locale. The de-DE file is the working proof.

### 6. How is your content structure optimized for AI retrieval, not just Google?

- **Standalone, citable FAQ answers**: the prompt requires every answer to restate its subject and make complete sense with zero surrounding context (schema-enforced minimum lengths; no "as mentioned above"). An AI interface can quote one answer verbatim.
- **Topic declared in the first 100 words**: the intro must state what the page is — style, room/use case, and what can be bought — before anything else.
- **`llms.txt`**: a plain-language index of what the store sells (facet vocabulary with counts) and every published PLP with its target intent, keyword, locale and product count. Regenerated from live data on every request, so it updates automatically on publish.
- **`sitemap-ai.xml`**: a curated sitemap containing only quality-approved published pages, annotated with intent summary, primary keyword, product count, locale/market, plus hreflang alternates — separate from Shopify's built-in sitemap.xml.
- **Semantic, machine-legible page body**: FAQPage JSON-LD mirrors the visible FAQ; ItemList enumerates the exact products; headings follow a strict H1→H2/H3 hierarchy.

### 7. Known gaps and what you'd build next

Gaps are listed in [Honest stubs & limitations](#honest-stubs--limitations). Next, in priority order:

1. **Theme app extension / metaobject publishing** — real head control (canonical + hreflang link tags), native product cards with live pricing and availability, Markets-aware currency.
2. **Real search-volume + SERP data** behind the existing `KeywordVolumeProvider` interface — turns supply-biased discovery into demand-ranked discovery and enables opportunity scoring (volume × supply × competition).
3. **Background job queue** for generation (currently a synchronous Remix action; fine locally, wrong for bulk) with batch generation of approved keywords.
4. **Embedding-based similarity** to complement facet Jaccard — catches semantic overlap between differently-faceted intents beyond what the lexicon normalizes.
5. **Performance tracking loop**: Search Console integration per PLP, auto-flagging cannibalization observed in the wild (two pages ranking for one query) rather than only predicted.
6. **Webhook-driven freshness**: `products/update` webhooks re-run matching for affected published pages and flag pages whose product count dropped below threshold.

---

## Decisions & judgment calls

Recorded here instead of asked, as agreed:

| Decision | Choice | Why |
|---|---|---|
| Intent parsing | **Hybrid, rules-first.** Bilingual lexicon (seed vocabulary + catalog tag values) with greedy longest-phrase matching; AI enrichment only when confidence < 0.6 or no page type routes; rules win on conflict; AI output is schema-validated like all AI output. | Deterministic, free, offline and demo-safe for the common case; AI where it adds recall. Facet values stay canonical English regardless of query language so matching is locale-independent. |
| Matching strictness | **All explicitly stated facets are hard filters** (style, room, color, material, useCase, attribute); audience is soft; weighted score ranks the qualifying set (style/room/useCase 3, material 2.5, color/attribute 1.5, audience 1, small text bonus). | "Right products on right PLPs" — a page must never contain a product that contradicts what its H1 promises. Thin results are surfaced, not papered over. |
| Kid safety | Kid-intent pages exclude `attribute:dramatic` always, and dark colourways (black/charcoal/navy) *unless the shopper explicitly asked for that colour* (so "midnight blue kids room" still works). | The brief's own accuracy example ("kids room must not surface dark moody wallpapers"), without breaking legitimate dark-colour kid queries. |
| "Too similar" | Weighted per-facet Jaccard between intents (same weights as matching). **≥ 0.85 blocks** generation; **0.6–0.85 flags** the page into review. Identical cluster keys (sorted hard-facet values) never generate twice per locale. Cross-locale same-cluster pages are *expected* and consolidated via `canonicalOf` + hreflang instead of blocked. | The score is explainable to a merchant ("shares style and room, differs only in one attribute ≈ 0.7"), cheap, and deterministic. Thresholds chosen so single-facet siblings (botanical living room vs botanical bedroom ≈ 0.5) pass while reorderings/synonyms (≈ 1.0) block. |
| Schema markup ownership | JSON-LD is **assembled deterministically in code** from real catalog data; the AI supplies copy (FAQ, alt text, sections), never structured facts. The brief's example put `schema_markup` in the AI output schema — deliberately deviated: prices/URLs in structured data must be exact, and models hallucinate exactly those. | Never publish invented prices. The `output_schema` remains fully authoritative for what the AI must return. |
| Meta strategy | AI writes meta title/description as a separate CTR objective (schema-capped 60/155 chars); deterministic templates from the page-type config are the fallback; hard truncation as a last resort. | Brief requires CTR-written meta separate from body; templates guarantee a sane floor. |
| Validation failures | Up to 3 attempts, with the ajv validator's concrete errors fed back into the retry prompt. Still invalid → the keyword is marked `failed` with the error, and **no page is created**. | "Invalid or incomplete responses must be retried or flagged — never published." |
| Alt-text coverage | The schema can't know product count, so coverage is enforced in code: missing products get a deterministic intent-based fallback and the page is flagged into review noting the backfill. | Guarantees every product image has alt text without failing a whole generation for one omission. |
| Noindex | Draft/review pages **never leave the app's database** — the strongest noindex. The Shopify-native mechanism (`seo.hidden` metafield → noindex + sitemap removal) is implemented for any article that must exist unindexed. | Shopify indexes published content immediately; the safest draft is one that isn't there. |
| Default AI models | `claude-opus-5` / `gpt-4o` / `gemini-2.5-flash` per provider, overridable via `AI_MODEL`. Temperature comes from the page-type config where the provider supports it (Claude Opus 5 removed sampling parameters, so the Anthropic adapter deliberately doesn't send it). | Current defaults; one env var to change. |

---

## Honest stubs & limitations

Documented deliberately — these are simplifications, not oversights:

1. **No search-volume data.** Discovery is catalog-only and therefore **supply-biased**: it proposes what the store can support, not what people search for. The `KeywordVolumeProvider` interface (`services/discovery/keyword-volume.server.ts`) is the plug point; the keywords UI shows the volume column wired to the stub ("—").
2. **`llms.txt` / `sitemap-ai.xml` are served from app routes**, not the true store root. Production approach: a **Shopify App Proxy** (e.g. `/apps/seo/llms.txt` → this handler) so the files resolve on the store's own domain; the handlers already take the shop as a parameter and would work behind the proxy unchanged. Locally, links with `?shop=` are in Settings.
3. **Blog-article publishing is a simplification.** The JSON-LD declares these pages as `CollectionPage` (with a real ItemList of products) while the host document is technically a blog article — semantically defensible for a curated listing, but a production build would publish CollectionPage markup on a true collection-like template (metaobjects/theme extension) as described in question 4. Consequences accepted and noted: canonical/hreflang live in the JSON-LD, the stored SEO payload and `sitemap-ai.xml` (`xhtml:link` alternates) rather than `<head>` link tags, which require theme-level control; Shopify auto-emits a self-referencing canonical for each article, which matches our canonical for all non-variant pages.
4. **Currency reflects the store, not the market.** Product prices (and Offer currency in JSON-LD) come from the dev store's base currency; a production build would use Shopify Markets contextual pricing per locale. The locale configs already carry the target market currency for prompt context, so generated *copy* uses the right currency conventions.
5. **Synchronous generation.** Generation runs inside the request (roughly 30–90 s with retries). Right for a local demo, wrong at scale — see the roadmap.
6. **Placeholder product imagery** (picsum.photos, deterministic per handle) — seeding degrades gracefully to imageless products if the image service is unreachable.
7. **Local SQLite** session/app storage, per the template default; swap the Prisma datasource for production.

---

## Configuration reference

| File | Controls |
|---|---|
| `.env` | `AI_PROVIDER` (`anthropic` \| `openai` \| `gemini`), `AI_API_KEY`, `AI_MODEL` (optional) |
| `app/config/page-types/*.json` | Page-type identity, slug template, SEO templates, generation params (temperature, section/FAQ counts, system + user prompts), `output_schema` (JSON Schema enforced on every AI response) |
| `app/config/locales/*.json` | Market definition: language, currency, measurement system, slug prefix, hreflang, prompt briefing, facet translations, template tokens |
| Settings screen | Brand name/tone, competitor URLs, enabled + default locales, blog handle, minimum product threshold, catalog seeding |

## Scripts

```bash
npm run dev        # shopify app dev (auth, tunnel, install, HMR)
npm run build      # production build
npm run lint       # eslint
npx tsc --noEmit   # typecheck
```

## Examples

Three full pipeline outputs (all `content` blocks validate against the real page-type `output_schema`s — checked with the same ajv setup the pipeline uses):

- `examples/style-room.en-US.json` — style-based: botanical × living room
- `examples/use-case.en-US.json` — use-case-based: peel and stick for renters (note the `buying_guide` required only by this page type)
- `examples/style-room.de-DE.json` — non-English locale: *botanische Tapete fürs Wohnzimmer*, market-aware German (Sie-Form, metric, EUR, Schönheitsreparatur-Klausel), canonically consolidated onto its en-US cluster sibling
