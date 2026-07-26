import Anthropic from "@anthropic-ai/sdk";
import { AiRefusalError, type AiProvider, type CompletionRequest } from "../types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export function createAnthropicProvider(apiKey: string, model?: string): AiProvider {
  const client = new Anthropic({ apiKey });
  const resolvedModel = model || DEFAULT_ANTHROPIC_MODEL;

  return {
    name: "anthropic",
    model: resolvedModel,

    async complete(request: CompletionRequest): Promise<string> {
      // Claude Opus 5 rejects sampling parameters (temperature/top_p), so the
      // page-type temperature is intentionally not forwarded here.
      const response = await client.messages.create({
        model: resolvedModel,
        max_tokens: request.maxTokens ?? 16000,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
      });
      if (response.stop_reason === "refusal") {
        throw new AiRefusalError("Anthropic declined the request (stop_reason: refusal)");
      }
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (!text) throw new Error("Anthropic returned an empty response");
      return text;
    },
  };
}
