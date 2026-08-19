import { describe, expect, it } from "vitest";

import {
  classifyGestureActivity,
  classifyPointerActivity,
  FIXING_EDIT_COMMANDS,
  isFixingEditCommand,
} from "./activity";

describe("classifyPointerActivity", () => {
  it("labels buttonless movement as pointing", () => {
    for (const behavior of ["select-move", "pan", "frame-menu", "creation"] as const) {
      expect(classifyPointerActivity(behavior)).toBe("pointing");
      expect(classifyPointerActivity(behavior, { buttons: 0 })).toBe("pointing");
    }
  });

  it("labels pressed creation and frame tools as drawing", () => {
    expect(classifyPointerActivity("creation", { buttons: 1 })).toBe("drawing");
    expect(classifyPointerActivity("frame-menu", { buttons: 1 })).toBe("drawing");
  });

  it("labels a pressed selection drag as fixing", () => {
    expect(classifyPointerActivity("select-move", { buttons: 1 })).toBe("fixing");
  });

  it("keeps panning as pointing even while pressed", () => {
    expect(classifyPointerActivity("pan", { buttons: 1 })).toBe("pointing");
  });
});

describe("classifyGestureActivity", () => {
  it("classifies element gestures as fixing", () => {
    for (const kind of ["move", "resize", "rotate"] as const) {
      expect(classifyGestureActivity(kind)).toBe("fixing");
    }
  });
});

describe("isFixingEditCommand", () => {
  it("recognizes editing bridge commands", () => {
    for (const command of FIXING_EDIT_COMMANDS) {
      expect(isFixingEditCommand(command)).toBe(true);
    }
  });

  it("rejects creation, selection, and unknown commands", () => {
    expect(isFixingEditCommand("create-element")).toBe(false);
    expect(isFixingEditCommand("pick-element")).toBe(false);
    expect(isFixingEditCommand("nonsense")).toBe(false);
  });
});