import {
  assembleCanvasFig,
  createEmptyFigDoc,
  createFigZip,
  encodeCommandsBlob,
  encodeFigParts,
  encodeVectorNetworkBlob,
  parseSVGPathData,
  type FigColor,
  type FigDocument,
  type FigNode,
  type FigPaint,
  type FigTransform,
  type VectorPathCommand,
} from "openfig-core";
import { ZstdCodec } from "zstd-codec";
import type { FrameEntity, NodeEntity, PageEntity } from "../editor/model";
import type { OverlayBridgeTargetState } from "../overlay/useNodeOverlayGestures";

export const FIGMA_FILE_NAME = "brainstorm-session.fig" as const;
export const FIGMA_FILE_MIME_TYPE = "application/octet-stream" as const;

export interface FigmaExportInput {
  frames: FrameEntity[];
  nodes: Record<string, NodeEntity>;
  bridgeTargets: Record<string, OverlayBridgeTargetState>;
  /** Ordered page list; frames are grouped onto one Figma page (CANVAS) each. */
  pages?: readonly PageEntity[];
}

const THUMBNAIL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAYAAADl5PURAAACaUlEQVR4nO3UoREAIBDAsN9/Uxx3DABjIBoRX9U5e12AovkdAPCLAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWAQJZBghkGSCQZYBAlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWQYIZBkgkGWAQJYBAlkGCGQZIJBlgECWQYIZBkgkGWAQJYBAlkGCGQ9WzOc/PiAJNQAAAAASUVORK5CYII=";

const DETACH_STYLE_GUID = { sessionID: 0xffffffff, localID: 0xffffffff };

/* ------------------------------------------------------------------ */
/* Colors                                                              */
/* ------------------------------------------------------------------ */

/** CSS named colors (CSS Color 4), name -> #rrggbb. */
const NAMED_COLORS: Record<string, string> = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4",
  azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000",
  blanchedalmond: "#ffebcd", blue: "#0000ff", blueviolet: "#8a2be2", brown: "#a52a2a",
  burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e",
  coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9", darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b", darkolivegreen: "#556b2f", darkorange: "#ff8c00", darkorchid: "#9932cc",
  darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3",
  deeppink: "#ff1493", deepskyblue: "#00bfff", dimgray: "#696969", dimgrey: "#696969",
  dodgerblue: "#1e90ff", firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22",
  fuchsia: "#ff00ff", gainsboro: "#dcdcdc", ghostwhite: "#f8f8ff", gold: "#ffd700",
  goldenrod: "#daa520", gray: "#808080", green: "#008000", greenyellow: "#adff2f",
  grey: "#808080", honeydew: "#f0fff0", hotpink: "#ff69b4", indianred: "#cd5c5c",
  indigo: "#4b0082", ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa",
  lavenderblush: "#fff0f5", lawngreen: "#7cfc00", lemonchiffon: "#fffacd", lightblue: "#add8e6",
  lightcoral: "#f08080", lightcyan: "#e0ffff", lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3",
  lightgreen: "#90ee90", lightgrey: "#d3d3d3", lightpink: "#ffb6c1", lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa", lightskyblue: "#87cefa", lightslategray: "#778899", lightslategrey: "#778899",
  lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", lime: "#00ff00", limegreen: "#32cd32",
  linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd", mediumorchid: "#ba55d3", mediumpurple: "#9370db", mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc", mediumvioletred: "#c71585",
  midnightblue: "#191970", mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5",
  navajowhite: "#ffdead", navy: "#000080", oldlace: "#fdf5e6", olive: "#808000",
  olivedrab: "#6b8e23", orange: "#ffa500", orangered: "#ff4500", orchid: "#da70d6",
  palegoldenrod: "#eee8aa", palegreen: "#98fb98", paleturquoise: "#afeeee", palevioletred: "#db7093",
  papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb",
  plum: "#dda0dd", powderblue: "#b0e0e6", purple: "#800080", rebeccapurple: "#663399",
  red: "#ff0000", rosybrown: "#bc8f8f", royalblue: "#4169e1", saddlebrown: "#8b4513",
  salmon: "#fa8072", sandybrown: "#f4a460", seagreen: "#2e8b57", seashell: "#fff5ee",
  sienna: "#a0522d", silver: "#c0c0c0", skyblue: "#87ceeb", slateblue: "#6a5acd",
  slategray: "#708090", slategrey: "#708090", snow: "#fffafa", springgreen: "#00ff7f",
  steelblue: "#4682b4", tan: "#d2b48c", teal: "#008080", thistle: "#d8bfd8",
  tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee", wheat: "#f5deb3",
  white: "#ffffff", whitesmoke: "#f5f5f5", yellow: "#ffff00", yellowgreen: "#9acd32",
};

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function parseHexColor(value: string): FigColor | null {
  const match = /^#([0-9a-f]+)$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a] = [...hex].map((ch) => parseInt(ch + ch, 16));
    return { r: r / 255, g: g / 255, b: b / 255, a: hex.length === 4 ? a / 255 : 1 };
  }
  if (hex.length === 6 || hex.length === 8) {
    const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16) / 255;
    return { r: channel(0), g: channel(2), b: channel(4), a: hex.length === 8 ? channel(6) : 1 };
  }
  return null;
}

function splitColorArgs(body: string): { channels: string[]; alpha: string | null } {
  const slash = body.split("/");
  const alpha = slash.length > 1 ? slash[1].trim() : null;
  const rest = slash[0];
  const channels = rest.includes(",")
    ? rest.split(",").map((part) => part.trim()).filter(Boolean)
    : rest.trim().split(/\s+/).filter(Boolean);
  return { channels, alpha };
}

