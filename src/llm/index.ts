import { CodexClient, DEFAULT_CODEX_MODEL } from "./codex";
import {
  CODEX_CHATGPT_ENV_KEY,
  GEMINI_ENV_KEY,
  OPENCODE_GO_ENV_KEY,
  type LLMCredentials,
} from "./credentials";
import { DEFAULT_GEMINI_MODEL, GeminiClient } from "./gemini";
import { DEFAULT_GO_TEST_MODEL, OpenCodeGoClient } from "./opencode-go";
import { LLMError, type LLMChatRequest, type LLMChatResult, type LLMProviderId } from "./types";

export * from "./codex";
export * from "./credentials";
export * from "./gemini";
export * from "./http";
export * from "./opencode-go";
export * from "./types";

export type LLMClient = OpenCodeGoClient | CodexClient | GeminiClient;

export interface LLMClientOptions {
  fetchFn?: typeof fetch;
}

export interface LLMChatOptions extends LLMClientOptions {
  credentials: LLMCredentials;
}

/** Default model per provider, used by test tooling when the caller omits one. */
export function defaultModelForProvider(provider: LLMProviderId): string {
  switch (provider) {
    case "opencode-go":
      return DEFAULT_GO_TEST_MODEL;
    case "codex-chatgpt":
      return DEFAULT_CODEX_MODEL;
    case "gemini":
      return DEFAULT_GEMINI_MODEL;
  }
}

/** Builds the client for a provider, throwing `missing-credentials` when its key is absent. */
export function createLLMClient(
  provider: LLMProviderId,
  credentials: LLMCredentials,
  options: LLMClientOptions = {},
): LLMClient {
  if (provider === "opencode-go") {
    const entry = credentials.openCodeGo;
    if (!entry.apiKey) {
      throw new LLMError("missing-credentials", provider, `Missing ${OPENCODE_GO_ENV_KEY}`);
    }
    return new OpenCodeGoClient({ apiKey: entry.apiKey, baseUrl: entry.baseUrl, fetchFn: options.fetchFn });
  }
  if (provider === "gemini") {
    const entry = credentials.gemini;
    if (!entry.apiKey) {
      throw new LLMError("missing-credentials", provider, `Missing ${GEMINI_ENV_KEY}`);
    }
    return new GeminiClient({ apiKey: entry.apiKey, baseUrl: entry.baseUrl, fetchFn: options.fetchFn });
  }
  const entry = credentials.codexChatGpt;
  if (!entry.apiKey) {
    throw new LLMError("missing-credentials", provider, `Missing ${CODEX_CHATGPT_ENV_KEY}`);
  }
  return new CodexClient({ apiKey: entry.apiKey, baseUrl: entry.baseUrl, fetchFn: options.fetchFn });
}

/** Provider-agnostic entry point: routes a request to the configured subscription. */
export async function chatWith(
  provider: LLMProviderId,
  request: LLMChatRequest,
  options: LLMChatOptions,
): Promise<LLMChatResult> {
  const client = createLLMClient(provider, options.credentials, options);
  return client.chat(request);
}
