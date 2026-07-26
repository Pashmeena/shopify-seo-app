import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { extractJsonObject } from "../../lib/json";
import type { AiProvider, CompletionRequest } from "./types";

/**
 * Validated JSON completions. Every AI response is parsed and validated
 * against the page type's output_schema (JSON Schema, via ajv) before it
 * can enter the pipeline. Invalid responses are retried with the
 * validation errors fed back to the model; if retries are exhausted the
 * error propagates and the page is flagged — never published.
 */

const MAX_ATTEMPTS = 3;

const ajv = new Ajv({ allErrors: true, strict: false });
const compiledSchemas = new Map<string, ValidateFunction>();

/** Compile (and cache) a JSON Schema keyed by page-type id. */
export function getValidator(key: string, schema: Record<string, unknown>): ValidateFunction {
  let validator = compiledSchemas.get(key);
  if (!validator) {
    validator = ajv.compile(schema);
    compiledSchemas.set(key, validator);
  }
  return validator;
}

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
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

    const raw = await provider.complete({ ...request, user });

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