function colorChannel(part: string): number | null {
  const trimmed = part.trim();
  if (trimmed.endsWith("%")) {
    const pct = Number.parseFloat(trimmed);
    return Number.isFinite(pct) ? clamp01(pct / 100) : null;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? clamp01(value / 255) : null;
}

function alphaChannel(part: string | null): number {
  if (part === null || part === "") return 1;
  const trimmed = part.trim();
  if (trimmed.endsWith("%")) {
    const pct = Number.parseFloat(trimmed);
    return Number.isFinite(pct) ? clamp01(pct / 100) : 1;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? clamp01(value) : 1;
}

function hueDegrees(part: string): number | null {
  const trimmed = part.trim().toLowerCase();
  const match = /^(-?\d+(?:\.\d+)?)(deg|rad|grad|turn)?$/.exec(trimmed);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  switch (match[2]) {
    case "rad": return (value * 180) / Math.PI;
    case "grad": return value * 0.9;
    case "turn": return value * 360;
    default: return value;
  }
}

function percent(part: string): number | null {
  const trimmed = part.trim();
  if (!trimmed.endsWith("%")) return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? clamp01(value / 100) : null;
}

function hslToFigColor(h: number, s: number, l: number, a: number): FigColor {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: channel(hue + 1 / 3), g: channel(hue), b: channel(hue - 1 / 3), a };
}

function hwbToFigColor(h: number, w: number, b: number, a: number): FigColor {
  const sum = w + b;
  const ww = sum > 1 ? w / sum : w;
  const bb = sum > 1 ? b / sum : b;
  const rgb = hslToFigColor(h, 1, 0.5, a);
  const blend = (channel: number) => channel * (1 - ww - bb) + ww;
  return { r: blend(rgb.r), g: blend(rgb.g), b: blend(rgb.b), a };
}

function parseFunctionColor(value: string): FigColor | null {
  const match = /^([a-z]+)\s*\((.*)\)$/i.exec(value.trim());
  if (!match) return null;
  const fn = match[1].toLowerCase();
  const { channels, alpha } = splitColorArgs(match[2]);
  // Legacy comma syntax carries alpha as a 4th channel; modern syntax uses /.
  const a = alphaChannel(alpha ?? (channels.length > 3 ? channels[3] : null));
  if (fn === "rgb" || fn === "rgba") {
    if (channels.length < 3) return null;
    const [r, g, b] = channels.map(colorChannel);
    if (r === null || g === null || b === null) return null;
    return { r, g, b, a };
  }
  if (fn === "hsl" || fn === "hsla") {
    if (channels.length < 3) return null;
    const h = hueDegrees(channels[0]);
    const s = percent(channels[1]);
    const l = percent(channels[2]);
    if (h === null || s === null || l === null) return null;
    return hslToFigColor(h, s, l, a);
  }
  if (fn === "hwb") {
    if (channels.length < 3) return null;
    const h = hueDegrees(channels[0]);
    const w = percent(channels[1]);
    const b = percent(channels[2]);
    if (h === null || w === null || b === null) return null;
    return hwbToFigColor(h, w, b, a);
  }
  return null;
}

let probeContext: CanvasRenderingContext2D | null | undefined;

/**
 * Last-resort resolution for CSS colors we do not parse statically
 * (oklch/lab/color-mix/etc.). Canvas fillStyle normalizes any supported
 * color to #rrggbb/rgba(); unavailable outside a real DOM.
 */
function domProbeColor(value: string): FigColor | null {
  if (typeof document === "undefined") return null;
  try {
    if (probeContext === undefined) {
      probeContext = document.createElement("canvas").getContext("2d");
    }
    if (!probeContext) return null;
    probeContext.fillStyle = "#010203";
    probeContext.fillStyle = value;
    const normalized = probeContext.fillStyle;
    if (typeof normalized !== "string" || normalized === "#010203") return null;
    return parseHexColor(normalized) ?? parseFunctionColor(normalized);
  } catch {
    return null;
  }
}

/**
 * Any CSS color -> Figma's normalized RGBA. Never throws; returns null when
 * the color cannot be understood so callers can fall back or drop the paint.
 */
function resolveCssColor(raw: string | undefined | null): FigColor | null {
  const value = raw?.trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "none" || lower === "currentcolor" || lower === "inherit" || lower === "initial" || lower === "unset") {
    return null;
  }
  if (lower === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLORS[lower];
  if (named) return parseHexColor(named);
  if (lower.startsWith("#")) return parseHexColor(lower);
  const functional = parseFunctionColor(value);
  if (functional) return functional;
  return domProbeColor(value);
}

function isSaneColor(color: FigColor): boolean {
  return [color.r, color.g, color.b, color.a].every((channel) => Number.isFinite(channel));
}

/** Solid paint shaped the way real Figma writes it: alpha on color, opacity 1. */
function solidPaint(color: FigColor): FigPaint {
  return {
    type: "SOLID",
    color: { r: color.r, g: color.g, b: color.b, a: clamp01(color.a) },
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function fillPaints(fill: string | undefined, fallback: string): FigPaint[] | undefined {
  if (fill === "none") return undefined;
  const color = resolveCssColor(fill) ?? resolveCssColor(fallback);
  if (!color || !isSaneColor(color)) return undefined;
  return [solidPaint(color)];
}

function strokePaints(
  stroke: string | undefined,
  width: number,
): { strokePaints?: FigPaint[]; strokeWeight: number } {
  if (!stroke || stroke === "none") return { strokeWeight: 0 };
  const color = resolveCssColor(stroke) ?? resolveCssColor("#222222");
  if (!color || !isSaneColor(color)) return { strokeWeight: 0 };
  return { strokePaints: [solidPaint(color)], strokeWeight: width };
}

/* ------------------------------------------------------------------ */
/* 2D helpers                                                          */
/* ------------------------------------------------------------------ */

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint(value: unknown): value is Point {
  return (
    Boolean(value) &&
    isFiniteNumber((value as Point).x) &&
    isFiniteNumber((value as Point).y)
  );
}

function multiplyTransform(a: FigTransform, b: FigTransform): FigTransform {
  return {
    m00: a.m00 * b.m00 + a.m01 * b.m10,
    m01: a.m00 * b.m01 + a.m01 * b.m11,
    m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02,
    m10: a.m10 * b.m00 + a.m11 * b.m10,
    m11: a.m10 * b.m01 + a.m11 * b.m11,
    m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12,
  };
}

function translateTransform(x: number, y: number): FigTransform {
  return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y };
}

function rotateTransform(radians: number): FigTransform {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { m00: cos, m01: -sin, m02: 0, m10: sin, m11: cos, m12: 0 };
}

function scaleTransform(x: number, y: number): FigTransform {
  return { m00: x, m01: 0, m02: 0, m10: 0, m11: y, m12: 0 };
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  return match ? Number.parseFloat(match[1]) : null;
}

const TRANSFORM_FN = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

function numberList(raw: string): number[] | null {
  const parts = raw.trim().split(/[\s,]+/).filter(Boolean);
  const values = parts.map((part) => Number.parseFloat(part.replace(/(deg|rad|grad|turn|px|%)$/i, "")));
  return values.every(Number.isFinite) ? values : null;
}

function angleValue(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  const match = /^(-?\d+(?:\.\d+)?)(deg|rad|grad|turn)?$/.exec(trimmed);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  switch (match[2]) {
    case "rad": return value;
    case "grad": return (value * Math.PI) / 200;
    case "turn": return value * 2 * Math.PI;
    default: return (value * Math.PI) / 180;
  }
}

/**
 * Resolves a CSS transform list (computed `matrix(...)`, or the
 * `translate()/rotate()/scale()` chains the overlay writes) into a 2x3
 * affine matrix. Identity when the value is absent or unrecognized.
 */
function parseCssTransform(value: string | undefined): FigTransform {
  if (!value || value.trim() === "none") return translateTransform(0, 0);
  const text = value.trim();
  if (/^matrix\s*\(/.test(text)) {
    const args = numberList(text.slice(text.indexOf("(") + 1, text.lastIndexOf(")")));
    if (args && args.length === 6) {
      return { m00: args[0], m01: args[2], m02: args[4], m10: args[1], m11: args[3], m12: args[5] };
    }
    return translateTransform(0, 0);
  }
  if (/^matrix3d\s*\(/.test(text)) {
    const args = numberList(text.slice(text.indexOf("(") + 1, text.lastIndexOf(")")));
    if (args && args.length === 16) {
      return { m00: args[0], m01: args[4], m02: args[12], m10: args[1], m11: args[5], m12: args[13] };
    }
    return translateTransform(0, 0);
  }
  let result = translateTransform(0, 0);
  let matched = false;
  let failed = false;
  for (const match of text.matchAll(TRANSFORM_FN)) {
    const name = match[1].toLowerCase();
    const args = numberList(match[2]);
    let next: FigTransform | null = null;
    if ((name === "translate" || name === "translate3d") && args && args.length >= 2) {
      next = translateTransform(args[0], args[1]);
    } else if (name === "translatex" && args && args.length >= 1) {
      next = translateTransform(args[0], 0);
    } else if (name === "translatey" && args && args.length >= 1) {
      next = translateTransform(0, args[0]);
    } else if (name === "rotate" || name === "rotatez") {
      const angle = angleValue(match[2]);
      if (angle !== null) next = rotateTransform(angle);
    } else if ((name === "scale" || name === "scale3d") && args && args.length >= 1) {
      next = scaleTransform(args[0], args.length >= 2 ? args[1] : args[0]);
    } else if (name === "scalex" && args && args.length >= 1) {
      next = scaleTransform(args[0], 1);
    } else if (name === "scaley" && args && args.length >= 1) {
      next = scaleTransform(1, args[0]);
    } else if (name === "skewx" || name === "skewy") {
      const angle = angleValue(match[2]);
      if (angle !== null) {
        next = name === "skewx"
          ? { m00: 1, m01: Math.tan(angle), m02: 0, m10: 0, m11: 1, m12: 0 }
          : { m00: 1, m01: 0, m02: 0, m10: Math.tan(angle), m11: 1, m12: 0 };
      }
    }
    if (next) {
      result = multiplyTransform(result, next);
      matched = true;
    } else {
      failed = true;
    }
  }
  return matched && !failed ? result : translateTransform(0, 0);
}

function parseNullableTransform(value: string | undefined): FigTransform | null {
  if (!value || value.trim() === "" || value.trim() === "none") return null;
  const parsed = parseCssTransform(value);
  return parsed;
}

function invertTransform(m: FigTransform): FigTransform | null {
  const det = m.m00 * m.m11 - m.m01 * m.m10;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const ia = m.m11 / det;
  const ib = -m.m10 / det;
  const ic = -m.m01 / det;
  const id = m.m00 / det;
  return {
    m00: ia,
    m01: ic,
    m02: -(ia * m.m02 + ic * m.m12),
    m10: ib,
    m11: id,
    m12: -(ib * m.m02 + id * m.m12),
  };
}

/**
 * The element's live box in frame space: inline left/top/width/height are the
 * authored box (moves ride in `transform`), `computedStyle.transform` carries
 * gesture translate/rotate folded around the element's transform-origin
 * (50% 50%), and `data-design-tool-bounds` is the creation-time fallback.
 *
 * Elements imported from a .fig file are nested inside generated containers,
 * so their inline left/top are parent-relative and meaningless here. They are
 * marked `data-design-tool-space="document"` and carry their document-space
 * box in `data-design-tool-bounds` plus the document-space transform in
 * `data-design-tool-transform` and the authored parent-space transform in
 * `data-design-tool-local-transform`; the live local transform (which folds
 * in gesture deltas) is mapped back into document space for an exact
 * re-export placement.
 */
function resolveElementPlacement(
  entry: OverlayBridgeTargetState | undefined,
  attrBounds: Bounds,
  attributes: Record<string, string> = {},
): { size: Point; transform: FigTransform } {
  const inline = entry?.inspection?.inlineStyle ?? {};
  const computed = entry?.inspection?.computedStyle ?? {};
  const width = parsePx(inline["width"] ?? computed["width"]) ?? attrBounds.width;
  const height = parsePx(inline["height"] ?? computed["height"]) ?? attrBounds.height;

  if (attributes["data-design-tool-space"] === "document") {
    const authoredDocument = parseNullableTransform(attributes["data-design-tool-transform"]);
    const authoredLocal = parseNullableTransform(attributes["data-design-tool-local-transform"]);
    const liveX = parsePx(inline["left"] ?? computed["left"]) ?? 0;
    const liveY = parsePx(inline["top"] ?? computed["top"]) ?? 0;
    const liveLocal = multiplyTransform(
      translateTransform(liveX, liveY),
      parseCssTransform(computed["transform"] ?? inline["transform"]),
    );
    const inverseLocal = authoredLocal ? invertTransform(authoredLocal) : null;
    const transform = authoredDocument
      ? inverseLocal
        ? multiplyTransform(authoredDocument, multiplyTransform(inverseLocal, liveLocal))
        : authoredDocument
      : liveLocal;
    return { size: { x: width, y: height }, transform };
  }

  const x = parsePx(inline["left"] ?? computed["left"]) ?? attrBounds.x;
  const y = parsePx(inline["top"] ?? computed["top"]) ?? attrBounds.y;
  const cssTransform = parseCssTransform(computed["transform"] ?? inline["transform"]);
  const transform = multiplyTransform(
    translateTransform(x, y),
    multiplyTransform(
      translateTransform(width / 2, height / 2),
      multiplyTransform(cssTransform, translateTransform(-width / 2, -height / 2)),
    ),
  );
  return { size: { x: width, y: height }, transform };
}

/* ------------------------------------------------------------------ */
/* Stroke expansion: stroked polylines become filled outline paths     */
/* ------------------------------------------------------------------ */

function vsub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function vadd(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function vscale(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s };
}

function vlen(a: Point): number {
  return Math.hypot(a.x, a.y);
}

function vunit(a: Point): Point {
  const length = vlen(a);
  return length > 1e-9 ? vscale(a, 1 / length) : { x: 1, y: 0 };
}

function leftNormal(d: Point): Point {
  return { x: -d.y, y: d.x };
}

function vcross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function dedupePoints(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (!prev || vlen(vsub(point, prev)) > 1e-6) out.push(point);
  }
  return out;
}

/** Sample an arc of `sweep` radians starting at angle `a0` around `center`. */
function arcPoints(center: Point, radius: number, a0: number, sweep: number): Point[] {
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 15)));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = a0 + (sweep * i) / steps;
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return points;
}

