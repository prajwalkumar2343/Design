import { describe, expect, it } from "vitest";
import { mapIframePointToCanvas, mapIframeRectToCanvas } from "./coordinates";

const context = {
  iframeRect: { x: 300, y: 240, width: 400, height: 300 },
  surfaceRect: { x: 100, y: 40, width: 1200, height: 800 },
  camera: { x: 50, y: 70, zoom: 2 },
};

describe("iframe coordinate mapping", () => {
  it("maps child viewport points through parent iframe bounds and canvas zoom", () => {
    expect(mapIframePointToCanvas({ x: 20, y: 30 }, context)).toEqual({
      screen: { x: 220, y: 230 },
      world: { x: 160, y: 185 },
    });
  });

  it("maps inspected child bounds into world-space rectangles", () => {
    expect(mapIframeRectToCanvas({ x: 20, y: 30, width: 100, height: 40 }, context)).toEqual({
      x: 160,
      y: 185,
      width: 50,
      height: 20,
    });
  });
});

