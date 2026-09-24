import type { Point, Rect } from "../canvas/types";
import type { ShapeVariantId } from "../editor/tools";

/**
 * Freeform elements are drawn directly onto empty canvas. Under the hood each
 * becomes a chromeless "freeform" frame whose document carries the element
 * markup baked into its srcDoc — the same DOM the bridge runtime's
 * `create-element` command produces (`createElementFromSpec` in
 * src/bridge/runtime.ts), so overlay gestures, shape commands, undo, export,
 * and persistence treat it identically to an element drawn inside a frame.
 * If the runtime's created-element markup changes, update these builders too.
 */

/** Transparent padding (world px) between a drawn element and its frame edge. */
export const FREEFORM_FRAME_PAD = 8;

/**
 * Extra frame height below a text element so typing has room to grow before
 * the iframe clips it. The element itself stays `height:auto`.
 */
export const FREEFORM_TEXT_HEADROOM = 56;

export const FREEFORM_TEXT_MIN_HEIGHT = 32;

const SHAPE_FILL_DEFAULT = "#d9d9d9";
const SHAPE_STROKE_DEFAULT = "#222222";
const TEXT_COLOR_DEFAULT = "#171717";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function attr(name: string, value: string): string {
  return `${name}="${escapeAttr(value)}"`;
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** Stable editor id the bridge runtime derives from `data-design-element-id`. */
export function bridgeNodeIdForElement(elementId: string): string {
  return `data:${encodeURIComponent(elementId)}`;
}

interface CreatedElementBase {
  elementId: string;
  bounds: Rect;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  editable: boolean;
}

function createdElementAttributes(base: CreatedElementBase, extra?: string): string {
  const style = extra ?? "";
  return [
    attr("data-design-element-id", base.elementId),
    attr("data-design-tool-created", "true"),
    attr("data-design-tool-bounds", JSON.stringify(base.bounds)),
    attr("data-design-tool-fill", base.fill),
    attr("data-design-tool-stroke", base.stroke),
    attr("data-design-tool-stroke-width", String(base.strokeWidth)),
    attr("data-design-tool-radius", String(base.radius)),
    attr("data-design-tool-editable", base.editable ? "true" : "false"),
    style,
  ].filter(Boolean).join(" ");
}

function createdStyle(bounds: Rect, extras: string): string {
  return (
    `position:fixed;left:${num(bounds.x)}px;top:${num(bounds.y)}px;` +
    `width:${num(bounds.width)}px;height:${num(bounds.height)}px;` +
    `box-sizing:border-box;z-index:10;${extras}`
  );
}

export interface FreeformShapeSpec {
  elementId: string;
  kind: ShapeVariantId;
  /** Element bounds inside the frame document (offset by FREEFORM_FRAME_PAD). */
  bounds: Rect;
  /** Points in frame-document coordinates, matching the create-element spec. */
  points: Point[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}

/**
 * Mirrors `createElementFromSpec` + `createSvgChild`: the outer svg carries the
 * tool metadata and fixed placement; one geometry child paints the vector.
 */
export function buildFreeformShapeMarkup(spec: FreeformShapeSpec): string {
  const { bounds, elementId, kind } = spec;
  const fill = spec.fill ?? SHAPE_FILL_DEFAULT;
  const stroke = spec.stroke ?? SHAPE_STROKE_DEFAULT;
  const strokeWidth = spec.strokeWidth ?? 0;
  const radius = spec.radius ?? 0;
  const inset = Math.max(0, strokeWidth / 2);
  const normalized = spec.points.map((point) => ({
    x: point.x - bounds.x,
    y: point.y - bounds.y,
  }));
  const pointString = normalized.map((point) => `${num(point.x)},${num(point.y)}`).join(" ");
  const paintsFill = kind === "rectangle" || kind === "ellipse" || kind === "polygon" || kind === "star";
  const childFill = paintsFill ? fill : "none";
  const shared = `${attr("stroke", stroke)} stroke-width="${num(Math.max(0, strokeWidth))}"`;

  let child: string;
  if (kind === "rectangle") {
    child = `<rect x="${num(inset)}" y="${num(inset)}" width="${num(Math.max(1, bounds.width - strokeWidth))}" height="${num(Math.max(1, bounds.height - strokeWidth))}"${radius > 0 ? ` rx="${num(radius)}" ry="${num(radius)}"` : ""} ${attr("fill", childFill)} ${shared}/>`;
  } else if (kind === "ellipse") {
    child = `<ellipse cx="${num(bounds.width / 2)}" cy="${num(bounds.height / 2)}" rx="${num(Math.max(0.5, bounds.width / 2 - inset))}" ry="${num(Math.max(0.5, bounds.height / 2 - inset))}" ${attr("fill", childFill)} ${shared}/>`;
  } else if (kind === "line" || kind === "arrow") {
    const first = normalized[0] ?? { x: 0, y: 0 };
    const last = normalized[normalized.length - 1] ?? first;
    const marker = kind === "arrow" ? ` marker-end="url(#design-tool-arrowhead)"` : "";
    child = `<line x1="${num(first.x)}" y1="${num(first.y)}" x2="${num(last.x)}" y2="${num(last.y)}" stroke-linecap="round"${marker} ${attr("fill", "none")} ${shared}/>`;
  } else {
    child = `<polygon points="${pointString}" stroke-linejoin="round" stroke-linecap="round" ${attr("fill", childFill)} ${shared}/>`;
  }

  const defs = kind === "arrow"
    ? `<defs><marker id="design-tool-arrowhead" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M1,1 L9,5 L1,9 L3.2,5 Z" ${attr("fill", stroke)}/></marker></defs>`
    : "";

  const attributes = createdElementAttributes(
    {
      elementId,
      bounds,
      fill,
      stroke,
      strokeWidth,
      radius,
      editable: true,
    },
    [
      `viewBox="0 0 ${num(bounds.width)} ${num(bounds.height)}"`,
      attr("aria-label", kind),
      attr("shape-rendering", "geometricPrecision"),
      attr("data-design-tool-kind", kind),
      attr("data-design-tool-points", JSON.stringify(spec.points)),
      attr("style", createdStyle(bounds, "overflow:visible;")),
    ].join(" "),
  );
  return `<svg ${attributes}>${defs}${child}</svg>`;
}

export interface FreeformTextSpec {
  elementId: string;
  bounds: Rect;
  text: string;
}

/** Mirrors the `kind === "text"` branch of `createElementFromSpec`. */
export function buildFreeformTextMarkup(spec: FreeformTextSpec): string {
  const { bounds, elementId } = spec;
  const style =
    `color:${TEXT_COLOR_DEFAULT};` +
    `font-family:Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;` +
    "font-size:16px;font-weight:400;line-height:1.5;letter-spacing:0.01em;" +
    "white-space:pre-wrap;overflow-wrap:break-word;text-align:left;" +
    "padding:4px 6px;outline:none;" +
    `position:fixed;left:${num(bounds.x)}px;top:${num(bounds.y)}px;` +
    `width:${num(bounds.width)}px;height:auto;box-sizing:border-box;z-index:10;`;
  const attributes = createdElementAttributes(
    {
      elementId,
      bounds,
      fill: TEXT_COLOR_DEFAULT,
      stroke: TEXT_COLOR_DEFAULT,
      strokeWidth: 0,
      radius: 0,
      editable: true,
    },
    [
      attr("data-design-tool-kind", "text"),
      attr("data-design-tool-points", "[]"),
      attr("style", style),
      'contenteditable="true"',
      attr("spellcheck", "false"),
    ].join(" "),
  );
  return `<div ${attributes}>${escapeText(spec.text)}</div>`;
}

export interface FreeformImageSpec {
  elementId: string;
  bounds: Rect;
  src: string;
  alt: string;
}

/** Mirrors the `kind === "image"` branch of `createElementFromSpec`. */
export function buildFreeformImageMarkup(spec: FreeformImageSpec): string {
  const { bounds, elementId } = spec;
  const attributes = createdElementAttributes(
    {
      elementId,
      bounds,
      fill: SHAPE_FILL_DEFAULT,
      stroke: SHAPE_STROKE_DEFAULT,
      strokeWidth: 0,
      radius: 0,
      editable: false,
    },
    [
      attr("data-design-tool-kind", "image"),
      attr("data-design-tool-points", "[]"),
      attr("src", spec.src),
      attr("alt", spec.alt),
      attr("style", createdStyle(bounds, "object-fit:cover;background:transparent;")),
    ].join(" "),
  );
  return `<img ${attributes}>`;
}

/**
 * Complete document for a chromeless freeform frame. The element positions
 * itself with `position:fixed`, so the body only needs margin/scroll reset.
 */
export function buildFreeformDocument(bodyMarkup: string, title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeText(title)}</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: transparent; }
    </style>
  </head>
  <body>${bodyMarkup}</body>
</html>`;
}
