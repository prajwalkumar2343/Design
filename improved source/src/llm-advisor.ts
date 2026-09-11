/**
 * Optional LLM advisor.
 *
 * Sends a compact, structured summary of recent frustration signals to any
 * OpenAI-compatible chat-completions endpoint and expects back JSON proposals
 * constrained to the adaptation catalog. Everything is best-effort: network
 * errors, malformed JSON, or unknown adaptation kinds degrade to "no extra
 * proposals", and the rule advisor still runs. Prompts contain aggregated
 * evidence only — never raw prompt text or personal content — so this is safe
 * to point at remote models when the user opts in.
 */

import type { AdaptationKind } from "./adaptations.ts";
import { SIGNAL_TO_ADAPTATION, buildAdaptation } from "./adaptations.ts";
import type { FrustrationSignal } from "./detectors.ts";
import type { Advisor, Proposal } from "./propose.ts";

export interface LlmClient {
  /** Returns raw assistant text for one user message. */
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface HttpLlmClientOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
}

/** Minimal fetch-based OpenAI-compatible client (chat completions). */
export class HttpLlmClient implements LlmClient {
  private readonly options: Required<HttpLlmClientOptions>;

  constructor(options: HttpLlmClientOptions) {
    this.options = { timeoutMs: 20_000, ...options };
  }

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return body.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
  }
}

const SYSTEM_PROMPT = `You are a UX improvement engine embedded in a design tool.
You receive frustration signals detected from real user interaction telemetry.
Respond ONLY with a JSON array. Each item:
{ "feature": string, "kind": one of ${Object.keys(SIGNAL_TO_ADAPTATION).join("|")} -> use these ADAPTATION kinds: ${[...new Set(Object.values(SIGNAL_TO_ADAPTATION).flat())].join(", ")}, "rationale": string, "confidence": number between 0 and 1 }
Only propose changes that directly address observed friction. Maximum 3 items.`;

interface RawProposal {
  feature?: unknown;
  kind?: unknown;
  rationale?: unknown;
  confidence?: unknown;
}

export interface LlmAdvisorOptions {
  readonly maxProposals?: number;
}

export class LlmAdvisor implements Advisor {
  private readonly client: LlmClient;
  private readonly maxProposals: number;

  constructor(client: LlmClient, options: LlmAdvisorOptions = {}) {
    this.client = client;
    this.maxProposals = options.maxProposals ?? 3;
  }

  async propose(signals: readonly FrustrationSignal[], nowMs: number): Promise<Proposal[]> {
    if (signals.length === 0) return [];
    let raw: string;
    try {
      raw = await this.client.complete(
        SYSTEM_PROMPT,
        JSON.stringify(
          signals.map((s) => ({
            kind: s.kind,
            feature: s.feature,
            confidence: Number(s.confidence.toFixed(2)),
            severity: Number(s.severity.toFixed(2)),
            evidence: s.evidence.slice(0, 2),
          })),
        ),
      );
    } catch {
      return [];
    }

    const parsed = safeParseArray(raw);
    const allowedKinds = new Set<string>(Object.values(SIGNAL_TO_ADAPTATION).flat());
    const proposals: Proposal[] = [];

    for (const item of parsed) {
      if (proposals.length >= this.maxProposals) break;
      if (typeof item !== "object" || item === null) continue;
      const candidate = item as RawProposal;
      const feature = typeof candidate.feature === "string" ? candidate.feature : null;
      const kind = typeof candidate.kind === "string" ? candidate.kind : null;
      if (!feature || !kind || !allowedKinds.has(kind)) continue;

      const adaptation = buildAdaptation(kind as AdaptationKind, feature);
      const confidence =
        typeof candidate.confidence === "number"
          ? Math.min(1, Math.max(0, candidate.confidence))
          : 0.5;
      proposals.push({
        id: `prop-${adaptation.id}`,
        basedOn: [],
        feature,
        adaptation,
        rationale:
          (typeof candidate.rationale === "string" ? candidate.rationale : "LLM suggestion") +
          ` [llm, grounded in ${signals.length} signal(s)]`,
        confidence,
        source: "llm",
        createdAtMs: nowMs,
      });
    }
    return proposals;
  }
}

function safeParseArray(raw: string): unknown[] {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
