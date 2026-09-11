import { describe, expect, it, vi } from "vitest";

import { CodexClient, DEFAULT_CODEX_MODEL } from "./codex";

const API_KEY = "chtk-test";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(impl);
}

function clientWith(fetchFn: typeof fetch) {
  return new CodexClient({
    apiKey: API_KEY,
    baseUrl: "https://chatgpt.example.test/backend-api/codex",
    fetchFn,
  });
}

describe("CodexClient.chat", () => {
  it("posts to the Codex responses endpoint with the ChatGPT token", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "  signed in  " }],
          },
        ],
        usage: { input_tokens: 30, output_tokens: 7 },
      }),
    );
    const client = clientWith(fetchFn as unknown as typeof fetch);

    const result = await client.chat({
      model: "gpt-5.6-sol",
      messages: [
        { role: "system", content: "You are Codex." },
        { role: "user", content: "Summarize the brief" },
      ],
    });

    expect(result).toEqual({
      provider: "codex-chatgpt",
      model: "gpt-5.6-sol",
      text: "signed in",
      usage: { inputTokens: 30, outputTokens: 7 },
    });

    const [url, init] = fetchFn.mock.calls[0];
    const requestInit = init as RequestInit;
    expect(url).toBe("https://chatgpt.example.test/backend-api/codex/responses");
    expect(requestInit.headers).toMatchObject({
      Authorization: "Bearer chtk-test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(requestInit.body as string)).toMatchObject({
      model: "gpt-5.6-sol",
      instructions: "You are Codex.",
      input: [{ role: "user", content: [{ type: "input_text", text: "Summarize the brief" }] }],
      stream: false,
    });
  });

  it("defaults to the current Codex model when none is supplied", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        output: [
          { type: "message", content: [{ type: "output_text", text: "ok" }] },
        ],
      }),
    );
    const client = clientWith(fetchFn as unknown as typeof fetch);

    const result = await client.chat({ messages: [{ role: "user", content: "hi" }] });

    expect(DEFAULT_CODEX_MODEL).toBe("gpt-5.3-codex");
    expect(result.model).toBe(DEFAULT_CODEX_MODEL);
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string).model)
      .toBe(DEFAULT_CODEX_MODEL);
  });

  it("supports the convenience output_text field", async () => {
    const client = clientWith((async () =>
      jsonResponse({ output_text: "short answer" })) as typeof fetch);

    const result = await client.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("short answer");
  });

  it("throws a protocol error on an empty response", async () => {
    const client = clientWith((async () => jsonResponse({ output: [] })) as typeof fetch);

    await expect(
      client.chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "protocol-error", provider: "codex-chatgpt" });
  });

  it("maps a 401 to unauthorized", async () => {
    const client = clientWith((async () => jsonResponse({ error: "expired token" }, 401)) as typeof fetch);

    await expect(
      client.chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });
});
