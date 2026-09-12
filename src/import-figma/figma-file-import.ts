import {
  parseFig,
  resolveGradientGeometry,
  resolveVectorNodePaths,
  transformSvgPathData,
  type FigColor,
  type FigDocument,
  type FigNode,
  type FigPaint,
} from "openfig-core";
import {
  createFrameCommand,
  selectBriefFrameCommand,
  setActiveToolCommand,
  setSelectionCommand,
  switchPageCommand,
} from "../editor/commands";
import type { FrameSeed } from "../editor/model";
import type { EditorStore } from "../editor/store";

// ---------------------------------------------------------------------------
// Figma (.fig) file import.
//
// A .fig file is a ZIP archive; openfig-core decodes it into a node tree of
// DOCUMENT -> CANVAS (pages) -> top-level nodes -> nested children. Mapping:
//
// - each visible CANVAS becomes a page
// - each top-level node on a page becomes a frame backed by its own document
//   (pages may therefore group frames from multiple documents)
// - the node's subtree is rendered into the document as positioned HTML/SVG:
//   primitive shapes use the canvas-created-element convention (svg child +
//   data-design-tool-* attributes) so they stay editable and re-exportable,
//   vectors render their resolved fill/stroke geometry, and text, gradients,
//   images, effects, opacity, blend modes, clipping, and transforms map to
//   the closest CSS equivalent.
//
// Elements carry data-design-tool-space="document" plus bounds/transform
// attributes in document space; the .fig exporter reads those so nested
// imported content round-trips at its authored position.
// ---------------------------------------------------------------------------

export class FigmaImportError extends Error {
  readonly code: "invalid-fig" | "empty-fig";
  constructor(code: "invalid-fig" | "empty-fig", message: string) {
    super(message);
    this.name = "FigmaImportError";
    this.code = code;
  }
}

export interface FigmaImportSummary {
  pageIds: string[];
  frameIds: string[];
  documentIds: string[];
  firstPageId: string | null;
  firstFrameId: string | null;
  firstFrameRect: { x: number; y: number; width: number; height: number } | null;
  elementCount: number;
  warnings: string[];
}

interface Mat {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

const IDENTITY: Mat = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function matMultiply(a: Mat, b: Mat): Mat {
  return {
    m00: a.m00 * b.m00 + a.m01 * b.m10,
    m01: a.m00 * b.m01 + a.m01 * b.m11,
    m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02,
    m10: a.m10 * b.m00 + a.m11 * b.m10,
    m11: a.m10 * b.m01 + a.m11 * b.m11,
    m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12,
  };
}

function matTranslate(x: number, y: number): Mat {
  return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y };
}

function matPoint(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.m00 * x + m.m01 * y + m.m02, y: m.m10 * x + m.m11 * y + m.m12 };
}

function matLinearIsIdentity(m: Mat): boolean {
  return m.m00 === 1 && m.m01 === 0 && m.m10 === 0 && m.m11 === 1;
}

function matCss(m: Mat): string {
  return `matrix(${round(m.m00)}, ${round(m.m10)}, ${round(m.m01)}, ${round(m.m11)}, ${round(m.m02)}, ${round(m.m12)})`;
}

