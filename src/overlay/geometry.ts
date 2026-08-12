import type { Point, Rect } from "../canvas/types";

export const RESIZE_HANDLES = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const;

export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export interface SnapGuide {
  axis: "x" | "y";
  value: number;
  distance: number;
}

export interface SnapResult {
  delta: Point;
  guides: SnapGuide[];
}

const EPSILON = 0.0001;

function rectEdges(rect: Rect) {
  return {
    left: rect.x,
    centerX: rect.x + rect.width / 2,
    right: rect.x + rect.width,
    top: rect.y,
    centerY: rect.y + rect.height / 2,
    bottom: rect.y + rect.height,
  };
}

export function normalizeRect(rect: Rect, minimumSize = 0): Rect {
  const width = Math.max(minimumSize, Math.abs(rect.width));
  const height = Math.max(minimumSize, Math.abs(rect.height));
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width,
    height,
  };
}

export function translateRect(rect: Rect, delta: Point): Rect {
  return { ...rect, x: rect.x + delta.x, y: rect.y + delta.y };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function resizeRect(
  initial: Rect,
  handle: ResizeHandle,
  delta: Point,
  minimumSize = 24,
): Rect {
  const left = initial.x;
  const right = initial.x + initial.width;
  const top = initial.y;
  const bottom = initial.y + initial.height;
  let nextLeft = left;
  let nextRight = right;
  let nextTop = top;
  let nextBottom = bottom;

  if (handle.includes("w")) nextLeft = Math.min(left + delta.x, right - minimumSize);
  if (handle.includes("e")) nextRight = Math.max(right + delta.x, left + minimumSize);
  if (handle.includes("n")) nextTop = Math.min(top + delta.y, bottom - minimumSize);
  if (handle.includes("s")) nextBottom = Math.max(bottom + delta.y, top + minimumSize);

  return normalizeRect({
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  }, minimumSize);
}

function nearestGuide(
  values: readonly number[],
  candidates: readonly number[],
  threshold: number,
): SnapGuide | null {
  let nearest: SnapGuide | null = null;
  for (const value of values) {
    for (const candidate of candidates) {
      const distance = candidate - value;
      if (Math.abs(distance) > threshold) continue;
      if (!nearest || Math.abs(distance) < Math.abs(nearest.distance)) {
        nearest = { axis: "x", value: candidate, distance };
      }
    }
  }
  return nearest;
}

function keepsDragDirection(delta: number, guide: SnapGuide | null): boolean {
  if (!guide || Math.abs(delta) < EPSILON) return true;
  return Math.sign(delta) === Math.sign(delta + guide.distance);
}

/** Snaps a moving rect's edges/center to nearby rect edges/centers. */
export function snapTranslation(
  rect: Rect,
  delta: Point,
  targets: readonly Rect[],
  threshold = 8,
): SnapResult {
  const proposed = translateRect(rect, delta);
  const proposedEdges = rectEdges(proposed);
  const xCandidates = targets.flatMap((target) => {
    const edges = rectEdges(target);
    return [edges.left, edges.centerX, edges.right];
  });
  const yCandidates = targets.flatMap((target) => {
    const edges = rectEdges(target);
    return [edges.top, edges.centerY, edges.bottom];
  });
  const xGuide = nearestGuide(
    [proposedEdges.left, proposedEdges.centerX, proposedEdges.right],
    xCandidates,
    threshold,
  );
  const yGuide = nearestGuide(
    [proposedEdges.top, proposedEdges.centerY, proposedEdges.bottom],
    yCandidates,
    threshold,
  );

  const usableXGuide = keepsDragDirection(delta.x, xGuide) ? xGuide : null;
  const usableYGuide = keepsDragDirection(delta.y, yGuide) ? yGuide : null;
  if (usableXGuide) usableXGuide.axis = "x";
  if (usableYGuide) usableYGuide.axis = "y";
  const guides = [usableXGuide, usableYGuide].filter((guide): guide is SnapGuide => guide !== null);
  return {
    delta: {
      x: delta.x + (usableXGuide?.distance ?? 0),
      y: delta.y + (usableYGuide?.distance ?? 0),
    },
    guides,
  };
}

export function rotationAngle(center: Point, start: Point, current: Point): number {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const currentAngle = Math.atan2(current.y - center.y, current.x - center.x);
  let degrees = ((currentAngle - startAngle) * 180) / Math.PI;
  while (degrees > 180) degrees -= 360;
  while (degrees < -180) degrees += 360;
  return Math.round((degrees + EPSILON) * 10) / 10;
}