function wrapPi(angle: number): number {
  let a = angle;
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/**
 * The stroked outline of an open polyline as a single closed outline
 * (round joins and round caps, matching the runtime's SVG rendering).
 */
function openStrokeOutline(points: readonly Point[], halfWidth: number): Point[] {
  const pts = dedupePoints(points);
  if (pts.length < 2 || halfWidth <= 0) return [];
  const n = pts.length;
  const dirs: Point[] = [];
  for (let i = 0; i < n - 1; i++) dirs.push(vunit(vsub(pts[i + 1], pts[i])));

  const left: Point[] = [vadd(pts[0], vscale(leftNormal(dirs[0]), halfWidth))];
  const right: Point[] = [vadd(pts[0], vscale(leftNormal(dirs[0]), -halfWidth))];
  for (let i = 1; i < n - 1; i++) {
    const v = pts[i];
    const dA = dirs[i - 1];
    const dB = dirs[i];
    const nA = leftNormal(dA);
    const nB = leftNormal(dB);
    const cross = vcross(dA, dB);
    for (const side of [1, -1] as const) {
      const out = side === 1 ? left : right;
      if (Math.abs(cross) < 1e-6) {
        out.push(vadd(v, vscale(nA, side * halfWidth)));
        continue;
      }
      // The side the path turns toward is the inside of the bend: its two
      // offset edges cross at a miter. The far side is the outside of the
      // bend and gets the round-join arc.
      const isInnerSide = cross * side > 0;
      if (isInnerSide) {
        const pA = vadd(v, vscale(nA, side * halfWidth));
        const pB = vadd(v, vscale(nB, side * halfWidth));
        const denom = vcross(dA, dB);
        const t = vcross(vsub(pB, pA), dB) / denom;
        out.push(vadd(pA, vscale(dA, t)));
      } else {
        const a0 = Math.atan2(side * nA.y, side * nA.x);
        const a1 = Math.atan2(side * nB.y, side * nB.x);
        const sweep = wrapPi(a1 - a0);
        const samples = arcPoints(v, halfWidth, a0, sweep);
        for (const point of samples) out.push(point);
      }
    }
  }
  const lastDir = dirs[dirs.length - 1];
  left.push(vadd(pts[n - 1], vscale(leftNormal(lastDir), halfWidth)));
  right.push(vadd(pts[n - 1], vscale(leftNormal(lastDir), -halfWidth)));

  const outline: Point[] = [...left];
  // End cap: from the left-side endpoint around the segment direction to the right side.
  outline.push(...arcPoints(pts[n - 1], halfWidth, Math.atan2(leftNormal(lastDir).y, leftNormal(lastDir).x), -Math.PI).slice(1));
  for (let i = right.length - 1; i >= 0; i--) outline.push(right[i]);
  // Start cap: from the right-side endpoint back around -d0 to the left start.
  outline.push(...arcPoints(pts[0], halfWidth, Math.atan2(-leftNormal(dirs[0]).y, -leftNormal(dirs[0]).x), -Math.PI).slice(1));
  return outline;
}

/**
 * The stroked outline of a closed polygon as a filled ring: outer offset
 * loop plus reversed inner offset loop (NONZERO winding punches the hole).
 */
function closedStrokeOutline(points: readonly Point[], halfWidth: number): { outer: Point[]; inner: Point[] } {
  const pts = dedupePoints(points);
  if (pts.length < 3 || halfWidth <= 0) return { outer: [], inner: [] };
  const n = pts.length;
  if (vlen(vsub(pts[0], pts[n - 1])) < 1e-6) {
    pts.pop();
  }
  const count = pts.length;
  let area = 0;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % count];
    area += a.x * b.y - b.x * a.y;
  }
  const outerSide = area >= 0 ? -1 : 1;

  const outer: Point[] = [];
  const inner: Point[] = [];
  for (let i = 0; i < count; i++) {
    const v = pts[i];
    const prev = pts[(i - 1 + count) % count];
    const next = pts[(i + 1) % count];
    const dA = vunit(vsub(v, prev));
    const dB = vunit(vsub(next, v));
    const nA = leftNormal(dA);
    const nB = leftNormal(dB);
    const cross = vcross(dA, dB);
    for (const [side, out] of [[outerSide, outer], [-outerSide, inner]] as const) {
      if (Math.abs(cross) < 1e-6) {
        out.push(vadd(v, vscale(nA, side * halfWidth)));
        continue;
      }
      const isInnerSide = cross * side > 0;
      if (isInnerSide) {
        const pA = vadd(v, vscale(nA, side * halfWidth));
        const pB = vadd(v, vscale(nB, side * halfWidth));
        const t = vcross(vsub(pB, pA), dB) / cross;
        out.push(vadd(pA, vscale(dA, t)));
      } else {
        const a0 = Math.atan2(side * nA.y, side * nA.x);
        const a1 = Math.atan2(side * nB.y, side * nB.x);
        out.push(...arcPoints(v, halfWidth, a0, wrapPi(a1 - a0)));
      }
    }
  }
  return { outer, inner };
}