function nodeTransform(node: FigNode): Mat {
  const t = node.transform;
  return t
    ? { m00: t.m00, m01: t.m01, m02: t.m02, m10: t.m10, m11: t.m11, m12: t.m12 }
    : { ...IDENTITY };
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Finite-number-or-fallback for the optional numeric fields on FigNode. */
function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function guidKey(node: FigNode): string {
  return `${node.guid.sessionID}:${node.guid.localID}`;
}

function figColorToCss(color: FigColor | undefined, opacity = 1): string {
  if (!color) return "transparent";
  const r = Math.round(clamp01(color.r) * 255);
  const g = Math.round(clamp01(color.g) * 255);
  const b = Math.round(clamp01(color.b) * 255);
  const a = clamp01((color.a ?? 1) * opacity);
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return a >= 0.9995 ? hex : `rgba(${r}, ${g}, ${b}, ${round(a, 4)})`;
}

function visiblePaints(paints: FigPaint[] | undefined): FigPaint[] {
  return Array.isArray(paints) ? paints.filter((paint) => paint && paint.visible !== false) : [];
}

function firstSolidPaint(paints: FigPaint[] | undefined): string | null {
  for (const paint of visiblePaints(paints)) {
    if (paint.type === "SOLID") return figColorToCss(paint.color, paint.opacity ?? 1);
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[8] === 0x57) return "image/webp";
  return "image/png";
}

interface EmitContext {
  doc: FigDocument;
  idPrefix: string;
  warnings: Set<string>;
  elementCount: number;
  imageCache: Map<string, string | null>;
  gradientSeq: number;
  defs: string[];
}

function resolveImageDataUrl(ctx: EmitContext, hash: Uint8Array | string | undefined): string | null {
  if (hash === undefined || hash === null) return null;
  const hex = typeof hash === "string"
    ? hash
    : Array.from(hash).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (ctx.imageCache.has(hex)) return ctx.imageCache.get(hex) ?? null;
  let url: string | null = null;
  // Zip image entries are stored as images/<hash>[.<ext>]; try the common
  // spellings, then any entry that starts with the hash.
  const candidates = [hex, `${hex}.png`, `${hex}.jpg`, `${hex}.jpeg`, `${hex}.webp`, `${hex}.gif`];
  let bytes = candidates.map((key) => ctx.doc.images.get(key)).find((entry) => entry && entry.length > 0);
  if (!bytes) {
    for (const [name, entry] of ctx.doc.images) {
      if (name === hex || name.startsWith(hex) || name.replace(/\..*$/, "") === hex) {
        bytes = entry;
        break;
      }
    }
  }
  if (bytes && bytes.length > 0) {
    url = `data:${sniffImageMime(bytes)};base64,${bytesToBase64(bytes)}`;
  } else {
    ctx.warnings.add("Some image fills referenced assets missing from the file");
  }
  ctx.imageCache.set(hex, url);
  return url;
}

function gradientStopsCss(paint: FigPaint): string {
  const stops = [...(paint.stops ?? [])].sort((a, b) => a.position - b.position);
  return stops
    .map((stop) => `${figColorToCss(stop.color, paint.opacity ?? 1)} ${round(stop.position * 100, 2)}%`)
    .join(", ");
}

/** CSS background layer for one paint (used for stacking on containers/text). */
function paintToCssLayer(paint: FigPaint, width: number, height: number, ctx: EmitContext): string | null {
  switch (paint.type) {
    case "SOLID": {
      const color = figColorToCss(paint.color, paint.opacity ?? 1);
      return `linear-gradient(${color} 0 0)`;
    }
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR":
    case "GRADIENT_DIAMOND":
      return gradientCss(paint, width, height);
    case "IMAGE": {
      const url = resolveImageDataUrl(ctx, paint.image?.hash ?? paint.imageThumbnail?.hash);
      return url ? `url("${url}") center / cover no-repeat` : null;
    }
    default:
      ctx.warnings.add(`Unsupported fill type: ${paint.type}`);
      return null;
  }
}

function gradientCss(paint: FigPaint, width: number, height: number): string | null {
  const stops = gradientStopsCss(paint);
  if (!stops) return null;
  const type = paint.type === "GRADIENT_LINEAR" ? "linear" : "radial";
  const geometry = resolveGradientGeometry(
    { type, transform: paint.transform ?? { ...IDENTITY } },
    Math.max(0.001, width),
    Math.max(0.001, height),
  );
  if (!geometry) {
    const fallback = paint.stops?.[0] ? figColorToCss(paint.stops[0].color, paint.opacity ?? 1) : null;
    return fallback ? `linear-gradient(${fallback} 0 0)` : null;
  }
  if (geometry.type === "linear") {
    const dx = geometry.end.x - geometry.start.x;
    const dy = geometry.end.y - geometry.start.y;
    const degrees = round((Math.atan2(dx, -dy) * 180) / Math.PI, 2);
    return `linear-gradient(${degrees}deg, ${stops})`;
  }
  if (paint.type === "GRADIENT_ANGULAR" || paint.type === "GRADIENT_DIAMOND") {
    // Closest CSS shape: a conic gradient from the authored start angle.
    const degrees = round(((geometry.angle * 180) / Math.PI + 90 + 360) % 360, 2);
    return `conic-gradient(from ${degrees}deg at ${round(geometry.center.x, 2)}px ${round(geometry.center.y, 2)}px, ${stops})`;
  }
  const cx = round(geometry.center.x, 2);
  const cy = round(geometry.center.y, 2);
  const rx = round(geometry.radiusX, 2);
  const ry = round(geometry.radiusY, 2);
  return `radial-gradient(ellipse ${rx}px ${ry}px at ${cx}px ${cy}px, ${stops})`;
}

function backgroundLayers(paints: FigPaint[], width: number, height: number, ctx: EmitContext): string | null {
  // Figma lists paints top-most first; CSS backgrounds do too.
  const layers = paints
    .map((paint) => paintToCssLayer(paint, width, height, ctx))
    .filter((layer): layer is string => layer !== null);
  return layers.length > 0 ? layers.join(", ") : null;
}

/** fill value for an svg shape child; registers defs for gradient/image paints. */
function svgPaintRef(paint: FigPaint, width: number, height: number, ctx: EmitContext): string | null {
  if (paint.type === "SOLID") return figColorToCss(paint.color, paint.opacity ?? 1);
  if (paint.type === "IMAGE") {
    const url = resolveImageDataUrl(ctx, paint.image?.hash ?? paint.imageThumbnail?.hash);
    if (!url) return null;
    const id = `fig-img-${ctx.gradientSeq++}`;
    const scaleMode = (paint as unknown as { scaleMode?: unknown }).scaleMode;
    const ratio = scaleMode === "FIT" ? "xMidYMid meet" : "xMidYMid slice";
    ctx.defs.push(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${round(width)}" height="${round(height)}">` +
        `<image href="${url}" x="0" y="0" width="${round(width)}" height="${round(height)}" preserveAspectRatio="${ratio}"/>` +
        `</pattern>`,
    );
    return `url(#${id})`;
  }
  if (!paint.type.startsWith("GRADIENT_")) {
    ctx.warnings.add(`Unsupported fill type: ${paint.type}`);
    return null;
  }
  const geometry = resolveGradientGeometry(
    {
      type: paint.type === "GRADIENT_LINEAR" ? "linear" : "radial",
      transform: paint.transform ?? { ...IDENTITY },
    },
    Math.max(0.001, width),
    Math.max(0.001, height),
  );
  if (!geometry) {
    return paint.stops?.[0] ? figColorToCss(paint.stops[0].color, paint.opacity ?? 1) : null;
  }
  const id = `fig-grad-${ctx.gradientSeq++}`;
  const stops = [...(paint.stops ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((stop) => {
      const alpha = clamp01((stop.color?.a ?? 1) * (paint.opacity ?? 1));
      const color = figColorToCss({ ...stop.color, a: 1 }, paint.opacity ?? 1);
      return `<stop offset="${round(stop.position * 100, 2)}%" stop-color="${color}"${alpha < 0.9995 ? ` stop-opacity="${round(alpha, 4)}"` : ""}/>`;
    })
    .join("");
  if (geometry.type === "linear") {
    ctx.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(geometry.start.x)}" y1="${round(geometry.start.y)}" x2="${round(geometry.end.x)}" y2="${round(geometry.end.y)}">${stops}</linearGradient>`,
    );
  } else {
    const rx = Math.max(0.001, geometry.radiusX);
    const scaleY = geometry.radiusY / rx;
    const degrees = (geometry.angle * 180) / Math.PI;
    const cx = round(geometry.center.x);
    const cy = round(geometry.center.y);
    const needsTransform = Math.abs(geometry.radiusY - geometry.radiusX) > 0.01 || Math.abs(degrees) > 0.01;
    const transform = needsTransform
      ? ` gradientTransform="translate(${cx} ${cy}) rotate(${round(degrees)}) scale(1 ${round(scaleY, 4)}) translate(${-cx} ${-cy})"`
      : "";
    ctx.defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${round(rx)}"${transform}>${stops}</radialGradient>`,
    );
  }
  return `url(#${id})`;
}

function effectStyles(node: FigNode): { shadows: string[]; filter: string | null; backdrop: string | null } {
  const shadows: string[] = [];
  let filter: string | null = null;
  let backdrop: string | null = null;
  for (const effect of Array.isArray(node.effects) ? node.effects : []) {
    if (!effect || effect.visible === false) continue;
    const radius = num(effect.radius);
    if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
      const ox = round(num(effect.offset?.x));
      const oy = round(num(effect.offset?.y));
      const spread = round(num(effect.spread));
      const color = figColorToCss(effect.color, num(effect.opacity, 1));
      shadows.push(`${effect.type === "INNER_SHADOW" ? "inset " : ""}${ox}px ${oy}px ${round(radius)}px ${spread}px ${color}`);
    } else if (effect.type === "FOREGROUND_BLUR") {
      filter = `blur(${round(radius)}px)`;
    } else if (effect.type === "BACKGROUND_BLUR") {
      backdrop = `blur(${round(radius)}px)`;
    }
  }
  return { shadows, filter, backdrop };
}

function strokeExtent(node: FigNode): number {
  const weight = num(node.strokeWeight);
  if (weight <= 0 || visiblePaints(node.strokePaints).length === 0) return 0;
  if (node.strokeAlign === "INSIDE") return 0;
  if (node.strokeAlign === "OUTSIDE") return weight;
  return weight / 2;
}

