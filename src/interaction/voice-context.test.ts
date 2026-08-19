import { describe, expect, it } from "vitest";

import { PointerInteractionRecorder } from "./recorder";
import { toVoiceInteractionContext, toVoicePointerContext } from "./voice-context";

function snapshotAt(x: number, y: number, frameId: string | null, elementId: string | null) {
  const recorder = new PointerInteractionRecorder({ now: () => 5_000 });
  recorder.sample({ x, y, frameId, elementId, atMs: 5_000 });
  return recorder.snapshot();
}

describe("toVoicePointerContext", () => {
  it("maps the current pointer when a frame is active", () => {
    const pointer = toVoicePointerContext(snapshotAt(120, 340, "f1", "hero-title"));
    expect(pointer).toEqual({ frameId: "f1", x: 120, y: 340, hoveredElementId: "hero-title" });
  });

  it("returns null when the pointer is outside any frame", () => {
    expect(toVoicePointerContext(snapshotAt(5, 5, null, null))).toBeNull();
  });
});

describe("toVoiceInteractionContext", () => {
  it("adapts a snapshot into the voice protocol context", () => {
    const snapshot = snapshotAt(120, 340, "f1", "hero-title");
    const base = {
      documentId: "doc-1",
      documentRevision: 7,
      activeFrameId: "f1",
      selectedElementIds: ["hero-title"],
    };

    const context = toVoiceInteractionContext(snapshot, base);

    expect(context).toEqual({
      capturedAtMs: 5_000,
      documentId: "doc-1",
      documentRevision: 7,
      activeFrameId: "f1",
      selectedElementIds: ["hero-title"],
      pointer: { frameId: "f1", x: 120, y: 340, hoveredElementId: "hero-title" },
    });
  });

  it("falls back to the snapshot frame when the base has none", () => {
    const snapshot = snapshotAt(10, 20, "f2", null);
    const context = toVoiceInteractionContext(snapshot, {
      documentId: null,
      documentRevision: null,
      activeFrameId: null,
      selectedElementIds: [],
    });

    expect(context.activeFrameId).toBe("f2");
  });

  it("keeps null pointer when the snapshot is frame-less", () => {
    const context = toVoiceInteractionContext(snapshotAt(1, 1, null, null), {
      documentId: null,
      documentRevision: null,
      activeFrameId: null,
      selectedElementIds: [],
    });

    expect(context.pointer).toBeNull();
  });
});