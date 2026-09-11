import { extractResponsesOutputText, requestJson } from "./http";
import { LLMError, type LLMChatRequest, type LLMChatResult, type LLMProviderId } from "./types";

const PROVIDER: LLMProviderId = "opencode-go";

/** Cheap default model for connection tests through the Go gateway. */
export const DEFAULT_GO_TEST_MODEL = "deepseek-v4-flash";

/**
 * The OpenCode Go gateway family served at `/responses` (OpenAI Responses API),
 * per https://opencode.ai/docs/go/#endpoints.
 */
export const GO_RESPONSES_MODELS = new Set([
  "gpt-5.6-luna",
  "grok-4.6",
  "muse-spark-1.2-contributor",
]);

/** The OpenCode Go gateway family served at `/messages` (Anthropic-style). */
export const GO_MESSAGES_MODELS = [
  { prefix: "minimax-" },
  { prefix: "qwen3." },
];

export type GoEndpoint = "responses" | "chat-completions" | "messages";

/** Maps a Go model id to the endpoint dialect it is served under. */
export function goEndpointForModel(model: string): GoEndpoint {
  if (GO_RESPONSES_MODELS.has(model)) return "responses";
  if (GO_MESSAGES_MODELS.some(({ prefix }) => model.startsWith(prefix))) return "messages";
  return "chat-completions";
}

export interface OpenCodeGoClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface GoModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

interface GoChatCompletionsBody {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null };
}

interface GoResponsesBody {
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  output_text?: string;
  usage?: { input_tokens?: number | null; output_tokens?: number | null };
}

interface GoMessagesBody {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number | null; output_tokens?: number | null };
}

/** Anthropic APIs require an explicit output budget; Go gateways enforce it too. */
const DEFAULT_MESSAGES_MAX_TOKENS = 4_096;

function extractMessagesText(body: GoMessagesBody): string {
  const parts: string[] = [];
  for (const block of body.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("").trim();
}

/**
 * Client for the OpenCode Go subscription gateway
 * (`https://opencode.ai/zen/go/v1`). Uses the key issued at
 * https://opencode.ai/auth for OpenCode Go.
 */
export class OpenCodeGoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number | undefined;

  constructor(options: OpenCodeGoClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs;
  }

  /** Lists the models currently available through the Go subscription. */
  async listModels(signal?: AbortSignal): Promise<GoModel[]> {
    const { body } = await requestJson({
      provider: PROVIDER,
      url: `${this.baseUrl}/models`,
      apiKey: this.apiKey,
      method: "GET",
      signal,
      timeoutMs: this.timeoutMs,
      fetchFn: this.fetchFn,
    });
    const data = body as { data?: unknown } | null;
    if (!Array.isArray(data?.data)) {
      throw new LLMError("protocol-error", PROVIDER, "OpenCode Go returned an invalid model list");
    }
    return data.data as GoModel[];
  }

  /** OpenAI-compatible `/chat/completions` for the Go chat-completions family. */
  async chatCompletions(request: LLMChatRequest): Promise<LLMChatResult> {
    if (!request.model) {
      throw new LLMError("bad-request", PROVIDER, "OpenCode Go requires a model");
    }
    const model = request.model;
    const { body } = await requestJson({
      provider: PROVIDER,
      url: `${this.baseUrl}/chat/completions`,
      apiKey: this.apiKey,
      signal: request.signal,
      timeoutMs: this.timeoutMs,
      fetchFn: this.fetchFn,
      body: {
        model,
        messages: request.messages,
        ...(request.maxOutputTokens !== undefined
          ? { max_completion_tokens: request.maxOutputTokens }
          : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        stream: false,
      },
    });
    const data = body as GoChatCompletionsBody;
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      throw new LLMError("protocol-error", PROVIDER, "OpenCode Go returned an empty chat completion");
    }
    return {
      provider: PROVIDER,
      model,
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
      },
    };
  }

  /** OpenAI Responses API (`/responses`) for the Go responses family. */
  async responses(request: LLMChatRequest): Promise<LLMChatResult> {
    if (!request.model) {
      throw new LLMError("bad-request", PROVIDER, "OpenCode Go requires a model");
    }
    const model = request.model;
    const { body } = await requestJson({
      provider: PROVIDER,
      url: `${this.baseUrl}/responses`,
      apiKey: this.apiKey,
      signal: request.signal,
      timeoutMs: this.timeoutMs,
      fetchFn: this.fetchFn,
      body: {
        model,
        instructions: request.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n") || undefined,
        input: request.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: [{ type: "input_text", text: m.content }] })),
        ...(request.maxOutputTokens !== undefined
          ? { max_output_tokens: request.maxOutputTokens }
          : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        stream: false,
      },
    });
    const data = body as GoResponsesBody;
    const text = extractResponsesOutputText(data);
    if (!text) {
      throw new LLMError("protocol-error", PROVIDER, "OpenCode Go returned an empty response");
    }
    return {
      provider: PROVIDER,
      model,
      text,
      usage: {
        inputTokens: data.usage?.input_tokens ?? null,
        outputTokens: data.usage?.output_tokens ?? null,
      },
    };
  }

  /**
   * Anthropic Messages API (`/messages`) for the Go messages family
   * (MiniMax, Qwen3.x). Auth stays on the Go bearer key; the gateway proxies
   * the Anthropic dialect.
   */
  async messages(request: LLMChatRequest): Promise<LLMChatResult> {
    if (!request.model) {
      throw new LLMError("bad-request", PROVIDER, "OpenCode Go requires a model");
    }
    const model = request.model;
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const { body } = await requestJson({
      provider: PROVIDER,
      url: `${this.baseUrl}/messages`,
      apiKey: this.apiKey,
      signal: request.signal,
      timeoutMs: this.timeoutMs,
      fetchFn: this.fetchFn,
      headers: { "anthropic-version": "2023-06-01" },
      body: {
        model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MESSAGES_MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: request.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        stream: false,
      },
    });
    const data = body as GoMessagesBody;
    const text = extractMessagesText(data);
    if (!text) {
      throw new LLMError("protocol-error", PROVIDER, "OpenCode Go returned an empty response");
    }
    return {
      provider: PROVIDER,
      model,
      text,
      usage: {
        inputTokens: data.usage?.input_tokens ?? null,
        outputTokens: data.usage?.output_tokens ?? null,
      },
    };
  }

  /** Routes to the correct dialect for the requested Go model. */
  async chat(request: LLMChatRequest): Promise<LLMChatResult> {
    if (!request.model) {
      throw new LLMError("bad-request", PROVIDER, "OpenCode Go requires a model");
    }
    const endpoint = goEndpointForModel(request.model);
    if (endpoint === "responses") return this.responses(request);
    if (endpoint === "messages") return this.messages(request);
    return this.chatCompletions(request);
  }
}