function effectExtent(node: FigNode): { left: number; top: number; right: number; bottom: number } {
  const pad = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const effect of Array.isArray(node.effects) ? node.effects : []) {
    if (!effect || effect.visible === false) continue;
    const radius = num(effect.radius);
    if (effect.type === "DROP_SHADOW") {
      const reach = radius + Math.abs(num(effect.spread));
      pad.left = Math.max(pad.left, -num(effect.offset?.x) + reach);
      pad.right = Math.max(pad.right, num(effect.offset?.x) + reach);
      pad.top = Math.max(pad.top, -num(effect.offset?.y) + reach);
      pad.bottom = Math.max(pad.bottom, num(effect.offset?.y) + reach);
    } else if (effect.type === "FOREGROUND_BLUR") {
      pad.left = Math.max(pad.left, radius);
      pad.top = Math.max(pad.top, radius);
      pad.right = Math.max(pad.right, radius);
      pad.bottom = Math.max(pad.bottom, radius);
    }
  }
  return pad;
}

function cssBlendMode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/_/g, "-");
  const allowed = new Set([
    "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
    "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
  ]);
  return allowed.has(normalized) ? normalized : null;
}

function nodeSize(node: FigNode): { width: number; height: number } {
  return { width: Math.max(0, num(node.size?.x)), height: Math.max(0, num(node.size?.y)) };
}

function isGroupLike(node: FigNode): boolean {
  return node.type === "GROUP" || node.resizeToFit === true;
}

function nodeClips(node: FigNode): boolean {
  if (isGroupLike(node) || node.type === "SECTION") return false;
  const frameTypes = new Set(["FRAME", "INSTANCE", "COMPONENT", "COMPONENT_SET", "SHAPE_WITH_TEXT"]);
  return frameTypes.has(node.type) && node.frameMaskDisabled !== true;
}

function isContainerType(node: FigNode): boolean {
  const types = new Set([
    "FRAME", "SECTION", "GROUP", "INSTANCE", "COMPONENT", "COMPONENT_SET",
    "SHAPE_WITH_TEXT", "STICKY", "TABLE", "WIDGET", "EMBED", "LINK_UNFURL",
    "MEDIA", "HIGHLIGHT", "WASHI_TAPE", "SECTION_OVERLAY", "STAMP", "SHAPE",
  ]);
  return types.has(node.type);
}

