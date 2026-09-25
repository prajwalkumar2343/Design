import { describe, expect, it } from "vitest";

import { LLMError } from "./types";

describe("LLMError", () => {
  it("carries the code, provider, and status", () => {
    const error = new LLMError("rate-limited", "gemini", "too many requests", { status: 429 });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("LLMError");
    expect(error.code).toBe("rate-limited");
    expect(error.provider).toBe("gemini");
    expect(error.status).toBe(429);
    expect(error.message).toBe("too many requests");
  });

  it("defaults status to null and forwards a cause", () => {
    const cause = new TypeError("fetch failed");
    const error = new LLMError("network-error", "codex-chatgpt", "request failed", { cause });

    expect(error.status).toBeNull();
    expect(error.cause).toBe(cause);
  });
});