/* ------------------------------------------------------------------ */
/* Vector node authoring                                               */
/* ------------------------------------------------------------------ */

function ensureBlobs(doc: FigDocument): { bytes: Uint8Array }[] {
  const message = doc.message as { blobs?: { bytes: Uint8Array }[] };
  if (!Array.isArray(message.blobs)) message.blobs = [];
  return message.blobs;
}

function pushCommandsPath(doc: FigDocument, commands: VectorPathCommand[]): { windingRule: "NONZERO"; commandsBlob: number; styleID: number } {
  const blobs = ensureBlobs(doc);
  blobs.push({ bytes: encodeCommandsBlob(commands) });
  return { windingRule: "NONZERO", commandsBlob: blobs.length - 1, styleID: 0 };
}

function pushNetworkBlob(doc: FigDocument, paths: readonly (readonly VectorPathCommand[])[], emitRegions: boolean): number {
  const blobs = ensureBlobs(doc);
  blobs.push({ bytes: encodeVectorNetworkBlob(paths, { emitRegions }) });
  return blobs.length - 1;
}

/** Parse an SVG path stored on an imported element back into path commands. */
function parsePathCommandsAttr(value: string | undefined): VectorPathCommand[] | null {
  if (!value || value.trim() === "") return null;
  try {
    const commands = parseSVGPathData(value);
    return commands.length > 0 ? commands : null;
  } catch {
    return null;
  }
}