function sortedChildren(doc: FigDocument, node: FigNode): FigNode[] {
  const children = doc.childrenMap.get(guidKey(node)) ?? [];
  return [...children].sort((a, b) => {
    const pa = a.parentIndex?.position ?? "";
    const pb = b.parentIndex?.position ?? "";
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function aabbOfMatBox(m: Mat, width: number, height: number, pad = 0): Box {
  const points = [
    matPoint(m, -pad, -pad),
    matPoint(m, width + pad, -pad),
    matPoint(m, width + pad, height + pad),
    matPoint(m, -pad, height + pad),
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(0, Math.max(...xs) - minX), height: Math.max(0, Math.max(...ys) - minY) };
}

/**
 * Canvas-space visual bounds of a node subtree. Clipped containers bound at
 * their own box; unclipped content unions over descendants. Stroke and shadow
 * extents pad each shape so nothing imported is cut by the frame edge.
 */
function subtreeBounds(doc: FigDocument, node: FigNode, parentToCanvas: Mat, depth: number): Box | null {
  if (depth > 64) return null;
  const m = matMultiply(parentToCanvas, nodeTransform(node));
  const { width, height } = nodeSize(node);
  if (node.visible === false) return null;
  let box: Box | null = null;
  if (width > 0 || height > 0) {
    const strokePad = strokeExtent(node);
    const effectPad = effectExtent(node);
    const pad = Math.max(strokePad, effectPad.left, effectPad.top, effectPad.right, effectPad.bottom);
    box = aabbOfMatBox(m, width, height, pad);
  }
  const children = sortedChildren(doc, node);
  if (!nodeClips(node) && children.length > 0) {
    for (const child of children) {
      const childBox = subtreeBounds(doc, child, m, depth + 1);
      if (!childBox) continue;
      if (!box) {
        box = childBox;
      } else {
        const minX = Math.min(box.x, childBox.x);
        const minY = Math.min(box.y, childBox.y);
        box = {
          x: minX,
          y: minY,
          width: Math.max(box.x + box.width, childBox.x + childBox.width) - minX,
          height: Math.max(box.y + box.height, childBox.y + childBox.height) - minY,
        };
      }
    }
  }
  return box;
}

function commonAttrs(ctx: EmitContext, node: FigNode): string {
  const parts = [
    `data-design-element-id="${escapeAttr(ctx.idPrefix)}${escapeAttr(guidKey(node).replace(/[^a-zA-Z0-9_-]/g, "-"))}"`,
    `data-figma-type="${escapeAttr(node.type)}"`,
  ];
  if (node.name) parts.push(`aria-label="${escapeAttr(node.name)}"`);
  if (node.locked === true) parts.push(`data-design-locked="true"`);
  if (node.visible === false) parts.push(`data-figma-hidden="true"`);
  ctx.elementCount += 1;
  return parts.join(" ");
}

function commonStyle(domT: Mat, width: number, height: number, node: FigNode): string[] {
  const styles = [
    `position:absolute`,
    `left:${round(domT.m02)}px`,
    `top:${round(domT.m12)}px`,
    `width:${round(width)}px`,
    `height:${round(height)}px`,
    `box-sizing:border-box`,
  ];
  if (!matLinearIsIdentity(domT)) {
    styles.push(`transform-origin:0 0`, `transform:${matCss({ ...domT, m02: 0, m12: 0 })}`);
  }
  if (typeof node.opacity === "number" && node.opacity < 0.9995) {
    styles.push(`opacity:${round(clamp01(node.opacity), 4)}`);
  }
  const blend = cssBlendMode(node.blendMode);
  if (blend) styles.push(`mix-blend-mode:${blend}`);
  if (node.visible === false) styles.push(`display:none`);
  const effects = effectStyles(node);
  if (effects.filter) styles.push(`filter:${effects.filter}`);
  if (effects.backdrop) styles.push(`backdrop-filter:${effects.backdrop}`);
  return styles;
}

function toolAttrs(kind: string, node: FigNode, localT: Mat, docT: Mat, width: number, height: number, extra: Record<string, string>): string {
  const bounds = { x: round(docT.m02), y: round(docT.m12), width: round(width), height: round(height) };
  const attrs = [
    `data-design-tool-created="true"`,
    `data-design-tool-kind="${kind}"`,
    `data-design-tool-space="document"`,
    `data-design-tool-bounds='${escapeAttr(JSON.stringify(bounds))}'`,
    `data-design-tool-transform="${escapeAttr(matCss(docT))}"`,
    `data-design-tool-local-transform="${escapeAttr(matCss(localT))}"`,
  ];
  for (const [key, value] of Object.entries(extra)) {
    attrs.push(`${key}='${escapeAttr(value)}'`);
  }
  return attrs.join(" ");
}

function emitSvgShape(
  node: FigNode,
  domT: Mat,
  docT: Mat,
  width: number,
  height: number,
  kind: string,
  children: string,
  ctx: EmitContext,
  extraAttrs: Record<string, string>,
): string {
  const styles = commonStyle(domT, width, height, node);
  styles.push("overflow:visible");
  if (node.visible !== false) styles.push("display:block");
  const defs = ctx.defs.splice(0).join("");
  const attrs = `${commonAttrs(ctx, node)} ${toolAttrs(kind, node, domT, docT, width, height, extraAttrs)}`;
  return `<svg ${attrs} viewBox="0 0 ${round(width)} ${round(height)}" style="${styles.join(";")}" xmlns="http://www.w3.org/2000/svg">${defs}${children}</svg>`;
}

function cornerRadii(node: FigNode): [number, number, number, number] {
  const uniform = num(node.cornerRadius);
  const tl = Number.isFinite(node.rectangleTopLeftCornerRadius) ? node.rectangleTopLeftCornerRadius! : uniform;
  const tr = Number.isFinite(node.rectangleTopRightCornerRadius) ? node.rectangleTopRightCornerRadius! : uniform;
  const br = Number.isFinite(node.rectangleBottomRightCornerRadius) ? node.rectangleBottomRightCornerRadius! : uniform;
  const bl = Number.isFinite(node.rectangleBottomLeftCornerRadius) ? node.rectangleBottomLeftCornerRadius! : uniform;
  return [Math.max(0, tl), Math.max(0, tr), Math.max(0, br), Math.max(0, bl)];
}

function roundedRectPath(width: number, height: number, radii: [number, number, number, number]): string {
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, r));
  const cx = width;
  const cy = height;
  const commands: string[] = [
    `M ${round(tl)} 0`,
    `H ${round(cx - tr)}`,
    tr > 0 ? `A ${round(tr)} ${round(tr)} 0 0 1 ${round(cx)} ${round(tr)}` : `L ${round(cx)} ${round(tr)}`,
    `V ${round(cy - br)}`,
    br > 0 ? `A ${round(br)} ${round(br)} 0 0 1 ${round(cx - br)} ${round(cy)}` : `L ${round(cx - br)} ${round(cy)}`,
    `H ${round(bl)}`,
    bl > 0 ? `A ${round(bl)} ${round(bl)} 0 0 1 0 ${round(cy - bl)}` : `L 0 ${round(cy - bl)}`,
    `V ${round(tl)}`,
    tl > 0 ? `A ${round(tl)} ${round(tl)} 0 0 1 ${round(tl)} 0` : `L ${round(tl)} 0`,
    `Z`,
  ];
  return commands.join(" ");
}

function strokeOffsetFor(node: FigNode): number {
  const weight = num(node.strokeWeight);
  if (weight <= 0) return 0;
  if (node.strokeAlign === "OUTSIDE") return -weight / 2;
  if (node.strokeAlign === "CENTER") return 0;
  return weight / 2; // INSIDE
}

function emitRectangle(node: FigNode, domT: Mat, docT: Mat, ctx: EmitContext): string {
  const { width, height } = nodeSize(node);
  const fills = visiblePaints(node.fillPaints);
  const strokes = visiblePaints(node.strokePaints);
  const weight = num(node.strokeWeight);
  const radii = cornerRadii(node);
  const uniformRadius = radii.every((r) => r === radii[0]);
  const offset = strokeOffsetFor(node);
  const sx = offset;
  const sy = offset;
  const sw = Math.max(0, width - 2 * offset);
  const sh = Math.max(0, height - 2 * offset);
  const shrink = Math.max(0, offset);

  const pieces: string[] = [];
  for (const paint of [...fills].reverse()) {
    const fill = svgPaintRef(paint, width, height, ctx);
    if (!fill) continue;
    if (uniformRadius) {
      pieces.push(`<rect x="0" y="0" width="${round(width)}" height="${round(height)}" rx="${round(radii[0])}" fill="${fill}"/>`);
    } else {
      pieces.push(`<path d="${roundedRectPath(width, height, radii)}" fill="${fill}"/>`);
    }
  }
  for (const paint of strokes) {
    const color = svgPaintRef(paint, width, height, ctx);
    if (!color) continue;
    const strokeRadius = Math.max(0, radii[0] - shrink);
    const dash = Array.isArray(node.strokeDashPattern) && node.strokeDashPattern.length > 0
      ? ` stroke-dasharray="${node.strokeDashPattern.map((d) => round(d)).join(",")}"`
      : "";
    if (uniformRadius) {
      pieces.push(
        `<rect x="${round(sx)}" y="${round(sy)}" width="${round(sw)}" height="${round(sh)}" rx="${round(strokeRadius)}" fill="none" stroke="${color}" stroke-width="${round(weight)}"${dash}/>`,
      );
    } else {
      const strokeRadii = radii.map((r) => Math.max(0, r - shrink)) as [number, number, number, number];
      pieces.push(
        `<path d="${roundedRectPath(sw, sh, strokeRadii)}" transform="translate(${round(sx)} ${round(sy)})" fill="none" stroke="${color}" stroke-width="${round(weight)}"${dash}/>`,
      );
    }
  }
  if (pieces.length === 0) {
    pieces.push(`<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="none"/>`);
  }
  return emitSvgShape(node, domT, docT, width, height, "rectangle", pieces.join(""), ctx, {
    "data-design-tool-fill": firstSolidPaint(node.fillPaints) ?? "none",
    "data-design-tool-stroke": firstSolidPaint(node.strokePaints) ?? "none",
    "data-design-tool-stroke-width": String(round(weight)),
    "data-design-tool-radius": String(round(radii[0])),
  });
}

/** Ellipse-arc sweep as cubic segments — parseSVGPathData only round-trips
 * M/L/C/Z, so `A` commands would break re-export. */
function arcCubics(cx: number, cy: number, rx: number, ry: number, start: number, end: number): string[] {
  const sweep = end - start;
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const step = sweep / segments;
  const parts: string[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a0 = start + step * i;
    const a1 = a0 + step;
    const kappa = (4 / 3) * Math.tan(step / 4);
    const x0 = Math.cos(a0);
    const y0 = Math.sin(a0);
    const x1 = Math.cos(a1);
    const y1 = Math.sin(a1);
    parts.push(
      `C ${round(cx + rx * (x0 - kappa * y0))} ${round(cy + ry * (y0 + kappa * x0))} ` +
      `${round(cx + rx * (x1 + kappa * y1))} ${round(cy + ry * (y1 - kappa * x1))} ` +
      `${round(cx + rx * x1)} ${round(cy + ry * y1)}`,
    );
  }
  return parts;
}

function arcToPath(width: number, height: number, arcData: { startingAngle?: number; endingAngle?: number; innerRadius?: number } | undefined): string | null {
  if (!arcData) return null;
  const start = arcData.startingAngle ?? 0;
  const end = arcData.endingAngle ?? Math.PI * 2;
  const sweep = end - start;
  if (Math.abs(sweep) >= Math.PI * 2 - 1e-6 && !(num(arcData.innerRadius) > 0)) return null;
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const inner = Math.max(0, Math.min(1, arcData.innerRadius ?? 0));
  const p0 = { x: cx + rx * Math.cos(start), y: cy + ry * Math.sin(start) };
  const parts = [
    `M ${round(p0.x)} ${round(p0.y)}`,
    ...arcCubics(cx, cy, rx, ry, start, end),
  ];
  if (inner > 0) {
    const irx = rx * inner;
    const iry = ry * inner;
    const i1 = { x: cx + irx * Math.cos(end), y: cy + iry * Math.sin(end) };
    parts.push(`L ${round(i1.x)} ${round(i1.y)}`);
    parts.push(...arcCubics(cx, cy, irx, iry, end, start));
    parts.push("Z");
  } else {
    parts.push(`L ${round(cx)} ${round(cy)}`, "Z");
  }
  return parts.join(" ");
}

function emitEllipse(node: FigNode, domT: Mat, docT: Mat, ctx: EmitContext): string {
  const { width, height } = nodeSize(node);
  const fills = visiblePaints(node.fillPaints);
  const strokes = visiblePaints(node.strokePaints);
  const weight = num(node.strokeWeight);
  const offset = strokeOffsetFor(node);
  const arc = arcToPath(width, height, node.arcData);

  const pieces: string[] = [];
  if (arc === null) {
    const cx = round(width / 2);
    const cy = round(height / 2);
    for (const paint of [...fills].reverse()) {
      const fill = svgPaintRef(paint, width, height, ctx);
      if (!fill) continue;
      pieces.push(`<ellipse cx="${cx}" cy="${cy}" rx="${round(width / 2)}" ry="${round(height / 2)}" fill="${fill}"/>`);
    }
    for (const paint of strokes) {
      const color = svgPaintRef(paint, width, height, ctx);
      if (!color) continue;
      pieces.push(
        `<ellipse cx="${cx}" cy="${cy}" rx="${round(Math.max(0, width / 2 - offset))}" ry="${round(Math.max(0, height / 2 - offset))}" fill="none" stroke="${color}" stroke-width="${round(weight)}"/>`,
      );
    }
    if (pieces.length === 0) {
      pieces.push(`<ellipse cx="${cx}" cy="${cy}" rx="${round(width / 2)}" ry="${round(height / 2)}" fill="none"/>`);
    }
    return emitSvgShape(node, domT, docT, width, height, "ellipse", pieces.join(""), ctx, {
      "data-design-tool-fill": firstSolidPaint(node.fillPaints) ?? "none",
      "data-design-tool-stroke": firstSolidPaint(node.strokePaints) ?? "none",
      "data-design-tool-stroke-width": String(round(weight)),
    });
  }
  const fillD = arc;
  for (const paint of [...fills].reverse()) {
    const fill = svgPaintRef(paint, width, height, ctx);
    if (!fill) continue;
    pieces.push(`<path d="${fillD}" fill="${fill}"/>`);
  }
  for (const paint of strokes) {
    const color = svgPaintRef(paint, width, height, ctx);
    if (!color) continue;
    pieces.push(`<path d="${fillD}" fill="none" stroke="${color}" stroke-width="${round(weight)}"/>`);
  }
  return emitSvgShape(node, domT, docT, width, height, "vector", pieces.join(""), ctx, {
    "data-design-tool-path": fillD,
    "data-design-tool-fill": firstSolidPaint(node.fillPaints) ?? "none",
    "data-design-tool-stroke": firstSolidPaint(node.strokePaints) ?? "none",
    "data-design-tool-stroke-width": String(round(weight)),
  });
}

function emitLine(node: FigNode, domT: Mat, docT: Mat, ctx: EmitContext): string {
  const { width } = nodeSize(node);
  const weight = Math.max(1, num(node.strokeWeight, 1));
  // Box the line into a stroke-weight-tall element so the overlay has a hit
  // target; the node's local origin is the line start point.
  const domBox = matMultiply(domT, matTranslate(0, -weight / 2));
  const docBox = matMultiply(docT, matTranslate(0, -weight / 2));
  const strokes = visiblePaints(node.strokePaints);
  const pieces: string[] = [];
  for (const paint of strokes) {
    const color = svgPaintRef(paint, width, weight, ctx);
    if (!color) continue;
    const cap = node.strokeCap === "ROUND" ? "round" : node.strokeCap === "SQUARE" ? "square" : "butt";
    const dash = Array.isArray(node.strokeDashPattern) && node.strokeDashPattern.length > 0
      ? ` stroke-dasharray="${node.strokeDashPattern.map((d) => round(d)).join(",")}"`
      : "";
    pieces.push(
      `<line x1="0" y1="${round(weight / 2)}" x2="${round(width)}" y2="${round(weight / 2)}" stroke="${color}" stroke-width="${round(weight)}" stroke-linecap="${cap}"${dash}/>`,
    );
  }
  if (pieces.length === 0) {
    pieces.push(`<line x1="0" y1="${round(weight / 2)}" x2="${round(width)}" y2="${round(weight / 2)}" stroke="#000000" stroke-width="${round(weight)}"/>`);
  }
  const start = matPoint(docT, 0, 0);
  const end = matPoint(docT, width, 0);
  const points = [
    { x: round(start.x), y: round(start.y) },
    { x: round(end.x), y: round(end.y) },
  ];
  const bounds = {
    x: Math.min(points[0].x, points[1].x),
    y: Math.min(points[0].y, points[1].y) - weight / 2,
    width: Math.abs(points[1].x - points[0].x),
    height: weight,
  };
  const styles = commonStyle(domBox, width, weight, node);
  styles.push("overflow:visible");
  if (node.visible !== false) styles.push("display:block");
  const defs = ctx.defs.splice(0).join("");
  const attrs = [
    commonAttrs(ctx, node),
    `data-design-tool-created="true"`,
    `data-design-tool-kind="line"`,
    `data-design-tool-space="document"`,
    `data-design-tool-bounds='${escapeAttr(JSON.stringify({ x: round(bounds.x), y: round(bounds.y), width: round(bounds.width), height: round(bounds.height) }))}'`,
    `data-design-tool-points='${escapeAttr(JSON.stringify(points))}'`,
    `data-design-tool-stroke='${escapeAttr(firstSolidPaint(node.strokePaints) ?? "#000000")}'`,
    `data-design-tool-stroke-width="${round(weight)}"`,
    // The exported LINE's transform is the node's own transform (the -sw/2
    // element boxing is a DOM detail), so the document-space attribute keeps
    // docT while the local one mirrors what the DOM actually applies.
    `data-design-tool-transform="${escapeAttr(matCss(docT))}"`,
    `data-design-tool-local-transform="${escapeAttr(matCss(domBox))}"`,
  ];
  return `<svg ${attrs.join(" ")} viewBox="0 0 ${round(width)} ${round(weight)}" style="${styles.join(";")}" xmlns="http://www.w3.org/2000/svg">${defs}${pieces.join("")}</svg>`;
}

function regularPolygonPath(width: number, height: number, node: FigNode): string | null {
  const count = num(node.pointCount) >= 3 ? Math.round(num(node.pointCount)) : 0;
  if (count === 0) return null;
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const points: { x: number; y: number }[] = [];
  if (node.type === "STAR") {
    const inner = Math.max(0.01, Math.min(0.99, num(node.starInnerScale, 0.382)));
    for (let i = 0; i < count * 2; i += 1) {
      const angle = (Math.PI * 2 * i) / (count * 2) - Math.PI / 2;
      const scale = i % 2 === 0 ? 1 : inner;
      points.push({ x: cx + rx * scale * Math.cos(angle), y: cy + ry * scale * Math.sin(angle) });
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
      points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    }
  }
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`).join(" ") + "Z";
}

function emitVector(node: FigNode, domT: Mat, docT: Mat, ctx: EmitContext): string {
  const { width, height } = nodeSize(node);
  const paths = resolveVectorNodePaths(ctx.doc, node);
  if (paths.fill.length === 0 && (node.type === "REGULAR_POLYGON" || node.type === "STAR" || node.type === "POLYGON")) {
    const fallback = regularPolygonPath(width, height, node);
    if (fallback) {
      paths.fill.push({ blobIndex: -1, commandsBlob: new Uint8Array(), svgPath: fallback, styleID: 0, ...(node.fillPaints ? { paints: node.fillPaints } : {}) });
    }
  }
  const normalized = node.vectorData?.normalizedSize;
  const scaleX = normalized && normalized.x > 0 ? width / normalized.x : 1;
  const scaleY = normalized && normalized.y > 0 ? height / normalized.y : 1;
  const scale = (d: string) =>
    Math.abs(scaleX - 1) > 1e-6 || Math.abs(scaleY - 1) > 1e-6
      ? transformSvgPathData(d, { scaleX, scaleY })
      : d;
  const pieces: string[] = [];
  const fillDs: string[] = [];
  const strokeDs: string[] = [];
  for (const path of paths.fill) {
    const d = scale(path.svgPath);
    fillDs.push(d);
    const rule = path.windingRule === "EVENODD" ? ` fill-rule="evenodd"` : "";
    const paints = visiblePaints(path.paints ?? node.fillPaints);
    if (paints.length === 0) {
      pieces.push(`<path d="${escapeAttr(d)}"${rule} fill="none"/>`);
      continue;
    }
    for (const paint of [...paints].reverse()) {
      const fill = svgPaintRef(paint, width, height, ctx);
      if (fill) pieces.push(`<path d="${escapeAttr(d)}"${rule} fill="${fill}"/>`);
    }
  }
  for (const path of paths.stroke) {
    const d = scale(path.svgPath);
    strokeDs.push(d);
    const rule = path.windingRule === "EVENODD" ? ` fill-rule="evenodd"` : "";
    const paints = visiblePaints(path.paints ?? node.strokePaints);
    for (const paint of [...paints].reverse()) {
      const fill = svgPaintRef(paint, width, height, ctx);
      if (fill) pieces.push(`<path d="${escapeAttr(d)}"${rule} fill="${fill}"/>`);
    }
  }
  if (pieces.length === 0) {
    // No vector geometry payload — keep a transparent placeholder so the
    // layer still exists and stays selectable.
    pieces.push(`<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="none"/>`);
  }
  const weight = num(node.strokeWeight);
  const extra: Record<string, string> = {
    "data-design-tool-fill": firstSolidPaint(node.fillPaints) ?? "none",
    "data-design-tool-stroke": firstSolidPaint(node.strokePaints) ?? "none",
    "data-design-tool-stroke-width": String(round(weight)),
  };
  if (fillDs.length > 0) extra["data-design-tool-path"] = fillDs.join(" ");
  if (strokeDs.length > 0) extra["data-design-tool-stroke-path"] = strokeDs.join(" ");
  if (paths.fill[0]?.windingRule) extra["data-design-tool-path-winding"] = paths.fill[0].windingRule;
  return emitSvgShape(node, domT, docT, width, height, "vector", pieces.join(""), ctx, extra);
}

const FONT_WEIGHTS: Record<string, number> = {
  thin: 100, hairline: 100,
  ultralight: 200, extralight: 200,
  light: 300,
  regular: 400, normal: 400, roman: 400, book: 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800,
  black: 900, heavy: 900,
};

function fontFaceOf(node: FigNode): { family: string; weight: number; italic: boolean } {
  const style = (node.fontName?.style ?? "").toLowerCase();
  let weight = 400;
  for (const [name, value] of Object.entries(FONT_WEIGHTS)) {
    if (style.includes(name)) {
      weight = value;
      break;
    }
  }
  const italic = style.includes("italic") || style.includes("oblique");
  return { family: node.fontName?.family ?? "", weight, italic };
}

function emitText(node: FigNode, domT: Mat, docT: Mat, ctx: EmitContext): string {
  const { width, height } = nodeSize(node);
  // The canvas text convention pads the box by 4px 6px and exports subtract
  // it; shift the element so the text origin lands at the authored position.
  const padX = 6;
  const padY = 4;
  const domBox = matMultiply(domT, matTranslate(-padX, -padY));
  const docBox = matMultiply(docT, matTranslate(-padX, -padY));
  const boxW = width + padX * 2;
  const boxH = height + padY * 2;

  const styles = commonStyle(domBox, boxW, boxH, node);
  styles.push(`padding:${padY}px ${padX}px`, "overflow:hidden");
  const face = fontFaceOf(node);
  if (face.family) {
    styles.push(`font-family:"${face.family.replace(/"/g, "")}", ui-sans-serif, system-ui, sans-serif`);
  }
  if (num(node.fontSize) > 0) styles.push(`font-size:${round(num(node.fontSize))}px`);
  styles.push(`font-weight:${face.weight}`);
  if (face.italic) styles.push("font-style:italic");
  const alignMap: Record<string, string> = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };
  if (node.textAlignHorizontal && alignMap[node.textAlignHorizontal]) {
    styles.push(`text-align:${alignMap[node.textAlignHorizontal]}`);
  }
  const vAlign = node.textAlignVertical;
  if (node.visible !== false && (vAlign === "CENTER" || vAlign === "BOTTOM")) {
    styles.push("display:flex", "flex-direction:column", `justify-content:${vAlign === "CENTER" ? "center" : "flex-end"}`);
  }
  const lineHeight = node.lineHeight;
  if (lineHeight && Number.isFinite(lineHeight.value)) {
    if (lineHeight.units === "PIXELS") styles.push(`line-height:${round(lineHeight.value)}px`);
    else if (lineHeight.units === "PERCENT") styles.push(`line-height:${round(lineHeight.value / 100, 4)}`);
    else styles.push(`line-height:${round(lineHeight.value, 4)}`);
  }
  const letterSpacing = node.letterSpacing;
  if (letterSpacing && Number.isFinite(letterSpacing.value) && letterSpacing.value !== 0) {
    if (letterSpacing.units === "PIXELS") styles.push(`letter-spacing:${round(letterSpacing.value)}px`);
    else styles.push(`letter-spacing:${round(letterSpacing.value / 100, 4)}em`);
  }
  styles.push(`white-space:${node.textAutoResize === "WIDTH_AND_HEIGHT" ? "pre" : "pre-wrap"}`);
  const decoration = node.textDecoration;
  if (decoration === "UNDERLINE") styles.push("text-decoration:underline");
  else if (decoration === "STRIKETHROUGH") styles.push("text-decoration:line-through");

  const fills = visiblePaints(node.fillPaints);
  const firstFill = fills[0];
  if (firstFill && firstFill.type === "SOLID") {
    styles.push(`color:${figColorToCss(firstFill.color, firstFill.opacity ?? 1)}`);
  } else if (firstFill) {
    const layer = paintToCssLayer(firstFill, boxW, boxH, ctx);
    if (layer) {
      styles.push(`background:${layer}`, "-webkit-background-clip:text", "background-clip:text", "color:transparent");
    }
  }
  const strokes = visiblePaints(node.strokePaints);
  const strokeWeight = num(node.strokeWeight);
  if (strokes.length > 0 && strokeWeight > 0) {
    const color = firstSolidPaint(strokes);
    if (color) styles.push(`-webkit-text-stroke:${round(strokeWeight)}px ${color}`);
  }

  const characters = typeof node.textData?.characters === "string" ? node.textData.characters : "";
  const bounds = { x: round(docBox.m02), y: round(docBox.m12), width: round(boxW), height: round(boxH) };
  const attrs = [
    commonAttrs(ctx, node),
    `data-design-tool-created="true"`,
    `data-design-tool-kind="text"`,
    `data-design-tool-editable="true"`,
    `data-design-tool-space="document"`,
    `data-design-tool-bounds='${escapeAttr(JSON.stringify(bounds))}'`,
    `data-design-tool-fill='${escapeAttr(firstSolidPaint(node.fillPaints) ?? "#000000")}'`,
    `data-design-tool-transform="${escapeAttr(matCss(docBox))}"`,
    `data-design-tool-local-transform="${escapeAttr(matCss(domBox))}"`,
  ];
  return `<div ${attrs.join(" ")} style="${styles.join(";")}">${escapeHtml(characters)}</div>`;
}

