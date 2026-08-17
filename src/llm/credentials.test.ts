import { describe, expect, it } from "vitest";

import {
  CODEX_BASE_URL_ENV_KEY,
  CODEX_CHATGPT_ENV_KEY,
  DEFAULT_CODEX_BASE_URL,
  DEFAULT_OPENCODE_GO_BASE_URL,
  OPENCODE_GO_BASE_URL_ENV_KEY,
  OPENCODE_GO_ENV_KEY,
  getLLMAuthStatus,
  maskApiKey,
  resolveLLMCredentials,
} from "./credentials";

describe("resolveLLMCredentials", () => {
  it("reads OpenCode Go and Codex keys with default base URLs", () => {
    const credentials = resolveLLMCredentials({
      [OPENCODE_GO_ENV_KEY]: "  sk-go-1234  ",
      [CODEX_CHATGPT_ENV_KEY]: "chtk-abcd",
    });

    expect(credentials.openCodeGo).toMatchObject({
      provider: "opencode-go",
      apiKey: "sk-go-1234",
      baseUrl: DEFAULT_OPENCODE_GO_BASE_URL,
    });
    expect(credentials.codexChatGpt).toMatchObject({
      provider: "codex-chatgpt",
      apiKey: "chtk-abcd",
      baseUrl: DEFAULT_CODEX_BASE_URL,
    });
  });

  it("honors base URL overrides", () => {
    const credentials = resolveLLMCredentials({
      [OPENCODE_GO_BASE_URL_ENV_KEY]: "https://proxy.example/go/v1",
      [CODEX_BASE_URL_ENV_KEY]: "/backend-api/codex",
    });
    expect(credentials.openCodeGo.baseUrl).toBe("https://proxy.example/go/v1");
    expect(credentials.codexChatGpt.baseUrl).toBe("/backend-api/codex");
  });

  it("treats missing or whitespace-only keys as unconfigured", () => {
    const credentials = resolveLLMCredentials({
      [OPENCODE_GO_ENV_KEY]: "",
      [CODEX_CHATGPT_ENV_KEY]: "   ",
    });
    expect(credentials.openCodeGo.apiKey).toBeNull();
    expect(credentials.codexChatGpt.apiKey).toBeNull();
    expect(credentials.openCodeGo.baseUrl).toBe(DEFAULT_OPENCODE_GO_BASE_URL);
  });
});

describe("maskApiKey", () => {
  it("keeps only the outer characters", () => {
    expect(maskApiKey("sk-go-abcdefghijklmnop")).toBe("sk-g…mnop");
  });

  it("returns null for missing or empty keys", () => {
    expect(maskApiKey(null)).toBeNull();
    expect(maskApiKey("")).toBeNull();
    expect(maskApiKey(undefined)).toBeNull();
  });

  it("never reveals short keys", () => {
    expect(maskApiKey("abc")).toBe("••••");
  });
});

describe("getLLMAuthStatus", () => {
  it("reports configured providers without exposing secrets", () => {
    const status = getLLMAuthStatus(
      resolveLLMCredentials({
        [OPENCODE_GO_ENV_KEY]: "sk-go-abcdefghijklmnop",
        [CODEX_CHATGPT_ENV_KEY]: "",
      }),
    );

    expect(status).toHaveLength(2);
    expect(status[0]).toMatchObject({
      provider: "opencode-go",
      configured: true,
      maskedKey: "sk-g…mnop",
    });
    expect(status[1]).toMatchObject({
      provider: "codex-chatgpt",
      configured: false,
      maskedKey: null,
    });
  });
});
