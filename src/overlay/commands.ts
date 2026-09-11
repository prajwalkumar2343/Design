import type { BridgeCommand, SafeInlineStyleProperty } from "../bridge/protocol";
import type { Point, Rect } from "../canvas/types";
import { resizeRect, unionRects, type ResizeHandle } from "./geometry";
import type { OverlayNodeTarget } from "./NodeOverlayLayer";

export interface OverlayStyleSnapshot {
  target: OverlayNodeTarget;
  inlineStyle: Partial<Record<SafeInlineStyleProperty, string>>;
  computedStyle: Record<string, string>;
}

export interface OverlayStyleChange {
  target: OverlayNodeTarget;
  nextBounds: Rect;
  rotation: number;
  previous: Partial<Record<SafeInlineStyleProperty, string | null>>;
  next: Partial<Record<SafeInlineStyleProperty, string | null>>;
}

export interface ParsedTransform {
  tx: number;
  ty: number;
  rotation: number;
}

const TRANSFORM_FRAGMENT =
  /(-?\d+(?:\.\d+)?)/g;

function parseTranslate(value: string): { tx: number; ty: number } | null {
  const match = value.match(/translate\(\s*([-\d.]+)(?:px)?(?:\s*[, ]\s*([-\d.]+)(?:px)?)?\s*\)/);
  if (!match) return null;
  return { tx: Number(match[1]), ty: match[2] !== undefined ? Number(match[2]) : 0 };
}

function parseRotations(value: string): number {
  let total = 0;
  for (const match of value.matchAll(/rotate\(\s*(-?\d+(?:\.\d+)?)deg\s*\)/g)) {
    total += Number(match[1]);
  }
  return total;
}

/**
 * Extracts the canonical translate/rotate form of a CSS transform. Returns
 * `null` when the value cannot be understood, so callers can fall back to
 * appending deltas instead of corrupting an unknown transform.
 */
