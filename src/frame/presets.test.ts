import { describe, expect, it } from "vitest";
import { createFrameFromPreset, FRAME_PRESETS } from "./presets";

describe("createFrameFromPreset", () => {
  it("centers the requested viewport at the world position", () => {
    const preset = FRAME_PRESETS.find((candidate) => candidate.id === "mobile")!;
    const frame = createFrameFromPreset({
      preset,
      position: { x: 1000, y: 800 },
      sequence: 5,
    });

    expect(frame).toMatchObject({
      id: "mobile-5",
      name: "Mobile · 390 × 844",
      x: 805,
      y: 378,
      width: 390,
      height: 844,
    });
    expect(frame.srcDoc).toContain("<!doctype html>");
  });
});
