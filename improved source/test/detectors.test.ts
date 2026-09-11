import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TrackedEvent } from "../src/events.ts";
import {
  detectDeadAndErrorClicks,
  detectExcessiveScroll,
  detectGhostGestures,
  detectMouseThrash,
  detectPromptRetries,
  detectRageClicks,
  featureFromTarget,
  runAllDetectors,
} from "../src/detectors.ts";
import { makeClick, makePointer, makeUiState } from "./helpers.ts";

const SIDEBAR_TARGET = {
  id: "left-sidebar-edge",
  feature: "left-sidebar",
  region: { x: 1380, y: 0, width: 60, height: 900 },
  tolerancePx: 20,
  minApproachSpeedPxMs: 0.5,
  expectedProperty: "open",
  expectedValue: "true",
  repeatWindowMs: 5000,
  attemptsThreshold: 2,
};

const uiState = (tMs: number, to: string) => makeUiState(tMs, "left-sidebar", to);

describe("ghost gesture detection", () => {
  it("fires when the user sweeps toward the sidebar twice and it never opens", () => {
    const events: TrackedEvent[] = [
      makePointer(0, 700, 400),
      makePointer(50, 1100, 405), // fast hop ~8px/ms
      makePointer(80, 1390, 410), // enters region
      makePointer(300, 1200, 420), // retreats
      makePointer(340, 800, 430),
      makePointer(380, 1150, 435), // second fast approach
      makePointer(400, 1395, 440), // re-enters
      makePointer(600, 1300, 450),
    ];
    const signals = detectGhostGestures(events, {
      targets: [SIDEBAR_TARGET],
      speedLookbackMs: 200,
    });
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.kind, "ghost-gesture");
    assert.equal(signals[0]?.feature, "left-sidebar");
    assert.ok((signals[0]?.confidence ?? 0) >= 0.55);
    assert.equal(signals[0]?.evidence.length, 2);
  });

  it("does not fire when a slow drift is not an approach attempt", () => {
    const events: TrackedEvent[] = [
      makePointer(0, 700, 400),
      makePointer(1000, 1000, 401), // slow
      makePointer(2000, 1390, 402), // very slow entry
      makePointer(3000, 1391, 403),
      makePointer(4000, 1390, 404),
      makePointer(5000, 1389, 405),
    ];
    const signals = detectGhostGestures(events, {
      targets: [SIDEBAR_TARGET],
      speedLookbackMs: 200,
    });
    assert.equal(signals.length, 0);
  });

  it("does not fire when the sidebar actually opened after the first sweep", () => {
    const events: TrackedEvent[] = [
      makePointer(0, 700, 400),
      makePointer(50, 1100, 405),
      makePointer(80, 1390, 410), // first entry
      makePointer(120, 1250, 420), // leaves
      uiState(150, "true"), // response!
      makePointer(160, 800, 430),
      makePointer(200, 1150, 435),
      makePointer(220, 1395, 440), // second entry — but intent was satisfied
    ];
    const signals = detectGhostGestures(events, {
      targets: [SIDEBAR_TARGET],
      speedLookbackMs: 200,
    });
    assert.equal(signals.length, 0);
  });

  it("requires attempts within the repeat window", () => {
    const events: TrackedEvent[] = [
      makePointer(0, 700, 400),
      makePointer(50, 1100, 405),
      makePointer(80, 1390, 410),
      makePointer(300, 1200, 420),
      // ...long gap beyond repeatWindowMs (5000)...
      makePointer(9000, 800, 430),
      makePointer(9040, 1150, 435),
      makePointer(9060, 1395, 440),
    ];
    const signals = detectGhostGestures(events, {
      targets: [{ ...SIDEBAR_TARGET, repeatWindowMs: 5000 }],
      speedLookbackMs: 200,
    });
    assert.equal(signals.length, 0);
  });
});

describe("rage click detection", () => {
  it("flags 3+ clustered clicks with no UI response", () => {
    const events: TrackedEvent[] = [
      makeClick(0, 100, 100),
      makeClick(200, 105, 102),
      makeClick(400, 98, 99),
    ];
    const signals = detectRageClicks(events);
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.kind, "rage-click");
    assert.match(signals[0]!.evidence[0]!, /3 clicks/);
  });

  it("ignores spread-out or far-apart clicks", () => {
    const spread = [
      makeClick(0, 100, 100),
      makeClick(2000, 105, 102),
      makeClick(4000, 98, 99),
    ];
    assert.equal(detectRageClicks(spread).length, 0);

    const far = [
      makeClick(0, 100, 100),
      makeClick(200, 400, 400),
      makeClick(400, 700, 700),
    ];
    assert.equal(detectRageClicks(far).length, 0);
  });
});

