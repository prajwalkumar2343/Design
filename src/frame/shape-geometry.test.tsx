import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { normalizedBounds, ShapePreview, shapeDragPoints, shapePoints } from "./shape-geometry";

describe("shape geometry", () => {
  it("normalizes drag bounds in both directions and enforces a minimum size", () => {
    expect(normalizedBounds({ x: 20, y: 30 }, { x: 5, y: 60 })).toEqual({
      x: 5,
      y: 30,
      width: 16,
      height: 30,
    });
    expect(normalizedBounds({ x: 10, y: 10 }, { x: 14, y: 12 })).toEqual({
      x: 10,
      y: 10,
      width: 16,
      height: 16,
    });
  });

  it("builds crisp rectangle and line primitives from the drag bounds", () => {
    const bounds = { x: 20, y: 30, width: 80, height: 40 };
    expect(shapePoints("rectangle", bounds)).toEqual([
      { x: 20, y: 30 },
      { x: 100, y: 30 },
      { x: 100, y: 70 },
      { x: 20, y: 70 },
    ]);
    expect(shapePoints("line", bounds)).toEqual([
      { x: 20, y: 30 },
      { x: 100, y: 70 },
    ]);
    expect(shapePoints("arrow", bounds)).toEqual(shapePoints("line", bounds));
  });

  it("builds a five-sided polygon that stays inside the drag bounds", () => {
    const points = shapePoints("polygon", { x: 10, y: 10, width: 100, height: 60 });
    expect(points).toHaveLength(5);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(10);
      expect(point.x).toBeLessThanOrEqual(110);
      expect(point.y).toBeGreaterThanOrEqual(10);
      expect(point.y).toBeLessThanOrEqual(70);
    }
  });

  it("builds a ten-point star with alternating outer and inner radii", () => {
    const bounds = { x: 50, y: 40, width: 120, height: 120 };
    const points = shapePoints("star", bounds);
    expect(points).toHaveLength(10);
    const outer = points.filter((_, index) => index % 2 === 0);
    const inner = points.filter((_, index) => index % 2 === 1);
    const distance = (point: { x: number; y: number }) => Math.hypot(point.x - 110, point.y - 100);
    for (const point of outer) expect(distance(point)).toBeCloseTo(60, 4);
    for (const point of inner) expect(distance(point)).toBeCloseTo(60 * 0.382, 4);
  });

  it("preserves the exact drag direction for lines and arrows", () => {
    const start = { x: 300, y: 60 };
    const end = { x: 40, y: 220 };
    expect(shapeDragPoints("line", start, end)).toEqual([start, end]);
    expect(shapeDragPoints("arrow", start, end)).toEqual([start, end]);
  });

  it("normalizes boxed shapes from any drag direction", () => {
    const start = { x: 300, y: 60 };
    const end = { x: 40, y: 220 };
    const points = shapeDragPoints("rectangle", start, end);
    expect(points).toContainEqual({ x: 40, y: 60 });
    expect(points).toContainEqual({ x: 300, y: 220 });
  });
});

describe("ShapePreview", () => {
  it("renders a vector preview for the active shape with crisp rendering hints", () => {
    render(<ShapePreview shape="rectangle" start={{ x: 20, y: 30 }} end={{ x: 120, y: 90 }} />);
    const preview = screen.getByTestId("shape-preview");
    expect(preview.getAttribute("shape-rendering")).toBe("geometricPrecision");
    const rect = preview.querySelector("rect");
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute("stroke")).toBeNull();
    expect(rect?.getAttribute("fill")).toBe("#d9d9d9");
  });

  it("renders a stroke-only preview for lines and arrows with an arrowhead marker", () => {
    const { rerender } = render(<ShapePreview shape="line" start={{ x: 0, y: 0 }} end={{ x: 80, y: 40 }} />);
    const line = screen.getByTestId("shape-preview").querySelector("line");
    expect(line).not.toBeNull();
    expect(line?.getAttribute("stroke-linecap")).toBe("round");

    rerender(<ShapePreview shape="arrow" start={{ x: 0, y: 0 }} end={{ x: 80, y: 40 }} />);
    const arrow = screen.getByTestId("shape-preview").querySelector("line");
    expect(arrow).not.toBeNull();
    expect(arrow?.getAttribute("marker-end")).toMatch(/^url\(#shape-preview-arrow-/);
  });

  it("renders polygon and star previews filled with no outline", () => {
    const { rerender } = render(<ShapePreview shape="polygon" start={{ x: 0, y: 0 }} end={{ x: 100, y: 80 }} />);
    const polygon = screen.getByTestId("shape-preview").querySelector("polygon");
    expect(polygon).not.toBeNull();
    expect(polygon?.getAttribute("stroke")).toBeNull();
    expect(polygon?.getAttribute("fill")).toBe("#d9d9d9");

    rerender(<ShapePreview shape="star" start={{ x: 0, y: 0 }} end={{ x: 100, y: 80 }} />);
    expect(screen.getByTestId("shape-preview").querySelector("polygon")).not.toBeNull();
  });
});
