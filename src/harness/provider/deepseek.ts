import {
  mapProviderStatus,
  ProviderError,
  type ModelProvider,
  type ModelProviderKind,
  type ProviderMessage,
  type ProviderRequest,
  type ProviderResult,
  type ToolCall,
  type ToolDefinition,
  type ProviderUsage,
} from "./types";

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
}

interface DeepSeekToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface DeepSeekChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: DeepSeekToolCall[];
  };
  finish_reason: string;
}

interface DeepSeekResponseBody {
  choices?: DeepSeekChoice[];
  usage?: DeepSeekUsage;
  error?: { message?: string };
}

function translateMessages(messages: readonly ProviderMessage[]): unknown[] {
  return messages.map((message) => {
    switch (message.role) {
      case "tool":
        return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
      case "assistant":
        return {
          role: "assistant",
          content: message.content,
          ...(message.toolCalls && message.toolCalls.length > 0
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        };
      default:
        return { role: message.role, content: message.content };
    }
  });
}

function translateTools(tools: readonly ToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function translateUsage(usage: DeepSeekUsage | undefined): ProviderUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cacheReadTokens: usage.prompt_cache_hit_tokens,
  };
}

/**
 * DeepSeek OpenAI-compatible chat completions client for
 * deepseek-v4-flash (and deepseek-v4-pro).
 */
export class DeepSeekClient implements ModelProvider {
  readonly kind: ModelProviderKind = "deepseek";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeepSeekClientOptions) {
    if (!options.apiKey) {
      throw new ProviderError("auth", "DeepSeekClient requires an API key");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async complete(request: ProviderRequest): Promise<ProviderResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = request.signal;
    if (signal?.aborted) {
      clearTimeout(timeout);
      throw new ProviderError("cancelled", "Provider request was cancelled before it started");
    }
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: translateMessages(request.messages),
          tools: translateTools(request.tools),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted || controller.signal.aborted) {
        throw new ProviderError("cancelled", "Provider request was cancelled", { cause: error });
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ProviderError("timeout", "Provider request timed out", { cause: error });
      }
      throw new ProviderError("network", "Provider request failed", { cause: error });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }

    let body: DeepSeekResponseBody;
    try {
      body = (await response.json()) as DeepSeekResponseBody;
    } catch (error) {
      throw new ProviderError("model-error", "Provider returned an unparseable response", { cause: error });
    }

    if (!response.ok) {
      const message = body.error?.message ?? `DeepSeek request failed with status ${response.status}`;
      throw new ProviderError(mapProviderStatus(response.status, message), message, {
        status: response.status,
      });
    }

    const choice = body.choices?.[0];
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    }));

    return {
      content: choice?.message.content ?? "",
      toolCalls,
      stopReason: choice?.finish_reason ?? "unknown",
      model: request.model,
      usage: translateUsage(body.usage),
    };
  }
}
