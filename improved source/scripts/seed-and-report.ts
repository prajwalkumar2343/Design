/**
 * Seeds `./data` with two realistic synthetic sessions so the CLI report and
 * dashboard can be exercised end-to-end without a browser:
 *
 *   node scripts/seed-and-report.ts
 *
 * Session 1: heavy frustration (ghost gestures on the sidebar + rage clicks).
 * Session 2: after the "open on hover-intent" adaptation — same usage, no
 * ghost gestures. The engine's evaluation should therefore keep the fix.
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_SCHEMA_VERSION, type TrackedEvent } from "../src/events.ts";
import type { TrackedEventInput } from "../src/tracker.ts";
import { JsonlFileStore } from "../src/store-file.ts";
import { analyzeAllSessions } from "../src/index.ts";
import { ImprovementEngine, JsonFileStateStore } from "../src/index.ts";
import { RuleAdvisor } from "../src/propose.ts";

const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const GHOST_TARGET = {
  id: "left-sidebar-edge",
  feature: "left-sidebar",
  region: { x: 1400, y: 0, width: 40, height: 900 },
  tolerancePx: 60,
  minApproachSpeedPxMs: 0.5,
  expectedProperty: "open",
  expectedValue: "true",
  repeatWindowMs: 8000,
  attemptsThreshold: 2,
};
const DETECTOR_CONFIG = { ghostGesture: { targets: [GHOST_TARGET], speedLookbackMs: 150 } };

let seq = 0;
const ev = (tMs: number, event: TrackedEventInput): TrackedEvent =>
  ({ ...event, seq: seq++, atMs: tMs, tMs }) as TrackedEvent;

function sweep(tMs: number): TrackedEvent[] {
  return [
    ev(tMs, { category: "pointer", kind: "pointer-move", x: 900, y: 420, buttons: 0 }),
    ev(tMs + 40, { category: "pointer", kind: "pointer-move", x: 1250, y: 424, buttons: 0 }),
    ev(tMs + 70, { category: "pointer", kind: "pointer-move", x: 1420, y: 430, buttons: 0 }),
    ev(tMs + 260, { category: "pointer", kind: "pointer-move", x: 1300, y: 436, buttons: 0 }),
  ];
}

function frustratedSession(startedAtMs: number): TrackedEvent[] {
  return [
    ...sweep(2_000),
    ev(3_400, { category: "pointer", kind: "pointer-move", x: 1_100, y: 440, buttons: 0 }),
    ...sweep(3_800), // second sweep → ghost gesture fires
    ev(5_000, {
      category: "click",
      kind: "click",
      x: 200,
      y: 300,
      target: "button#export",
      label: "Export",
      lookedInteractive: true,
    }),
    ev(5_180, {
      category: "click",
      kind: "click",
      x: 203,
      y: 301,
      target: "button#export",
      label: "Export",
      lookedInteractive: true,
    }),
    ev(5_360, {
      category: "click",
      kind: "click",
      x: 199,
      y: 299,
      target: "button#export",
      label: "Export",
      lookedInteractive: true,
    }), // rage click cluster
    ev(7_000, {
      category: "prompt",
      kind: "prompt-sent",
      promptId: "p1",
      text: "make the hero section blue",
      textLength: 27,
    }),
    ev(25_000, {
      category: "prompt",
      kind: "prompt-sent",
      promptId: "p2",
      text: "make the hero section blue please",
      textLength: 33,
    }), // retry without accepted artifact
  ];
}

function calmSession(startedAtMs: number): TrackedEvent[] {
  return [
    ...sweep(2_000),
    // hover-intent opens the sidebar → intent answered → no ghost gesture
    ev(2_120, {
      category: "ui-state",
      kind: "ui-state-change",
      feature: "left-sidebar",
      property: "open",
      from: "false",
      to: "true",
    }),
    ev(6_000, {
      category: "click",
      kind: "click",
      x: 220,
      y: 310,
      target: "button#export",
      label: "Export",
      lookedInteractive: true,
    }),
    ev(6_150, {
      category: "ui-state",
      kind: "ui-state-change",
      feature: "export-dialog",
      property: "visible",
      from: "false",
      to: "true",
    }),
    ev(9_000, {
      category: "prompt",
      kind: "prompt-sent",
      promptId: "p3",
      text: "add a pricing table",
      textLength: 19,
    }),
    ev(10_500, {
      category: "artifact",
      kind: "artifact-accepted",
      artifactId: "a9",
      artifactType: "section",
      promptId: "p3",
      latencyMs: 1_400,
    }),
  ];
}

async function main(): Promise<void> {
  await rm(DATA, { recursive: true, force: true });
  await mkdir(join(DATA, "sessions"), { recursive: true });

  const store = new JsonlFileStore({ rootDir: DATA });
  const hour = 3_600_000;
  const base = Date.now() - 3 * hour;

  const sessions: Array<[string, TrackedEvent[]]> = [
    ["frustrated", frustratedSession(base)],
    ["calm", calmSession(base + 2 * hour)],
  ];
  for (const [name, events] of sessions) {
    const sessionId = `${name}-${base.toString(36)}`;
    await store.createSession({
      schemaVersion: EVENT_SCHEMA_VERSION,
      sessionId,
      startedAtMs: base,
      userAgent: "seed-script",
      viewport: { width: 1440, height: 900 },
      appVersion: "improved-source-seed",
    });
    for (const event of events) await store.append(sessionId, event);
    await store.flush(sessionId);
  }

  const analyses = await analyzeAllSessions(store, DETECTOR_CONFIG);
  console.log(
    "[seed] friction scores:",
    analyses.map((a) => `${a.sessionId}=${a.frictionScore}`).join(", "),
  );

  const engine = new ImprovementEngine(new JsonFileStateStore(join(DATA, "engine-state.json")), {
    advisors: [new RuleAdvisor()],
    detectorConfig: DETECTOR_CONFIG,
    apply: async () => true,
  });

  const frustratedEvents = frustratedSession(base);
  const cycle = await engine.runCycle(frustratedEvents);
  console.log(
    `[seed] signals=${cycle.signals.length} proposals=${cycle.newProposals.length} autoApplied=${cycle.autoApplied.map((a) => a.id).join("|") || "none"}`,
  );

  const evaluation = await engine.evaluate({ analyses });
  console.log(`[seed] verdicts=${evaluation.verdicts.length} rolledBack=${evaluation.rolledBack.join("|") || "none"}`);

  const { buildReport } = await import("../src/node-cli.ts");
  const report = await buildReport(
    {
      data: DATA,
      out: fileURLToPath(new URL("../dashboard/report.json", import.meta.url)),
      engineState: join(DATA, "engine-state.json"),
    },
    DETECTOR_CONFIG,
  );
  console.log(
    `[seed] report: sessions=${report.sessionsAnalyzed} signals=${JSON.stringify(report.signalsByKind)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