describe("dead & error click detection", () => {
  it("flags interactive clicks that produce no response within the window", () => {
    const events: TrackedEvent[] = [
      makeClick(0, 50, 50),
      makePointer(10, 52, 52),
    ];
    const signals = detectDeadAndErrorClicks(events);
    assert.equal(signals.filter((s) => s.kind === "dead-click").length, 1);
  });

  it("does not flag clicks answered by a UI state change", () => {
    const events: TrackedEvent[] = [
      makeClick(0, 50, 50),
      uiState(100, "true"),
    ];
    const signals = detectDeadAndErrorClicks(events);
    assert.equal(signals.length, 0);
  });

  it("prefers error-click when the click is followed by an app error", () => {
    const events: TrackedEvent[] = [
      makeClick(0, 50, 50),
      {
        category: "error",
        kind: "app-error",
        seq: 77,
        atMs: 1_000_500,
        tMs: 500,
        message: "boom",
        source: null,
      },
    ];
    const signals = detectDeadAndErrorClicks(events);
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.kind, "error-click");
  });

  it("ignores non-interactive targets like canvas background", () => {
    const events: TrackedEvent[] = [
      makeClick(0, 50, 50, { target: "div#canvas", lookedInteractive: false }),
    ];
    const signals = detectDeadAndErrorClicks(events);
    assert.equal(signals.length, 0);
  });
});

describe("mouse thrash detection", () => {
  it("detects rapid direction reversals in a small area", () => {
    const events: TrackedEvent[] = [];
    let x = 500;
    for (let i = 0; i < 12; i++) {
      events.push(makePointer(i * 60, x, 400));
      x += i % 2 === 0 ? -30 : 30; // ping-pong
    }
    const signals = detectMouseThrash(events);
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.kind, "mouse-thrash");
  });

  it("ignores calm movement", () => {
    const events = Array.from({ length: 12 }, (_, i) => makePointer(i * 60, 300 + i * 20, 400));
    assert.equal(detectMouseThrash(events).length, 0);
  });
});

describe("excessive scroll detection", () => {
  it("flags huge scroll distance in a short window", () => {
    const scroll = (tMs: number, delta: number): TrackedEvent => ({
      category: "scroll",
      kind: "scroll",
      seq: 500 + tMs,
      atMs: 1_000_000 + tMs,
      tMs,
      x: 0,
      y: delta,
      delta,
      surface: "properties-panel",
    });
    const events = Array.from({ length: 10 }, (_, i) => scroll(i * 200, 800));
    const signals = detectExcessiveScroll(events, { distanceThresholdPx: 5000 });
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.feature, "properties-panel.scroll");
  });
});

describe("prompt retry detection", () => {
  const prompt = (tMs: number, text: string): TrackedEvent => ({
    category: "prompt",
    kind: "prompt-sent",
    seq: 900 + tMs,
    atMs: 1_000_000 + tMs,
    tMs,
    promptId: `p-${tMs}`,
    text,
    textLength: text.length,
  });

  it("flags near-identical retries without an accepted artifact between them", () => {
    const events = [
      prompt(0, "make the hero section blue with big title"),
      prompt(30_000, "make the hero section blue with big title!!"),
    ];
    const signals = detectPromptRetries(events);
    assert.equal(signals.length, 1);
    assert.equal(signals[0]?.feature, "agent.prompt");
  });

  it("stays silent when the user accepted an artifact in between", () => {
    const events: TrackedEvent[] = [
      prompt(0, "make the hero blue"),
      {
        category: "artifact",
        kind: "artifact-accepted",
        seq: 950,
        atMs: 1_010_000,
        tMs: 10_000,
        artifactId: "a1",
        artifactType: "section",
        promptId: "p-0",
        latencyMs: 9000,
      },
      prompt(20_000, "make the hero blue"),
    ];
    assert.equal(detectPromptRetries(events).length, 0);
  });
});

describe("featureFromTarget", () => {
  it("derives dotted keys from selectors", () => {
    assert.equal(featureFromTarget("button#open-sidebar"), "button.open-sidebar");
    assert.equal(featureFromTarget("div.canvas-surface"), "div.canvas-surface");
    assert.equal(featureFromTarget("input"), "input");
    assert.equal(featureFromTarget(""), null);
  });
});

describe("runAllDetectors", () => {
  it("merges and time-sorts signals across detectors", () => {
    const events: TrackedEvent[] = [
      makeClick(0, 100, 100),
      makeClick(150, 103, 101),
      makeClick(300, 99, 100),
      makePointer(1000, 700, 400),
      makePointer(1050, 1100, 405),
      makePointer(1080, 1390, 410),
      makePointer(1300, 1200, 420),
      makePointer(1340, 800, 430),
      makePointer(1380, 1150, 435),
      makePointer(1400, 1395, 440),
    ];
    const signals = runAllDetectors(events, {
      ghostGesture: {
        targets: [SIDEBAR_TARGET],
        speedLookbackMs: 200,
      },
    });
    const kinds = new Set(signals.map((s) => s.kind));
    assert.ok(kinds.has("rage-click"));
    assert.ok(kinds.has("dead-click"));
    assert.ok(kinds.has("ghost-gesture"));
    for (let i = 1; i < signals.length; i++) {
      assert.ok(signals[i]!.atMs >= signals[i - 1]!.atMs, "signals must be sorted by time");
    }
  });
});
