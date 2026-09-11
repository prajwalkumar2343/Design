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

export interface OpenAIResponsesClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface OpenAIUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

interface OpenAIResponseItem {
  type: string;
  role?: string;
  content?: Array<{ type: string; text?: string; }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

interface OpenAIResponseBody {
  output?: OpenAIResponseItem[];
  status?: string;
  usage?: OpenAIUsage;
  error?: { message?: string; type?: string; };
}

function translateMessage(message: ProviderMessage): unknown {
  switch (message.role) {
    case "user":
      return { role: "user", content: [{ type: "input_text", text: message.content }] };
    case "assistant": {
      const items: unknown[] = [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: message.content }] },
      ];
      for (const call of message.toolCalls ?? []) {
        items.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      return items;
    }
    case "tool":
      return { type: "function_call_output", call_id: message.toolCallId, output: message.content };
    case "system":
      return { role: "system", content: [{ type: "input_text", text: message.content }] };
  }
}

function translateTools(tools: readonly ToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function translateOutput(output: OpenAIResponseItem[] | undefined): {
  content: string;
  toolCalls: ToolCall[];
} {
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (const item of output ?? []) {
    if (item.type === "message" && item.content) {
      content += item.content
        .filter((part) => part.type === "output_text")
        .map((part) => part.text ?? "")
        .join("");
    } else if (item.type === "function_call" && item.call_id && item.name) {
      toolCalls.push({
        id: item.call_id,
        name: item.name,
        arguments: item.arguments ?? "{}",
      });
    }
  }
  return { content, toolCalls };
}

function translateUsage(usage: OpenAIUsage | undefined): ProviderUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.input_tokens_details?.cached_tokens,
  };
}

/**
 * OpenAI Responses API client for GPT-5.6 family models
 * (gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol).
 */
export class OpenAIResponsesClient implements ModelProvider {
  readonly kind: ModelProviderKind = "openai";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIResponsesClientOptions) {
    if (!options.apiKey) {
      throw new ProviderError("auth", "OpenAIResponsesClient requires an API key");
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

    const input: unknown[] = [];
    for (const message of request.messages) {
      const translated = translateMessage(message);
      if (Array.isArray(translated)) input.push(...translated);
      else input.push(translated);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          input,
          tools: translateTools(request.tools),
          store: false,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new ProviderError("cancelled", "Provider request was cancelled", { cause: error });
      }
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "TimeoutError")
      ) {
        throw new ProviderError("timeout", "Provider request timed out", { cause: error });
      }
      throw new ProviderError("network", "Provider request failed", { cause: error });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }

    let body: OpenAIResponseBody;
    try {
      body = (await response.json()) as OpenAIResponseBody;
    } catch (error) {
      throw new ProviderError("model-error", "Provider returned an unparseable response", { cause: error });
    }

    if (!response.ok) {
      const message = body.error?.message ?? `OpenAI request failed with status ${response.status}`;
      throw new ProviderError(mapProviderStatus(response.status, message), message, {
        status: response.status,
      });
    }

    const { content, toolCalls } = translateOutput(body.output);
    return {
      content,
      toolCalls,
      stopReason: body.status ?? "unknown",
      model: request.model,
      usage: translateUsage(body.usage),
    };
  }
}
