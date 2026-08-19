import { describe, expect, it } from "vitest";

import {
  MAX_DISTINCT_ELEMENTS,
  MAX_FIX_EVENTS,
  MAX_STROKE_SAMPLES,
  MAX_TRAIL_SAMPLES,
  MIN_SAMPLE_DISTANCE,
  PointerInteractionRecorder,
  PointerInteractionRecorderError,
} from "./recorder";

function clock(start = 1_000) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

function sample(recorder: PointerInteractionRecorder, x: number, y: number, overrides: Record<string, unknown> = {}) {
  return recorder.sample({ x, y, ...overrides });
}

describe("PointerInteractionRecorder", () => {
  it("records samples into the trail and tracks the latest pointer", () => {
    const recorder = new PointerInteractionRecorder({ now: clock().now });

    recorder.sample({ x: 10, y: 20, frameId: "f1", elementId: "e1", atMs: 1000 });
    recorder.sample({ x: 40, y: 60, frameId: "f1", elementId: "e2", atMs: 1100 });

    const snapshot = recorder.snapshot();
    expect(snapshot.trail).toHaveLength(2);
    expect(snapshot.current).toMatchObject({ x: 40, y: 60, frameId: "f1", elementId: "e2" });
    expect(snapshot.pointedElementIds).toEqual(["e1", "e2"]);
    expect(snapshot.activity).toBe("pointing");
  });

  it("filters sub-threshold jitter but keeps real movement", () => {
    const recorder = new PointerInteractionRecorder({
      now: clock().now,
      minSampleDistance: 10,
    });

    expect(recorder.sample({ x: 0, y: 0, atMs: 1000 })).not.toBeNull();
    expect(recorder.sample({ x: 2, y: 1, atMs: 1010 })).toBeNull();
    expect(recorder.sample({ x: 50, y: 0, atMs: 1020 })).not.toBeNull();

    expect(recorder.snapshot().trail).toHaveLength(2);
  });

  it("keeps a jitter-filtered sample when the hovered element changes", () => {
    const recorder = new PointerInteractionRecorder({
      now: clock().now,
      minSampleDistance: 100,
    });

    recorder.sample({ x: 0, y: 0, elementId: "e1", atMs: 1000 });
    const kept = recorder.sample({ x: 1, y: 1, elementId: "e2", atMs: 1010 });

    expect(kept).not.toBeNull();
    expect(recorder.snapshot().trail).toHaveLength(2);
  });

  it("bounds the trail by window and sample count", () => {
    const rec = clock();
    const recorder = new PointerInteractionRecorder({
      now: rec.now,
      maxTrailSamples: 5,
      maxTrailWindowMs: 1_000,
    });

    for (let i = 0; i < 8; i += 1) {
      rec.advance(150);
      recorder.sample({ x: i * 50, y: 0, atMs: rec.now() });
    }

    const snapshot = recorder.snapshot();
    expect(snapshot.trail).toHaveLength(5);
    expect(snapshot.trail[0].atMs).toBe(1600);
    expect(snapshot.trail.at(-1)!.atMs).toBe(2200);
    expect(snapshot.trail.at(-1)!.atMs - snapshot.trail[0].atMs).toBe(600);
  });

  it("caps distinct pointed elements, dropping the oldest", () => {
    const recorder = new PointerInteractionRecorder({
      now: clock().now,
      maxDistinctElements: 3,
    });

    for (let i = 0; i < 5; i += 1) {
      recorder.sample({ x: i * 50, y: 0, elementId: `e${i}`, atMs: 1000 + i * 100 });
    }

    expect(recorder.snapshot().pointedElementIds).toEqual(["e2", "e3", "e4"]);
  });

  it("records drawing strokes with bounds, elements, and counts", () => {
    const recorder = new PointerInteractionRecorder({ now: clock().now });

    recorder.beginStroke("drawing", 1, 1000);
    sample(recorder, 0, 0, { atMs: 1001, pointerId: 1, elementId: "card" });
    sample(recorder, 10, 0, { atMs: 1002, pointerId: 1, elementId: "card" });
    sample(recorder, 10, 20, { atMs: 1003, pointerId: 1, elementId: "button" });
    recorder.endStroke(1, 1004);

    const snapshot = recorder.snapshot();
    expect(snapshot.strokes).toHaveLength(1);
    expect(snapshot.strokes[0]).toMatchObject({
      kind: "drawing",
      pointerId: 1,
      startedAtMs: 1000,
      endedAtMs: 1004,
      sampleCount: 3,
      elementIds: ["card", "button"],
    });
    expect(snapshot.strokes[0].bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 20 });
    expect(snapshot.drawOverElementIds).toEqual(["card", "button"]);
  });

  it("rejects a second stroke for the same pointer", () => {
    const recorder = new PointerInteractionRecorder({ now: clock().now });
    recorder.beginStroke("drawing", 1, 1000);

    expect(() => recorder.beginStroke("drawing", 1, 1001)).toThrowError(
      PointerInteractionRecorderError,
    );
  });

  it("cancels an in-progress stroke", () => {
    const recorder = new PointerInteractionRecorder({ now: clock().now });
    recorder.beginStroke("drawing", 1, 1000);
    recorder.cancelStroke(1);

    expect(recorder.snapshot().strokes).toHaveLength(0);
  });

  it("records fixing strokes as fix targets on completion", () => {
    const recorder = new PointerInteractionRecorder({ now: clock().now });

    recorder.beginStroke("fixing", 2, 1000);
    sample(recorder, 5, 5, { atMs: 1001, pointerId: 2, elementId: "hero-title" });
    recorder.endStroke(2, 1002);

    const snapshot = recorder.snapshot();
    expect(snapshot.strokes[0].kind).toBe("fixing");
    expect(snapshot.fixElementIds).toEqual(["hero-title"]);
  });

  it("records and bounds fix events", () => {
    const rec = clock();
    const recorder = new PointerInteractionRecorder({
      now: rec.now,
      maxFixEvents: 2,
    });

    for (let i = 0; i < 4; i += 1) {
      rec.advance(50);
      recorder.markFix({ elementId: `e${i}`, frameId: "f1", atMs: rec.now() });
    }

    const snapshot = recorder.snapshot();
    expect(snapshot.fixes).toHaveLength(2);
    expect(snapshot.fixes.map((fix) => fix.elementId)).toEqual(["e2", "e3"]);
    expect(snapshot.fixElementIds).toEqual(["e0", "e1", "e2", "e3"]);
  });

  it("caps stroke sample bookkeeping", () => {
    const recorder = new PointerInteractionRecorder({ now: clock().now });

    recorder.beginStroke("drawing", 1, 1000);
    for (let i = 0; i < MAX_STROKE_SAMPLES + 10; i += 1) {
      sample(recorder, i * 50, 0, { atMs: 1000 + i, pointerId: 1 });
    }
    recorder.endStroke(1, 3000);

    expect(recorder.snapshot().strokes[0].sampleCount).toBe(MAX_STROKE_SAMPLES);
  });

  it("caps the retained trail independently of constant movement", () => {
    const rec = clock();
    const recorder = new PointerInteractionRecorder({
      now: rec.now,
      maxTrailSamples: MAX_TRAIL_SAMPLES,
    });

    for (let i = 0; i < MAX_TRAIL_SAMPLES + 50; i += 1) {
      rec.advance(1);
      recorder.sample({ x: i * 100, y: 0, atMs: rec.now() });
    }

    expect(recorder.snapshot().trail).toHaveLength(MAX_TRAIL_SAMPLES);
  });

  it("snapshot returns defensive copies", () => {
    const recorder = new PointerInteractionRecorder({ now: clock().now });
    recorder.sample({ x: 0, y: 0, elementId: "e1", atMs: 1000 });
    const first = recorder.snapshot();

    recorder.sample({ x: 100, y: 0, elementId: "e2", atMs: 1001 });

    expect(first.trail).toHaveLength(1);
    expect(first.pointedElementIds).toEqual(["e1"]);
  });

  it("reset clears the window", () => {
    const recorder = new PointerInteractionRecorder({ now: clock().now });
    recorder.sample({ x: 0, y: 0, elementId: "e1", atMs: 1000 });
    recorder.markFix({ elementId: "e1", atMs: 1001 });
    recorder.setActivity("drawing");

    recorder.reset();

    const snapshot = recorder.snapshot();
    expect(snapshot.trail).toHaveLength(0);
    expect(snapshot.strokes).toHaveLength(0);
    expect(snapshot.fixes).toHaveLength(0);
    expect(snapshot.pointedElementIds).toHaveLength(0);
    expect(snapshot.current).toBeNull();
    expect(snapshot.activity).toBe("pointing");
  });

  it("rejects non-finite samples", () => {
    const recorder = new PointerInteractionRecorder({ now: clock().now });
    expect(() => recorder.sample({ x: Number.NaN, y: 0 })).toThrowError(
      PointerInteractionRecorderError,
    );
  });

  it("honors MIN_SAMPLE_DISTANCE default", () => {
    expect(MIN_SAMPLE_DISTANCE).toBe(2);
    const recorder = new PointerInteractionRecorder({ now: clock().now });
    recorder.sample({ x: 0, y: 0, atMs: 1000 });
    expect(recorder.sample({ x: 0.5, y: 0.5, atMs: 1001 })).toBeNull();
    expect(recorder.sample({ x: 2.1, y: 0, atMs: 1002 })).not.toBeNull();
  });
});