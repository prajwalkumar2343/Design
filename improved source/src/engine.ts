/**
 * The improvement engine: the closed loop.
 *
 *   observe → detect signals → propose adaptations → policy gate → apply
 *      ↑                                                        |
 *      └──── verify effect on future sessions; roll back if worse
 *
 * State is small and serializable (proposals, active adaptations, verdicts)
 * so the whole loop is restartable and auditable.
 */

import type { Adaptation } from "./adaptations.ts";
import { compareFeaturePain, type SessionAnalysis } from "./analyze.ts";
import type { DetectorConfig, FrustrationSignal } from "./detectors.ts";
import { runAllDetectors } from "./detectors.ts";
import type { TrackedEvent } from "./events.ts";
import type { Advisor, Proposal } from "./propose.ts";

export interface EnginePolicy {
  /** Auto-apply proposals at or above this confidence; below → suggest only. */
  autoApplyConfidence: number;
  /** Never auto-apply unless a supporting signal is at least this severe. */
  minSeverityToAutoApply: number;
  /** Ignore duplicate proposals for one feature within this window, ms. */
  reproposalCooldownMs: number;
  /** Wait this much usage after applying before verifying, ms. */
  verificationDelayMs: number;
  /** Minimum usage (sessions) in each verification window. */
  verificationMinSessions: number;
  /** Roll back when post-application pain exceeds pre by this %. */
  rollbackDeltaPct: number;
}

export const DEFAULT_POLICY: EnginePolicy = {
  autoApplyConfidence: 0.55,
  minSeverityToAutoApply: 0.5,
  reproposalCooldownMs: 6 * 60 * 60_000,
  verificationDelayMs: 24 * 60 * 60_000,
  verificationMinSessions: 2,
  rollbackDeltaPct: 20,
};

export type ProposalStatus = "proposed" | "applied" | "rolled-back" | "dismissed";

export interface ProposalRecord {
  readonly proposal: Proposal;
  readonly status: ProposalStatus;
  readonly createdAtMs: number;
  readonly decidedAtMs: number | null;
  /** Why the engine applied / deferred / rolled back — kept for auditability. */
  readonly decisionNote: string;
}

export interface AppliedAdaptation {
  readonly adaptation: Adaptation;
  readonly appliedAtMs: number;
  readonly basedOnSignalAtMs: number;
}

export interface Verdict {
  readonly adaptationId: string;
  readonly kept: boolean;
  readonly beforePain: number;
  readonly afterPain: number;
  readonly deltaPct: number;
  readonly evaluatedAtMs: number;
}

export interface EngineState {
  readonly records: ProposalRecord[];
  readonly active: Record<string, AppliedAdaptation>;
  readonly verdicts: Verdict[];
}

export function emptyEngineState(): EngineState {
  return { records: [], active: {}, verdicts: [] };
}

export interface EngineStateStore {
  load(): Promise<EngineState>;
  save(state: EngineState): Promise<void>;
}

export class MemoryStateStore implements EngineStateStore {
  private state: EngineState = emptyEngineState();
  async load(): Promise<EngineState> {
    return this.state;
  }
  async save(state: EngineState): Promise<void> {
    this.state = state;
  }
}

export interface CycleResult {
  readonly signals: readonly FrustrationSignal[];
  readonly newProposals: readonly Proposal[];
  readonly autoApplied: readonly Adaptation[];
  readonly suggestions: readonly Proposal[];
}

export interface EvaluateOptions {
  analyses: readonly SessionAnalysis[];
}

export interface EvaluateResult {
  readonly verdicts: Verdict[];
  readonly rolledBack: readonly string[];
}

export interface ImprovementEngineOptions {
  advisors: readonly Advisor[];
  apply: (adaptation: Adaptation) => Promise<boolean>;
  revert?: (adaptation: Adaptation) => Promise<boolean>;
  policy?: Partial<EnginePolicy>;
  /** Ghost targets etc. — must match what the host UI actually renders. */
  detectorConfig?: DetectorConfig;
  now?: () => number;
}

/**
 * Runs the loop. The host calls `runCycle` whenever it has fresh events
 * (throttled), and `evaluate` later to verify earlier applications.
 */
export class ImprovementEngine {
  private readonly store: EngineStateStore;
  private readonly advisors: readonly Advisor[];
  private readonly applyFn: (adaptation: Adaptation) => Promise<boolean>;
  private readonly revertFn: ((adaptation: Adaptation) => Promise<boolean>) | undefined;
  private readonly policy: EnginePolicy;
  private readonly detectorConfig: DetectorConfig | undefined;
  private readonly now: () => number;

  constructor(store: EngineStateStore, options: ImprovementEngineOptions) {
    this.store = store;
    this.advisors = options.advisors;
    this.applyFn = options.apply;
    this.revertFn = options.revert;
    this.policy = { ...DEFAULT_POLICY, ...(options.policy ?? {}) };
    this.detectorConfig = options.detectorConfig;
    this.now = options.now ?? (() => Date.now());
  }

  async loadState(): Promise<EngineState> {
    return this.store.load();
  }

