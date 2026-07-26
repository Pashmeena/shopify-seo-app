/** Parse JSON, returning `undefined` instead of throwing. */
export function safeParseJson<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Parse a JSON array column, defaulting to []. */
export function parseJsonArray<T = string>(raw: string | null | undefined): T[] {
  const parsed = safeParseJson<T[]>(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Extract a JSON object from an AI response. Models are instructed to
 * return bare JSON, but this tolerates stray code fences or prose around
 * the object rather than failing the whole generation for cosmetic noise.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to fence/substring extraction
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Response contained no parseable JSON object");
}
