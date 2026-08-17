import type { LLMProviderId } from "./types";

export const OPENCODE_GO_ENV_KEY = "VITE_OPENCODE_GO_API_KEY";
export const OPENCODE_GO_BASE_URL_ENV_KEY = "VITE_OPENCODE_GO_BASE_URL";
export const CODEX_CHATGPT_ENV_KEY = "VITE_CODEX_CHATGPT_API_KEY";
export const CODEX_BASE_URL_ENV_KEY = "VITE_CODEX_BASE_URL";

export const DEFAULT_OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
export const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

export interface ProviderCredential {
  provider: LLMProviderId;
  apiKey: string | null;
  baseUrl: string;
}

export interface LLMCredentials {
  openCodeGo: ProviderCredential;
  codexChatGpt: ProviderCredential;
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
  };
}

/** Auth-only status snapshot per provider, safe to render in any UI. */
export function getLLMAuthStatus(credentials: LLMCredentials): LLMAuthStatus[] {
  const entries: ProviderCredential[] = [credentials.openCodeGo, credentials.codexChatGpt];
  return entries.map((entry) => ({
    provider: entry.provider,
    configured: entry.apiKey !== null,
    maskedKey: maskApiKey(entry.apiKey),
    baseUrl: entry.baseUrl,
  }));
}
