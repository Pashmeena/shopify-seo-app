import type { LocaleConfig } from "../../config/types";
import { completeValidatedJson, getValidator } from "../ai/json-client.server";
import { getAiProvider } from "../ai/provider.server";
import type { CatalogProduct } from "../catalog/types";
import { buildGenerationPrompt, type PromptInput } from "./prompt.server";
import type { GenerationResult, PlpContent } from "./types";

/**
 * AI content generation for one PLP. The response must satisfy the page
 * type's output_schema (validated with ajv, retried with error feedback);
 * anything that still fails is thrown by the JSON client and the page is
 * flagged for review upstream — invalid content never proceeds.
 */
export async function generatePlpContent(input: PromptInput): Promise<GenerationResult> {
  const provider = getAiProvider();
  const prompt = buildGenerationPrompt(input);
  const validator = getValidator(
    `page-type:${input.pageType.id}`,
    input.pageType.output_schema,
  );

  const { data, attempts } = await completeValidatedJson<PlpContent>(
    provider,
    {
      system: prompt.system,
      user: prompt.user,
      temperature: prompt.temperature,
      maxTokens: 16000,
    },
    validator,
  );

  const backfilledAltTextIds = ensureAltTextCoverage(
    data,
    input.products,
    input.intent.keyword,
    input.locale,
  );

  return {
    content: data,
    provider: provider.name,
    model: provider.model,
    attempts,
    backfilledAltTextIds,
  };
}

/**
 * The schema can't know the product count, so coverage is enforced here:
 * every matched product must have alt text. Missing entries get a
 * deterministic intent-based fallback rather than failing the whole
 * generation, and the backfill is reported so the UI can show it.
 *
 * The fallback is built from the locale's own token table and the keyword,
 * which is already in the market's language — an English noun on a German
 * page would be a locale leak on the one surface a screen reader reads
 * aloud.
 */
function ensureAltTextCoverage(
  content: PlpContent,
  products: CatalogProduct[],
  keyword: string,
  locale: LocaleConfig,
): string[] {
  const covered = new Set(content.product_alt_texts.map((entry) => entry.product_id));
  const backfilled: string[] = [];
  const noun = locale.tokens.wallpaper;

  for (const product of products) {
    if (covered.has(product.id) || covered.has(product.handle)) continue;
    content.product_alt_texts.push({
      product_id: product.id,
      alt_text: `${product.title}${noun ? ` ${noun}` : ""} — ${keyword}`,
    });
    backfilled.push(product.id);
  }
  return backfilled;
}
