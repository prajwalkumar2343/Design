import { describe, expect, it } from "vitest";

import { CodexClient } from "./codex";
import {
  CODEX_BASE_URL_ENV_KEY,
  CODEX_CHATGPT_ENV_KEY,
  OPENCODE_GO_BASE_URL_ENV_KEY,
  OPENCODE_GO_ENV_KEY,
  resolveLLMCredentials,
} from "./credentials";
import { chatWith, createLLMClient } from "./index";
import { OpenCodeGoClient } from "./opencode-go";
import { LLMError } from "./types";

const credentials = resolveLLMCredentials({
  [OPENCODE_GO_ENV_KEY]: "sk-go-abcdefghijklmnop",
  [OPENCODE_GO_BASE_URL_ENV_KEY]: "https://go.example.test/v1",
  [CODEX_CHATGPT_ENV_KEY]: "chtk-test",
  [CODEX_BASE_URL_ENV_KEY]: "https://chatgpt.example.test/backend-api/codex",
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("createLLMClient", () => {
  it("returns an OpenCodeGoClient for the opencode-go provider", () => {
    expect(createLLMClient("opencode-go", credentials)).toBeInstanceOf(OpenCodeGoClient);
  });

  it("returns a CodexClient for the codex-chatgpt provider", () => {
    expect(createLLMClient("codex-chatgpt", credentials)).toBeInstanceOf(CodexClient);
  });

  it("throws missing-credentials when a provider has no key", () => {
    const empty = resolveLLMCredentials({});
    expect(() => createLLMClient("opencode-go", empty)).toThrow(LLMError);
    expect(() => createLLMClient("codex-chatgpt", empty)).toThrowError(
      expect.objectContaining({ code: "missing-credentials" }),
    );
  });
});

describe("chatWith", () => {
  it("routes a chat request through the selected provider", async () => {
    const fetchFn = (async () =>
      jsonResponse({
        choices: [{ message: { content: "go says hi" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      })) as typeof fetch;

    const result = await chatWith(
      "opencode-go",
      { model: "hy3", messages: [{ role: "user", content: "hi" }] },
      { credentials, fetchFn },
    );

    expect(result).toMatchObject({
      provider: "opencode-go",
      model: "hy3",
      text: "go says hi",
      usage: { inputTokens: 5, outputTokens: 2 },
    });
  });
});