function emitContainer(node: FigNode, domT: Mat, docT: Mat, ctx: EmitContext, depth: number): string {
  const { width, height } = nodeSize(node);
  const styles = commonStyle(domT, width, height, node);
  const fills = visiblePaints(node.fillPaints);
  if (fills.length > 0) {
    const background = backgroundLayers(fills, width, height, ctx);
    if (background) styles.push(`background:${background}`);
  }
  const radii = cornerRadii(node);
  if (radii.some((r) => r > 0)) {
    styles.push(`border-radius:${radii.map((r) => `${round(r)}px`).join(" ")}`);
  }
  const strokes = visiblePaints(node.strokePaints);
  const weight = num(node.strokeWeight);
  const effects = effectStyles(node);
  const shadowList = [...effects.shadows];
  if (strokes.length > 0 && weight > 0) {
    const color = firstSolidPaint(strokes);
    if (color) {
      if (node.strokeAlign === "OUTSIDE") {
        shadowList.push(`0 0 0 ${round(weight)}px ${color}`);
      } else if (node.strokeAlign === "CENTER") {
        shadowList.unshift(`inset 0 0 0 ${round(weight / 2)}px ${color}`, `0 0 0 ${round(weight / 2)}px ${color}`);
      } else {
        shadowList.unshift(`inset 0 0 0 ${round(weight)}px ${color}`);
      }
    }
  }
  if (shadowList.length > 0) styles.push(`box-shadow:${shadowList.join(", ")}`);
  styles.push(`overflow:${nodeClips(node) ? "hidden" : "visible"}`);
  const children = sortedChildren(ctx.doc, node)
    .map((child) => emitNode(child, { ...IDENTITY }, docT, ctx, depth + 1))
    .join("");
  const isShape = node.type === "FRAME" || node.type === "SECTION" || node.type === "SHAPE_WITH_TEXT";
  const extra = isShape
    ? ` ${toolAttrs("rectangle", node, domT, docT, width, height, {
        "data-design-tool-fill": firstSolidPaint(node.fillPaints) ?? "none",
        "data-design-tool-stroke": firstSolidPaint(node.strokePaints) ?? "none",
        "data-design-tool-stroke-width": String(round(weight)),
        "data-design-tool-radius": String(round(radii[0])),
      })}`
    : "";
  return `<div ${commonAttrs(ctx, node)}${extra} style="${styles.join(";")}">${children}</div>`;
}

