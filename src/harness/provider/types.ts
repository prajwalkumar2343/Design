export type ProviderRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded tool arguments. */
  arguments: string;
}

export type ProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: readonly ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderResult {
  content: string;
  toolCalls: readonly ToolCall[];
  stopReason: string;
  model: string;
  usage?: ProviderUsage;
}

export interface ProviderRequest {
  model: string;
  messages: readonly ProviderMessage[];
  tools?: readonly ToolDefinition[];
  signal?: AbortSignal;
}

export type ModelProviderKind = "openai" | "deepseek" | "scripted";

export interface ModelProvider {
  readonly kind: ModelProviderKind;
  complete(request: ProviderRequest): Promise<ProviderResult>;
}

export type ProviderErrorCode =
  | "auth"
  | "rate-limit"
  | "network"
  | "bad-request"
  | "model-error"
  | "timeout"
  | "cancelled"
  | "unknown";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;

  constructor(code: ProviderErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = options.status;
    this.cause = options.cause;
  }
}

export function mapProviderStatus(status: number, message: string): ProviderErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status >= 400 && status < 500) return "bad-request";
  if (status >= 500) return "model-error";
  return "unknown";
}
