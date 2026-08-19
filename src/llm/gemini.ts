import { requestJson } from "./http";
import { LLMError, type LLMChatRequest, type LLMChatResult, type LLMProviderId } from "./types";

const PROVIDER: LLMProviderId = "gemini";

/** The Google AI Gemini Flash models supported by this client. */
export const GEMINI_FLASH_MODEL_IDS = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
] as const;

export const DEFAULT_GEMINI_MODEL: string = GEMINI_FLASH_MODEL_IDS[2];

export interface GeminiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiGenerateContentBody {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number | null;
    candidatesTokenCount?: number | null;
  };
}

/**
 * Client for Google AI Gemini (Gemini Developer API) using an API key from
 * Google AI Studio. Gemini Flash models (3.5/3.6/3.7) default here; any
 * `models/{model}:generateContent` model id can be requested.
 */
export class GeminiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number | undefined;

  constructor(options: GeminiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs;
  }

  async chat(request: LLMChatRequest): Promise<LLMChatResult> {
    const model = request.model || DEFAULT_GEMINI_MODEL;
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const { body } = await requestJson({
      provider: PROVIDER,
      url: `${this.baseUrl}/models/${model}:generateContent`,
      apiKey: this.apiKey,
      authHeader: { name: "x-goog-api-key", value: this.apiKey },
      signal: request.signal,
      timeoutMs: this.timeoutMs,
      fetchFn: this.fetchFn,
      body: {
        contents: request.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        ...(systemMessages.length > 0
          ? { systemInstruction: { parts: systemMessages.map((m) => ({ text: m.content })) } }
          : {}),
        ...(request.maxOutputTokens !== undefined || request.temperature !== undefined
          ? {
              generationConfig: {
                ...(request.maxOutputTokens !== undefined
                  ? { maxOutputTokens: request.maxOutputTokens }
                  : {}),
                ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
              },
            }
          : {}),
      },
    });
    const data = body as GeminiGenerateContentBody;
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) {
      const finishReason = data.candidates?.[0]?.finishReason ?? "UNKNOWN";
      throw new LLMError(
        "protocol-error",
        PROVIDER,
        `Gemini returned no text (finishReason: ${finishReason})`,
      );
    }
    return {
      provider: PROVIDER,
      model,
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? null,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
      },
    };
  }
}