function emitGeneric(node: FigNode, domT: Mat, docT: Mat, ctx: EmitContext, depth: number): string {
  const { width, height } = nodeSize(node);
  const styles = commonStyle(domT, width, height, node);
  const fills = visiblePaints(node.fillPaints);
  const background = backgroundLayers(fills, width, height, ctx);
  if (background) styles.push(`background:${background}`);
  const children = sortedChildren(ctx.doc, node)
    .map((child) => emitNode(child, { ...IDENTITY }, docT, ctx, depth + 1))
    .join("");
  return `<div ${commonAttrs(ctx, node)} style="${styles.join(";")}">${children}</div>`;
}

function emitNode(node: FigNode, domParentT: Mat, docParentT: Mat, ctx: EmitContext, depth: number): string {
  if (depth > 64 || ctx.elementCount > 4000) {
    ctx.warnings.add("Some deeply nested content was skipped");
    return "";
  }
  const localT = nodeTransform(node);
  const domT = matMultiply(domParentT, localT);
  const docT = matMultiply(docParentT, localT);
  switch (node.type) {
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      return emitRectangle(node, domT, docT, ctx);
    case "ELLIPSE":
      return emitEllipse(node, domT, docT, ctx);
    case "LINE":
      return emitLine(node, domT, docT, ctx);
    case "TEXT":
      return emitText(node, domT, docT, ctx);
    case "VECTOR":
    case "BOOLEAN_OPERATION":
    case "STAR":
    case "REGULAR_POLYGON":
    case "POLYGON":
      return emitVector(node, domT, docT, ctx);
    case "SLICE":
      return "";
    default:
      break;
  }
  if (Array.isArray(node.fillGeometry) && node.fillGeometry.length > 0) {
    return emitVector(node, domT, docT, ctx);
  }
  if (isContainerType(node) || sortedChildren(ctx.doc, node).length > 0) {
    return emitContainer(node, domT, docT, ctx, depth);
  }
  return emitGeneric(node, domT, docT, ctx, depth);
}

