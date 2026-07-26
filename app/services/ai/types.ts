/**
 * LLM-agnostic AI layer. Switching from Claude to GPT-4o to Gemini is a
 * .env change (AI_PROVIDER / AI_API_KEY / AI_MODEL) — no code changes.
 */

export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

export interface CompletionRequest {
  system: string;
  user: string;
  /**
   * Sampling temperature from the page-type config. Applied where the
   * provider supports it; Claude Opus 5 removed sampling parameters, so
   * the Anthropic provider ignores it by design.
   */
  temperature?: number;
  maxTokens?: number;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly model: string;
  /** Run one completion and return the raw text of the response. */
  complete(request: CompletionRequest): Promise<string>;
}

export class AiConfigError extends Error {}

export class AiRefusalError extends Error {}
