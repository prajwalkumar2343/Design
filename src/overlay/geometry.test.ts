import { describe, expect, it } from "vitest";

import {
  resizeRect,
  rotationAngle,
  snapTranslation,
  unionRects,
} from "./geometry";

describe("overlay geometry", () => {
  it("resizes from each edge while respecting a minimum size", () => {
    expect(resizeRect({ x: 10, y: 20, width: 100, height: 80 }, "nw", { x: 200, y: 200 }, 24)).toEqual({
      x: 86,
      y: 76,
      width: 24,
      height: 24,
    });
    expect(resizeRect({ x: 10, y: 20, width: 100, height: 80 }, "se", { x: 20, y: 10 }, 24)).toEqual({
      x: 10,
      y: 20,
      width: 120,
      height: 90,
    });
  });

  it("unions multiple selected targets", () => {
    expect(unionRects([
      { x: 10, y: 20, width: 40, height: 30 },
      { x: 80, y: 10, width: 20, height: 50 },
    ])).toEqual({ x: 10, y: 10, width: 90, height: 50 });
  });

  it("snaps translated edges to nearby alignment candidates", () => {
    expect(snapTranslation(
      { x: 10, y: 20, width: 40, height: 30 },
      { x: 46, y: 0 },
      [{ x: 100, y: 100, width: 40, height: 40 }],
      8,
    )).toEqual({
      delta: { x: 50, y: 0 },
      guides: [{ axis: "x", value: 100, distance: 4 }],
    });
  });

  it("does not snap a drag backward when a nearby guide is behind the pointer", () => {
    const result = snapTranslation(
      { x: 100, y: 20, width: 40, height: 30 },
      { x: 4, y: 0 },
      [{ x: 58, y: 100, width: 40, height: 40 }],
      8,
    );

    expect(result.delta.x).toBe(4);
    expect(result.guides).toEqual([]);
  });

  it("returns a normalized rotation delta", () => {
    expect(rotationAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBe(90);
    expect(rotationAngle({ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 })).toBe(-90);
  });
});