function buildSrcDoc(node: FigNode, bounds: Box, ctx: EmitContext): string {
  const docOffset = matTranslate(-bounds.x, -bounds.y);
  const rootHtml = emitNode(node, docOffset, docOffset, ctx, 0);
  const defs = ctx.defs.length > 0
    ? `<svg width="0" height="0" style="position:absolute;overflow:hidden" aria-hidden="true">${ctx.defs.join("")}</svg>`
    : "";
  const fills = visiblePaints(node.fillPaints);
  const bodyBackground = fills.length > 0 ? "" : "background:transparent;";
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;${bodyBackground}}*,*::before,*::after{box-sizing:border-box}</style>`,
    "</head><body>",
    `<div id="fig-root" data-figma-root="true" style="position:absolute;left:0;top:0;width:${round(bounds.width)}px;height:${round(bounds.height)}px">${defs}${rootHtml}</div>`,
    "</body></html>",
  ].join("");
}

function makeIdAllocator(existingIds?: {
  frames?: Record<string, unknown>;
  pages?: Record<string, unknown>;
  documents?: Record<string, unknown>;
}): (base: string) => string {
  const taken = new Set<string>([
    ...Object.keys(existingIds?.frames ?? {}),
    ...Object.keys(existingIds?.pages ?? {}),
    ...Object.keys(existingIds?.documents ?? {}),
  ]);
  return (base: string) => {
    let candidate = base;
    let suffix = 2;
    while (taken.has(candidate)) {
      candidate = `${base}-${suffix++}`;
    }
    taken.add(candidate);
    return candidate;
  };
}

function isRenderableTopLevel(node: FigNode): boolean {
  if (node.type === "SLICE") return false;
  return true;
}

export interface FigmaImportPlan {
  seeds: FrameSeed[];
  firstPageId: string | null;
  firstFrameId: string | null;
  firstFrameRect: { x: number; y: number; width: number; height: number } | null;
  pageIds: string[];
  frameIds: string[];
  documentIds: string[];
  elementCount: number;
  warnings: string[];
}

/**
 * Parse .fig bytes and plan the insertion as frame seeds — one document +
 * frame per top-level node, one page per Figma canvas. Pure: no store
 * mutation, so conversion errors leave the current project untouched.
 */
export function planFigmaImport(bytes: Uint8Array, existingIds?: { frames?: Record<string, unknown>; pages?: Record<string, unknown>; documents?: Record<string, unknown> }): FigmaImportPlan {
  let fig: FigDocument;
  try {
    fig = parseFig(bytes);
  } catch (error) {
    throw new FigmaImportError(
      "invalid-fig",
      error instanceof Error ? error.message : "The file could not be parsed as a .fig document",
    );
  }
  const root = fig.nodes.find((node) => node.type === "DOCUMENT") ?? fig.nodes[0];
  if (!root) {
    throw new FigmaImportError("empty-fig", "The file does not contain a Figma document");
  }
  const canvases = sortedChildren(fig, root).filter((node) => node.type === "CANVAS" && node.visible !== false);
  const fileName = typeof fig.meta?.file_name === "string" ? (fig.meta.file_name as string) : "Imported Figma file";
  const allocId = makeIdAllocator(existingIds);

  const seeds: FrameSeed[] = [];
  const pageIds: string[] = [];
  const frameIds: string[] = [];
  const documentIds: string[] = [];
  const warnings = new Set<string>();
  let elementCount = 0;
  let firstFrameId: string | null = null;
  let firstPageId: string | null = null;
  let firstFrameRect: FigmaImportPlan["firstFrameRect"] = null;

  canvases.forEach((canvas, pageIndex) => {
    const topLevel = sortedChildren(fig, canvas).filter(isRenderableTopLevel);
    if (topLevel.length === 0) return;
    const pageId = allocId(`fig-page-${pageIndex + 1}`);
    pageIds.push(pageId);
    if (!firstPageId) firstPageId = pageId;
    for (const node of topLevel) {
      const bounds = subtreeBounds(fig, node, { ...IDENTITY }, 0);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        warnings.add(`"${node.name || node.type}" was skipped (no visible bounds)`);
        continue;
      }
      const nodeKey = guidKey(node).replace(/[^a-zA-Z0-9_-]/g, "-");
      const ctx: EmitContext = {
        doc: fig,
        idPrefix: `fig-${nodeKey}-`,
        warnings,
        elementCount,
        imageCache: new Map(),
        gradientSeq: 0,
        defs: [],
      };
      const srcDoc = buildSrcDoc(node, bounds, ctx);
      elementCount = ctx.elementCount;
      const documentId = allocId(`fig-doc-${nodeKey}`);
      const frameId = allocId(`fig-frame-${nodeKey}`);
      const background = firstSolidPaint(node.fillPaints)
        ?? (canvas.backgroundColor ? figColorToCss(canvas.backgroundColor) : "#ffffff");
      seeds.push({
        id: frameId,
        name: node.name || node.type,
        documentId,
        documentName: fileName === "Imported Figma file" ? node.name || node.type : `${fileName} — ${node.name || node.type}`,
        pageId,
        pageName: canvas.name || `Page ${pageIndex + 1}`,
        mode: "design",
        x: round(bounds.x),
        y: round(bounds.y),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
        srcDoc,
        background,
      });
      frameIds.push(frameId);
      documentIds.push(documentId);
      if (!firstFrameId) {
        firstFrameId = frameId;
        firstFrameRect = { x: round(bounds.x), y: round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
      }
    }
  });

  if (seeds.length === 0) {
    throw new FigmaImportError("empty-fig", "The file has no importable Figma content");
  }
  return {
    seeds,
    firstPageId,
    firstFrameId,
    firstFrameRect,
    pageIds,
    frameIds,
    documentIds,
    elementCount,
    warnings: [...warnings],
  };
}

/**
 * Import .fig bytes into the store as one undoable transaction. Each top-level
 * Figma node becomes a canvas frame backed by its own generated document;
 * each visible Figma canvas becomes a page. On any parse/convert error the
 * transaction rolls back and the current project is untouched.
 */
export function importFigmaFileIntoStore(store: EditorStore, bytes: Uint8Array): FigmaImportSummary {
  const state = store.getState();
  const plan = planFigmaImport(bytes, {
    frames: state.frames,
    pages: state.pages,
    documents: state.documents,
  });
  store.transact("Import Figma file", () => {
    for (const seed of plan.seeds) {
      store.execute(createFrameCommand(seed), { history: "skip" });
    }
    if (plan.firstPageId) {
      store.execute(switchPageCommand(plan.firstPageId), { history: "skip" });
    }
    store.execute(selectBriefFrameCommand(null), { history: "skip" });
    if (plan.firstFrameId) {
      store.execute(setSelectionCommand({
        frameIds: [plan.firstFrameId],
        nodeIds: [],
        primaryFrameId: plan.firstFrameId,
        primaryNodeId: null,
      }), { history: "skip" });
    }
    store.execute(setActiveToolCommand("select"), { history: "skip" });
  });
  return {
    pageIds: plan.pageIds,
    frameIds: plan.frameIds,
    documentIds: plan.documentIds,
    firstPageId: plan.firstPageId,
    firstFrameId: plan.firstFrameId,
    firstFrameRect: plan.firstFrameRect,
    elementCount: plan.elementCount,
    warnings: plan.warnings,
  };
}
