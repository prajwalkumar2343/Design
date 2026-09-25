import type { Point, Rect } from "../canvas/types";
import { isDataBridgeElementId } from "../bridge/protocol";
import { moveFrameCommand, type EditorCommand } from "../editor/commands";
import type { FrameEntity } from "../editor/model";
import { FREEFORM_FRAME_PAD } from "../frame/freeform";
import type { OverlayStyleChange } from "./commands";
import { unionRects } from "./geometry";



export const FREEFORM_FIT_EPSILON = 0.05;

/** Frame-document tags that describe the viewport itself, not content. */
const STRUCTURAL_TAGS = new Set(["html", "head", "body"]);

export function isFreeformContentTag(tagName: string): boolean {
  return !STRUCTURAL_TAGS.has(tagName.toLowerCase());
}

/**
 * Only created roots count as fit content. Inner geometry (the rect/polygon
 * inside a created svg, defs, markers) rides inside its root's bounds —
 * including it double-counts space and, worse, pins the fit union at stale
 * positions while a gesture moves the root. Created roots are the nodes with
 * `data:` element ids (frame-scoped or not).
 */
export function isFreeformContentNode(target: { tagName: string; elementId: string }): boolean {
  return isFreeformContentTag(target.tagName) && isDataBridgeElementId(target.elementId);
}

/**
 * The doc-space footprint a change occupies for freeform fitting. Canonical
 * changes carry the unrotated element rect in `nextBounds` — rotate it by
 * the change's total rotation to get the occupied AABB. Non-canonical
 * changes carry a measured AABB that is already post-transform and passes
 * through verbatim.
 */
export function changeFootprint(change: OverlayStyleChange): Rect {
  return change.canonical
    ? rotatedBoundsAabb(change.nextBounds, change.rotation)
    : change.nextBounds;
}

/** Axis-aligned bounds of a rect rotated about its own center. */
export function rotatedBoundsAabb(bounds: Rect, rotationDeg: number): Rect {
  if (Math.abs(rotationDeg) < 0.01) return bounds;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = bounds.width * cos + bounds.height * sin;
  const height = bounds.width * sin + bounds.height * cos;
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface FreeformFit {
  rect: Rect;
  /** How far the frame origin moves — the delta content must counter-shift by. */
  originDelta: Point;
}

/**
 * The frame rect that keeps every content rect visible, or `null` when the
 * current rect already fits (or the frame has no measurable content).
 */
export function computeFreeformFit(
  frame: Pick<FrameEntity, "x" | "y" | "width" | "height">,
  contentBounds: readonly Rect[],
  pad: number = FREEFORM_FRAME_PAD,
): FreeformFit | null {
  const union = unionRects(
    contentBounds.filter((bounds) => bounds.width > 0 && bounds.height > 0),
  );
  if (!union) return null;
  const rect: Rect = {
    x: round(union.x - pad),
    y: round(union.y - pad),
    width: Math.max(1, round(union.width + pad * 2)),
    height: Math.max(1, round(union.height + pad * 2)),
  };
  const originDelta = { x: rect.x - frame.x, y: rect.y - frame.y };
  if (
    Math.abs(originDelta.x) < FREEFORM_FIT_EPSILON &&
    Math.abs(originDelta.y) < FREEFORM_FIT_EPSILON &&
    Math.abs(rect.width - frame.width) < FREEFORM_FIT_EPSILON &&
    Math.abs(rect.height - frame.height) < FREEFORM_FIT_EPSILON
  ) {
    return null;
  }
  return { rect, originDelta };
}

export function freeformFrameCommands(
  frame: Pick<FrameEntity, "id" | "x" | "y" | "width" | "height">,
  rect: Rect,
): EditorCommand[] {
  const commands: EditorCommand[] = [];
  if (rect.x !== frame.x || rect.y !== frame.y) {
    commands.push(
      moveFrameCommand({ frameId: frame.id, position: { x: rect.x, y: rect.y } }),
    );
  }
  if (rect.width !== frame.width || rect.height !== frame.height) {
    commands.push({
      type: "frame/update",
      frameId: frame.id,
      patch: { width: rect.width, height: rect.height },
    });
  }
  return commands;
}

/**
 * The <body> translate that re-anchors content after the frame origin moved
 * by `shift` — i.e. `translate(-shift)`. `null` clears the transform.
 */
export function freeformBodyShiftValue(shift: Point): string | null {
  if (Math.abs(shift.x) < 0.01 && Math.abs(shift.y) < 0.01) return null;
  return `translate(${round(shift.x)}px, ${round(shift.y)}px)`;
}

/** Inverse of {@link freeformBodyShiftValue} — reads the shift back out. */
export function freeformBodyShiftFromValue(value: string | null | undefined): Point {
  if (!value) return { x: 0, y: 0 };
  const match = value.match(
    /translate\(\s*(-?[\d.]+)px(?:\s*[, ]\s*(-?[\d.]+)px)?\s*\)/,
  );
  if (!match) return { x: 0, y: 0 };
  return { x: -Number(match[1]), y: -(Number(match[2] ?? 0)) };
}