function closedPathCommands(points: readonly Point[]): VectorPathCommand[] {
  const pts = dedupePoints(points);
  if (pts.length < 2) return [];
  const commands: VectorPathCommand[] = [{ type: "M", x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length; i++) commands.push({ type: "L", x: pts[i].x, y: pts[i].y });
  commands.push({ type: "Z" });
  return commands;
}

/* ------------------------------------------------------------------ */
/* Node conversion                                                     */
/* ------------------------------------------------------------------ */

/**
 * Fractional sibling index for `parentIndex.position`. The alphabet is
 * printable ASCII `!`..`~` and comparison is lexicographic, so a continuation
 * marker reserves the top character to keep longer keys sorting last.
 */
function positionAt(index: number): string {
  const first = 0x21;
  const last = 0x7d;
  const base = last - first + 1;
  const more = "~";
  let out = "";
  let remaining = index;
  while (remaining >= base) {
    out += more;
    remaining -= base;
  }
  return out + String.fromCharCode(first + remaining);
}

interface Guid {
  sessionID: number;
  localID: number;
}

interface NodeExtras {
  locked?: boolean;
  hidden?: boolean;
  opacity?: number;
}

function baseNode(
  node: Record<string, unknown>,
  guid: Guid,
  name: string,
  type: string,
  parentGuid: Guid,
  position: string,
  size: Point,
  transform: FigTransform,
  extras?: NodeExtras,
): FigNode {
  return {
    ...node,
    guid,
    type,
    name,
    phase: "CREATED",
    parentIndex: { guid: parentGuid, position },
    size: { x: size.x, y: size.y },
    transform,
    visible: extras?.hidden ? false : true,
    opacity: extras?.opacity !== undefined && Number.isFinite(extras.opacity)
      ? clamp01(extras.opacity)
      : 1,
    ...(extras?.locked ? { locked: true } : {}),
    blendMode: "NORMAL",
  } as FigNode;
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseBounds(raw: string | undefined): Bounds | null {
  const bounds = parseJson(raw) as Bounds | null;
  if (
    !bounds ||
    !isFiniteNumber(bounds.x) || !isFiniteNumber(bounds.y) ||
    !isFiniteNumber(bounds.width) || !isFiniteNumber(bounds.height) ||
    bounds.width < 0 || bounds.height < 0
  ) return null;
  return bounds;
}

function parsePoints(raw: string | undefined): Point[] | null {
  const points = parseJson(raw);
  if (!Array.isArray(points) || points.length < 2 || !points.every(isPoint)) return null;
  return points;
}

/** Points are stored creation-absolute; the element's local frame anchors at the creation bounds. */
function localizePoints(points: readonly Point[], origin: Bounds): Point[] {
  return points.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y }));
}

function shapeExtras(node: NodeEntity, entry: OverlayBridgeTargetState | undefined): NodeExtras {
  const opacity = Number(entry?.inspection?.computedStyle?.["opacity"]);
  return {
    hidden: node.hidden === true,
    locked: node.locked === true,
    opacity: Number.isFinite(opacity) ? opacity : undefined,
  };
}

const FONT_WEIGHT_STYLES: [number, string][] = [
  [150, "Thin"],
  [250, "ExtraLight"],
  [350, "Light"],
  [450, "Regular"],
  [550, "Medium"],
  [650, "SemiBold"],
  [750, "Bold"],
  [850, "ExtraBold"],
  [1000, "Black"],
];

function fontStyleName(weight: number, italic: boolean): string {
  let style = "Regular";
  for (const [limit, name] of FONT_WEIGHT_STYLES) {
    if (weight <= limit) {
      style = name;
      break;
    }
  }
  if (italic) style = style === "Regular" ? "Italic" : `${style} Italic`;
  return style;
}

function textFontName(computed: Record<string, string>): { family: string; style: string; postscript: string } {
  const familyList = computed["font-family"] ?? "";
  const first = familyList.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  const family = first && first !== "ui-sans-serif" && first !== "system-ui" && first !== "sans-serif"
    ? first
    : "Inter";
  const weight = Number.parseFloat(computed["font-weight"] ?? "");
  const italic = (computed["font-style"] ?? "").toLowerCase().includes("italic")
    || (computed["font-style"] ?? "").toLowerCase().includes("oblique");
  const style = fontStyleName(Number.isFinite(weight) ? weight : 400, italic);
  return { family, style, postscript: `${family.replace(/\s+/g, "")}-${style.replace(/\s+/g, "")}` };
}

function textNumberStyle(raw: string | undefined, fontSize: number): { value: number; units: "PIXELS" | "RAW" | "PERCENT" } | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const px = parsePx(trimmed);
  if (px !== null) return { value: px, units: "PIXELS" };
  const unitless = Number.parseFloat(trimmed);
  if (Number.isFinite(unitless) && unitless > 0) return { value: unitless, units: "RAW" };
  if (trimmed === "normal") return { value: fontSize * 1.2, units: "PIXELS" };
  return undefined;
}

