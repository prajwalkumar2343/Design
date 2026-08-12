import type { BridgeCommand, SafeInlineStyleProperty } from "../bridge/protocol";
import type { Point, Rect } from "../canvas/types";
import { resizeRect, type ResizeHandle } from "./geometry";
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

function transformValue(
  original: string | null,
  translation: Point,
  rotation: number,
): string | null {
  const additions: string[] = [];
  if (Math.abs(translation.x) > 0.01 || Math.abs(translation.y) > 0.01) {
    additions.push(`translate(${translation.x}px, ${translation.y}px)`);
  }
  if (Math.abs(rotation) > 0.01) additions.push(`rotate(${rotation}deg)`);
  if (additions.length === 0) return original;
  return [original, ...additions].filter((value) => value && value !== "none").join(" ");
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
  const nextTransform = transformValue(previousTransform, translation, rotation);
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
  } else {
    if (Math.abs(nextBounds.width - snapshot.target.bounds.width) > 0.01) {
      setStyle("width", `${Math.max(1, nextBounds.width)}px`);
    }
    if (Math.abs(nextBounds.height - snapshot.target.bounds.height) > 0.01) {
      setStyle("height", `${Math.max(1, nextBounds.height)}px`);
    }
  }

  return {
    target: snapshot.target,
    nextBounds,
    rotation,
    previous,
    next,
  };
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
  return snapshots.map((snapshot) => createChange(snapshot, snapshot.target.bounds, rotation));
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
