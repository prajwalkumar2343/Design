import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TrackedEvent } from "../src/events.ts";
import { detectGhostGestures, type DetectorConfig } from "../src/detectors.ts";
import { MemoryStateStore, ImprovementEngine, DEFAULT_POLICY } from "../src/engine.ts";
import { RuleAdvisor } from "../src/propose.ts";
import type { SessionAnalysis } from "../src/analyze.ts";
import { makeClick, makePointer } from "./helpers.ts";

const GHOST_TARGET = {
  id: "left-sidebar-edge",
  feature: "left-sidebar",
  region: { x: 1380, y: 0, width: 60, height: 900 },
  tolerancePx: 20,
  minApproachSpeedPxMs: 0.5,
  repeatWindowMs: 5000,
  attemptsThreshold: 2,
};

const GHOST_DETECTOR_CONFIG: DetectorConfig = {
  ghostGesture: { targets: [GHOST_TARGET], speedLookbackMs: 200 },
};

function ghostGestureEvents(): TrackedEvent[] {
  return [
    makePointer(0, 700, 400),
    makePointer(50, 1100, 405),
    makePointer(80, 1390, 410),
    makePointer(300, 1200, 420),
    makePointer(340, 800, 430),
    makePointer(380, 1150, 435),
    makePointer(400, 1395, 440),
  ];
}

function ghostSignals() {
  return detectGhostGestures(ghostGestureEvents(), {
    targets: [GHOST_TARGET],
    speedLookbackMs: 200,
  });
}

function fakeAnalysis(startedAtMs: number, pain: number): SessionAnalysis {
  return {
    sessionId: `s-${startedAtMs}`,
    startedAtMs,
    eventCount: 1,
    signals: [],
    frictionScore: pain * 10,
    features: [
      { feature: "left-sidebar", countsByKind: { "ghost-gesture": 1 }, totalSignals: 1, painScore: pain },
    ],
  };
}

describe("ImprovementEngine.runCycle", () => {
  it("auto-applies high-confidence proposals through the host applier", async () => {
    const store = new MemoryStateStore();
    const applied: string[] = [];
    let clock = 100_000;
    const engine = new ImprovementEngine(store, {
      advisors: [new RuleAdvisor()],
      detectorConfig: { ghostGesture: { targets: [GHOST_TARGET], speedLookbackMs: 200 } },
      apply: async (adaptation) => {
        applied.push(adaptation.id);
        return true;
      },
      now: () => clock,
    });

    const result = await engine.runCycle(ghostGestureEvents());
    assert.equal(result.signals.length, 1);
    assert.equal(result.newProposals.length, 1);
    assert.equal(result.autoApplied.length, 1);
    assert.equal(applied[0], "panel-open-on-hover-intent:left-sidebar");

    const state = await engine.loadState();
    const record = state.records[0];
    assert.equal(record?.status, "applied");
    assert.match(record?.decisionNote ?? "", /auto-applied/);
    assert.ok(state.active["panel-open-on-hover-intent:left-sidebar"]);
  });

  it("defers low-confidence proposals to suggestions", async () => {
    const store = new MemoryStateStore();
    const engine = new ImprovementEngine(store, {
      advisors: [
        {
          propose: async (_signals, now) => [
            {
              id: "prop-increase-hit-target:left-sidebar",
              basedOn: [],
              feature: "left-sidebar",
              adaptation: {
                id: "increase-hit-target:left-sidebar",
                kind: "increase-hit-target" as const,
                feature: "left-sidebar",
                params: {},
                description: "test",
              },
              rationale: "weak evidence",
              confidence: 0.2,
              source: "rule" as const,
              createdAtMs: now,
            },
          ],
        },
      ],
      apply: async () => true,
    });

    // Low confidence + no real severity → suggestion only.
    const result = await engine.runCycle([], {
      signalsOverride: [
        {
          id: "sig-1",
          kind: "mouse-thrash",
          atMs: 5,
          feature: "left-sidebar",
          confidence: 0.2,
          severity: 0.2,
          evidence: ["tiny"],
        },
      ],
    });
    assert.equal(result.autoApplied.length, 0);
    assert.equal(result.suggestions.length, 1);
  });

  it("suppresses duplicate proposals within the cooldown window", async () => {
    const store = new MemoryStateStore();
    let clock = 100_000;
    const engine = new ImprovementEngine(store, {
      advisors: [new RuleAdvisor()],
      detectorConfig: GHOST_DETECTOR_CONFIG,
      apply: async () => false, // never applies → stays a proposal
      now: () => clock,
      policy: { reproposalCooldownMs: DEFAULT_POLICY.reproposalCooldownMs },
    });

    await engine.runCycle(ghostGestureEvents());
    clock += 1000;
    const second = await engine.runCycle(ghostGestureEvents());
    assert.equal(second.newProposals.length, 0, "duplicate inside cooldown is skipped");

    clock += DEFAULT_POLICY.reproposalCooldownMs + 1;
    const third = await engine.runCycle(ghostGestureEvents());
    assert.equal(third.newProposals.length, 1, "outside cooldown it may re-propose");
  });
});

