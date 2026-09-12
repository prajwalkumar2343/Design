import { describe, expect, it, vi } from "vitest";
import { extractResponsesOutputText, requestJson } from "./http";
import { LLMError } from "./types";

const SECRET_KEY = "sk-super-secret-key-that-must-not-leak";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function expectLLMError(promise: Promise<unknown>, code: string): Promise<LLMError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LLMError);
    const llmError = error as LLMError;
    expect(llmError.code).toBe(code);
    return llmError;
  }
  throw new Error(`Expected LLMError(${code})`);
}

describe("requestJson", () => {
  it("sends the bearer key and JSON body and returns the parsed payload", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
    const result = await requestJson({
      provider: "gemini",
      url: "https://example.com/api",
      apiKey: SECRET_KEY,
      body: { prompt: "hi" },
      fetchFn,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(init.body).toBe(JSON.stringify({ prompt: "hi" }));
  });

  it("supports non-bearer auth headers that override Authorization", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}));
    await requestJson({
      provider: "gemini",
      url: "https://example.com/api",
      apiKey: SECRET_KEY,
      authHeader: { name: "x-goog-api-key", value: SECRET_KEY },
      fetchFn,
    });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe(SECRET_KEY);
    expect(headers.Authorization).toBeUndefined();
  });

  it("maps HTTP status codes to typed error codes", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
      [403, "unauthorized"],
      [429, "rate-limited"],
      [400, "bad-request"],
      [404, "bad-request"],
      [500, "server-error"],
      [503, "server-error"],
    ];
    for (const [status, code] of cases) {
      const fetchFn = vi.fn(async () => new Response("nope", { status }));
      const error = await expectLLMError(
        requestJson({ provider: "codex-chatgpt", url: "u", apiKey: SECRET_KEY, fetchFn }),
        code,
      );
      expect(error.status).toBe(status);
    }
  });

  it("truncates long error bodies and never echoes the Authorization header", async () => {
    const fetchFn = vi.fn(async () => new Response("x".repeat(500), { status: 500 }));
    const error = await expectLLMError(
      requestJson({ provider: "gemini", url: "u", apiKey: SECRET_KEY, fetchFn }),
      "server-error",
    );
    // The detail is capped at 200 chars and the credential only ever lives in
    // the request headers — it must not appear in the error surface.
    expect(error.message.length).toBeLessThan(400);
    expect(error.message).not.toContain(SECRET_KEY);
    expect(error.message).not.toContain("Bearer");
  });

  it("normalizes network failures into network-error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expectLLMError(
      requestJson({ provider: "gemini", url: "u", apiKey: SECRET_KEY, fetchFn }),
      "network-error",
    );
  });

  it("distinguishes caller aborts from internal timeouts", async () => {
    // Caller aborts surface as network-error (aborted), internal timeout as timeout.
    const callerController = new AbortController();
    const abortingFetch = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const promise = requestJson({
      provider: "gemini",
      url: "u",
      apiKey: SECRET_KEY,
      signal: callerController.signal,
      fetchFn: abortingFetch as unknown as typeof fetch,
    });
    callerController.abort();
    await expectLLMError(promise, "network-error");

    const timeoutFetch = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    await expectLLMError(
      requestJson({
        provider: "gemini",
        url: "u",
        apiKey: SECRET_KEY,
        timeoutMs: 5,
        fetchFn: timeoutFetch as unknown as typeof fetch,
      }),
      "timeout",
    );
  });

  it("returns null for 204 and reports invalid JSON as a protocol error", async () => {
    const empty = await requestJson({
      provider: "gemini",
      url: "u",
      apiKey: SECRET_KEY,
      fetchFn: vi.fn(async () => new Response(null, { status: 204 })),
    });
    expect(empty.body).toBeNull();

    await expectLLMError(
      requestJson({
        provider: "gemini",
        url: "u",
        apiKey: SECRET_KEY,
        fetchFn: vi.fn(async () => new Response("not json{", { status: 200 })),
      }),
      "protocol-error",
    );
  });
});

describe("extractResponsesOutputText", () => {
  it("prefers the top-level output_text when present", () => {
    expect(extractResponsesOutputText({
      output_text: "  direct  ",
      output: [{ type: "message", content: [{ type: "output_text", text: "ignored" }] }],
    })).toBe("  direct  ");
  });

  it("concatenates message output_text parts and skips non-message items", () => {
    const text = extractResponsesOutputText({
      output: [
        { type: "reasoning" },
        { type: "message", content: [{ type: "output_text", text: "Hello" }, { type: "refusal" }] },
        { type: "message", content: [{ type: "output_text", text: " world" }] },
      ],
    });
    expect(text).toBe("Hello world");
  });

  it("returns an empty string when nothing is usable", () => {
    expect(extractResponsesOutputText({})).toBe("");
    expect(extractResponsesOutputText({ output_text: "   " })).toBe("");
  });
});
