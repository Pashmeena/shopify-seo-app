import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiOutputInvalidError,
  completeValidatedJson,
  formatAjvErrors,
  getValidator,
} from "./json-client.server";
import { AiRefusalError, type AiProvider } from "./types";

/**
 * The content quality gate: no AI response reaches the publishing pipeline
 * until it satisfies its page type's schema. The brief's requirement is that
 * an invalid response is "retried or flagged, never published", so both the
 * retry behaviour and the give-up behaviour are pinned down here.
 *
 * The transient layer is deliberately separate from the content layer. A rate
 * limit should cost a backoff; a wrong API key should fail immediately rather
 * than burning three attempts pretending it might work.
 */

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["h1", "sections"],
  properties: {
    h1: { type: "string", minLength: 5 },
    sections: { type: "array", minItems: 2 },
  },
};

const VALID = { h1: "Botanical Wallpaper", sections: ["a", "b"] };

let schemaCounter = 0;
/** A fresh cache key per test, since compiled validators are memoized by key. */
function validator() {
  return getValidator(`test-${++schemaCounter}`, SCHEMA);
}

function provider(
  complete: AiProvider["complete"],
): AiProvider & { complete: ReturnType<typeof vi.fn> } {
  return {
    name: "anthropic",
    model: "test-model",
    complete: vi.fn(complete),
  } as AiProvider & { complete: ReturnType<typeof vi.fn> };
}

