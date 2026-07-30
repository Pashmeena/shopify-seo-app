# Wild Palace — Programmatic SEO PLP App

A plug & play Shopify app (Remix + TypeScript) that generates SEO-optimized, AI-written Product Listing Pages at scale:

**Keyword input → Intent parsing → Product matching → Content generation → PLP published**

Installable on any Shopify dev store. LLM-agnostic (Claude / GPT-4o / Gemini via `.env`). Four markets ship as config: en-US, en-GB, en-AU, de-DE.

---

## Scope & Assumptions

- **PLPs publish as Shopify blog articles** via the Blog/Article Admin GraphQL API, plus a small theme app extension for the head tags an article body cannot carry. A page the similarity check consolidates publishes as a **301 redirect** onto its canonical page instead of as an article, so the two never compete. See [Why blog articles?](#4-why-did-you-choose-your-publishing-mechanism).
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
npm test           # 462 unit tests
npm run typecheck
npm run lint
npm run build
```

---

## Architecture

```
app/
├── config/
│   ├── page-types/          # style-room, attribute-room, use-case,
│   │                        #   rental-compliance (de-DE only) — prompts, temperature,
│   │                        #   SEO templates, routing rules, output_schema
│   ├── locales/             # en-US, en-GB, en-AU, de-DE — language, currency, country,
│   │                        #   measurement system, terminology, market briefing,
│   │                        #   app-written headings, optional SEO template overrides
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
│   │                        #   consolidation guards + 301 redirects, publish
│   │                        #   orchestration + affected-page refresh
│   ├── ai-files/            # llms.txt and sitemap-ai.xml
│   └── plp/                 # repository + pipeline orchestrator
├── routes/                  # dashboard, keywords, page detail, settings, app-proxy files
├── components/              # shared Polaris pieces
└── test-support/            # fixtures; the example outputs are built from these
extensions/
└── plp-seo-head/            # theme app extension: hreflang + noindex in <head>
```

**Pipeline** (`services/plp/pipeline.server.ts`): parse intent → route to page type (market-aware) → **Gate 1** cluster already has a page? → **Gate 2** intent too similar? → **Gate 3** slug already taken? → match products (threshold; a saved preview selection wins) → price for the market → canonical decision → generate (validated against `output_schema`, retried with the validator's errors, never published if invalid) → resolve meta → assemble SEO → save as `draft` or `needs_review`.

**Page-type routing** (`services/intent/parse.server.ts`) picks the most specific page type that applies, comparing in a fixed order: more required facets, then more *value-constrained* facets, then market-restricted, then the explicit `routing_priority`, then id. The last comparison exists so the outcome can never depend on which config file globbed first — without it, renaming a file could silently re-route live keywords.

The constraint step is load-bearing rather than decorative. `rental-compliance` and `use-case` both require a `useCase`, so before `required_facet_values` existed the market-restricted page type won every German tie — and since `useCase: kids` is *derived* from `room: kids room`, a German kids-room keyword produced a page about tenancy law and deposit recovery. Right products, entirely wrong subject. A page type whose subject is one narrow scenario now has to name it (`{"useCase": ["renters"]}`), and the regression is pinned by tests.

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

**Where this guarantee stops.** It is one-directional: it holds from generation up to publication. A page that is already live and later falls below the threshold — the merchant edits the selection, or products leave the catalog — keeps its published status, with the thin-page warning downgraded to advisory rather than blocking. Publishing does not recount either, so raising `minProducts` after a draft exists does not re-gate that draft. Closing this properly is the `products/update` webhook on the [roadmap](ISSUES-AND-IMPROVEMENTS.md#roadmap-what-id-build-next); today the honest statement is "thin pages never *become* published", not "published pages never become thin".

Worth knowing before you try it: the brief's own example keyword, *"sustainable midnight blue wallpaper kids room"*, matches **one** product in the seeded catalog. All four facets are hard filters and only `starry-night-sky` carries all of them. That is the thin-content path working as designed, not a bug — but if you paste that keyword expecting a page, you will correctly get a held one. `washable wallpaper bathroom` (3 products) is the same path with a shorter keyword; `removable wallpaper bedroom` (6) is the `attribute-room` page type clearing the bar.

### 2. How does your prompt strategy differentiate pages targeting adjacent queries?

- **Different page types are different briefs, with different schemas.** `style-room` prompts an interior-design persona toward pattern scale, light and furniture pairing. `use-case` prompts a practical home-improvement persona toward suitability, removal and cost, and its schema *requires* a `buying_guide` the other has no concept of. `attribute-room` prompts a specification persona — what a durability claim means in testable terms, what a room does to a wall — and requires a `suitability_notes` block whose whole job is to state where the property stops being enough. `rental-compliance` is written in German for German tenancy law and requires `compliance_notes`. Adjacent pages of different types differ structurally, not lexically: four page types, four schemas, no shared optional block.
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
- *What the extension deliberately does not emit:* `<link rel="canonical">`. Every Theme Store theme already emits a self-referencing canonical for an article, an app extension renders after it and cannot remove it, and two canonicals naming different URLs is a mixed signal Google discards entirely. Under the [current policy](#canonical-policy-why-locale-is-not-a-reason-to-consolidate) every page is canonical for itself, so the theme's tag is already the tag this app wants. The extension stays out of the way and the payload it writes carries no canonical field at all.
- *How consolidation is emitted instead — a 301, not a tag:* the one case the theme's tag cannot serve is a same-market near-duplicate that should point at another page. Rather than record that decision somewhere and hope, the app **publishes it as a Shopify URL redirect**: `/blogs/<blog>/<duplicate>` 301s to `/blogs/<blog>/<canonical>`, and no article is created for the duplicate at all. This is strictly stronger than the tag it replaces — Shopify serves redirects as HTTP 301 and resolves them before the theme renders, so the duplicate never produces a competing document, there is no second entry in Shopify's own `sitemap.xml`, and link equity consolidates rather than merely being *suggested* to consolidate. A `rel=canonical` is a hint Google may override; a 301 is not. The cost is that the duplicate stops existing as a page, which is acceptable precisely because locale is never a reason to consolidate here: the only pages that reach this path are same-market duplicates, which should not have had separate URLs. Guards, the merchant override and the teardown rules live in `app/services/publishing/consolidation.server.ts`; it needs the `write_online_store_navigation` scope.
- *What production would do instead:* metaobject-backed templates or a full theme section, owning the head outright, with native product cards and Markets-aware pricing. Publishing is one isolated service behind the pipeline, so swapping the target changes nothing upstream.
- *Acknowledged wrinkle:* the JSON-LD declares `CollectionPage` while the host document is an article. Defensible for a curated listing, not what a production build would ship.

### 5. How does adding a new locale work — what does the merchant actually do?

Two steps, no code:

1. **Drop a JSON file** into `app/config/locales/`, e.g. `fr-FR.json`: language, market, currency, `country` (for Markets pricing), measurement system, slug prefix, hreflang code, a `promptContext` market briefing, `facetTranslations` and `tokens`. The registry discovers files by glob and validates them at startup, so a malformed or incomplete file fails loudly rather than silently — including a missing token, because that failure mode is *silent at runtime*: it ships an English heading onto a French page.
2. **Enable it in Settings** — it appears in the checklist automatically.

Everything downstream is locale-parameterized: slugs (`fr-fr-papier-peint-botanique-salon` from the same template), prompts, meta templates, hreflang pairing, breadcrumb labels, the FAQ and related-guides headings the app writes itself, and market currency in schema markup. The canonical policy is the deliberate exception — it is locale-*independent* by design, so a new market can never be consolidated away by the act of existing. See [the canonical policy](#canonical-policy-why-locale-is-not-a-reason-to-consolidate).

**Where "translate the values" is not enough, and what the config does about it.** A page type's SEO templates are written in one language's word order. `"{Style} Wallpaper for {Room}s"` localizes its values perfectly and its grammar not at all — de-DE resolved it to *"Botanische Wallpaper for Wohnzimmers"*: every value correct, the sentence English, the product noun untranslated, the plural formed by an English `-s`. Two fixes, both config:

- Templates now resolve the locale's own `tokens`, so `{wallpaper}` is "wallpaper" in en-US and "tapete" in de-DE — the same mechanism the slug builder already used, applied to the one place that had been missed.
- A market that needs different *phrasing*, not just different words, supplies `seoTemplates` keyed by page-type id and overrides the title, description or keyword list field by field. de-DE does; en-GB and en-AU supply nothing, because the shared English template already fits them. That asymmetry is the point — a market states only what makes it different.

The German overrides deliberately avoid definite articles (`"{Style} {Wallpaper} für {Room}"`, not "fürs Wohnzimmer"), because German article gender varies by noun — *das* Wohnzimmer but *die* Küche — and a template cannot inflect. The AI-written meta, which wins whenever it is valid, has no such constraint and does produce "fürs Wohnzimmer"; the template is the floor beneath it and has to be correct for every room, not fluent for one.

This mattered most for the keyword list, which is the one part of the SEO payload the AI never writes — so the leak shipped on every German page rather than only on the rare fallback.

**One honest caveat on "no code".** Everything a locale *renders* is config. Keyword *parsing* in a new language is not: the vocabulary that turns "papier peint salon" into `style` and `room` facets lives in `app/services/facets/vocabulary.server.ts`, and it currently knows English and German. Add `fr-FR.json` alone and French pages generate correctly, but French keywords parse only through the AI enrichment fallback (which is language-agnostic) rather than deterministically. Adding the French synonyms is one file and no architecture, but it is a code change, and claiming otherwise would be overselling.

en-GB and en-AU are the proof, and they carry real market briefings rather than spelling swaps — inverted seasons and fade resistance for Australia, Victorian chimney breasts and lining paper for the UK. A page type can also declare `locales` and exist for one market only; `rental-compliance` does, because German Schönheitsreparatur obligations have no counterpart in the other three markets. Such a page type must also constrain the facet values it claims, or being market-specific turns into claiming everything in that market — see [page-type routing](#architecture).

**One more honest caveat, on URL shape.** The brief's example of a market-reflecting URL is a path segment: `/en-us/`, `/de-de/`. This app puts the market in the *handle* instead — `/blogs/seo-plp/de-de-botanische-tapete-wohnzimmer` — because a Shopify blog article's URL is `/blogs/<blog>/<handle>` and an app cannot introduce a path segment into it without owning the theme's routing. The market is still in the URL, still distinct per locale, and still what hreflang and the canonical point at; it is one character different in shape from the brief's illustration. Template-based publishing ([roadmap item 1](ISSUES-AND-IMPROVEMENTS.md#roadmap-what-id-build-next)) is what would make the path form available.

### 6. How is your content structure optimized for AI retrieval, not just Google?

- **Standalone, citable FAQ answers**: the prompt requires every answer to restate its subject and make complete sense with zero surrounding context, with schema-enforced minimum lengths.
- **Topic declared in the first 100 words**: the intro must state style, room or use case, and what can be bought, before anything else.
- **`llms.txt`** at `https://<store>/apps/seo/llms.txt` — a plain-language index of what the store sells (facet vocabulary with counts) and every published PLP with intent, primary keyword, the phrasings it also answers, locale and product count. It also names the AI sitemap, so an agent that found one file does not have to guess the other exists. Generated from live data, so publishing updates it with nothing to invalidate.
- **`sitemap-ai.xml`** at `https://<store>/apps/seo/sitemap-ai.xml` — published pages only, annotated with intent summary, primary keyword, product count, locale and market, plus hreflang alternates.
- **Machine-legible body**: FAQPage JSON-LD mirrors the visible FAQ, ItemList enumerates the exact products with per-product Offers, headings follow a strict H1 → H2/H3 hierarchy.

Both files are served through a **Shopify App Proxy**, so they answer on the store's own domain and Shopify signs the request (the handler authenticates the shop rather than accepting it as a parameter). One honest correction to a claim an earlier draft of this README made: a proxy does **not** put them at the true store root. Shopify does not let an app claim `/llms.txt`. Reaching the root needs a redirect the merchant adds; the proxy gets you a stable, authenticated URL on the right domain, which is the part an app can actually own.

### 7. Known gaps and what you'd build next

The full answer lives in **[ISSUES-AND-IMPROVEMENTS.md](ISSUES-AND-IMPROVEMENTS.md)**: the deliberate [limitations](ISSUES-AND-IMPROVEMENTS.md#limitations), the [known issues](ISSUES-AND-IMPROVEMENTS.md#known-issues) found reading the current code (each naming its file and its fix), and the [ranked roadmap](ISSUES-AND-IMPROVEMENTS.md#roadmap-what-id-build-next).

The three items at the top of that roadmap:

1. **Metaobject or template-based publishing** — own the head, native product cards, live pricing. Consolidation no longer needs it (a 301 covers that case better than a tag would), but owning the head would also let the app control `robots`, pagination hints and the page-type declaration instead of inheriting the theme's `Article` schema.
2. **Real search-volume + SERP data** behind the existing `KeywordVolumeProvider` interface — turns supply-biased discovery into demand-ranked discovery.
3. **Background job queue** for generation. Currently synchronous inside a Remix action (30–90s with retries): right for a local demo, wrong at the scale this app is premised on. Deliberately not attempted here — it is a real architectural change with no infrastructure to run on, and half-doing it would have been worse than documenting it.

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
| "Too similar" | Weighted per-facet Jaccard. **≥ 0.85 blocks**, **0.6–0.85 flags** into review, and **≥ 0.75 additionally consolidates** onto the page it resembles. Identical cluster keys never generate twice per locale. | Explainable to a merchant, cheap, deterministic. Thresholds chosen so single-facet siblings (≈ 0.5) pass while reorderings (≈ 1.0) block — asserted in tests. |
| Canonical policy | **Locale is never a reason to consolidate.** Every market page is canonical for itself; variants are paired by hreflang. Consolidation applies to same-market near-duplicates scoring ≥ 0.75. See [the long version](#canonical-policy-why-locale-is-not-a-reason-to-consolidate). | Regional variants of one language are what hreflang is for; consolidating them removes a page from the market it was written for. Consolidation is kept for the case that genuinely is a duplicate. |
| Schema markup ownership | JSON-LD is **assembled in code** from real catalog data; the AI supplies copy, never structured facts. The brief's example put `schema_markup` in the AI output schema — deliberately deviated. | Prices and URLs in structured data must be exact, and models hallucinate exactly those. |
| Market pricing | Prices resolved per page via Shopify Markets contextual pricing for the locale's country; degrades to shop currency with a log when the market is unavailable. | An `Offer` advertising USD to a German shopper is a factually wrong structured-data claim. Not every store has Markets configured, so it must not be fatal. |
| CSV column mapping | Three tiers: known header names → AI on the header plus five sample rows → first column. Every tier reports which column it read. | Merchants upload exports from tools we have never seen, with headers in languages we cannot read. Tier 3 always answers, so an import never fails for want of a mapping — and never guesses silently. |
| Validation failures | Up to 3 attempts with the validator's concrete errors fed back. Still invalid → keyword marked `failed`, **no page created**. | "Invalid or incomplete responses must be retried or flagged — never published." |
| Transient provider failures | Separate from content retries: 429/5xx/timeout/network retried twice with backoff (1s, 4s) at the shared client layer. Bad key, bad request and refusal fail immediately. | A momentary hiccup shouldn't fail a generation; a wrong API key shouldn't waste 5s pretending it might work. |
| Alt-text coverage | Enforced in code, since the schema cannot know the product count. Missing entries get a deterministic intent-based fallback and the page is flagged noting the backfill. | Guarantees every product image has alt text without failing a whole generation for one omission. |
| Noindex | Draft and review pages **never leave the database** — the strongest noindex. `seo.hidden` and a robots meta fallback in the theme extension cover anything that must exist unindexed. | Shopify indexes published content immediately; the safest draft is one that isn't there. |
| Example outputs | Committed AI content, but products and the entire SEO payload are **re-derived by the real matcher and assembler**, with a test asserting the files still match. | The examples are a deliverable a reviewer reads as evidence. Hand-written ones had already drifted into claiming a shared facet that the page they pointed at did not have. |
| SEO template tokens | Facets **and locale tokens** are offered in two forms: `{style}`/`{wallpaper}` as stored (lowercase, mid-sentence) and `{Style}`/`{Wallpaper}` capitalized. Tokens are registered before facets, so a facet can never be shadowed by one. | Values are stored lowercase because they also build slugs. A title needs them capitalized, and German needs them capitalized wherever a noun appears — so the config author chooses per position rather than the code guessing. |
| Locale template overrides | A page type's SEO templates are the shared default; a market may override `title_template`, `description_template` or `keywords_template` per page type in its own config. Markets whose grammar already fits override nothing. | Translating a template's *values* does not translate its *grammar*. Overriding at the market boundary is config, not code, and keeps "adding a locale requires only configuration" true for the fallback copy as well as the AI copy. |
| Page-type routing | Compared in order: required-facet count, value-constraint count, market restriction, explicit `routing_priority`, then id. | The first three are structural; the fourth is a domain judgment a rule cannot make (style beats attribute when both apply); the fifth exists so the winner is never decided by which file globbed first. |
| Narrow page types | A page type keyed on a broad facet must constrain the values it accepts (`required_facet_values`). Validated: a constraint on a facet the page type does not require is refused as unevaluable. | Otherwise being market-specific becomes a licence to claim every keyword in that market. `rental-compliance` was doing exactly that to German kids-room queries. |
| Required locale tokens | The registry refuses a locale missing any of `wallpaper`, `breadcrumb_home`, `breadcrumb_blog`, `faq_heading`, `related_heading`. | These are the strings the *app* writes rather than the model. A missing one does not throw — it publishes an English heading onto a page in another language, which is the worst kind of bug: invisible in code review, visible to every visitor. |
| Meta keywords | Computed deterministically, stored on the payload, and emitted **only** into `llms.txt` — never as a `<meta name="keywords">` tag. | Search engines have ignored that tag for two decades, so emitting it would be cargo cult. But naming the phrasings a page is meant to answer is precisely what an AI index is for, so the field earns its place there instead of being dead data. |
| Default AI models | `claude-opus-5` / `gpt-4o` / `gemini-2.5-flash`, overridable via `AI_MODEL`. Temperature comes from page-type config for OpenAI and Gemini. The Anthropic adapter never forwards it — Claude Opus 5 rejects sampling parameters, and the adapter drops it unconditionally rather than branching per model, so pointing `AI_MODEL` at an older Claude silently ignores the page-type temperature. | Current defaults; one env var to change. The unconditional drop is a simplification, not a per-model capability check. |

### Canonical policy: why locale is not a reason to consolidate

This is the decision in this repo most worth arguing about, so here is the whole reasoning rather than a table cell.

**The brief asks for two things that contradict each other.** Section 7 requires a "self-referencing canonical tag" with hreflang between locale variants. Four bullets later, the third cannibalization mechanism requires "canonical consolidation — where near-duplicate pages must exist (e.g. for locale reasons), designate one as canonical and point variants to it". A page cannot both point at itself and point at something else. The brief never says how to settle it, so the resolution is a judgment call, and it is mine, not the brief's.

**The first answer this repo shipped was wrong.** It split on language: different languages stayed self-canonical, same-language markets consolidated onto the default locale. It looked like it satisfied both bullets. It does not survive contact with three facts:

1. *It is the opposite of the documented guidance for this case.* Google's "Localized versions" page gives "English-language content targeted to the US, GB, and Ireland" as the example of what hreflang is for. Its multi-regional page reserves consolidation for content that is genuinely the same at two addresses — its example is `example.de/` and `example.com/de/` serving identical German. Practitioners are blunter: pointing regional pages at a default is described as one of the most common and costly mistakes in international SEO, because the consolidated page stops appearing in its own market.
2. *It contradicted its own justification.* The old code argued that canonicalising a German page onto an English one forfeits the market that page was generated for. That argument is exactly as true of the Australian page — which this app deliberately writes with its own market briefing (harsh sun, fade resistance, Queenslanders). The rule undercut the sentence defending it.
3. *It decided from a locale code, before generation, without reading a word of either page.* Whether two pages duplicate each other is a property of their content, not of their market label. Product matching does not vary by locale, so an en-US and en-AU page for the same intent list identical products; whether the prose then diverges depends entirely on how much the market briefing has to say about that particular topic. Sometimes a great deal, sometimes almost nothing — and the old rule made the same call either way.

**The policy now.** Locale is never a reason to consolidate. Every market page is canonical for itself and its variants reference each other with hreflang, which is both the standard and — because a Shopify theme already emits a self-referencing canonical on every article — what the storefront was doing in practice regardless.

Consolidation is kept, because the brief requires it, and pointed at the case that genuinely is a near-duplicate: **two pages in the same market** whose intents land in the similarity flag band. Same language, same products, same shoppers. Only the upper part of the band qualifies — burying a page is a strong action, so `CONSOLIDATE_THRESHOLD` sits at 0.75 while the flag band opens at 0.6. Between 0.6 and 0.75 a page is reviewed but stays canonical for itself. The cross-market case is refused explicitly in `chooseCanonicalTarget` rather than merely being unreachable, so a future caller widening the similarity scope cannot silently resurrect the old behaviour.

**And it is emitted, not just decided.** A consolidation that only exists in a database is not a mechanism. Publishing a consolidated page installs a Shopify 301 from its path onto its canonical page's path and creates no article for it, so the duplicate never becomes a competing document — see Q4 for why a redirect beats a `rel=canonical` tag when the theme owns the head. The lifecycle is the part worth reviewing: the target must be published first (a redirect to a draft would 404), chains are refused (`A → B → C` loses signal at every hop), cross-market targets are refused a second time here, and the redirect is torn down whenever the consolidation is — by the merchant override, or by deleting either page. Shopify resolves redirects *before* the theme renders, so a redirect left behind would permanently shadow any article later published at that handle; every path that stops being a consolidation goes through `removeRedirect` for that reason. Deleting a consolidation target releases its dependents rather than leaving them pointing at a 404.

**What is honestly still missing.** The right test is a comparison of the *generated content*, not of parsed intent — two pages can share every facet and still read completely differently, or share few and say the same thing. Doing it properly means scoring the output text after generation, which cannot prevent the duplicate work, only label it. That is the next thing I would build, and it is the reason the threshold is deliberately conservative in the meantime.

**What a reviewer should push on.** If the en-AU page is genuinely differentiated, why does the app ever consolidate anything in the same language? Because a same-market pair shares the keyword, the products and the language, so the copy differing is not enough to stop them competing for one result slot. That is a defensible line, not an obvious one, and the honest answer is that it sits at the aggressive end of a real spectrum.

---

## Issues, limitations and roadmap

Kept in their own file so this one stays readable: **[ISSUES-AND-IMPROVEMENTS.md](ISSUES-AND-IMPROVEMENTS.md)**.

- **[Limitations](ISSUES-AND-IMPROVEMENTS.md#limitations)** — 13 deliberate simplifications, each with the reason it was chosen.
- **[Known issues](ISSUES-AND-IMPROVEMENTS.md#known-issues)** — concrete bugs and gaps in keyword ingestion, intent parsing, product matching, the JSON page-type configs, multi-locale support and technical SEO. Each names the file and the fix. None block the demo.
- **[Roadmap](ISSUES-AND-IMPROVEMENTS.md#roadmap-what-id-build-next)** — what I'd build next, in priority order.

---

## Testing

462 unit tests, no store or API key required: `npm test`.

Everything below the Shopify and AI boundaries is pure and tested — vocabulary and phrase matching, facet derivation, matching and scoring, cluster keys and similarity thresholds, canonical policy, slug localization, SEO assembly, CSV ingestion and column mapping, the validated-JSON client's retry and give-up behaviour, HTML escaping, `llms.txt` and `sitemap-ai.xml`, and the config registry's invariants.

The Shopify and AI boundaries are covered by injecting a fake client rather than mocking modules, so the real retry, validation and fallback paths execute.

`UPDATE_EXAMPLES=1 npm test` rewrites the derived halves of `examples/` after an intentional pipeline change.

CI runs typecheck, lint, tests and build on Node 20 and 22.

## Configuration reference

| File | Controls |
|---|---|
| `.env` | `AI_PROVIDER` (`anthropic` \| `openai` \| `gemini`), `AI_API_KEY`, `AI_MODEL` |
| `app/config/page-types/*.json` | Identity, `required_facets` (+ optional `required_facet_values`), optional `locales` restriction, optional `routing_priority`, slug template, SEO templates, generation params, `output_schema` |
| `app/config/locales/*.json` | Language, currency, country, measurement system, slug prefix, hreflang, market briefing, facet translations, `tokens` (incl. the headings the app writes: `faq_heading`, `related_heading`, breadcrumbs), optional `seoTemplates` overrides per page type |
| `app/services/facets/vocabulary.server.ts` | The domain vocabulary both keyword parsing and facet inference read |
| Settings screen | Brand name/tone, competitor URLs, enabled + default locales, blog handle, minimum product threshold, catalog seeding |

## Examples

Three full pipeline outputs. Content validates against the real page-type schemas; products and SEO payloads are re-derived by the real pipeline and verified by `app/services/plp/examples.test.ts`.

- `examples/style-room.en-US.json` — style-based: botanical × living room
- `examples/use-case.en-US.json` — use-case-based: peel and stick for renters (note the `buying_guide`, required only by this page type)
- `examples/style-room.de-DE.json` — non-English locale: market-aware German (Sie-Form, metric, EUR pricing in the `Offer`s, Schönheitsreparatur), self-canonical and paired with its en-US sibling by hreflang
