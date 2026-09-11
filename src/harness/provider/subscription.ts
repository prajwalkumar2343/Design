import { goEndpointForModel } from "../../llm";
import type { LLMCredentials } from "../../llm";
import { DeepSeekClient } from "./deepseek";
import { OpenAIResponsesClient } from "./openai-responses";
import { ProviderError, type ModelProvider, type ModelProviderKind, type ProviderRequest, type ProviderResult } from "./types";

/** Subscription backends that can power the agent harness. */
export type SubscriptionBackendId = "opencode-go" | "codex-chatgpt";

export interface SubscriptionProviderOptions {
  apiKey: string;
  /** Gateway root, e.g. https://opencode.ai/zen/go/v1 or https://chatgpt.com/backend-api/codex. */
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Routes harness requests over a personal OpenCode Go or Codex subscription so
 * agent runs consume those plan limits instead of separate API billing.
 *
 * - `opencode-go`: Responses-family models (gpt-5.6-luna, grok-4.6,
 *   muse-spark-1.2-contributor) use the gateway's `/responses`; all other
 *   tool-capable models (DeepSeek, GLM, Kimi, MiMo, LongCat, Hy3, Ox Alpha)
 *   use its OpenAI-compatible `/chat/completions`. The Anthropic-dialect
 *   family (MiniMax, Qwen3.x) has no function-calling client here and is
 *   rejected up front.
 * - `codex-chatgpt`: every request goes to the Codex Responses endpoint using
 *   the token issued by `codex login`.
 */
export class SubscriptionModelProvider implements ModelProvider {
  readonly kind: ModelProviderKind = "openai";
  private readonly backend: SubscriptionBackendId;
  private readonly delegate: ModelProvider;

  constructor(backend: SubscriptionBackendId, options: SubscriptionProviderOptions) {
    this.backend = backend;
    this.delegate =
      backend === "opencode-go"
        ? new GoRoutedProvider(options)
        : new OpenAIResponsesClient({
            apiKey: options.apiKey,
            baseUrl: options.baseUrl,
            timeoutMs: options.timeoutMs,
            fetch: options.fetch,
          });
  }

  async complete(request: ProviderRequest): Promise<ProviderResult> {
    return this.delegate.complete(request);
  }

  /** Backend identifier for traces and diagnostics. */
  get id(): SubscriptionBackendId {
    return this.backend;
  }
}

class GoRoutedProvider implements ModelProvider {
  readonly kind: ModelProviderKind = "openai";
  private readonly responses: OpenAIResponsesClient;
  private readonly chatCompletions: DeepSeekClient;

  constructor(options: SubscriptionProviderOptions) {
    const shared = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      fetch: options.fetch,
    };
    this.responses = new OpenAIResponsesClient(shared);
    this.chatCompletions = new DeepSeekClient(shared);
  }

  async complete(request: ProviderRequest): Promise<ProviderResult> {
    const endpoint = goEndpointForModel(request.model);
    if (endpoint === "messages") {
      throw new ProviderError(
        "bad-request",
        `OpenCode Go model "${request.model}" is served over an Anthropic-dialect endpoint without a tool-calling client, which the agent harness requires`,
      );
    }
    return endpoint === "responses"
      ? this.responses.complete(request)
      : this.chatCompletions.complete(request);
  }
}

export interface ResolvedSubscriptionBackend {
  backend: SubscriptionBackendId;
  provider: SubscriptionModelProvider;
}

/**
 * Builds a harness provider from resolved LLM credentials, preferring
 * OpenCode Go when its key is present and falling back to the Codex/ChatGPT
 * token. Throws `auth` when neither subscription is configured.
 */
export function createSubscriptionModelProvider(
  credentials: LLMCredentials,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): ResolvedSubscriptionBackend {
  const go = credentials.openCodeGo;
  if (go?.apiKey) {
    return {
      backend: "opencode-go",
      provider: new SubscriptionModelProvider("opencode-go", {
        apiKey: go.apiKey,
        baseUrl: go.baseUrl,
        timeoutMs: options.timeoutMs,
        fetch: options.fetch,
      }),
    };
  }
  const codex = credentials.codexChatGpt;
  if (codex?.apiKey) {
    return {
      backend: "codex-chatgpt",
      provider: new SubscriptionModelProvider("codex-chatgpt", {
        apiKey: codex.apiKey,
        baseUrl: codex.baseUrl,
        timeoutMs: options.timeoutMs,
        fetch: options.fetch,
      }),
    };
  }
  throw new ProviderError(
    "auth",
    "No subscription credentials configured — set VITE_OPENCODE_GO_API_KEY or VITE_CODEX_CHATGPT_API_KEY",
  );
}
