export type LLMProviderId = "opencode-go" | "codex-chatgpt";

export type LLMRole = "system" | "user" | "assistant";

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMChatRequest {
  model?: string;
  messages: LLMMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LLMChatResult {
  provider: LLMProviderId;
  model: string;
  text: string;
  usage: LLMUsage | null;
}

export type LLMErrorCode =
  | "missing-credentials"
  | "network-error"
  | "timeout"
  | "unauthorized"
  | "rate-limited"
  | "bad-request"
  | "server-error"
  | "unsupported"
  | "protocol-error";

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly provider: LLMProviderId;
  readonly status: number | null;

  constructor(
    code: LLMErrorCode,
    provider: LLMProviderId,
    message: string,
    options?: { cause?: unknown; status?: number | null },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "LLMError";
    this.code = code;
    this.provider = provider;
    this.status = options?.status ?? null;
  }
}