function convertShapeNode(
  node: NodeEntity,
  entry: OverlayBridgeTargetState | undefined,
  guid: Guid,
  parentGuid: Guid,
  position: string,
  doc: FigDocument,
): void {
  const inspection = entry?.inspection;
  const attributes = inspection?.attributes ?? {};
  const kind = attributes["data-design-tool-kind"];
  if (!kind) return;

  const attrBounds = parseBounds(attributes["data-design-tool-bounds"]);
  if (!attrBounds) return;

  const placement = resolveElementPlacement(entry, attrBounds, attributes);
  if (!Number.isFinite(placement.size.x) || !Number.isFinite(placement.size.y) ||
    placement.size.x <= 0 || placement.size.y <= 0 ||
    Object.values(placement.transform).some((value) => !Number.isFinite(value))) {
    return;
  }

  const fill = attributes["data-design-tool-fill"];
  const stroke = attributes["data-design-tool-stroke"];
  const strokeWidthAttr = Number(attributes["data-design-tool-stroke-width"] || 2);
  const strokeWidth = Number.isFinite(strokeWidthAttr) && strokeWidthAttr >= 0 ? strokeWidthAttr : 2;
  const radiusAttr = Number(attributes["data-design-tool-radius"] || 0);
  const radius = Number.isFinite(radiusAttr) && radiusAttr >= 0 ? radiusAttr : 0;
  const name = node.name || kind;
  const extras = shapeExtras(node, entry);

  const paintFields = () => ({
    ...(fillPaints(fill, "#d9d9d9") ? { fillPaints: fillPaints(fill, "#d9d9d9") as never } : {}),
    ...(() => {
      const st = strokePaints(stroke, strokeWidth);
      return {
        ...(st.strokePaints ? { strokePaints: st.strokePaints as never } : {}),
        strokeWeight: st.strokeWeight,
      };
    })(),
    strokeAlign: "CENTER",
    strokeJoin: "ROUND",
  });

  if (kind === "rectangle") {
    doc.message.nodeChanges.push(baseNode(
      {
        cornerRadius: radius,
        rectangleTopLeftCornerRadius: radius,
        rectangleTopRightCornerRadius: radius,
        rectangleBottomLeftCornerRadius: radius,
        rectangleBottomRightCornerRadius: radius,
        ...paintFields(),
        strokeAlign: "INSIDE",
        strokeJoin: "MITER",
      },
      guid,
      name,
      "ROUNDED_RECTANGLE",
      parentGuid,
      position,
      placement.size,
      placement.transform,
      extras,
    ));
    return;
  }

  if (kind === "ellipse") {
    doc.message.nodeChanges.push(baseNode(
      {
        arcData: { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0 },
        ...paintFields(),
        strokeAlign: "INSIDE",
        strokeJoin: "MITER",
      },
      guid,
      name,
      "ELLIPSE",
      parentGuid,
      position,
      placement.size,
      placement.transform,
      extras,
    ));
    return;
  }

  if (kind === "vector") {
    // Exact-geometry vectors (everything the .fig importer emits for
    // VECTOR/BOOLEAN_OPERATION/STAR/partial-arc content): fill geometry is a
    // verbatim SVG path and the stroke is already an expanded outline path.
    const fillCommands = parsePathCommandsAttr(attributes["data-design-tool-path"]);
    const strokeCommands = parsePathCommandsAttr(attributes["data-design-tool-stroke-path"]);
    if (!fillCommands && !strokeCommands) return;
    const fillGeometry = fillCommands ? [pushCommandsPath(doc, fillCommands)] : [];
    const strokeGeometry = strokeCommands ? [pushCommandsPath(doc, strokeCommands)] : [];
    const vectorNetworkBlob = pushNetworkBlob(
      doc,
      [fillCommands, strokeCommands].filter((entry): entry is VectorPathCommand[] => entry !== null),
      true,
    );
    doc.message.nodeChanges.push(baseNode(
      {
        fillGeometry,
        strokeGeometry,
        vectorData: { vectorNetworkBlob, normalizedSize: { x: placement.size.x, y: placement.size.y } },
        ...paintFields(),
      },
      guid,
      name,
      "VECTOR",
      parentGuid,
      position,
      placement.size,
      placement.transform,
      extras,
    ));
    return;
  }

  if (kind === "polygon" || kind === "star") {
    const points = parsePoints(attributes["data-design-tool-points"]);
    if (!points || points.length < 3) return;
    const local = localizePoints(points, attrBounds);
    const fillCommands = closedPathCommands(local);
    if (fillCommands.length === 0) return;

    const fillGeometry = [pushCommandsPath(doc, fillCommands)];
    const strokeGeometry: { windingRule: "NONZERO"; commandsBlob: number; styleID: number }[] = [];
    if (stroke && stroke !== "none" && strokeWidth > 0) {
      const { outer, inner } = closedStrokeOutline(local, strokeWidth / 2);
      if (outer.length >= 3 && inner.length >= 3) {
        strokeGeometry.push(pushCommandsPath(doc, [...closedPathCommands(outer), ...closedPathCommands([...inner].reverse())]));
      }
    }
    const vectorNetworkBlob = pushNetworkBlob(doc, [fillCommands], true);
    doc.message.nodeChanges.push(baseNode(
      {
        fillGeometry,
        strokeGeometry,
        vectorData: { vectorNetworkBlob, normalizedSize: { x: placement.size.x, y: placement.size.y } },
        ...paintFields(),
      },
      guid,
      name,
      "VECTOR",
      parentGuid,
      position,
      placement.size,
      placement.transform,
      extras,
    ));
    return;
  }

  if (kind === "line") {
    const points = parsePoints(attributes["data-design-tool-points"]);
    if (!points) return;
    const start = vsub(points[0], attrBounds);
    const end = vsub(points[points.length - 1], attrBounds);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return;
    // Imported lines carry their exact document-space transform; rebuilding
    // it from points would apply the direction rotation a second time.
    const transform = attributes["data-design-tool-space"] === "document"
      ? placement.transform
      : multiplyTransform(
          placement.transform,
          multiplyTransform(translateTransform(start.x, start.y), rotateTransform(Math.atan2(dy, dx))),
        );
    const st = strokePaints(stroke ?? "#222222", strokeWidth);
    doc.message.nodeChanges.push({
      guid,
      type: "LINE",
      name,
      phase: "CREATED",
      parentIndex: { guid: parentGuid, position },
      size: { x: length, y: 0 },
      transform,
      visible: !extras.hidden,
      opacity: extras.opacity ?? 1,
      ...(extras.locked ? { locked: true } : {}),
      blendMode: "NORMAL",
      ...(st.strokePaints ? { strokePaints: st.strokePaints } : {}),
      strokeWeight: st.strokeWeight,
      strokeAlign: "CENTER",
      strokeCap: "ROUND",
      strokeJoin: "ROUND",
    });
    return;
  }

  if (kind === "arrow") {
    const points = parsePoints(attributes["data-design-tool-points"]);
    if (!points) return;
    const start = vsub(points[0], attrBounds);
    const end = vsub(points[points.length - 1], attrBounds);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return;
    const unitX = dx / length;
    const unitY = dy / length;
    const perpX = -unitY;
    const perpY = unitX;
    const halfWidth = Math.max(1, strokeWidth / 2);
    const headLength = Math.max(10, halfWidth * 6);
    const baseX = end.x - unitX * headLength;
    const baseY = end.y - unitY * headLength;
    const arrowWidth = halfWidth * 3;
    const local: Point[] = [
      { x: start.x + perpX * halfWidth, y: start.y + perpY * halfWidth },
      { x: start.x - perpX * halfWidth, y: start.y - perpY * halfWidth },
      { x: baseX - perpX * halfWidth, y: baseY - perpY * halfWidth },
      { x: baseX - perpX * arrowWidth, y: baseY - perpY * arrowWidth },
      { x: end.x, y: end.y },
      { x: baseX + perpX * arrowWidth, y: baseY + perpY * arrowWidth },
      { x: baseX + perpX * halfWidth, y: baseY + perpY * halfWidth },
    ];
    const minX = Math.min(...local.map((point) => point.x));
    const minY = Math.min(...local.map((point) => point.y));
    const maxX = Math.max(...local.map((point) => point.x));
    const maxY = Math.max(...local.map((point) => point.y));
    const arrowSize = {
      x: Math.max(1, maxX - minX),
      y: Math.max(1, maxY - minY),
    };
    const commands: VectorPathCommand[] = [
      { type: "M", x: local[0].x - minX, y: local[0].y - minY },
      ...local.slice(1).map((point) => ({ type: "L" as const, x: point.x - minX, y: point.y - minY })),
      { type: "Z" },
    ];
    const fillGeometry = [pushCommandsPath(doc, commands)];
    const vectorNetworkBlob = pushNetworkBlob(doc, [commands], true);
    const transform = multiplyTransform(placement.transform, translateTransform(minX, minY));
    doc.message.nodeChanges.push(baseNode(
      {
        ...(fillPaints(stroke ?? "#222222", "#222222")
          ? { fillPaints: fillPaints(stroke ?? "#222222", "#222222") as never }
          : {}),
        fillGeometry,
        strokeGeometry: [],
        vectorData: { vectorNetworkBlob, normalizedSize: arrowSize },
        strokeWeight: 0,
        strokeAlign: "CENTER",
        strokeJoin: "MITER",
      },
      guid,
      name,
      "VECTOR",
      parentGuid,
      position,
      arrowSize,
      transform,
      extras,
    ));
    return;
  }

  if (kind === "path") {
    const points = parsePoints(attributes["data-design-tool-points"]);
    if (!points) return;
    const local = dedupePoints(localizePoints(points, attrBounds));
    if (local.length < 2) return;
    const pathCommands: VectorPathCommand[] = [
      { type: "M", x: local[0].x, y: local[0].y },
      ...local.slice(1).map((point) => ({ type: "L" as const, x: point.x, y: point.y })),
    ];
    const strokeGeometry: { windingRule: "NONZERO"; commandsBlob: number; styleID: number }[] = [];
    const effectiveStrokeWidth = strokeWidth > 0 ? strokeWidth : 2;
    const outline = openStrokeOutline(local, effectiveStrokeWidth / 2);
    if (outline.length >= 3) {
      strokeGeometry.push(pushCommandsPath(doc, closedPathCommands(outline)));
    }
    const vectorNetworkBlob = pushNetworkBlob(doc, [pathCommands], false);
    const st = strokePaints(stroke ?? "#222222", effectiveStrokeWidth);
    doc.message.nodeChanges.push(baseNode(
      {
        fillGeometry: [],
        strokeGeometry,
        vectorData: {
          vectorNetworkBlob,
          normalizedSize: { x: placement.size.x, y: placement.size.y },
        },
        fillPaints: [],
        ...(st.strokePaints ? { strokePaints: st.strokePaints } : {}),
        strokeWeight: st.strokeWeight,
        strokeAlign: "CENTER",
        strokeCap: "ROUND",
        strokeJoin: "ROUND",
      },
      guid,
      name,
      "VECTOR",
      parentGuid,
      position,
      placement.size,
      placement.transform,
      extras,
    ));
    return;
  }

  if (kind === "text") {
    // Figma rejects empty text runs; a single space keeps the layer importable.
    const rawCharacters = inspection?.text ?? "";
    const characters = rawCharacters === "" ? " " : rawCharacters;
    const computed = inspection?.computedStyle ?? {};
    const fontSize = parsePx(computed["font-size"]) ?? 16;
    const lineHeight = textNumberStyle(computed["line-height"], fontSize) ?? { value: 1.5, units: "RAW" as const };
    const letterSpacingRaw = computed["letter-spacing"];
    const letterSpacing = letterSpacingRaw && letterSpacingRaw.trim() !== "normal"
      ? textNumberStyle(letterSpacingRaw, fontSize)
      : undefined;
    const alignMap: Record<string, string> = {
      left: "LEFT", start: "LEFT", center: "CENTER", right: "RIGHT", end: "RIGHT", justify: "JUSTIFIED",
    };
    const textAlign = alignMap[(computed["text-align"] ?? "left").toLowerCase()] ?? "LEFT";
    const fontName = textFontName(computed);
    // Created text elements pad content by `4px 6px`; mirror it so the text
    // lands where it rendered in the canvas.
    const padX = 6;
    const padY = 4;
    const transform = multiplyTransform(placement.transform, translateTransform(padX, padY));
    const size = {
      x: Math.max(1, placement.size.x - padX * 2),
      y: Math.max(1, placement.size.y - padY * 2),
    };
    const colorPaints = fillPaints(computed["color"] ?? fill, "#171717");
    doc.message.nodeChanges.push(baseNode(
      {
        textData: { characters },
        fontName,
        styleIdForText: { guid: DETACH_STYLE_GUID },
        fontSize,
        lineHeight,
        ...(letterSpacing ? { letterSpacing } : {}),
        textAlignHorizontal: textAlign,
        textAlignVertical: "TOP",
        textAutoResize: "HEIGHT",
        ...(colorPaints ? { fillPaints: colorPaints as never } : {}),
        strokeWeight: 0,
        strokeAlign: "OUTSIDE",
        strokeJoin: "MITER",
      },
      guid,
      name,
      "TEXT",
      parentGuid,
      position,
      size,
      transform,
      extras,
    ));
    return;
  }

  // Images and other kinds are not yet represented in the .fig export.
}

