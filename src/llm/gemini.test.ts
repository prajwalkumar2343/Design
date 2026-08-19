import { describe, expect, it, vi } from "vitest";

import { DEFAULT_GEMINI_MODEL, GeminiClient, GEMINI_FLASH_MODEL_IDS } from "./gemini";

const API_KEY = "gem-test-key";

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
  return new GeminiClient({
    apiKey: API_KEY,
    baseUrl: "https://gemini.example.test/v1beta",
    fetchFn,
  });
}

describe("Gemini model constants", () => {
  it("exposes the 3.5/3.6/3.7 Flash family", () => {
    expect(GEMINI_FLASH_MODEL_IDS).toEqual([
      "gemini-3.5-flash",
      "gemini-3.6-flash",
      "gemini-3.7-flash",
    ]);
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.7-flash");
  });
});

describe("GeminiClient.chat", () => {
  it("calls generateContent with the API-key header and returns the text", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "hello" }, { text: " gemini" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 9 },
      }),
    );
    const client = clientWith(fetchFn as unknown as typeof fetch);

    const result = await client.chat({
      model: "gemini-3.7-flash",
      messages: [{ role: "user", content: "Hi" }],
      maxOutputTokens: 256,
      temperature: 0.2,
    });

    expect(result).toEqual({
      provider: "gemini",
      model: "gemini-3.7-flash",
      text: "hello gemini",
      usage: { inputTokens: 40, outputTokens: 9 },
    });

    const [url, init] = fetchFn.mock.calls[0];
    const requestInit = init as RequestInit;
    expect(url).toBe("https://gemini.example.test/v1beta/models/gemini-3.7-flash:generateContent");
    expect(requestInit.headers).toMatchObject({
      "x-goog-api-key": API_KEY,
      "Content-Type": "application/json",
    });
    const sent = JSON.parse(requestInit.body as string);
    expect(sent).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
      generationConfig: { maxOutputTokens: 256, temperature: 0.2 },
    });
    expect(sent.systemInstruction).toBeUndefined();
  });

  it("maps system to systemInstruction and assistant to the model role", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      }),
    );
    const client = clientWith(fetchFn as unknown as typeof fetch);

    await client.chat({
      model: "gemini-3.6-flash",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Go" },
        { role: "assistant", content: "Done." },
        { role: "user", content: "Again" },
      ],
    });

    const sent = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.systemInstruction).toEqual({ parts: [{ text: "Be terse." }] });
    expect(sent.contents).toEqual([
      { role: "user", parts: [{ text: "Go" }] },
      { role: "model", parts: [{ text: "Done." }] },
      { role: "user", parts: [{ text: "Again" }] },
    ]);
  });

  it("defaults to gemini-3.7-flash when no model is supplied", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }),
    );
    const client = clientWith(fetchFn as unknown as typeof fetch);

    const result = await client.chat({ messages: [{ role: "user", content: "hi" }] });

    expect(result.model).toBe("gemini-3.7-flash");
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://gemini.example.test/v1beta/models/gemini-3.7-flash:generateContent",
    );
  });

  it("supports any of the Flash family ids", async () => {
    for (const model of GEMINI_FLASH_MODEL_IDS) {
      const fetchFn = mockFetch(async () =>
        jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      );
      const client = clientWith(fetchFn as unknown as typeof fetch);
      await client.chat({ model, messages: [{ role: "user", content: "hi" }] });
      expect(fetchFn.mock.calls[0][0]).toBe(
        `https://gemini.example.test/v1beta/models/${model}:generateContent`,
      );
    }
  });

  it("throws a protocol error with the finish reason when the response is empty", async () => {
    const client = clientWith((async () =>
      jsonResponse({
        candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }],
      })) as typeof fetch);

    await expect(
      client.chat({ model: "gemini-3.5-flash", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({
      code: "protocol-error",
      provider: "gemini",
      message: expect.stringContaining("SAFETY"),
    });
  });

  it("maps HTTP status to typed errors", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
      [429, "rate-limited"],
      [400, "bad-request"],
      [500, "server-error"],
    ];

    for (const [status, code] of cases) {
      const client = clientWith((async () =>
        jsonResponse({ error: { status: "DENIED" } }, status)) as typeof fetch);
      await expect(
        client.chat({ model: "gemini-3.5-flash", messages: [] }),
      ).rejects.toMatchObject({ code, status });
    }
  });
});
