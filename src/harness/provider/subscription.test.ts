import { describe, expect, it, vi } from "vitest";

import { resolveLLMCredentials } from "../../llm";
import { createSubscriptionModelProvider, SubscriptionModelProvider } from "./subscription";
import { ProviderError } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function credentialsWith(env: Record<string, string>) {
  return resolveLLMCredentials({
    VITE_OPENCODE_GO_API_KEY: env.go,
    VITE_OPENCODE_GO_BASE_URL: "https://go.example.test/v1",
    VITE_CODEX_CHATGPT_API_KEY: env.codex,
    VITE_CODEX_BASE_URL: "https://chatgpt.example.test/backend-api/codex",
  });
}

describe("createSubscriptionModelProvider", () => {
  it("prefers OpenCode Go when both subscriptions are configured", () => {
    const resolved = createSubscriptionModelProvider(
      credentialsWith({ go: "sk-go-key", codex: "chtk-key" }),
    );
    expect(resolved.backend).toBe("opencode-go");
    expect(resolved.provider.id).toBe("opencode-go");
  });

  it("falls back to the Codex token when no Go key is present", () => {
    const resolved = createSubscriptionModelProvider(credentialsWith({ codex: "chtk-key" }));
    expect(resolved.backend).toBe("codex-chatgpt");
  });

  it("throws an auth error when neither subscription is configured", () => {
    try {
      createSubscriptionModelProvider(credentialsWith({}));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe("auth");
    }
  });
});

describe("SubscriptionModelProvider on opencode-go", () => {
  it("routes responses-family models through /responses with the Go key", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      jsonResponse({
        output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    );
    const provider = new SubscriptionModelProvider("opencode-go", {
      apiKey: "sk-go-key",
      baseUrl: "https://go.example.test/v1",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.complete({
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.content).toBe("hi");
    expect(fetchImpl.mock.calls[0][0]).toBe("https://go.example.test/v1/responses");
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-go-key");
  });

  it("routes chat-completions models through /chat/completions", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      jsonResponse({
        choices: [
          {
            message: { role: "assistant", content: "drafted" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }),
    );
    const provider = new SubscriptionModelProvider("opencode-go", {
      apiKey: "sk-go-key",
      baseUrl: "https://go.example.test/v1",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.complete({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "draft a frame" }],
      tools: [{ name: "make_frame", description: "d", parameters: { type: "object" } }],
    });

    expect(result.content).toBe("drafted");
    expect(fetchImpl.mock.calls[0][0]).toBe("https://go.example.test/v1/chat/completions");
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.tools).toHaveLength(1);
  });

  it("rejects Anthropic-dialect Go models up front", async () => {
    const fetchImpl = vi.fn();
    const provider = new SubscriptionModelProvider("opencode-go", {
      apiKey: "sk-go-key",
      baseUrl: "https://go.example.test/v1",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      provider.complete({ model: "qwen3.8-max", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "bad-request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("SubscriptionModelProvider on codex-chatgpt", () => {
  it("sends every request to the Codex Responses endpoint with the ChatGPT token", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      jsonResponse({
        output: [{ type: "message", content: [{ type: "output_text", text: "codex" }] }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    );
    const provider = new SubscriptionModelProvider("codex-chatgpt", {
      apiKey: "chtk-key",
      baseUrl: "https://chatgpt.example.test/backend-api/codex",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.complete({
      model: "gpt-5.3-codex",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.content).toBe("codex");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://chatgpt.example.test/backend-api/codex/responses",
    );
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer chtk-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "gpt-5.3-codex", store: false });
  });
});