describe("ImprovementEngine.evaluate", () => {
  function setupEngine(clock: { value: number }, revertLog: string[]) {
    const store = new MemoryStateStore();
    return new ImprovementEngine(store, {
      advisors: [new RuleAdvisor()],
      detectorConfig: GHOST_DETECTOR_CONFIG,
      apply: async () => true,
      revert: async (adaptation) => {
        revertLog.push(adaptation.id);
        return true;
      },
      now: () => clock.value,
      policy: {
        verificationDelayMs: 0,
        verificationMinSessions: 1,
      },
    });
  }

  it("keeps an adaptation when post-application pain drops", async () => {
    const clock = { value: 100_000 };
    const engine = setupEngine(clock, []);
    await engine.runCycle(ghostGestureEvents());

    clock.value += 10;
    const analyses = [
      fakeAnalysis(90_000, 0.9), // before application
      fakeAnalysis(95_000, 0.8),
      fakeAnalysis(100_500, 0.3), // after application
      fakeAnalysis(101_000, 0.2),
    ];
    const result = await engine.evaluate({ analyses });
    const verdict = result.verdicts.at(-1);
    assert.ok(verdict);
    assert.equal(verdict.kept, true);

    const state = await engine.loadState();
    assert.match(state.records.at(-1)?.decisionNote ?? "", /verification passed/);
    assert.ok(state.active["panel-open-on-hover-intent:left-sidebar"], "stays active");
  });

  it("rolls back an adaptation that made things worse", async () => {
    const clock = { value: 100_000 };
    const revertLog: string[] = [];
    const engine = setupEngine(clock, revertLog);
    await engine.runCycle(ghostGestureEvents());

    clock.value += 10;
    const analyses = [
      fakeAnalysis(90_000, 0.3),
      fakeAnalysis(95_000, 0.4),
      fakeAnalysis(100_500, 0.95), // much worse after the change
      fakeAnalysis(101_000, 0.9),
    ];
    const result = await engine.evaluate({ analyses });
    assert.deepEqual(result.rolledBack, ["panel-open-on-hover-intent:left-sidebar"]);
    assert.equal(revertLog.length, 1);

    const state = await engine.loadState();
    assert.equal(state.active["panel-open-on-hover-intent:left-sidebar"], undefined);
    assert.match(state.records.at(-1)?.decisionNote ?? "", /verification failed/);
  });

  it("waits for enough sessions in both windows before judging", async () => {
    const clock = { value: 100_000 };
    const engine = setupEngine(clock, []);
    await engine.runCycle(ghostGestureEvents());

    clock.value += 10;
    const tooFew = [fakeAnalysis(90_000, 0.9)];
    const result = await engine.evaluate({ analyses: tooFew });
    assert.equal(result.verdicts.length, 0, "insufficient data → no verdict yet");

    const state = await engine.loadState();
    assert.ok(state.active["panel-open-on-hover-intent:left-sidebar"], "still active while unverified");
  });
});