const REQUEST = { system: "system", user: "user" };

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("validation", () => {
  it("returns the parsed object on a first-attempt success", async () => {
    const ai = provider(async () => JSON.stringify(VALID));

    const result = await completeValidatedJson(ai, REQUEST, validator());

    expect(result).toEqual({ data: VALID, attempts: 1 });
    expect(ai.complete).toHaveBeenCalledTimes(1);
  });

  it("retries with the validator's own errors appended to the prompt", async () => {
    const ai = provider(async ({ user }) =>
      user.includes("rejected")
        ? JSON.stringify(VALID)
        : JSON.stringify({ h1: "Hi", sections: [] }),
    );

    const result = await completeValidatedJson(ai, REQUEST, validator());

    expect(result.attempts).toBe(2);
    const retryPrompt = ai.complete.mock.calls[1][0].user;
    expect(retryPrompt).toContain("Your previous attempt was rejected");
    // The concrete failure, not a generic "try again".
    expect(retryPrompt).toMatch(/h1|sections/);
  });

  it("retries when the response is not JSON at all", async () => {
    const ai = provider(async ({ user }) =>
      user.includes("rejected") ? JSON.stringify(VALID) : "I'd be happy to help!",
    );

    const result = await completeValidatedJson(ai, REQUEST, validator());

    expect(result.attempts).toBe(2);
    expect(ai.complete.mock.calls[1][0].user).toContain("not valid JSON");
  });

  it("gives up after three attempts and never returns bad content", async () => {
    const ai = provider(async () => JSON.stringify({ h1: "no" }));

    await expect(
      completeValidatedJson(ai, REQUEST, validator()),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
    expect(ai.complete).toHaveBeenCalledTimes(3);
  });

  it("reports the last validation failure on the thrown error", async () => {
    const ai = provider(async () => JSON.stringify({ h1: "no" }));

    await expect(completeValidatedJson(ai, REQUEST, validator())).rejects.toThrow(
      /failed validation after 3 attempts/,
    );
  });

  it("rejects properties the schema does not declare", async () => {
    // additionalProperties: false is what stops a model inventing fields the
    // renderer would silently ignore.
    const ai = provider(async () => JSON.stringify({ ...VALID, extra: "nope" }));

    await expect(
      completeValidatedJson(ai, REQUEST, validator()),
    ).rejects.toBeInstanceOf(AiOutputInvalidError);
  });

  it("tolerates a fenced code block around otherwise valid JSON", async () => {
    const ai = provider(async () => `\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``);

    const result = await completeValidatedJson(ai, REQUEST, validator());

    expect(result.data).toEqual(VALID);
    expect(result.attempts).toBe(1);
  });

  it("tolerates prose around the object", async () => {
    const ai = provider(
      async () => `Here you go:\n${JSON.stringify(VALID)}\nHope that helps.`,
    );

    expect((await completeValidatedJson(ai, REQUEST, validator())).data).toEqual(
      VALID,
    );
  });
});

describe("transient provider failures", () => {
  /**
   * The backoffs are real seconds in production. Faking the clock keeps the
   * behaviour under test (how many attempts, in what order) without paying
   * for the waiting.
   */
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Drive the pending backoff timers to completion. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    const raced = promise.catch((error) => ({ __thrown: error }) as never);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = (await raced) as T & { __thrown?: unknown };
    if (result && typeof result === "object" && "__thrown" in result) {
      throw result.__thrown;
    }
    return result;
  }

  it.each([408, 429, 500, 502, 503, 504, 529])(
    "retries HTTP %i and then succeeds",
    async (status) => {
      let calls = 0;
      const ai = provider(async () => {
        if (++calls === 1) throw httpError(status);
        return JSON.stringify(VALID);
      });

      const result = await settle(
        completeValidatedJson(ai, REQUEST, validator()),
      );

      expect(result.data).toEqual(VALID);
      expect(ai.complete).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE"])(
    "retries network error %s",
    async (code) => {
      let calls = 0;
      const ai = provider(async () => {
        if (++calls === 1) throw Object.assign(new Error("socket"), { code });
        return JSON.stringify(VALID);
      });

      const result = await settle(
        completeValidatedJson(ai, REQUEST, validator()),
      );

      expect(result.data).toEqual(VALID);
    },
  );

  it("retries a transient error nested in `cause`", async () => {
    let calls = 0;
    const ai = provider(async () => {
      if (++calls === 1) {
        throw Object.assign(new Error("fetch failed"), {
          cause: { code: "ECONNREFUSED" },
        });
      }
      return JSON.stringify(VALID);
    });

    const result = await settle(completeValidatedJson(ai, REQUEST, validator()));

    expect(result.data).toEqual(VALID);
  });

  it.each([400, 401, 403, 404, 422])(
    "fails immediately on HTTP %i, without burning attempts",
    async (status) => {
      const ai = provider(async () => {
        throw httpError(status);
      });

      await expect(
        settle(completeValidatedJson(ai, REQUEST, validator())),
      ).rejects.toThrow(`HTTP ${status}`);
      expect(ai.complete).toHaveBeenCalledTimes(1);
    },
  );

  it("never retries a refusal", async () => {
    const ai = provider(async () => {
      throw new AiRefusalError("declined");
    });

    await expect(
      settle(completeValidatedJson(ai, REQUEST, validator())),
    ).rejects.toBeInstanceOf(AiRefusalError);
    expect(ai.complete).toHaveBeenCalledTimes(1);
  });

  it("gives up after two backoffs rather than retrying forever", async () => {
    const ai = provider(async () => {
      throw httpError(503);
    });

    await expect(
      settle(completeValidatedJson(ai, REQUEST, validator())),
    ).rejects.toThrow();
    expect(ai.complete).toHaveBeenCalledTimes(3);
  });
});

describe("getValidator", () => {
  it("reuses the compiled validator for a key", () => {
    expect(getValidator("cache-key", SCHEMA)).toBe(
      getValidator("cache-key", SCHEMA),
    );
  });
});

describe("formatAjvErrors", () => {
  it("names the failing path and the reason", () => {
    const validate = validator();
    validate({ h1: "no", sections: [] });

    const text = formatAjvErrors(validate.errors);

    expect(text).toContain("/h1");
    expect(text).toContain("/sections");
  });

  it("says something useful when there is nothing to report", () => {
    expect(formatAjvErrors(null)).toBe("unknown validation error");
    expect(formatAjvErrors([])).toBe("unknown validation error");
  });
});
