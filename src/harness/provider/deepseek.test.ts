import { describe, expect, it } from "vitest";

import { DeepSeekClient } from "./deepseek";
import type { ProviderMessage } from "./types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DeepSeekClient", () => {
  it("translates OpenAI-style messages, tools, and tool calls", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      return jsonResponse(200, {
        choices: [{
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "brainstorm.update_brief", arguments: "{\"field\":\"goals\"}" },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 2 },
      });
    };

    const client = new DeepSeekClient({ apiKey: "key", fetch: fetchImpl });
    const messages: ProviderMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    const result = await client.complete({
      model: "deepseek-v4-flash",
      messages,
      tools: [{ name: "t", description: "tool", parameters: { type: "object", properties: {} } }],
    });

    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "brainstorm.update_brief", arguments: "{\"field\":\"goals\"}" },
    ]);
    expect(result.stopReason).toBe("tool_calls");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 });
    expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0].body.model).toBe("deepseek-v4-flash");
    expect(calls[0].body.tools).toEqual([{
      type: "function",
      function: {
        name: "t",
        description: "tool",
        parameters: { type: "object", properties: {} },
      },
    }]);
  });

  it("round-trips tool results in assistant/tool message shapes", async () => {
    const fetchImpl = async () => jsonResponse(200, {
      choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const client = new DeepSeekClient({ apiKey: "key", fetch: fetchImpl });
    const result = await client.complete({
      model: "deepseek-v4-flash",
      messages: [
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "t", arguments: "{}" }] },
        { role: "tool", toolCallId: "c1", content: "result" },
      ],
    });
    expect(result.content).toBe("done");
  });

  it("maps errors and missing keys", async () => {
    const fetchImpl = async () => jsonResponse(429, { error: { message: "slow down" } });
    const client = new DeepSeekClient({ apiKey: "key", fetch: fetchImpl });
    await expect(client.complete({ model: "deepseek-v4-flash", messages: [] }))
      .rejects.toMatchObject({ code: "rate-limit", status: 429 });

    expect(() => new DeepSeekClient({ apiKey: "" })).toThrow();
  });

  it("reports the internal timeout as timeout, not cancelled", async () => {
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const client = new DeepSeekClient({ apiKey: "key", timeoutMs: 5, fetch: fetchImpl });
    await expect(client.complete({ model: "deepseek-v4-flash", messages: [] }))
      .rejects.toMatchObject({ code: "timeout" });
  });

  it("still reports caller abort as cancelled mid-flight", async () => {
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const client = new DeepSeekClient({ apiKey: "key", timeoutMs: 60_000, fetch: fetchImpl });
    const controller = new AbortController();
    const pending = client.complete({ model: "deepseek-v4-flash", messages: [], signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
});
