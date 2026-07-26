import { GoogleGenAI } from "@google/genai";
import type { AiProvider, CompletionRequest } from "../types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export function createGeminiProvider(apiKey: string, model?: string): AiProvider {
  const client = new GoogleGenAI({ apiKey });
  const resolvedModel = model || DEFAULT_GEMINI_MODEL;

  return {
    name: "gemini",
    model: resolvedModel,

    async complete(request: CompletionRequest): Promise<string> {
      const response = await client.models.generateContent({
        model: resolvedModel,
        contents: request.user,
        config: {
          systemInstruction: request.system,
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens ?? 16000,
          responseMimeType: "application/json",
        },
      });
      const text = response.text;
      if (!text) throw new Error("Gemini returned an empty response");
      return text;
    },
  };
}
