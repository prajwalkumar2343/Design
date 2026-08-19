import { describe, expect, it } from "vitest";

import {
  CODEX_BASE_URL_ENV_KEY,
  CODEX_CHATGPT_ENV_KEY,
  DEFAULT_CODEX_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENCODE_GO_BASE_URL,
  GEMINI_BASE_URL_ENV_KEY,
  GEMINI_ENV_KEY,
  OPENCODE_GO_BASE_URL_ENV_KEY,
  OPENCODE_GO_ENV_KEY,
  createCredentialsForKey,
  detectProviderForKey,
  getLLMAuthStatus,
  maskApiKey,
  resolveLLMCredentials,
} from "./credentials";

describe("resolveLLMCredentials", () => {
  it("reads OpenCode Go, Codex, and Gemini keys with default base URLs", () => {
    const credentials = resolveLLMCredentials({
      [OPENCODE_GO_ENV_KEY]: "  sk-go-1234  ",
      [CODEX_CHATGPT_ENV_KEY]: "chtk-abcd",
      [GEMINI_ENV_KEY]: "gem-key-5678",
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
    expect(credentials.gemini).toMatchObject({
      provider: "gemini",
      apiKey: "gem-key-5678",
      baseUrl: DEFAULT_GEMINI_BASE_URL,
    });
  });

  it("honors base URL overrides", () => {
    const credentials = resolveLLMCredentials({
      [OPENCODE_GO_BASE_URL_ENV_KEY]: "https://proxy.example/go/v1",
      [CODEX_BASE_URL_ENV_KEY]: "/backend-api/codex",
      [GEMINI_BASE_URL_ENV_KEY]: "https://gemini.example/v1beta",
    });
    expect(credentials.openCodeGo.baseUrl).toBe("https://proxy.example/go/v1");
    expect(credentials.codexChatGpt.baseUrl).toBe("/backend-api/codex");
    expect(credentials.gemini.baseUrl).toBe("https://gemini.example/v1beta");
  });

  it("treats missing or whitespace-only keys as unconfigured", () => {
    const credentials = resolveLLMCredentials({
      [OPENCODE_GO_ENV_KEY]: "",
      [CODEX_CHATGPT_ENV_KEY]: "   ",
      [GEMINI_ENV_KEY]: " ",
    });
    expect(credentials.openCodeGo.apiKey).toBeNull();
    expect(credentials.codexChatGpt.apiKey).toBeNull();
    expect(credentials.gemini.apiKey).toBeNull();
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

describe("detectProviderForKey", () => {
  it("detects each supported key shape", () => {
    expect(detectProviderForKey("AIzaSyFakeGeminiKey")).toBe("gemini");
    expect(detectProviderForKey("sk-go-abcdef")).toBe("opencode-go");
    expect(detectProviderForKey("eyJhbGciOiJIUzI1NiJ9.fake.jwt")).toBe("codex-chatgpt");
  });

  it("returns null for unknown or missing keys", () => {
    expect(detectProviderForKey("random-key")).toBeNull();
    expect(detectProviderForKey("")).toBeNull();
    expect(detectProviderForKey(null)).toBeNull();
    expect(detectProviderForKey(undefined)).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(detectProviderForKey("  AIzaFake  ")).toBe("gemini");
  });
});

describe("createCredentialsForKey", () => {
  it("overrides only the selected provider key", () => {
    const credentials = createCredentialsForKey("gemini", "AIzaRuntimeKey", {
      [OPENCODE_GO_ENV_KEY]: "sk-go-env",
      [GEMINI_ENV_KEY]: "AIzaEnvKey",
    });

    expect(credentials.gemini.apiKey).toBe("AIzaRuntimeKey");
    expect(credentials.openCodeGo.apiKey).toBe("sk-go-env");
    expect(credentials.codexChatGpt.apiKey).toBeNull();
    expect(credentials.gemini.baseUrl).toBe(DEFAULT_GEMINI_BASE_URL);
  });

  it("keeps env keys for other providers intact", () => {
    const credentials = createCredentialsForKey("opencode-go", "sk-go-runtime", {
      [CODEX_CHATGPT_ENV_KEY]: "chtk-env",
    });

    expect(credentials.openCodeGo.apiKey).toBe("sk-go-runtime");
    expect(credentials.codexChatGpt.apiKey).toBe("chtk-env");
  });
});

describe("getLLMAuthStatus", () => {
  it("reports configured providers without exposing secrets", () => {
    const status = getLLMAuthStatus(
      resolveLLMCredentials({
        [OPENCODE_GO_ENV_KEY]: "sk-go-abcdefghijklmnop",
        [CODEX_CHATGPT_ENV_KEY]: "",
        [GEMINI_ENV_KEY]: "gem-abc123456789",
      }),
    );

    expect(status).toHaveLength(3);
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
    expect(status[2]).toMatchObject({
      provider: "gemini",
      configured: true,
      maskedKey: "gem-…6789",
    });
  });
});