export function parseTransform(
  value: string | null | undefined,
): ParsedTransform | null {
  if (!value || value === "none") return { tx: 0, ty: 0, rotation: 0 };
  const translate = parseTranslate(value);
  const rotation = parseRotations(value);
  if (!translate && rotation === 0 && !/rotate\s*\(/i.test(value)) return null;
  return {
    tx: translate?.tx ?? 0,
    ty: translate?.ty ?? 0,
    rotation,
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Composes the canonical `translate(...) rotate(...)` chain so the element's
 * total translation is applied in world axes (before the rotation spins the
 * element about its own center), keeping the overlay and the live element in
 * exact agreement. Unknown transforms fall back to appending deltas.
 */
function composeTransform(
  original: string | null,
  translation: Point,
  rotation: number,
): string | null {
  const parsed = parseTransform(original);
  if (parsed) {
    const tx = parsed.tx + translation.x;
    const ty = parsed.ty + translation.y;
    const totalRotation = parsed.rotation + rotation;
    if (Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 && Math.abs(totalRotation) < 0.01) {
      return original;
    }
    const parts: string[] = [];
    if (Math.abs(tx) > 0.01 || Math.abs(ty) > 0.01) {
      parts.push(`translate(${round(tx)}px, ${round(ty)}px)`);
    }
    if (Math.abs(totalRotation) > 0.01) {
      parts.push(`rotate(${round(totalRotation)}deg)`);
    }
    return parts.join(" ");
  }
  const additions: string[] = [];
  if (Math.abs(translation.x) > 0.01 || Math.abs(translation.y) > 0.01) {
    additions.push(`translate(${round(translation.x)}px, ${round(translation.y)}px)`);
  }
  if (Math.abs(rotation) > 0.01) {
    additions.push(`rotate(${round(rotation)}deg)`);
  }
  if (additions.length === 0) return original;
  return [original, ...additions].filter((value) => Boolean(value)).join(" ");
}

function styleValue(
  snapshot: OverlayStyleSnapshot,
  property: SafeInlineStyleProperty,
): string | null {
  return snapshot.inlineStyle[property] ?? null;
}

const INLINE_TEXT_TAGS = new Set([
  "a",
  "b",
  "code",
  "em",
  "i",
  "label",
  "mark",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
]);

function resizeStylePreparation(
  snapshot: OverlayStyleSnapshot,
): Partial<Record<SafeInlineStyleProperty, string>> {
  const tagName = snapshot.target.tagName.toLowerCase();
  if (tagName === "img") {
    return {
      "aspect-ratio": "auto",
      "box-sizing": "border-box",
      "max-height": "none",
      "max-width": "none",
      "min-height": "0",
      "min-width": "0",
    };
  }
  if (
    snapshot.computedStyle.display === "inline" ||
    INLINE_TEXT_TAGS.has(tagName)
  ) {
    return {
      display: "inline-block",
      "box-sizing": "border-box",
      "white-space": "normal",
    };
  }
  return {};
}

function isHorizontalHandle(handle: ResizeHandle): boolean {
  return handle.includes("e") || handle.includes("w");
}

function isVerticalHandle(handle: ResizeHandle): boolean {
  return handle.includes("n") || handle.includes("s");
}

function createChange(
  snapshot: OverlayStyleSnapshot,
  nextBounds: Rect,
  rotation: number,
  resize?: { handle: ResizeHandle },
): OverlayStyleChange {
  const previousTransform = styleValue(snapshot, "transform");
  const translation = {
    x: nextBounds.x - snapshot.target.bounds.x,
    y: nextBounds.y - snapshot.target.bounds.y,
  };
  const parsed = parseTransform(previousTransform);
  const totalRotation = parsed ? parsed.rotation + rotation : rotation;
  const nextTransform = composeTransform(previousTransform, translation, rotation);
  const previous: Partial<Record<SafeInlineStyleProperty, string | null>> = {};
  const next: Partial<Record<SafeInlineStyleProperty, string | null>> = {};
  const setStyle = (
    property: SafeInlineStyleProperty,
    value: string | null,
    force = false,
  ) => {
    const previousValue = styleValue(snapshot, property);
    if (!force && previousValue === value) return;
    previous[property] = previousValue;
    next[property] = value;
  };

  setStyle("transform", nextTransform);
  // Outline scales with the shape (Apple-like). Border/stroke should grow as the shape grows.
  const prevBorderWidth = styleValue(snapshot, "border-width");
  const hasBorder = prevBorderWidth !== null && prevBorderWidth !== "" && prevBorderWidth !== "0px" && prevBorderWidth !== "0";
  let borderScale: number | null = null;
  if (hasBorder) {
    const wScale = snapshot.target.bounds.width > 0 ? nextBounds.width / snapshot.target.bounds.width : 1;
    const hScale = snapshot.target.bounds.height > 0 ? nextBounds.height / snapshot.target.bounds.height : 1;
    if (resize) {
      if (isHorizontalHandle(resize.handle) && !isVerticalHandle(resize.handle)) borderScale = wScale;
      else if (isVerticalHandle(resize.handle) && !isHorizontalHandle(resize.handle)) borderScale = hScale;
      else borderScale = (wScale + hScale) / 2;
    } else {
      borderScale = (wScale + hScale) / 2;
    }
    // Clamp to avoid vanishing or exploding borders
    borderScale = Math.max(0.2, Math.min(8, borderScale));
  }
  if (resize) {
    const preparation = resizeStylePreparation(snapshot);
    for (const [property, value] of Object.entries(preparation) as [SafeInlineStyleProperty, string][]) {
      setStyle(property, value, true);
    }
    const isImage = snapshot.target.tagName.toLowerCase() === "img";
    if (isImage || isHorizontalHandle(resize.handle)) {
      setStyle("width", `${Math.max(1, nextBounds.width)}px`, true);
    }
    if (isImage || isVerticalHandle(resize.handle)) {
      setStyle("height", `${Math.max(1, nextBounds.height)}px`, true);
    }
    if (hasBorder && borderScale !== null) {
      const num = parseFloat(prevBorderWidth!);
      if (!Number.isNaN(num)) {
        const nextBorder = Math.max(0.5, Math.round(num * borderScale * 10) / 10);
        setStyle("border-width", `${nextBorder}px`, true);
      }
    }
  } else {
    if (Math.abs(nextBounds.width - snapshot.target.bounds.width) > 0.01) {
      setStyle("width", `${Math.max(1, nextBounds.width)}px`);
    }
    if (Math.abs(nextBounds.height - snapshot.target.bounds.height) > 0.01) {
      setStyle("height", `${Math.max(1, nextBounds.height)}px`);
    }
    if (hasBorder && borderScale !== null && Math.abs(borderScale - 1) > 0.01) {
      const num = parseFloat(prevBorderWidth!);
      if (!Number.isNaN(num)) {
        const nextBorder = Math.max(0.5, Math.round(num * borderScale * 10) / 10);
        setStyle("border-width", `${nextBorder}px`);
      }
    }
  }

  return {
    target: snapshot.target,
    nextBounds,
    rotation: totalRotation,
    previous,
    next,
  };
}

function rotateVector(point: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function snapshotTransform(snapshot: OverlayStyleSnapshot): string | null {
  return snapshot.inlineStyle.transform ?? snapshot.computedStyle.transform ?? null;
}

export function buildMoveChanges(
  snapshots: readonly OverlayStyleSnapshot[],
  delta: Point,
): OverlayStyleChange[] {
  return snapshots.map((snapshot) =>
    createChange(snapshot, {
      ...snapshot.target.bounds,
      x: snapshot.target.bounds.x + delta.x,
      y: snapshot.target.bounds.y + delta.y,
    }, 0),
  );
}

export function buildResizeChanges(
  snapshots: readonly OverlayStyleSnapshot[],
  groupBounds: Rect,
  handle: ResizeHandle,
  delta: Point,
  minimumSize = 24,
): OverlayStyleChange[] {
  if (snapshots.length === 1) {
    const snapshot = snapshots[0];
    const parsed = parseTransform(snapshotTransform(snapshot));
    if (parsed && Math.abs(parsed.rotation) > 0.01) {
      const radians = (parsed.rotation * Math.PI) / 180;
      const localDelta = rotateVector(delta, -radians);
      const nextBounds = resizeRect(snapshot.target.bounds, handle, localDelta, minimumSize);
      return [createChange(snapshot, nextBounds, 0, { handle })];
    }
  }
  const nextGroup = resizeRect(groupBounds, handle, delta, minimumSize);
  const scaleX = groupBounds.width > 0 ? nextGroup.width / groupBounds.width : 1;
  const scaleY = groupBounds.height > 0 ? nextGroup.height / groupBounds.height : 1;
  return snapshots.map((snapshot) => {
    const bounds = snapshot.target.bounds;
    return createChange(snapshot, {
      x: nextGroup.x + (bounds.x - groupBounds.x) * scaleX,
      y: nextGroup.y + (bounds.y - groupBounds.y) * scaleY,
      width: Math.max(minimumSize, bounds.width * scaleX),
      height: Math.max(minimumSize, bounds.height * scaleY),
    }, 0, { handle });
  });
}

export function buildRotationChanges(
  snapshots: readonly OverlayStyleSnapshot[],
  rotation: number,
): OverlayStyleChange[] {
  if (snapshots.length <= 1) {
    return snapshots.map((snapshot) => createChange(snapshot, snapshot.target.bounds, rotation));
  }
  const group = unionRects(snapshots.map((snapshot) => snapshot.target.bounds));
  if (!group) return [];
  const centerX = group.x + group.width / 2;
  const centerY = group.y + group.height / 2;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return snapshots.map((snapshot) => {
    const bounds = snapshot.target.bounds;
    const offsetX = bounds.x + bounds.width / 2 - centerX;
    const offsetY = bounds.y + bounds.height / 2 - centerY;
    const nextCenterX = centerX + offsetX * cos - offsetY * sin;
    const nextCenterY = centerY + offsetX * sin + offsetY * cos;
    return createChange(snapshot, {
      x: nextCenterX - bounds.width / 2,
      y: nextCenterY - bounds.height / 2,
      width: bounds.width,
      height: bounds.height,
    }, rotation);
  });
}

export function toInlineStyleCommands(
  changes: readonly OverlayStyleChange[],
  direction: "previous" | "next",
): Extract<BridgeCommand, { command: "set-inline-style" }>[] {
  const commands: Extract<BridgeCommand, { command: "set-inline-style" }>[] = [];
  const properties = [
    "display",
    "box-sizing",
    "white-space",
    "aspect-ratio",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "width",
    "height",
    "border-width",
    "transform",
  ] as const;
  for (const change of changes) {
    const values = direction === "previous" ? change.previous : change.next;
    for (const property of properties) {
      const value = values[property];
      if (value === undefined) continue;
      commands.push({
        command: "set-inline-style",
        targetId: change.target.nodeId,
        property,
        value,
      });
    }
  }
  return commands;
}
