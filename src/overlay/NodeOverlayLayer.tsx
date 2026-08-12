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
  return {
    ...worldBox(target.bounds),
    ...(target.rotation
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
  const handleSize = 10 / Math.max(zoom, 0.08);
  const rotationSize = 12 / Math.max(zoom, 0.08);

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
              onPointerDown={(event) => beginGesture(event, { kind: "resize", handle })}
              style={{
                width: handleSize,
                height: handleSize,
                borderWidth: Math.max(0.75, 1 / Math.max(zoom, 0.08)),
              }}
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
              borderWidth: Math.max(0.75, 1 / Math.max(zoom, 0.08)),
              top: -32 / Math.max(zoom, 0.08),
            }}
            type="button"
          />
        </div>
      ) : null}
    </div>
  );
});
