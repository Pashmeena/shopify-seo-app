import { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./providers/anthropic.server";
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "./providers/gemini.server";
import { createOpenAiProvider, DEFAULT_OPENAI_MODEL } from "./providers/openai.server";
import { AI_PROVIDERS, AiConfigError, type AiProvider, type AiProviderName } from "./types";

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  openai: DEFAULT_OPENAI_MODEL,
  gemini: DEFAULT_GEMINI_MODEL,
};

const FACTORIES: Record<AiProviderName, (apiKey: string, model?: string) => AiProvider> = {
  anthropic: createAnthropicProvider,
  openai: createOpenAiProvider,
  gemini: createGeminiProvider,
};

function readEnv() {
  const provider = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
  return {
    provider,
    apiKey: process.env.AI_API_KEY || "",
    model: process.env.AI_MODEL || undefined,
  };
}

function isProviderName(value: string): value is AiProviderName {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

/** Build the configured provider from .env, or throw a readable config error. */
export function getAiProvider(): AiProvider {
  const { provider, apiKey, model } = readEnv();
  if (!isProviderName(provider)) {
    throw new AiConfigError(
      `AI_PROVIDER="${provider}" is not supported. Use one of: ${AI_PROVIDERS.join(", ")}.`,
    );
  }
  if (!apiKey) {
    throw new AiConfigError(
      "AI_API_KEY is not set. Add it to .env (see .env.example) to enable content generation.",
    );
  }
  return FACTORIES[provider](apiKey, model);
}

/** Non-throwing status for the Settings UI. */
export function getAiStatus() {
  const { provider, apiKey, model } = readEnv();
  const known = isProviderName(provider);
  return {
    provider,
    model: model ?? (known ? DEFAULT_MODELS[provider] : null),
    configured: known && Boolean(apiKey),
  };
}
