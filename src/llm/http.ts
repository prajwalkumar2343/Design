import { LLMError, type LLMErrorCode, type LLMProviderId } from "./types";

export const DEFAULT_LLM_TIMEOUT_MS = 60_000;

export interface JsonRequestOptions {
  provider: LLMProviderId;
  url: string;
  apiKey: string;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

export interface JsonResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

function statusToErrorCode(status: number): LLMErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate-limited";
  if (status >= 400 && status < 500) return "bad-request";
  if (status >= 500) return "server-error";
  return "protocol-error";
}

async function readErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  } catch {
    return "";
  }
}

/**
 * A single bounded fetch helper used by every LLM client. It never leaks the
 * API key into error messages, applies a default timeout, and normalizes any
 * failure into a typed {@link LLMError}.
 */
export async function requestJson(options: JsonRequestOptions): Promise<JsonResponse> {
  const {
    provider,
    url,
    apiKey,
    method = "POST",
    body,
    signal,
    timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
    headers = {},
    fetchFn = fetch,
  } = options;

  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchFn(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new LLMError("timeout", provider, `LLM request timed out after ${timeoutMs}ms`, { cause });
    }
    if (signal?.aborted) {
      throw new LLMError("network-error", provider, "LLM request aborted", { cause });
    }
    throw new LLMError("network-error", provider, "LLM request failed on the network", { cause });
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", onCallerAbort);
  }

  if (!response.ok) {
    const detail = await readErrorText(response);
    const suffix = detail ? ` — ${detail}` : "";
    throw new LLMError(
      statusToErrorCode(response.status),
      provider,
      `LLM request failed with HTTP ${response.status}${suffix}`,
      { status: response.status },
    );
  }

  let bodyValue: unknown;
  try {
    bodyValue = response.status === 204 ? null : await response.json();
  } catch (cause) {
    throw new LLMError("protocol-error", provider, "LLM response was not valid JSON", { cause, status: response.status });
  }

  return { status: response.status, body: bodyValue, headers: response.headers };
}

export interface ResponsesOutputItem {
  type?: string;
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
}

export interface ResponsesOutputBody {
  output?: ResponsesOutputItem[];
  output_text?: string;
  usage?: { input_tokens?: number | null; output_tokens?: number | null };
}

/** Concatenates assistant text out of an OpenAI Responses-format payload. */
export function extractResponsesOutputText(body: ResponsesOutputBody): string {
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
