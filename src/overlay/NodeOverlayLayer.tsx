import { memo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Rect } from "../canvas/types";
import {
  RESIZE_HANDLES,
  type ResizeHandle,
  unionRects,
} from "./geometry";

export interface OverlayNodeTarget {
  frameId: string;
  nodeId: string;
  tagName: string;
  name: string;
  bounds: Rect;
  locked?: boolean;
  rotation?: number;
  /**
   * The element's unrotated rect for a rotated target (`bounds` is always the
   * measured post-transform AABB). Painted with `rotation` so the chrome hugs
   * the real box instead of rotating the AABB a second time.
   */
  canonicalBounds?: Rect;
}

export type NodeGestureKind = "move" | "resize" | "rotate";

export interface NodeGestureStart {
  kind: NodeGestureKind;
  handle?: ResizeHandle;
  targetIds: string[];
  targets: OverlayNodeTarget[];
  pointerId: number;
  client: { x: number; y: number };
}

interface NodeOverlayLayerProps {
  zoom: number;
  hoveredTarget: OverlayNodeTarget | null;
  selectedTargets: OverlayNodeTarget[];
  interactive?: boolean;
  guides?: { axis: "x" | "y"; value: number }[];
  onGestureStart: (gesture: NodeGestureStart, event: ReactPointerEvent<HTMLElement>) => void;
  onGestureMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onGestureEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  onTextEditStart?: (target: OverlayNodeTarget) => void;
}

function worldBox(rect: Rect): CSSProperties {
  return {
    left: rect.x,
    top: rect.y,
    width: Math.max(0, rect.width),
    height: Math.max(0, rect.height),
  };
}

function targetBox(target: OverlayNodeTarget): CSSProperties {
  // A rotated element's `bounds` is its post-transform AABB — painting it
  // with rotate() spins the AABB a second time. When the canonical rect is
  // known, rotate that; otherwise show the plain AABB (still truthful, just
  // looser).
  const rect = target.rotation ? (target.canonicalBounds ?? target.bounds) : target.bounds;
  return {
    ...worldBox(rect),
    ...(target.rotation && target.canonicalBounds
      ? {
          transform: `rotate(${target.rotation}deg)`,
          transformOrigin: "center",
        }
      : {}),
  };
}

function targetKey(target: OverlayNodeTarget): string {
  return `${target.frameId}:${target.nodeId}`;
}

function gestureClient(event: ReactPointerEvent<HTMLElement>) {
  return { x: event.clientX, y: event.clientY };
}

