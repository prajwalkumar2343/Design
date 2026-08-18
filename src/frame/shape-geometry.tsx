import { useId } from "react";
import type { Point, Rect } from "../canvas/types";
import type { ShapeVariantId } from "../editor/tools";

export const SHAPE_FILL = "#d9d9d9";
export const SHAPE_STROKE = "#222222";
export const SHAPE_STROKE_WIDTH = 2;

export function normalizedBounds(start: Point, end: Point, minimum = 16): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(minimum, Math.abs(end.x - start.x)),
    height: Math.max(minimum, Math.abs(end.y - start.y)),
  };
}

export function shapeLabel(shape: ShapeVariantId): string {
  return shape[0].toUpperCase() + shape.slice(1);
}

export function shapePoints(shape: ShapeVariantId, bounds: Rect): Point[] {
  if (shape === "line" || shape === "arrow") {
    return [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }];
  }
  if (shape === "polygon") {
    return [
      { x: bounds.x + bounds.width / 2, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height * 0.38 },
      { x: bounds.x + bounds.width * 0.82, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width * 0.18, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height * 0.38 },
    ];
  }
  if (shape === "star") {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const outer = Math.min(bounds.width, bounds.height) / 2;
    const inner = outer * 0.382;
    return Array.from({ length: 10 }, (_, index) => {
      const radius = index % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });
  }
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

/**
 * Points for a shape being drawn from `start` to `end`. Lines and arrows
 * preserve the drag direction exactly; boxed shapes normalize the drag into
 * their bounds first.
 */
export function shapeDragPoints(shape: ShapeVariantId, start: Point, end: Point): Point[] {
  if (shape === "line" || shape === "arrow") {
    return [start, end];
  }
  return shapePoints(shape, normalizedBounds(start, end));
}

interface ShapePreviewProps {
  shape: ShapeVariantId;
  start: Point;
  end: Point;
  radius?: number;
}

/**
 * Live vector preview rendered while a shape is being dragged. It mirrors the
 * wireframe runtime's final SVG rendering so the preview and the committed
 * shape are pixel-identical.
 */
export function ShapePreview({ shape, start, end, radius = 0 }: ShapePreviewProps) {
  const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bounds = normalizedBounds(start, end);
  const points = shapeDragPoints(shape, start, end).map((point) => ({
    x: point.x - bounds.x,
    y: point.y - bounds.y,
  }));
  const inset = SHAPE_STROKE_WIDTH / 2;
  const cornerRadius = Math.min(radius, bounds.width / 2, bounds.height / 2);

  return (
    <svg
      aria-hidden="true"
      className="shape-preview"
      data-testid="shape-preview"
      shapeRendering="geometricPrecision"
      viewBox={`0 0 ${bounds.width} ${bounds.height}`}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }}
    >
      {shape === "rectangle" ? (
        <rect
          fill={SHAPE_FILL}
          height={Math.max(1, bounds.height - SHAPE_STROKE_WIDTH)}
          rx={cornerRadius > 0 ? cornerRadius : undefined}
          ry={cornerRadius > 0 ? cornerRadius : undefined}
          stroke={SHAPE_STROKE}
          strokeWidth={SHAPE_STROKE_WIDTH}
          width={Math.max(1, bounds.width - SHAPE_STROKE_WIDTH)}
          x={inset}
          y={inset}
        />
      ) : shape === "ellipse" ? (
        <ellipse
          cx={bounds.width / 2}
          cy={bounds.height / 2}
          fill={SHAPE_FILL}
          rx={Math.max(0.5, bounds.width / 2 - inset)}
          ry={Math.max(0.5, bounds.height / 2 - inset)}
          stroke={SHAPE_STROKE}
          strokeWidth={SHAPE_STROKE_WIDTH}
        />
      ) : shape === "line" || shape === "arrow" ? (
        <>
          {shape === "arrow" ? (
            <defs>
              <marker
                id={`shape-preview-arrow-${markerId}`}
                markerHeight="10"
                markerUnits="userSpaceOnUse"
                markerWidth="10"
                orient="auto"
                refX="9"
                refY="5"
              >
                <path d="M1,1 L9,5 L1,9 L3.2,5 Z" fill={SHAPE_STROKE} />
              </marker>
            </defs>
          ) : null}
          <line
            markerEnd={shape === "arrow" ? `url(#shape-preview-arrow-${markerId})` : undefined}
            stroke={SHAPE_STROKE}
            strokeLinecap="round"
            strokeWidth={SHAPE_STROKE_WIDTH}
            x1={points[0].x}
            x2={points[1].x}
            y1={points[0].y}
            y2={points[1].y}
          />
        </>
      ) : (
        <polygon
          fill={SHAPE_FILL}
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          stroke={SHAPE_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={SHAPE_STROKE_WIDTH}
        />
      )}
    </svg>
  );
}