/* ------------------------------------------------------------------ */
/* File assembly                                                       */
/* ------------------------------------------------------------------ */

function makeCanvasChange(
  guid: Guid,
  documentGuid: Guid,
  position: string,
  name: string,
  template: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...template,
    guid,
    type: "CANVAS",
    name,
    phase: "CREATED",
    parentIndex: { guid: documentGuid, position },
  };
}

export async function serializeFigmaProject(input: FigmaExportInput): Promise<Uint8Array> {
  const doc = createEmptyFigDoc();
  const page = doc.nodes.find((node) => node.type === "CANVAS" && node.name === "Page 1");
  if (!page) throw new Error("The Figma template has no page canvas");

  const documentNode = (doc.message.nodeChanges as unknown[]).find(
    (entry) => (entry as { type?: string }).type === "DOCUMENT",
  ) as unknown as Record<string, unknown> | undefined;
  if (documentNode && documentNode["documentColorProfile"] === undefined) {
    documentNode["documentColorProfile"] = "SRGB";
  }

  const documentGuid = (documentNode?.["guid"] ?? { sessionID: 0, localID: 0 }) as Guid;
  const firstPageChange = (doc.message.nodeChanges as Record<string, unknown>[]).find(
    (entry) => entry["type"] === "CANVAS" && entry["name"] === "Page 1",
  );

  // One CANVAS per project page. The template's "Page 1" hosts the first
  // page; additional pages get sibling CANVAS nodes whose positions sort
  // between "a" (Page 1) and "b" (the internal canvas).
  const pages = input.pages ?? [];
  const orderedPageIds: string[] = [];
  for (const pageEntity of pages) {
    if (pageEntity && typeof pageEntity.id === "string" && !orderedPageIds.includes(pageEntity.id)) {
      orderedPageIds.push(pageEntity.id);
    }
  }
  for (const frame of input.frames) {
    if (!orderedPageIds.includes(frame.pageId)) orderedPageIds.push(frame.pageId);
  }

  let nextLocalId = 1;
  const allocate = (): Guid => ({ sessionID: 1, localID: nextLocalId++ });

  const canvasTemplate: Record<string, unknown> = firstPageChange ? { ...firstPageChange } : {
    visible: true,
    opacity: 1,
    transform: translateTransform(0, 0),
    backgroundOpacity: 1,
    strokeWeight: 0,
    strokeAlign: "CENTER",
    strokeJoin: "BEVEL",
    backgroundEnabled: true,
  };
  delete canvasTemplate["guid"];
  delete canvasTemplate["parentIndex"];

  const pageGuids = new Map<string, Guid>();
  orderedPageIds.forEach((pageId, index) => {
    const pageEntity = pages.find((entry) => entry.id === pageId);
    if (index === 0) {
      pageGuids.set(pageId, page.guid);
      if (firstPageChange && pageEntity?.name) firstPageChange["name"] = pageEntity.name;
      return;
    }
    const guid = allocate();
    pageGuids.set(pageId, guid);
    doc.message.nodeChanges.push(makeCanvasChange(
      guid,
      documentGuid,
      `a${positionAt(index - 1)}`,
      pageEntity?.name || `Page ${index + 1}`,
      canvasTemplate,
    ) as never);
  });

  const frameGuids = new Map<string, Guid>();

  // Frames stay in document order within each page (that is the canvas
  // stacking order) — id-sorted order would scramble z-position.
  const framesByPage = new Map<string, FrameEntity[]>();
  orderedPageIds.forEach((pageId) => {
    const pageEntity = pages.find((entry) => entry.id === pageId);
    const ordered = pageEntity
      ? pageEntity.frameIds
          .map((id) => input.frames.find((frame) => frame.id === id))
          .filter((frame): frame is FrameEntity => Boolean(frame))
      : [];
    const listed = new Set(ordered.map((frame) => frame.id));
    const remainder = input.frames
      .filter((frame) => frame.pageId === pageId && !listed.has(frame.id))
      .sort((left, right) => left.y - right.y || left.x - right.x);
    framesByPage.set(pageId, [...ordered, ...remainder]);
  });

  let frameIndex = 0;
  for (const pageId of orderedPageIds) {
    const pageGuid = pageGuids.get(pageId);
    if (!pageGuid) continue;
    for (const frame of framesByPage.get(pageId) ?? []) {
      if (!isFiniteNumber(frame.x) || !isFiniteNumber(frame.y) ||
        !isFiniteNumber(frame.width) || !isFiniteNumber(frame.height) ||
        frame.width <= 0 || frame.height <= 0) {
        continue;
      }
      const guid = allocate();
      frameGuids.set(frame.id, guid);
      doc.message.nodeChanges.push({
        guid,
        type: "FRAME",
        name: frame.name,
        phase: "CREATED",
        parentIndex: { guid: pageGuid, position: positionAt(frameIndex) },
        size: { x: frame.width, y: frame.height },
        transform: translateTransform(frame.x, frame.y),
        visible: true,
        opacity: 1,
        blendMode: "PASS_THROUGH",
        cornerRadius: 0,
        rectangleTopLeftCornerRadius: 0,
        rectangleTopRightCornerRadius: 0,
        rectangleBottomLeftCornerRadius: 0,
        rectangleBottomRightCornerRadius: 0,
        strokeWeight: 0,
        strokeAlign: "CENTER",
        strokeJoin: "MITER",
        frameMaskDisabled: false,
        ...(fillPaints(frame.background, "#ffffff")
          ? { fillPaints: fillPaints(frame.background, "#ffffff") as never }
          : {}),
      });
      frameIndex++;
    }
  }

  // Children follow the nodes map's insertion order — the order they were
  // appended to the frame document — which is the rendered z-order.
  const nodesInOrder = Object.values(input.nodes);
  for (const pageId of orderedPageIds) {
    for (const frame of framesByPage.get(pageId) ?? []) {
      const frameGuid = frameGuids.get(frame.id);
      if (!frameGuid) continue;
      let childIndex = 0;
      for (const node of nodesInOrder) {
        if (node.frameId !== frame.id) continue;
        convertShapeNode(
          node,
          input.bridgeTargets[`${frame.id}:${node.id}`],
          allocate(),
          frameGuid,
          positionAt(childIndex),
          doc,
        );
        childIndex++;
      }
    }
  }

  // Real Figma exports always carry these envelope fields; the empty template omits them.
  const message = doc.message as unknown as Record<string, unknown>;
  if (message["sessionID"] === undefined) message["sessionID"] = 0;
  if (message["ackID"] === undefined) message["ackID"] = 0;
  if (!Array.isArray(message["blobs"])) message["blobs"] = [];

  const parts = encodeFigParts(doc);
  const zstd = await loadZstd();
  const messageCompressed = zstd.compress(parts.messageRaw, 3);
  const canvasFig = assembleCanvasFig({
    prelude: parts.prelude,
    version: parts.version,
    schemaCompressed: parts.schemaCompressed,
    messageCompressed,
    passThrough: parts.passThrough,
  });

  const canvasBackground = (firstPageChange?.["backgroundColor"] ?? { r: 1, g: 1, b: 1, a: 1 }) as FigColor;
  const exportedAt = new Date().toISOString();
  return createFigZip({
    canvasFig,
    meta: {
      client_meta: {
        background_color: {
          r: canvasBackground.r,
          g: canvasBackground.g,
          b: canvasBackground.b,
          a: canvasBackground.a ?? 1,
        },
        thumbnail_size: { width: 320, height: 180 },
      },
      file_name: "brainstorm-session",
      developer_related_links: [],
      exported_at: exportedAt,
      version: "1",
    },
    thumbnail: base64ToBytes(THUMBNAIL_PNG_BASE64),
    images: new Map(),
  });
}

interface ZstdSimple {
  compress(input: Uint8Array, level?: number): Uint8Array;
}

let zstdPromise: Promise<ZstdSimple> | null = null;

function loadZstd(): Promise<ZstdSimple> {
  if (!zstdPromise) {
    zstdPromise = new Promise((resolve) => {
      ZstdCodec.run((zstd: { Simple: new () => ZstdSimple }) => {
        resolve(new zstd.Simple());
      });
    });
  }
  return zstdPromise;
}

function base64ToBytes(base64: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of base64) {
    if (character === "=") break;
    const value = alphabet.indexOf(character);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
}
