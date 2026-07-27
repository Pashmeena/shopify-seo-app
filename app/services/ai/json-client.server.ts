import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { extractJsonObject } from "../../lib/json";
import {
  AiRefusalError,
  type AiProvider,
  type CompletionRequest,
} from "./types";

/**
 * Validated JSON completions. Every AI response is parsed and validated
 * against the page type's output_schema (JSON Schema, via ajv) before it
 * can enter the pipeline. Invalid responses are retried with the
 * validation errors fed back to the model; if retries are exhausted the
 * error propagates and the page is flagged — never published.
 *
 * Two retry layers, deliberately separate:
 * - content retries (MAX_ATTEMPTS): the model answered but the JSON was
 *   bad — re-ask with the validator's errors appended.
 * - transient retries (TRANSIENT_RETRY_DELAYS_MS): the provider itself
 *   hiccuped (rate limit, 5xx, network drop) — same request again after
 *   a backoff. Permanent failures (bad key, bad request, refusal) are
 *   never retried. Applied here, once, so all providers get it uniformly.
 */

const MAX_ATTEMPTS = 3;

const TRANSIENT_RETRY_DELAYS_MS = [1000, 4000];

// 429 rate limit, 408 timeout, 5xx server errors, 529 Anthropic overloaded.
const TRANSIENT_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

function isTransientAiError(error: unknown): boolean {
  if (error instanceof AiRefusalError) return false;
  const { status, code, cause } = (error ?? {}) as {
    status?: unknown;
    code?: unknown;
    cause?: unknown;
  };
  if (typeof status === "number") return TRANSIENT_HTTP_STATUS.has(status);
  if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code))
    return true;
  const causeCode = (cause as { code?: unknown } | undefined)?.code;
  if (typeof causeCode === "string" && TRANSIENT_NETWORK_CODES.has(causeCode))
    return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return /fetch failed|network|timed? ?out|socket hang up|terminated|overloaded|empty response/.test(
    message,
  );
}

/** One completion, with backoff-retry on transient provider failures. */
async function completeWithRetry(
  provider: AiProvider,
  request: CompletionRequest,
): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      return await provider.complete(request);
    } catch (error) {
      if (i >= TRANSIENT_RETRY_DELAYS_MS.length || !isTransientAiError(error))
        throw error;
      const delay = TRANSIENT_RETRY_DELAYS_MS[i];
      console.warn(
        `AI provider "${provider.name}" transient failure (${error instanceof Error ? error.message : String(error)}) — retrying in ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const ajv = new Ajv({ allErrors: true, strict: false });
const compiledSchemas = new Map<string, ValidateFunction>();

/** Compile (and cache) a JSON Schema keyed by page-type id. */
export function getValidator(
  key: string,
  schema: Record<string, unknown>,
): ValidateFunction {
  let validator = compiledSchemas.get(key);
  if (!validator) {
    validator = ajv.compile(schema);
    compiledSchemas.set(key, validator);
  }
  return validator;
}

export function formatAjvErrors(
  errors: ErrorObject[] | null | undefined,
): string {
  if (!errors?.length) return "unknown validation error";
  return errors
    .map((e) => `${e.instancePath || "(root)"} ${e.message ?? ""}`.trim())
    .join("; ");
}

export class AiOutputInvalidError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
  ) {
    super(message);
  }
}

export interface ValidatedJsonResult<T> {
  data: T;
  attempts: number;
}

/**
 * Run a completion and return the parsed object only once it satisfies
 * `validator`. On parse/validation failure the model is re-asked with the
 * concrete errors appended, up to MAX_ATTEMPTS total.
 */
export async function completeValidatedJson<T>(
  provider: AiProvider,
  request: CompletionRequest,
  validator: ValidateFunction,
): Promise<ValidatedJsonResult<T>> {
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const user =
      attempt === 1
        ? request.user
        : `${request.user}\n\nYour previous attempt was rejected: ${lastError}\nReturn the corrected JSON object only.`;

    const raw = await completeWithRetry(provider, { ...request, user });

    let parsed: unknown;
    try {
      parsed = extractJsonObject(raw);
    } catch (error) {
      lastError = `response was not valid JSON (${error instanceof Error ? error.message : "parse error"})`;
      continue;
    }

    if (validator(parsed)) {
      return { data: parsed as T, attempts: attempt };
    }
    lastError = `JSON failed schema validation: ${formatAjvErrors(validator.errors)}`;
  }

  throw new AiOutputInvalidError(
    `AI output failed validation after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
    MAX_ATTEMPTS,
  );
}