export const NodeOverlayLayer = memo(function NodeOverlayLayer({
  zoom,
  hoveredTarget,
  selectedTargets,
  interactive = true,
  guides = [],
  onGestureStart,
  onGestureMove,
  onGestureEnd,
  onTextEditStart,
}: NodeOverlayLayerProps) {
  const selectedKeys = new Set(selectedTargets.map(targetKey));
  const groupBounds = unionRects(selectedTargets.map((target) => target.bounds));
  const movableTargets = selectedTargets.filter((target) => !target.locked);
  const targetIds = movableTargets.map(targetKey);
  const zoomSafe = Math.max(zoom, 0.08);
  const handleSize = 14 / zoomSafe;
  const handleVisual = 6 / zoomSafe;
  const handleBorder = Math.max(0.75, 1 / zoomSafe);
  const rotationSize = 16 / zoomSafe;
  const rotationVisual = 8 / zoomSafe;
  // Handles keep a comfortable screen-space hit area, but never claim the
  // whole selection body — nor each other's territory. Capping each axis at
  // half the group leaves the middle to the move gesture and prevents corner
  // handles from painting over edge handles on cramped selections.
  const handleHitWidth = Math.min(handleSize, Math.max(2 / zoomSafe, ((groupBounds?.width ?? 0) * 0.98) / 2));
  const handleHitHeight = Math.min(handleSize, Math.max(2 / zoomSafe, ((groupBounds?.height ?? 0) * 0.98) / 2));

  const beginGesture = (
    event: ReactPointerEvent<HTMLElement>,
    gesture: Omit<NodeGestureStart, "pointerId" | "client" | "targetIds" | "targets">,
  ) => {
    if (event.button !== 0 || event.detail > 1 || targetIds.length === 0) return;
    event.stopPropagation();
    onGestureStart(
      {
        ...gesture,
        targets: movableTargets,
        targetIds,
        pointerId: event.pointerId,
        client: gestureClient(event),
      },
      event,
    );
  };

  /**
   * Resize handles keep a minimum screen-space hit area, so on very small
   * selections they overlap the box interior. A press far from every edge
   * belongs to the move gesture, and on cramped selections (where handles
   * tile the whole body) the middle of the box does too — only presses near
   * the edges/corners mean resize.
   */
  const beginHandleGesture = (
    event: ReactPointerEvent<HTMLElement>,
    handle: ResizeHandle,
  ) => {
    if (event.button !== 0 || event.detail > 1 || targetIds.length === 0) return;
    const box = event.currentTarget.closest<HTMLElement>(".node-selection-box");
    const rect = box?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const edgeDistance = Math.min(px, rect.width - px, py, rect.height - py);
      const cramped = Math.max(rect.width, rect.height) < 28;
      const interior =
        edgeDistance > 12 ||
        (cramped &&
          px > rect.width / 3 &&
          px < (rect.width * 2) / 3 &&
          py > rect.height / 4 &&
          py < (rect.height * 3) / 4);
      if (interior) {
        beginGesture(event, { kind: "move" });
        return;
      }
    }
    beginGesture(event, { kind: "resize", handle });
  };

  return (
    <div
      className="node-overlay-layer"
      data-testid="node-overlay-layer"
      onPointerMove={onGestureMove}
      onPointerUp={onGestureEnd}
      onPointerCancel={onGestureEnd}
    >
      {guides.map((guide, index) => (
        <div
          aria-hidden="true"
          className={`alignment-guide alignment-guide-${guide.axis}`}
          data-testid={`alignment-guide-${guide.axis}-${index}`}
          key={`${guide.axis}-${guide.value}-${index}`}
          style={guide.axis === "x"
            ? { left: guide.value }
            : { top: guide.value }}
        />
      ))}

      {hoveredTarget && !selectedKeys.has(targetKey(hoveredTarget)) ? (
        <div
          aria-hidden="true"
          className="node-hover-outline"
          data-testid="node-hover-outline"
          style={worldBox(hoveredTarget.bounds)}
        />
      ) : null}

      {selectedTargets.map((target) => (
        <div
          aria-hidden="true"
          className={`node-selection-outline${target.locked ? " is-locked" : ""}`}
          data-node-id={target.nodeId}
          data-testid={`node-selection-outline-${target.nodeId}`}
          key={targetKey(target)}
          style={targetBox(target)}
        />
      ))}

      {interactive && groupBounds && movableTargets.length > 0 ? (
        <div
          className="node-selection-box"
          data-testid="node-selection-box"
          style={worldBox(groupBounds)}
          onPointerDown={(event) => beginGesture(event, { kind: "move" })}
          onDoubleClick={(event) => {
            if (movableTargets.length !== 1 || !onTextEditStart) return;
            event.preventDefault();
            event.stopPropagation();
            onTextEditStart(movableTargets[0]);
          }}
        >
          {RESIZE_HANDLES.map((handle) => (
            <button
              aria-label={`Resize selection from ${handle}`}
              className={`node-resize-handle node-resize-handle-${handle}`}
              data-testid={`node-resize-handle-${handle}`}
              key={handle}
              onPointerDown={(event) => beginHandleGesture(event, handle)}
              style={{
                width: handleHitWidth,
                height: handleHitHeight,
                "--handle-visual": `${handleVisual}px`,
                "--handle-border": `${handleBorder}px`,
              } as CSSProperties}
              type="button"
            />
          ))}
          <button
            aria-label="Rotate selection"
            className="node-rotation-handle"
            data-testid="node-rotation-handle"
            onPointerDown={(event) => beginGesture(event, { kind: "rotate" })}
            style={{
              width: rotationSize,
              height: rotationSize,
              "--handle-visual": `${rotationVisual}px`,
              "--handle-border": `${handleBorder}px`,
              top: -40 / Math.max(zoom, 0.08),
            } as CSSProperties}
            type="button"
          />
        </div>
      ) : null}
    </div>
  );
});
