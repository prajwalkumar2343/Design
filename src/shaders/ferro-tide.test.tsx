import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FERRO_TIDE_MOODS, FerroTide, frameDeltaSeconds } from "./ferro-tide";

describe("FerroTide", () => {
  it("ships five named currents starting with Abyss", () => {
    expect(FERRO_TIDE_MOODS.map((mood) => mood.name)).toEqual([
      "Abyss",
      "Magma",
      "Ultraviolet",
      "Kelp",
      "Porcelain",
    ]);
    for (const mood of FERRO_TIDE_MOODS) {
      expect(mood.stops).toHaveLength(4);
      expect(mood.tint).toHaveLength(3);
    }
  });

  it("falls back gracefully when WebGL is unavailable", () => {
    // jsdom canvases have no GL context, so the component must degrade
    // to a labelled placeholder instead of throwing during mount.
    render(<FerroTide width="320px" height="200px" />);
    expect(screen.getByTestId("ferro-tide-fallback")).toBeDefined();
  });

  it("never advances the simulation by a negative delta", () => {
    expect(frameDeltaSeconds(1016, 1000)).toBeCloseTo(0.016, 5);
    expect(frameDeltaSeconds(1100, 1000)).toBeCloseTo(0.05, 5);
    expect(frameDeltaSeconds(900, 1000)).toBeCloseTo(0.016, 5);
    expect(frameDeltaSeconds(1000, 1000)).toBeCloseTo(0.016, 5);
  });
});
