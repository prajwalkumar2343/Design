import { requestJson } from "./http";
import { LLMError, type LLMChatRequest, type LLMChatResult, type LLMProviderId } from "./types";

const PROVIDER: LLMProviderId = "codex-chatgpt";

export const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";

export interface CodexClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface CodexResponsesBody {
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  output_text?: string;
  usage?: { input_tokens?: number | null; output_tokens?: number | null };
}

function extractResponsesText(body: CodexResponsesBody): string {
  if (typeof body.output_text === "string" && body.output_text.trim().length > 0) {
    return body.output_text;
  }
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") parts.push(part.text);
    }
  }
  return parts.join("").trim();
}

/**
 * Client for Codex through a ChatGPT/Codex subscription ("Sign in with ChatGPT").
 * Uses the `CHATGPT_API_KEY` token that `codex login` stores in
 * `~/.codex/auth.json` and speaks the Codex Responses dialect at
 * `https://chatgpt.com/backend-api/codex/responses`.
 */
export class CodexClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number | undefined;

  constructor(options: CodexClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs;
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResult> {
    const model = request.model || DEFAULT_CODEX_MODEL;
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
    const data = body as CodexResponsesBody;
    const text = extractResponsesText(data);
    if (!text) {
      throw new LLMError("protocol-error", PROVIDER, "Codex returned an empty response");
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
}
