/**
 * Aggregation and scoring over stored sessions.
 *
 * Turns raw signals into the numbers the improvement engine needs:
 *  - a friction score per session (weighted, rage > dead, as research suggests),
 *  - per-feature breakdowns so fixes can be attributed,
 *  - before/after windows used to verify whether an applied adaptation worked.
 */

import type { SessionHeader, TrackedEvent } from "./events.ts";
import type { FrustrationSignal, SignalKind } from "./detectors.ts";
import { runAllDetectors } from "./detectors.ts";

/** Relative pain weight of each signal kind; rage-style signals hurt most. */
export const SEVERITY_WEIGHTS: Record<SignalKind, number> = {
  "ghost-gesture": 1,
  "rage-click": 0.95,
  "error-click": 0.8,
  "prompt-retry": 0.7,
  "dead-click": 0.6,
  "mouse-thrash": 0.4,
  "excessive-scroll": 0.35,
};

export interface FeatureBreakdown {
  readonly feature: string;
  readonly countsByKind: Record<string, number>;
  readonly totalSignals: number;
  /** Mean confidence × mean severity — how painful this feature is when touched. */
  readonly painScore: number;
}

export interface SessionAnalysis {
  readonly sessionId: string;
  readonly startedAtMs: number;
  readonly eventCount: number;
  readonly signals: FrustrationSignal[];
  /** Σ weight(kind) × confidence × severity, normalized to 0..100. */
  readonly frictionScore: number;
  readonly features: FeatureBreakdown[];
}

export function analyzeSession(
  header: SessionHeader,
  events: readonly TrackedEvent[],
  config?: Parameters<typeof runAllDetectors>[1],
): SessionAnalysis {
  const signals = runAllDetectors(events, config);
  let weighted = 0;
  const byFeature = new Map<string, { counts: Map<SignalKind, number>; confidence: number[]; severity: number[] }>();

  for (const signal of signals) {
    weighted += SEVERITY_WEIGHTS[signal.kind] * signal.confidence * signal.severity;
    let entry = byFeature.get(signal.feature);
    if (!entry) {
      entry = { counts: new Map(), confidence: [], severity: [] };
      byFeature.set(signal.feature, entry);
    }
    entry.counts.set(signal.kind, (entry.counts.get(signal.kind) ?? 0) + 1);
    entry.confidence.push(signal.confidence);
    entry.severity.push(signal.severity);
  }

  const features: FeatureBreakdown[] = [...byFeature.entries()]
    .map(([feature, entry]) => ({
      feature,
      countsByKind: Object.fromEntries([...entry.counts.entries()]),
      totalSignals: entry.confidence.length,
      painScore:
        (avg(entry.confidence) ?? 0) * (avg(entry.severity) ?? 0),
    }))
    .sort((a, b) => b.painScore - a.painScore);

  return {
    sessionId: header.sessionId,
    startedAtMs: header.startedAtMs,
    eventCount: events.length,
    signals,
    frictionScore: Math.min(100, Math.round(weighted * 10)),
    features,
  };
}

export interface TrendPoint {
  readonly startedAtMs: number;
  readonly frictionScore: number;
  readonly sessionCount: number;
}

/** Groups analyses into time buckets so improvement/decay is visible. */
export function trend(analyses: readonly SessionAnalysis[], bucketMs: number): TrendPoint[] {
  const buckets = new Map<number, { sum: number; count: number; at: number }>();
  for (const analysis of analyses) {
    const key = Math.floor(analysis.startedAtMs / bucketMs) * bucketMs;
    const entry = buckets.get(key) ?? { sum: 0, count: 0, at: key };
    entry.sum += analysis.frictionScore;
    entry.count += 1;
    buckets.set(key, entry);
  }
  return [...buckets.values()]
    .sort((a, b) => a.at - b.at)
    .map((entry) => ({
      startedAtMs: entry.at,
      frictionScore: Math.round(entry.sum / entry.count),
      sessionCount: entry.count,
    }));
}

/**
 * Verification primitive for the engine: compares mean friction attributable
 * to one feature across two disjoint windows of sessions.
 * Returns null when either window lacks data — never fabricate an answer.
 */
export function compareFeaturePain(
  analyses: readonly SessionAnalysis[],
  feature: string,
  beforeRange: readonly [number, number],
  afterRange: readonly [number, number],
): { before: number; after: number; deltaPct: number } | null {
  const before = meanFeaturePain(analyses, feature, beforeRange);
  const after = meanFeaturePain(analyses, feature, afterRange);
  if (before === null || after === null) return null;
  const deltaPct = before === 0 ? (after === 0 ? 0 : 100) : ((after - before) / before) * 100;
  return { before, after, deltaPct };
}

function meanFeaturePain(
  analyses: readonly SessionAnalysis[],
  feature: string,
  range: readonly [number, number],
): number | null {
  const inRange = analyses.filter(
    (a) => a.startedAtMs >= range[0] && a.startedAtMs <= range[1],
  );
  if (inRange.length === 0) return null;
  const scores = inRange.map((a) => a.features.find((f) => f.feature === feature)?.painScore ?? 0);
  return avg(scores) ?? 0;
}

function avg(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
