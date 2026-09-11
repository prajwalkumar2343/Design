import { describe, expect, it } from "vitest";

import { OpenAIResponsesClient } from "./openai-responses";
import type { ProviderMessage } from "./types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAIResponsesClient", () => {
  it("translates messages, tools, and a text response", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      return jsonResponse(200, {
        id: "resp-1",
        status: "completed",
        output: [
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }] },
        ],
        usage: { input_tokens: 12, output_tokens: 4, input_tokens_details: { cached_tokens: 3 } },
      });
    };

    const client = new OpenAIResponsesClient({ apiKey: "key", fetch: fetchImpl });
    const messages: ProviderMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    const result = await client.complete({
      model: "gpt-5.6-luna",
      messages,
      tools: [{ name: "t", description: "tool", parameters: { type: "object", properties: {} } }],
    });

    expect(result.content).toBe("Hello");
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4, cacheReadTokens: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    const body = calls[0].body;
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.input).toEqual([
      { role: "system", content: [{ type: "input_text", text: "sys" }] },
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
    ]);
    expect(body.tools).toEqual([{
      type: "function",
      name: "t",
      description: "tool",
      parameters: { type: "object", properties: {} },
    }]);
  });

  it("translates assistant tool calls and tool results", async () => {
    const fetchImpl = async () => jsonResponse(200, {
      id: "resp-2",
      status: "completed",
      output: [
        { type: "function_call", call_id: "call_1", name: "brainstorm.update_brief", arguments: "{\"field\":\"audience\"}" },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const client = new OpenAIResponsesClient({ apiKey: "key", fetch: fetchImpl });
    const result = await client.complete({
      model: "gpt-5.6-terra",
      messages: [
        { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "brainstorm.update_brief", arguments: "{}" }] },
        { role: "tool", toolCallId: "call_1", content: "ok" },
      ],
    });

    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "brainstorm.update_brief", arguments: "{\"field\":\"audience\"}" },
    ]);
  });

  it("maps auth and server failures to typed ProviderErrors", async () => {
    const fetchImpl = async () => jsonResponse(401, { error: { message: "bad key" } });
    const client = new OpenAIResponsesClient({ apiKey: "key", fetch: fetchImpl });
    await expect(client.complete({ model: "gpt-5.6-sol", messages: [] }))
      .rejects.toMatchObject({ code: "auth", status: 401 });

    const fetchImpl500 = async () => jsonResponse(500, { error: { message: "boom" } });
    const client500 = new OpenAIResponsesClient({ apiKey: "key", fetch: fetchImpl500 });
    await expect(client500.complete({ model: "gpt-5.6-sol", messages: [] }))
      .rejects.toMatchObject({ code: "model-error", status: 500 });
  });

  it("surfaces cancellation", async () => {
    const fetchImpl = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    const client = new OpenAIResponsesClient({ apiKey: "key", fetch: fetchImpl });
    const controller = new AbortController();
    controller.abort();
    await expect(client.complete({ model: "gpt-5.6-luna", messages: [], signal: controller.signal }))
      .rejects.toMatchObject({ code: "cancelled" });
  });

  it("reports the internal timeout as timeout, not cancelled", async () => {
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const client = new OpenAIResponsesClient({ apiKey: "key", timeoutMs: 5, fetch: fetchImpl });
    await expect(client.complete({ model: "gpt-5.6-luna", messages: [] }))
      .rejects.toMatchObject({ code: "timeout" });
  });

  it("still reports caller abort as cancelled mid-flight", async () => {
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const client = new OpenAIResponsesClient({ apiKey: "key", timeoutMs: 60_000, fetch: fetchImpl });
    const controller = new AbortController();
    const pending = client.complete({ model: "gpt-5.6-luna", messages: [], signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
});
