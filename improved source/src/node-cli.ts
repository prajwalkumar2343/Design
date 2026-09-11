/**
 * CLI report generator (Node).
 *
 * Reads all stored sessions from the JSONL store, runs the full analysis +
 * improvement loop, and writes `report.json` for the static dashboard.
 *
 *   node src/node-cli.ts [--data ./data] [--out ./dashboard/report.json]
 *                                        [--engine-state ./data/engine-state.json]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JsonlFileStore } from "./store-file.ts";
import { analyzeAllSessions } from "./index.ts";
import { trend } from "./analyze.ts";
import { ImprovementEngine, JsonFileStateStore } from "./index.ts";
import type { analyzeSession } from "./analyze.ts";
import { RuleAdvisor } from "./propose.ts";
import type { ProposalRecord } from "./engine.ts";

interface CliArgs {
  data: string;
  out: string;
  engineState: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key?.startsWith("--")) {
      args[key.slice(2)] = argv[i + 1] ?? "";
      i += 1;
    }
  }
  return {
    data: resolve(args.data ?? "./data"),
    out: resolve(args.out ?? "./dashboard/report.json"),
    engineState: resolve(args.engineState ?? "./data/engine-state.json"),
  };
}

export interface Report {
  readonly generatedAtMs: number;
  readonly sessionsAnalyzed: number;
  readonly totalEvents: number;
  readonly averageFrictionScore: number;
  readonly signalsByKind: Record<string, number>;
  readonly topFeatures: Array<{ feature: string; painScore: number; signals: number }>;
  readonly frictionTrend: ReturnType<typeof trend>;
  readonly proposals: ProposalRecord[];
}

export async function buildReport(
  args: CliArgs,
  detectorConfig?: Parameters<typeof analyzeSession>[2],
): Promise<Report> {
  const store = new JsonlFileStore({ rootDir: args.data });
  const analyses = await analyzeAllSessions(store, detectorConfig);

  const totalEvents = analyses.reduce((sum, a) => sum + a.eventCount, 0);
  const signalsByKind: Record<string, number> = {};
  for (const analysis of analyses) {
    for (const signal of analysis.signals) {
      signalsByKind[signal.kind] = (signalsByKind[signal.kind] ?? 0) + 1;
    }
  }

  // Run the engine's evaluation so verdicts in state stay current.
  const engine = new ImprovementEngine(new JsonFileStateStore(args.engineState), {
    advisors: [new RuleAdvisor()],
    apply: async () => false, // reporting never applies anything.
  });
  await engine.evaluate({ analyses });
  const state = await engine.loadState();

  const featureMap = new Map<string, { painScore: number; signals: number }>();
  for (const analysis of analyses) {
    for (const feature of analysis.features) {
      const entry = featureMap.get(feature.feature) ?? { painScore: 0, signals: 0 };
      entry.painScore = Math.max(entry.painScore, feature.painScore);
      entry.signals += feature.totalSignals;
      featureMap.set(feature.feature, entry);
    }
  }

  return {
    generatedAtMs: Date.now(),
    sessionsAnalyzed: analyses.length,
    totalEvents,
    averageFrictionScore:
      analyses.length === 0
        ? 0
        : Math.round(analyses.reduce((sum, a) => sum + a.frictionScore, 0) / analyses.length),
    signalsByKind,
    topFeatures: [...featureMap.entries()]
      .map(([feature, v]) => ({ feature, ...v }))
      .sort((a, b) => b.painScore - a.painScore || b.signals - a.signals)
      .slice(0, 10),
    frictionTrend: trend(analyses, 60 * 60 * 1000),
    proposals: state.records,
  };
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1]?.replace(/\\/g, "/").endsWith("node-cli.ts");

if (isDirectRun) {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReport(args);
  await mkdir(resolve(args.out, ".."), { recursive: true });
  await writeFile(args.out, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[improved-source] report written: ${args.out} (${report.sessionsAnalyzed} sessions, ` +
      `${report.totalEvents} events, avg friction ${report.averageFrictionScore})`,
  );
}
