import OpenAI from "openai";
import type { AiProvider, CompletionRequest } from "../types";

export const DEFAULT_OPENAI_MODEL = "gpt-4o";

export function createOpenAiProvider(apiKey: string, model?: string): AiProvider {
  const client = new OpenAI({ apiKey });
  const resolvedModel = model || DEFAULT_OPENAI_MODEL;

  return {
    name: "openai",
    model: resolvedModel,

    async complete(request: CompletionRequest): Promise<string> {
      const response = await client.chat.completions.create({
        model: resolvedModel,
        // max_completion_tokens works across gpt-4o and newer reasoning
        // models, keeping AI_MODEL a true config-only switch.
        max_completion_tokens: request.maxTokens ?? 16000,
        temperature: request.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      });
      const text = response.choices[0]?.message?.content;
      if (!text) throw new Error("OpenAI returned an empty response");
      return text;
    },
  };
}
