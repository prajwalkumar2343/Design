import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeHeader, makePointer } from "./helpers.ts";
import { analyzeSession, compareFeaturePain, trend } from "../src/analyze.ts";
import type { SessionAnalysis } from "../src/analyze.ts";

describe("analyzeSession", () => {
  it("scores rage clicks higher than a calm session", () => {
    const calm = analyzeSession(makeHeader("calm"), [
      makePointer(0, 10, 10),
      makePointer(1000, 400, 400),
    ]);

    const angry = analyzeSession(
      makeHeader("angry"),
      [
        { ...makePointer(0, 100, 100) },
        {
          category: "click",
          kind: "click",
          seq: 1,
          atMs: 1_000_000,
          tMs: 0,
          x: 100,
          y: 100,
          target: "button#save",
          label: "Save",
          lookedInteractive: true,
        },
        {
          category: "click",
          kind: "click",
          seq: 2,
          atMs: 1_000_150,
          tMs: 150,
          x: 103,
          y: 101,
          target: "button#save",
          label: "Save",
          lookedInteractive: true,
        },
        {
          category: "click",
          kind: "click",
          seq: 3,
          atMs: 1_000_300,
          tMs: 300,
          x: 99,
          y: 102,
          target: "button#save",
          label: "Save",
          lookedInteractive: true,
        },
      ],
      // Silence ghost-gesture config; only click detectors run here.
    );

    assert.equal(calm.frictionScore, 0);
    assert.ok(angry.frictionScore > 0);
    assert.ok(angry.features.some((f) => f.feature === "button.save"));
  });
});

function fakeAnalysis(
  startedAtMs: number,
  featurePain: Record<string, number>,
): SessionAnalysis {
  return {
    sessionId: `s-${startedAtMs}`,
    startedAtMs,
    eventCount: 0,
    signals: [],
    frictionScore: Math.round(Object.values(featurePain).reduce((a, b) => a + b, 0)),
    features: Object.entries(featurePain).map(([feature, painScore]) => ({
      feature,
      countsByKind: {},
      totalSignals: 1,
      painScore,
    })),
  };
}

describe("compareFeaturePain", () => {
  const analyses = [
    fakeAnalysis(0, { "left-sidebar": 0.8 }),
    fakeAnalysis(1000, { "left-sidebar": 0.6 }),
    fakeAnalysis(2000, { "left-sidebar": 0.2 }),
    fakeAnalysis(3000, { "left-sidebar": 0.1 }),
  ];

  it("computes before/after delta", () => {
    const result = compareFeaturePain(analyses, "left-sidebar", [0, 1000], [2000, 3000]);
    assert.ok(result);
    assert.ok(result.before > result.after);
    assert.ok(result.deltaPct < 0);
  });

  it("returns null when a window has no data — never fabricates", () => {
    assert.equal(compareFeaturePain(analyses, "left-sidebar", [99999, 100000], [2000, 3000]), null);
    assert.equal(compareFeaturePain(analyses, "unknown-feature", [0, 1], [2, 3]), null);
  });
});

describe("trend", () => {
  it("buckets sessions by time and averages scores", () => {
    const analyses = [
      fakeAnalysis(0, { a: 10 }),
      fakeAnalysis(1000, { a: 30 }),
      fakeAnalysis(3600_000, { a: 5 }),
    ];
    const points = trend(analyses, 3600_000);
    assert.equal(points.length, 2);
    assert.equal(points[0]?.frictionScore, 20);
    assert.equal(points[0]?.sessionCount, 2);
    assert.equal(points[1]?.frictionScore, 5);
  });
});
