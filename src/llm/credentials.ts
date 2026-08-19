import type { LLMProviderId } from "./types";

export const OPENCODE_GO_ENV_KEY = "VITE_OPENCODE_GO_API_KEY";
export const OPENCODE_GO_BASE_URL_ENV_KEY = "VITE_OPENCODE_GO_BASE_URL";
export const CODEX_CHATGPT_ENV_KEY = "VITE_CODEX_CHATGPT_API_KEY";
export const CODEX_BASE_URL_ENV_KEY = "VITE_CODEX_BASE_URL";
export const GEMINI_ENV_KEY = "VITE_GEMINI_API_KEY";
export const GEMINI_BASE_URL_ENV_KEY = "VITE_GEMINI_BASE_URL";

export const DEFAULT_OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
export const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface ProviderCredential {
  provider: LLMProviderId;
  apiKey: string | null;
  baseUrl: string;
}

export interface LLMCredentials {
  openCodeGo: ProviderCredential;
  codexChatGpt: ProviderCredential;
  gemini: ProviderCredential;
}

export interface LLMAuthStatus {
  provider: LLMProviderId;
  configured: boolean;
  maskedKey: string | null;
  baseUrl: string;
}

/** Returns the last few characters of a secret so callers can label it without exposing it. */
export function maskApiKey(apiKey: string | null | undefined): string | null {
  if (!apiKey || apiKey.length === 0) return null;
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

/**
 * Best-effort provider detection from a pasted key, used only by test tooling.
 * Gemini keys start with `AIza`, OpenCode Go keys with `sk-`, and ChatGPT/Codex
 * subscription tokens are JWTs (`eyJ…`).
 */
export function detectProviderForKey(apiKey: string | null | undefined): LLMProviderId | null {
  if (!apiKey) return null;
  const trimmed = apiKey.trim();
  if (trimmed.startsWith("AIza")) return "gemini";
  if (trimmed.startsWith("sk-")) return "opencode-go";
  if (trimmed.startsWith("eyJ")) return "codex-chatgpt";
  return null;
}

/**
 * Builds credentials from environment defaults with a single provider key
 * overridden at runtime. Used by the temporary connection-test panel; keys are
 * never persisted by this path.
 */
export function createCredentialsForKey(
  provider: LLMProviderId,
  apiKey: string,
  env: Record<string, string | undefined> = import.meta.env,
): LLMCredentials {
  const credentials = resolveLLMCredentials(env);
  return {
    openCodeGo: {
      ...credentials.openCodeGo,
      apiKey: provider === "opencode-go" ? apiKey : credentials.openCodeGo.apiKey,
    },
    codexChatGpt: {
      ...credentials.codexChatGpt,
      apiKey: provider === "codex-chatgpt" ? apiKey : credentials.codexChatGpt.apiKey,
    },
    gemini: {
      ...credentials.gemini,
      apiKey: provider === "gemini" ? apiKey : credentials.gemini.apiKey,
    },
  };
}

function read(
  env: Record<string, string | undefined>,
  apiKeyName: string,
  baseUrlName: string,
  defaultBaseUrl: string,
  provider: LLMProviderId,
): ProviderCredential {
  const apiKey = env[apiKeyName]?.trim() || null;
  const baseUrl = env[baseUrlName]?.trim() || defaultBaseUrl;
  return { provider, apiKey, baseUrl };
}

/**
 * Resolves LLM credentials from environment-injected values (Vite `import.meta.env`).
 * Keys are never logged or serialized; use {@link maskApiKey} for any display.
 */
export function resolveLLMCredentials(
  env: Record<string, string | undefined> = import.meta.env,
): LLMCredentials {
  return {
    openCodeGo: read(
      env,
      OPENCODE_GO_ENV_KEY,
      OPENCODE_GO_BASE_URL_ENV_KEY,
      DEFAULT_OPENCODE_GO_BASE_URL,
      "opencode-go",
    ),
    codexChatGpt: read(
      env,
      CODEX_CHATGPT_ENV_KEY,
      CODEX_BASE_URL_ENV_KEY,
      DEFAULT_CODEX_BASE_URL,
      "codex-chatgpt",
    ),
    gemini: read(
      env,
      GEMINI_ENV_KEY,
      GEMINI_BASE_URL_ENV_KEY,
      DEFAULT_GEMINI_BASE_URL,
      "gemini",
    ),
  };
}

/** Auth-only status snapshot per provider, safe to render in any UI. */
export function getLLMAuthStatus(credentials: LLMCredentials): LLMAuthStatus[] {
  const entries: ProviderCredential[] = [
    credentials.openCodeGo,
    credentials.codexChatGpt,
    credentials.gemini,
  ];
  return entries.map((entry) => ({
    provider: entry.provider,
    configured: entry.apiKey !== null,
    maskedKey: maskApiKey(entry.apiKey),
    baseUrl: entry.baseUrl,
  }));
}