  /**
   * One observation→action pass over fresh events. `signalsOverride` lets
   * hosts supply live-detector output from the tracker; by default the
   * detectors run here over the supplied events.
   */
  async runCycle(
    events: readonly TrackedEvent[],
    options?: { signalsOverride?: readonly FrustrationSignal[] },
  ): Promise<CycleResult> {
    const now = this.now();
    const signals = options?.signalsOverride ?? runAllDetectors(events, this.detectorConfig);
    if (signals.length === 0) {
      return { signals, newProposals: [], autoApplied: [], suggestions: [] };
    }

    const proposals: Proposal[] = [];
    for (const advisor of this.advisors) {
      proposals.push(...(await advisor.propose(signals, now)));
    }

    const state = await this.store.load();
    const records = [...state.records];
    const active = { ...state.active };

    const autoApplied: Adaptation[] = [];
    const suggestions: Proposal[] = [];
    const newProposals: Proposal[] = [];

    for (const proposal of proposals) {
      if (active[proposal.adaptation.id]) continue;
      const duplicate = records.find(
        (r) => r.proposal.id === proposal.id && r.status !== "rolled-back",
      );
      if (duplicate && now - duplicate.createdAtMs < this.policy.reproposalCooldownMs) continue;

      const maxSeverity = Math.max(0, ...proposal.basedOn.map((s) => s.severity));
      newProposals.push(proposal);

      if (
        proposal.confidence >= this.policy.autoApplyConfidence &&
        maxSeverity >= this.policy.minSeverityToAutoApply &&
        !duplicate
      ) {
        const ok = await this.applyFn(proposal.adaptation);
        records.push({
          proposal,
          status: ok ? "applied" : "proposed",
          createdAtMs: now,
          decidedAtMs: now,
          decisionNote: ok
            ? `auto-applied: confidence ${proposal.confidence.toFixed(2)} ≥ ${this.policy.autoApplyConfidence}, severity ${maxSeverity.toFixed(2)}`
            : "host applier returned false; kept as proposal",
        });
        if (ok) {
          active[proposal.adaptation.id] = {
            adaptation: proposal.adaptation,
            appliedAtMs: now,
            basedOnSignalAtMs: proposal.basedOn[0]?.atMs ?? now,
          };
          autoApplied.push(proposal.adaptation);
        }
      } else {
        suggestions.push(proposal);
        records.push({
          proposal,
          status: "proposed",
          createdAtMs: now,
          decidedAtMs: null,
          decisionNote: duplicate
            ? "duplicate within cooldown"
            : `deferred: confidence ${proposal.confidence.toFixed(2)} / severity ${maxSeverity.toFixed(2)} below policy`,
        });
      }
    }

    await this.store.save({ ...state, records, active });
    return { signals, newProposals, autoApplied, suggestions };
  }

  /**
   * Verifies every applied-but-unverified adaptation by comparing feature pain
   * before vs. after its application across session analyses. Keeps improvements,
   * rolls back regressions, and marks verdicts so each application verifies once.
   */
  async evaluate(options: EvaluateOptions): Promise<EvaluateResult> {
    const now = this.now();
    const state = await this.store.load();
    const records = [...state.records];
    const active = { ...state.active };
    const verdicts = [...state.verdicts];
    const rolledBack: string[] = [];
    const verifiedIds = new Set(verdicts.map((v) => v.adaptationId));

    for (const [adaptationId, applied] of Object.entries(active)) {
      if (verifiedIds.has(adaptationId)) continue;
      if (now - applied.appliedAtMs < this.policy.verificationDelayMs) continue;

      const signalAt = applied.basedOnSignalAtMs;
      const beforeSessions = options.analyses.filter((a) => a.startedAtMs < applied.appliedAtMs);
      const afterSessions = options.analyses.filter(
        (a) => a.startedAtMs > applied.appliedAtMs + this.policy.verificationDelayMs - 1,
      );
      if (
        beforeSessions.length < this.policy.verificationMinSessions ||
        afterSessions.length < this.policy.verificationMinSessions
      ) {
        continue; // not enough evidence either way — keep observing.
      }

      const comparison = compareFeaturePain(
        options.analyses,
        applied.adaptation.feature,
        [
          Math.min(...beforeSessions.map((a) => a.startedAtMs)),
          Math.max(signalAt, ...beforeSessions.map((a) => a.startedAtMs)),
        ],
        [
          Math.min(...afterSessions.map((a) => a.startedAtMs)),
          Math.max(...afterSessions.map((a) => a.startedAtMs)),
        ],
      );
      if (!comparison) continue;

      const kept = comparison.deltaPct <= this.policy.rollbackDeltaPct;
      verdicts.push({
        adaptationId,
        kept,
        beforePain: comparison.before,
        afterPain: comparison.after,
        deltaPct: Number(comparison.deltaPct.toFixed(1)),
        evaluatedAtMs: now,
      });

      if (!kept) {
        if (this.revertFn) await this.revertFn(applied.adaptation);
        delete active[adaptationId];
        rolledBack.push(adaptationId);
        records.push({
          proposal: {
            id: `prop-${adaptationId}:rollback`,
            basedOn: [],
            feature: applied.adaptation.feature,
            adaptation: applied.adaptation,
            rationale: `rolled back: pain ${comparison.before.toFixed(2)} → ${comparison.after.toFixed(2)} (+${comparison.deltaPct.toFixed(1)}%)`,
            confidence: 1,
            source: "rule",
            createdAtMs: now,
          },
          status: "rolled-back",
          createdAtMs: now,
          decidedAtMs: now,
          decisionNote: `verification failed; reverted ${adaptationId}`,
        });
      } else {
        records.push({
          proposal: {
            id: `prop-${adaptationId}:verify`,
            basedOn: [],
            feature: applied.adaptation.feature,
            adaptation: applied.adaptation,
            rationale: `verified: pain ${comparison.before.toFixed(2)} → ${comparison.after.toFixed(2)} (${comparison.deltaPct.toFixed(1)}%)`,
            confidence: 1,
            source: "rule",
            createdAtMs: now,
          },
          status: "applied",
          createdAtMs: now,
          decidedAtMs: now,
          decisionNote: "verification passed; adaptation kept permanently",
        });
      }
    }

    await this.store.save({ records, active, verdicts });
    return { verdicts: verdicts.slice(), rolledBack };
  }
}
