import { afterEach, describe, expect, it, vi } from "vitest";

import { goEndpointForModel, OpenCodeGoClient } from "./opencode-go";

const API_KEY = "sk-go-test";

function jsonResponse(body: unknown, status = 200, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(impl);
}

function clientWith(fetchFn: typeof fetch) {
  return new OpenCodeGoClient({
    apiKey: API_KEY,
    baseUrl: "https://go.example.test/v1",
    fetchFn,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("goEndpointForModel", () => {
  it("maps the responses-family models", () => {
    expect(goEndpointForModel("grok-4.6")).toBe("responses");
    expect(goEndpointForModel("gpt-5.6-luna")).toBe("responses");
    expect(goEndpointForModel("muse-spark-1.2-contributor")).toBe("responses");
  });

  it("maps the messages-family models", () => {
    expect(goEndpointForModel("minimax-m3")).toBe("messages");
    expect(goEndpointForModel("qwen3.8-max")).toBe("messages");
  });

  it("defaults everything else to chat completions", () => {
    expect(goEndpointForModel("deepseek-v4-flash")).toBe("chat-completions");
    expect(goEndpointForModel("kimi-k2.7-code")).toBe("chat-completions");
    expect(goEndpointForModel("unknown-model")).toBe("chat-completions");
  });
});

describe("OpenCodeGoClient.chatCompletions", () => {
  it("posts an OpenAI-compatible request and returns the completion", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        choices: [{ message: { content: "  hello from go  " } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
    );
    const client = clientWith(fetchFn as unknown as typeof fetch);

    const result = await client.chatCompletions({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
      maxOutputTokens: 512,
    });

    expect(result).toEqual({
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      text: "hello from go",
      usage: { inputTokens: 12, outputTokens: 4 },
    });

    const [url, init] = fetchFn.mock.calls[0];
    const requestInit = init as RequestInit;
    expect(url).toBe("https://go.example.test/v1/chat/completions");
    expect(requestInit).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer sk-go-test",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(requestInit.body as string)).toMatchObject({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
      max_completion_tokens: 512,
      stream: false,
    });
  });

  it("throws a protocol error on an empty completion", async () => {
    const client = clientWith((async () =>
      jsonResponse({ choices: [{ message: { content: "   " } }] })) as typeof fetch);

    await expect(
      client.chatCompletions({ model: "deepseek-v4-flash", messages: [] }),
    ).rejects.toMatchObject({ code: "protocol-error", provider: "opencode-go" });
  });
});

describe("OpenCodeGoClient.responses", () => {
  it("maps system messages to instructions and parses output text", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "built for you" }],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 5 },
      }),
    );
    const client = clientWith(fetchFn as unknown as typeof fetch);

    const result = await client.responses({
      model: "gpt-5.6-luna",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Build it" },
      ],
    });

    expect(result.text).toBe("built for you");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 5 });

    const [url, init] = fetchFn.mock.calls[0];
    const requestInit = init as RequestInit;
    expect(url).toBe("https://go.example.test/v1/responses");
    expect(JSON.parse(requestInit.body as string)).toMatchObject({
      model: "gpt-5.6-luna",
      instructions: "Be concise.",
      input: [{ role: "user", content: [{ type: "input_text", text: "Build it" }] }],
      stream: false,
    });
  });
});

describe("OpenCodeGoClient.listModels", () => {
  it("returns the data array", async () => {
    const client = clientWith((async () =>
      jsonResponse({ data: [{ id: "deepseek-v4-flash", owned_by: "deepseek" }] })) as typeof fetch);

    await expect(client.listModels()).resolves.toEqual([
      { id: "deepseek-v4-flash", owned_by: "deepseek" },
    ]);
  });

  it("throws on a malformed model list", async () => {
    const client = clientWith((async () => jsonResponse({ data: {} })) as typeof fetch);

    await expect(client.listModels()).rejects.toMatchObject({ code: "protocol-error" });
  });
});

describe("OpenCodeGoClient.chat dispatch", () => {
  it("routes chat-completions models to chat/completions", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const client = clientWith(fetchFn as unknown as typeof fetch);

    await client.chat({ model: "hy3", messages: [{ role: "user", content: "hi" }] });

    expect(fetchFn.mock.calls[0][0]).toBe("https://go.example.test/v1/chat/completions");
  });

  it("routes responses-family models to /responses", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
      }));
    const client = clientWith(fetchFn as unknown as typeof fetch);

    await client.chat({ model: "grok-4.6", messages: [{ role: "user", content: "hi" }] });

    expect(fetchFn.mock.calls[0][0]).toBe("https://go.example.test/v1/responses");
  });

  it("routes messages-family models to /messages with the Anthropic dialect", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        content: [{ type: "text", text: "  qwen replies  " }],
        usage: { input_tokens: 9, output_tokens: 3 },
      }));
    const client = clientWith(fetchFn as unknown as typeof fetch);

    const result = await client.chat({
      model: "qwen3.8-max",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "hi" },
      ],
      maxOutputTokens: 256,
    });

    expect(result).toEqual({
      provider: "opencode-go",
      model: "qwen3.8-max",
      text: "qwen replies",
      usage: { inputTokens: 9, outputTokens: 3 },
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://go.example.test/v1/messages");
    const requestInit = init as RequestInit;
    expect(requestInit.headers).toMatchObject({
      Authorization: "Bearer sk-go-test",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(requestInit.body as string)).toEqual({
      model: "qwen3.8-max",
      max_tokens: 256,
      system: "Be terse.",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
  });

  it("defaults max_tokens for messages-family models when the caller omits one", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({ content: [{ type: "text", text: "ok" }] }));
    const client = clientWith(fetchFn as unknown as typeof fetch);

    await client.chat({ model: "minimax-m3", messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBeUndefined();
  });

  it("throws a protocol error on an empty messages response", async () => {
    const client = clientWith((async () =>
      jsonResponse({ content: [] })) as typeof fetch);

    await expect(
      client.chat({ model: "minimax-m2.7", messages: [] }),
    ).rejects.toMatchObject({ code: "protocol-error", provider: "opencode-go" });
  });
});

describe("OpenCodeGoClient error handling", () => {
  it("maps HTTP status to typed errors", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
      [403, "unauthorized"],
      [429, "rate-limited"],
      [400, "bad-request"],
      [500, "server-error"],
    ];

    for (const [status, code] of cases) {
      const client = clientWith((async () => jsonResponse({ error: "nope" }, status)) as typeof fetch);
      await expect(
        client.chatCompletions({ model: "hy3", messages: [] }),
      ).rejects.toMatchObject({ code, status });
    }
  });

  it("wraps network failures", async () => {
    const client = clientWith((() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch);

    await expect(
      client.chatCompletions({ model: "hy3", messages: [] }),
    ).rejects.toMatchObject({ code: "network-error" });
  });

  it("times out when the gateway stalls", async () => {
    vi.useFakeTimers();
    const fetchFn = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const client = new OpenCodeGoClient({
      apiKey: API_KEY,
      baseUrl: "https://go.example.test/v1",
      fetchFn,
      timeoutMs: 50,
    });

    const pending = client.chatCompletions({ model: "hy3", messages: [] });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it("propagates caller-initiated abort", async () => {
    const controller = new AbortController();
    const fetchFn = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const client = clientWith(fetchFn);

    const pending = client.chatCompletions({
      model: "hy3",
      messages: [],
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "network-error" });
  });
});
