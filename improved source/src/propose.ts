/**
 * Proposal generation: turning frustration signals into concrete adaptations.
 *
 * A deterministic rule advisor runs always (explainable, offline, instant).
 * An optional LLM advisor can layer richer, context-aware proposals on top;
 * every LLM proposal is validated against the adaptation catalog before use.
 */

import type { Adaptation, AdaptationKind } from "./adaptations.ts";
import { SIGNAL_TO_ADAPTATION, buildAdaptation } from "./adaptations.ts";
import type { FrustrationSignal } from "./detectors.ts";

export interface Proposal {
  readonly id: string;
  /** Signals that justify this proposal. */
  readonly basedOn: readonly FrustrationSignal[];
  readonly feature: string;
  readonly adaptation: Adaptation;
  readonly rationale: string;
  /** 0..1 — inherits the minimum confidence among the supporting signals. */
  readonly confidence: number;
  /** Where this proposal came from; surfaced in reports for auditability. */
  readonly source: "rule" | "llm";
  readonly createdAtMs: number;
}

export interface Advisor {
  propose(signals: readonly FrustrationSignal[], nowMs: number): Promise<Proposal[]>;
}

/**
 * Deterministic mapping: signal kind + feature → preferred adaptation kinds.
 * The first unused kind wins so repeated signals escalate to richer fixes.
 */
export class RuleAdvisor implements Advisor {
  async propose(signals: readonly FrustrationSignal[], nowMs: number): Promise<Proposal[]> {
    const byKey = new Map<string, { kindsTried: number; signals: FrustrationSignal[] }>();
    const proposals: Proposal[] = [];

    for (const signal of signals) {
      const kinds = SIGNAL_TO_ADAPTATION[signal.kind] ?? [];
      if (kinds.length === 0) continue;
      const key = signal.feature;
      const state = byKey.get(key) ?? { kindsTried: 0, signals: [] };
      if (state.kindsTried >= kinds.length) continue;

      const kind: AdaptationKind = kinds[state.kindsTried]!;
      const adaptation = buildAdaptation(kind, key);
      const supporting = [...state.signals, signal];
      proposals.push({
        id: `prop-${adaptation.id}`,
        basedOn: supporting,
        feature: key,
        adaptation,
        rationale:
          `${signal.kind} on ${key} ×${supporting.length}: ${signal.evidence[0] ?? "repeated friction"}. ` +
          `Proposed fix: ${adaptation.description}`,
        confidence: Math.min(...supporting.map((s) => s.confidence)),
        source: "rule",
        createdAtMs: nowMs,
      });
      state.kindsTried += 1;
      state.signals = supporting;
      byKey.set(key, state);
    }
    return proposals;
  }
}

export function proposalIdFor(kind: AdaptationKind, feature: string): string {
  return `prop-${buildAdaptation(kind, feature).id}`;
}
