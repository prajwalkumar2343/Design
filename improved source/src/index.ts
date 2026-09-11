/**
 * Public API of the self-improvement system.
 *
 * Browser one-liner:
 *   const loop = await startSelfImprovement({ apply: applyAdaptationInApp });
 *
 * Node report generation: see node-cli.ts
 */

export * from "./events.ts";
export { MemoryEventStore, type EventStore } from "./store.ts";
export { JsonlFileStore } from "./store-file.ts";
export { WebStorageEventStore } from "./store-web.ts";
export * from "./detectors.ts";
export * from "./analyze.ts";
export * from "./adaptations.ts";
export * from "./propose.ts";
export * from "./llm-advisor.ts";
export * from "./engine.ts";
export { JsonFileStateStore, WebStorageStateStore } from "./state-store.ts";
export * from "./tracker.ts";

import { RuleAdvisor, type Advisor } from "./propose.ts";
import {
  ImprovementEngine,
  type EnginePolicy,
} from "./engine.ts";
import type { Adaptation } from "./adaptations.ts";
import { analyzeSession, type SessionAnalysis } from "./analyze.ts";
import type { FrustrationSignal } from "./detectors.ts";
import {
  EVENT_SCHEMA_VERSION,
  type SessionHeader,
  type TrackedEvent,
} from "./events.ts";
import { TrackerCore, installTracker, type InstalledTracker, type InstallOptions } from "./tracker.ts";
import { WebStorageEventStore } from "./store-web.ts";
import { WebStorageStateStore } from "./state-store.ts";
import type { EventStore } from "./store.ts";

export interface StartOptions {
  /** Applies an adaptation inside the host app; return false to defer. */
  apply: (adaptation: Adaptation) => Promise<boolean>;
  revert?: (adaptation: Adaptation) => Promise<boolean>;
  policy?: Partial<EnginePolicy>;
  detectorConfig?: InstallOptions["detectorConfig"];
  onSignals?: (signals: readonly FrustrationSignal[]) => void;
  appVersion?: string;
  /** Extra advisors such as the LLM advisor; the rule advisor always runs. */
  extraAdvisors?: readonly Advisor[];
}

export interface RunningLoop {
  tracker: InstalledTracker;
  engine: ImprovementEngine;
  header: SessionHeader;
  stop(): Promise<void>;
}

/**
 * Wires everything together for a browser app: event store → tracker →
 * detectors → improvement engine. Call once at startup; call `stop()` on unload.
 */
export async function startSelfImprovement(options: StartOptions): Promise<RunningLoop> {
  const sessionId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const header: SessionHeader = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    sessionId,
    startedAtMs: Date.now(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    viewport:
      typeof window !== "undefined"
        ? { width: window.innerWidth, height: window.innerHeight }
        : { width: 0, height: 0 },
    appVersion: options.appVersion ?? "dev",
  };

  const eventStore = new WebStorageEventStore();
  await eventStore.createSession(header);

  const core = new TrackerCore({
    sessionId,
    sink: {
      async write(events: readonly TrackedEvent[]): Promise<void> {
        for (const event of events) {
          await eventStore.append(sessionId, event);
        }
      },
    },
  });
  core.begin(header.startedAtMs);

  const engine = new ImprovementEngine(new WebStorageStateStore(), {
    advisors: [new RuleAdvisor(), ...(options.extraAdvisors ?? [])],
    apply: options.apply,
    revert: options.revert,
    policy: options.policy,
  });

  const tracker = installTracker({
    core,
    header,
    detectorConfig: options.detectorConfig,
    onSignals: (signals) => {
      void engine.runCycle([], { signalsOverride: signals }).then(async (result) => {
        // runCycle applies through the policy gate itself; nothing extra here.
        void result;
      });
    },
  });

  return {
    tracker,
    engine,
    header,
    async stop(): Promise<void> {
      tracker.stop();
      await core.flush();
    },
  };
}

/** Builds analyses for every stored session (used by reports and evaluation). */
export async function analyzeAllSessions(
  store: EventStore,
  detectorConfig?: Parameters<typeof analyzeSession>[2],
): Promise<SessionAnalysis[]> {
  const headers = await store.listSessions();
  const analyses: SessionAnalysis[] = [];
  for (const header of headers) {
    const stored = await store.readSession(header.sessionId);
    if (!stored) continue;
    analyses.push(analyzeSession(stored.header, stored.events, detectorConfig));
  }
  return analyses.sort((a, b) => a.startedAtMs - b.startedAtMs);
}
