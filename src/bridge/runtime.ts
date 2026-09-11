import { BRIDGE_PROTOCOL, BRIDGE_PROTOCOL_VERSION, type BridgeSessionIdentity } from "./protocol";

export const BRIDGE_RUNTIME_MARKER = "data-design-tool-iframe-bridge";

export interface BridgeRuntimeConfig extends BridgeSessionIdentity {
  parentOrigin: string;
}

const SAFE_STYLE_PROPERTIES = [
  "align-items",
  "aspect-ratio",
  "backdrop-filter",
  "background",
  "background-color",
  "border-color",
  "border-radius",
  "border-width",
  "box-shadow",
  "box-sizing",
  "color",
  "display",
  "flex-direction",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "gap",
  "height",
  "justify-content",
  "letter-spacing",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "opacity",
  "overflow",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration-line",
  "text-transform",
  "transform",
  "white-space",
  "width",
] as const;

function escapeScriptJson(value: string): string {
  return value
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function serializeRuntimeConfig(config: BridgeRuntimeConfig): string {
  return escapeScriptJson(JSON.stringify(config));
}

/**
 * Returns a self-contained runtime. It deliberately has no imports, fetches,
 * storage access, or same-origin assumptions because it executes in an opaque
 * `sandbox="allow-scripts"` document.
 */
export function createBridgeRuntimeSource(config: BridgeRuntimeConfig): string {
  const serializedConfig = serializeRuntimeConfig(config);
  const serializedSafeProperties = JSON.stringify(SAFE_STYLE_PROPERTIES);

  return `
(() => {
  "use strict";
  const CONFIG = ${serializedConfig};
  const PROTOCOL = ${JSON.stringify(BRIDGE_PROTOCOL)};
  const VERSION = ${BRIDGE_PROTOCOL_VERSION};
  const SAFE_STYLE_PROPERTIES = new Set(${serializedSafeProperties});
  const MAX_NODES = 2000;
  const MAX_DEPTH = 64;
  const MAX_TEXT_LENGTH = 20000;
  const MAX_ATTRIBUTE_LENGTH = 4096;
  const MAX_MARKUP_LENGTH = 2000000;
  let lastHoveredElementId = null;
  let lastSelectedElement = null;
  let activeTextEdit = null;
  let pendingPointerMove = null;
  let pendingPointerMoveFrame = null;

  const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const isSafeString = (value, maxLength, allowEmpty = false) =>
    typeof value === "string" && value.length <= maxLength && (allowEmpty || value.length > 0) && !/[\\u0000-\\u001f\\u007f]/.test(value);
  const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
  const isPoint = (value) => isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
  const isEnvelope = (value) =>
    isRecord(value) &&
    value.protocol === PROTOCOL &&
    value.version === VERSION &&
    value.channel === CONFIG.channel &&
    value.frameId === CONFIG.frameId;

  function post(message) {
    window.parent.postMessage({
      protocol: PROTOCOL,
      version: VERSION,
      channel: CONFIG.channel,
      frameId: CONFIG.frameId,
      ...message,
    }, "*");
  }

  function sendResponse(requestId, response) {
    post({ type: "response", requestId, ...response });
  }

  function sendError(requestId, code, message) {
    sendResponse(requestId, { ok: false, error: { code, message } });
  }

  function sendReady() {
    post({
      type: "ready",
      capabilities: [
        "hover", "select", "pointer-events", "snapshot", "inspect", "set-inline-style", "set-text",
        "create-element", "delete-element", "duplicate-element", "set-shape-radius",
        "set-shape-fill", "set-shape-glass",
      ],
    });
  }

  function encodeId(value) {
    return encodeURIComponent(value);
  }

  function elementPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(current.tagName.toLowerCase() + "[" + index + "]");
      current = current.parentElement;
    }
    return parts.join("/");
  }

  function elementId(element) {
    const stableAttribute = element.getAttribute("data-design-element-id");
    if (stableAttribute && isSafeString(stableAttribute, 256)) {
      return "data:" + encodeId(stableAttribute);
    }
    if (element.id && document.getElementById(element.id) === element) {
      return "id:" + encodeId(element.id);
    }
    return "path:" + elementPath(element);
  }

  /**
   * Resolves the editor-created element an element belongs to. SVG shapes own
   * child geometry (rect, polygon, line), so clicks and hovers on the shape's
   * interior must target the created root, not the child path element.
   */
  function createdRoot(element) {
    let current = element;
    while (current && current.nodeType === 1) {
      if (current.getAttribute && current.getAttribute("data-design-tool-created") === "true") return current;
      current = current.parentElement;
    }
    return null;
  }

  function localBounds(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Number.isFinite(rect.x) ? rect.x : 0,
      y: Number.isFinite(rect.y) ? rect.y : 0,
      width: Number.isFinite(rect.width) && rect.width >= 0 ? rect.width : 0,
      height: Number.isFinite(rect.height) && rect.height >= 0 ? rect.height : 0,
    };
  }

  function textPreview(element) {
    return (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 512);
  }

  function describe(element, snapToCreatedRoot = true) {
    if (!(element instanceof Element)) return null;
    if (snapToCreatedRoot) {
      const created = createdRoot(element);
      if (created) element = created;
    }
    const role = element.getAttribute("role");
    const ariaLabel = element.getAttribute("aria-label");
    const name = ariaLabel || element.getAttribute("name") || textPreview(element) || element.tagName.toLowerCase();
    return {
      elementId: elementId(element),
      tagName: element.tagName.toLowerCase(),
      path: elementPath(element),
      name,
      role,
      bounds: localBounds(element),
      locked: element.getAttribute("data-design-locked") === "true",
    };
  }

  function findElement(targetId) {
    if (!isSafeString(targetId, 512)) return null;
    const elements = document.querySelectorAll("*");
    for (const element of elements) {
      if (elementId(element) === targetId) return element;
    }
    return null;
  }

  function safeColor(value, fallback) {
    if (!isSafeString(value, 4096, true) || /[;]|url\\s*\\(|expression\\s*\\(|javascript\\s*:|@import|-moz-binding/i.test(value)) return fallback;
    if (window.CSS && typeof window.CSS.supports === "function" && value && !window.CSS.supports("color", value)) return fallback;
    return value || fallback;
  }

  function safeDataImage(value) {
    return isSafeString(value, 16000000, true) && /^data:image\\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(value);
  }

  function safeBounds(bounds) {
    return isRecord(bounds) && isFiniteNumber(bounds.x) && isFiniteNumber(bounds.y) &&
      isFiniteNumber(bounds.width) && isFiniteNumber(bounds.height) &&
      bounds.x >= 0 && bounds.y >= 0 && bounds.width >= 1 && bounds.height >= 1 &&
      bounds.x <= 100000 && bounds.y <= 100000 && bounds.width <= 100000 && bounds.height <= 100000;
  }

  function safePoints(points) {
    return Array.isArray(points) && points.length >= 2 && points.length <= 256 && points.every((point) =>
      isPoint(point) && point.x >= -100000 && point.x <= 100000 && point.y >= -100000 && point.y <= 100000);
  }

  function styleCreatedElement(element, bounds) {
    element.style.position = "fixed";
    element.style.left = bounds.x + "px";
    element.style.top = bounds.y + "px";
    element.style.width = bounds.width + "px";
    element.style.height = bounds.height + "px";
    element.style.boxSizing = "border-box";
    element.style.zIndex = "10";
  }

  function normalizePoints(points, bounds) {
    const source = points || [];
    return source.map((point) => ({
      x: point.x - bounds.x,
      y: point.y - bounds.y,
    }));
  }

  function svgPointString(points) {
    return points.map((point) => point.x + "," + point.y).join(" ");
  }

  function createSvgChild(svg, kind, points, bounds, fill, stroke, strokeWidth, radius) {
    const ns = "http://www.w3.org/2000/svg";
    const normalized = points || [];
    const inset = Math.max(0, strokeWidth / 2);
    let child;
    if (kind === "rectangle") {
      child = document.createElementNS(ns, "rect");
      child.setAttribute("x", String(inset));
      child.setAttribute("y", String(inset));
      child.setAttribute("width", String(Math.max(1, bounds.width - strokeWidth)));
      child.setAttribute("height", String(Math.max(1, bounds.height - strokeWidth)));
      if (radius > 0) {
        child.setAttribute("rx", String(radius));
        child.setAttribute("ry", String(radius));
      }
    } else if (kind === "ellipse") {
      child = document.createElementNS(ns, "ellipse");
      child.setAttribute("cx", String(bounds.width / 2));
      child.setAttribute("cy", String(bounds.height / 2));
      child.setAttribute("rx", String(Math.max(0.5, bounds.width / 2 - inset)));
      child.setAttribute("ry", String(Math.max(0.5, bounds.height / 2 - inset)));
    } else if (kind === "line" || kind === "arrow") {
      child = document.createElementNS(ns, "line");
      const first = normalized[0] || { x: 0, y: 0 };
      const last = normalized[normalized.length - 1] || first;
      child.setAttribute("x1", String(first.x));
      child.setAttribute("y1", String(first.y));
      child.setAttribute("x2", String(last.x));
      child.setAttribute("y2", String(last.y));
      child.setAttribute("stroke-linecap", "round");
      if (kind === "arrow") {
        child.setAttribute("marker-end", "url(#design-tool-arrowhead)");
      }
    } else if (kind === "path") {
      child = document.createElementNS(ns, "polyline");
      child.setAttribute("points", svgPointString(normalized));
      child.setAttribute("fill", "none");
      child.setAttribute("stroke-linejoin", "round");
      child.setAttribute("stroke-linecap", "round");
    } else {
      child = document.createElementNS(ns, "polygon");
      child.setAttribute("points", svgPointString(normalized));
      child.setAttribute("stroke-linejoin", "round");
      child.setAttribute("stroke-linecap", "round");
    }
    child.setAttribute("fill", kind === "rectangle" || kind === "ellipse" || kind === "polygon" || kind === "star"
      ? (fill || "#d9d9d9")
      : "none");
    child.setAttribute("stroke", stroke || "#222222");
    child.setAttribute("stroke-width", String(strokeWidth || 2));
    // Outline scales with the shape (Apple-like). Previously non-scaling-stroke kept
    // the border hairline on resize, which felt disconnected when the shape grew.
    svg.appendChild(child);
  }

  function applyShapeRadius(element, radius) {
    const rect = element && element.getAttribute("data-design-tool-created") === "true"
      ? element.querySelector("rect")
      : null;
    if (!rect) return false;
    if (radius > 0) {
      rect.setAttribute("rx", String(radius));
      rect.setAttribute("ry", String(radius));
    } else {
      rect.removeAttribute("rx");
      rect.removeAttribute("ry");
    }
    element.setAttribute("data-design-tool-radius", String(radius));
    return true;
  }

  const GLASS_VECTOR_KINDS = ["rectangle", "ellipse", "line", "arrow", "polygon", "star", "path"];

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function parseColorChannels(value) {
    if (!value) return null;
    const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (hex) {
      const d = hex[1];
      return {
        r: parseInt(d.slice(0, 2), 16),
        g: parseInt(d.slice(2, 4), 16),
        b: parseInt(d.slice(4, 6), 16),
      };
    }
    const rgb = /^rgba?\\(\\s*(\\d+)[\\s,]+(\\d+)[\\s,]+(\\d+)(?:[\\s,/]+[\\d.]+)?\\s*\\)$/i.exec(value.trim());
    if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
    return null;
  }

  function mixChannels(a, b, t) {
    return {
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t),
    };
  }

  function rgba(color, alpha) {
    return "rgba(" + color.r + ", " + color.g + ", " + color.b + ", " + alpha + ")";
  }

  /** Legacy gradient stops — kept for spec parity; liquid glass uses backdrop-filter. */
  function glassGradientStops(base, level) {
    const t = clamp01(level / 100);
    const aBase = 0.32 + 0.43 * t;
    const white = { r: 255, g: 255, b: 255 };
    const sheen = mixChannels(mixChannels(base, white, 0.6), white, 0.25);
    const shade = { r: Math.round(base.r * 0.95), g: Math.round(base.g * 0.95), b: Math.round(base.b * 0.95) };
    return [
      { color: sheen, alpha: Math.min(0.92, aBase + 0.18) },
      { color: base, alpha: Math.round(aBase * 0.72 * 100) / 100 },
      { color: shade, alpha: Math.round(aBase * 0.9 * 100) / 100 },
    ];
  }

  // ── Liquid Glass helpers (Apple iOS 26) ──────────────────────────────────
  function glassBlur(level) {
    const t = clamp01(level / 100);
    return Math.round(6 + 18 * t);
  }
  function glassSaturate(level) {
    const t = clamp01(level / 100);
    return Math.round(140 + 60 * t);
  }
  function glassBrightness(level) {
    const t = clamp01(level / 100);
    return Math.round((1.02 + 0.12 * t) * 100) / 100;
  }
  function glassTintAlpha(level) {
    const t = clamp01(level / 100);
    return Math.round((0.08 + 0.16 * t) * 100) / 100;
  }
  function glassBackdropFilter(level) {
    return "blur(" + glassBlur(level) + "px) saturate(" + glassSaturate(level) + "%) brightness(" + glassBrightness(level) + ")";
  }
  function glassDisplacementScale(level) {
    const t = clamp01(level / 100);
    return Math.round(4 + 26 * t);
  }
  function glassTintBackground(base, level) {
    const t = clamp01(level / 100);
    const sheenTop = Math.min(0.62, 0.38 + 0.18 * t);
    const sheenMid = Math.min(0.22, 0.08 + 0.1 * t);
    const sheen = "linear-gradient(135deg, rgba(255, 255, 255, " + sheenTop + ") 0%, rgba(255, 255, 255, " + sheenMid + ") 26%, rgba(255, 255, 255, 0) 58%)";
    if (!base) return sheen;
    const alpha = glassTintAlpha(level);
    const tint = rgba(base, alpha);
    return sheen + ", " + tint;
  }

  const GLASS_LIQUID_RIM = "inset 0 1px 1px rgba(255, 255, 255, 0.65), inset 0 -1px 1px rgba(255, 255, 255, 0.32), inset 1px 0 1px rgba(255, 255, 255, 0.22), inset -1px 0 1px rgba(255, 255, 255, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.18)";
  const GLASS_LIQUID_DROP = "0 8px 32px rgba(0, 0, 0, 0.22), 0 2px 8px rgba(0, 0, 0, 0.14)";
  const GLASS_LIQUID_SHADOW = GLASS_LIQUID_RIM + ", " + GLASS_LIQUID_DROP;
  // Keep legacy name for any external read; now points at liquid shadow
  const GLASS_RIM_SHADOW = GLASS_LIQUID_SHADOW;

  // Refraction displacement map helpers ─────────────────────────────────────
  function ensureLiquidFilterContainer() {
    let svg = document.getElementById("design-tool-liquid-filters");
    if (svg) return svg;
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "design-tool-liquid-filters");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    svg.style.overflow = "hidden";
    svg.style.pointerEvents = "none";
    document.body.appendChild(svg);
    return svg;
  }

  function liquidFilterId(rawId) {
    return "design-tool-liquid-" + String(rawId).replace(/[^a-zA-Z0-9_-]/g, "");
  }

  function removeLiquidFilter(element) {
    try {
      const rawId = element.getAttribute("data-design-element-id") || element.id || "shape";
      const ids = [liquidFilterId(rawId), liquidFilterId(rawId + "-surface")];
      const container = document.getElementById("design-tool-liquid-filters");
      ids.forEach(function(fid) {
        let existing = null;
        try {
          existing = container ? container.querySelector("filter[id='" + fid + "']") : null;
        } catch {}
        if (!existing && container && typeof CSS !== "undefined" && CSS.escape) {
          try { existing = container.querySelector("#" + CSS.escape(fid)); } catch {}
        }
        if (existing && existing.parentElement) existing.parentElement.remove();
        const localFilter = element.querySelector("filter[id='" + fid + "']");
        if (localFilter) localFilter.remove();
      });
      // Also scrub any inline gradient that may have been left from legacy path
      const gradId = "design-tool-glass-" + String(rawId).replace(/[^a-zA-Z0-9_-]/g, "");
      const defs = element.querySelector("defs");
      if (defs) {
        const grad = defs.querySelector("linearGradient[id='" + gradId + "']");
        if (grad) grad.remove();
        if (!defs.firstChild) defs.remove();
      }
    } catch {}
  }

  function buildLiquidDisplacementDataUrl(width, height, level, radius, kind) {
    const w = Math.round(width);
    const h = Math.round(height);
    if (w < 8 || h < 8 || w > 2000 || h > 2000) return null;
    // Cap canvas for perf — large elements still get smooth refraction via CSS blur
    const maxDim = 512;
    let cw = w;
    let ch = h;
    let scaleFactor = 1;
    if (cw > maxDim || ch > maxDim) {
      scaleFactor = Math.min(maxDim / cw, maxDim / ch);
      cw = Math.max(1, Math.round(cw * scaleFactor));
      ch = Math.max(1, Math.round(ch * scaleFactor));
    }
    const t = clamp01(level / 100);
    const bezel = Math.min(28, Math.min(cw, ch) * 0.22);
    const maxDisp = 4 + 26 * t;
    // If bezel too thin, skip refraction
    if (bezel < 2) return null;

    let canvas;
    try {
      canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
    } catch { return null; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      const imageData = ctx.createImageData(cw, ch);
      const data = imageData.data;
      const cx = cw / 2;
      const cy = ch / 2;
      const rx = cw / 2;
      const ry = ch / 2;
      const rad = Math.min(radius || 0, Math.min(cw, ch) / 2);
      const isEllipse = kind === "ellipse";

      // SDF helpers for rounded rect — negative inside
      function sdRoundRect(px, py) {
        const qx = Math.abs(px - cx) - (rx - rad);
        const qy = Math.abs(py - cy) - (ry - rad);
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const inside = Math.min(Math.max(qx, qy), 0);
        return outside + inside - rad;
      }

      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const idx = (y * cw + x) * 4;
          let dist;
          let nx = 0;
          let ny = 0;

          if (isEllipse) {
            // Ellipse signed distance approximation
            const dx = (x - cx) / (rx || 1);
            const dy = (y - cy) / (ry || 1);
            const dNorm = Math.hypot(dx, dy);
            if (dNorm > 1) {
              // Outside ellipse → neutral (no displacement, masked by clipping anyway)
              data[idx] = 128; data[idx+1] = 128; data[idx+2] = 128; data[idx+3] = 255;
              continue;
            }
            // Distance to edge along radial approx
            dist = (1 - dNorm) * Math.min(rx, ry);
            if (dist > bezel) {
              data[idx] = 128; data[idx+1] = 128; data[idx+2] = 128; data[idx+3] = 255;
              continue;
            }
            if (dNorm < 0.001) {
              nx = 0; ny = 0;
            } else {
              // Ellipse normal (anisotropic) : (cosTheta/rx, sinTheta/ry) normalized
              // Theta from scaled coords
              const theta = Math.atan2(dy, dx);
              const cosT = Math.cos(theta);
              const sinT = Math.sin(theta);
              const nxx = cosT / (rx || 1);
              const nyy = sinT / (ry || 1);
              const len = Math.hypot(nxx, nyy) || 1;
              nx = nxx / len;
              ny = nyy / len;
            }
          } else {
            // Rectangle (with optional rounded corners) — use SDF
            const dSigned = rad > 0 ? sdRoundRect(x + 0.5, y + 0.5) : Math.min(Math.min(x, cw - 1 - x), Math.min(y, ch - 1 - y)) * -1;
            // Convert signed distance to interior distance to edge (positive inside, 0 at edge)
            // dSigned is negative inside, 0 at border, positive outside.
            // We want dist = -dSigned when inside, but only when inside.
            if (dSigned > 0) {
              // Outside rounded rect (corner cutout) → neutral
              data[idx] = 128; data[idx+1] = 128; data[idx+2] = 128; data[idx+3] = 255;
              continue;
            }
            dist = -dSigned;
            if (dist > bezel) {
              data[idx] = 128; data[idx+1] = 128; data[idx+2] = 128; data[idx+3] = 255;
              continue;
            }
            // Edge normal: closest edge perpendicular
            // For rounded rect, near straight edges the normal is axis-aligned; near corners it's diagonal from corner center.
            // Approximate via finite differences on SDF for accuracy, but cheap axis fallback is sufficient for most pixels.
            // Use SDF gradient approximated by sampling neighbor SDFs
            const eps = 0.5;
            const d0 = dSigned;
            const dX = rad > 0 ? (sdRoundRect(x + 0.5 + eps, y + 0.5) - d0) : 0;
            const dY = rad > 0 ? (sdRoundRect(x + 0.5, y + 0.5 + eps) - d0) : 0;
            if (rad > 0 && (Math.abs(dX) > 0.001 || Math.abs(dY) > 0.001)) {
              const glen = Math.hypot(dX, dY) || 1;
              // Gradient points outward (outside direction); for interior we want outward normal, so keep as is
              nx = dX / glen;
              ny = dY / glen;
            } else {
              // Fallback axis method
              const left = x;
              const right = cw - 1 - x;
              const top = y;
              const bottom = ch - 1 - y;
              const m = Math.min(left, right, top, bottom);
              if (m === left) { nx = -1; ny = 0; }
              else if (m === right) { nx = 1; ny = 0; }
              else if (m === top) { nx = 0; ny = -1; }
              else { nx = 0; ny = 1; }
              // Corner diagonal: when two distances equal within 1px, blend
              const nearLeft = Math.abs(left - m) < 0.75;
              const nearRight = Math.abs(right - m) < 0.75;
              const nearTop = Math.abs(top - m) < 0.75;
              const nearBottom = Math.abs(bottom - m) < 0.75;
              const cornerX = (nearLeft && nearTop) || (nearLeft && nearBottom) || (nearRight && nearTop) || (nearRight && nearBottom);
              if (cornerX) {
                // Diagonal outward
                if (nearLeft && nearTop) { nx = -0.707; ny = -0.707; }
                else if (nearRight && nearTop) { nx = 0.707; ny = -0.707; }
                else if (nearLeft && nearBottom) { nx = -0.707; ny = 0.707; }
                else if (nearRight && nearBottom) { nx = 0.707; ny = 0.707; }
              }
            }
          }

          // Profile: convex bevel — steep at edge, calm inside.  Use circular arc derivative.
          const u = dist / bezel; // 0 at edge, 1 at bezel inner limit
          const v = 1 - u; // 1 at edge, 0 inside
          // Circular-arc slope: derivative of sqrt(1-(1-v)^2) style gives pronounced edge
          const cl = Math.max(0.001, Math.min(0.999, v));
          const slope = (1 - cl) / Math.sqrt(Math.max(0.001, 1 - (1 - cl) * (1 - cl)));
          // Combine linear falloff with slope for natural edge emphasis
          const falloff = Math.pow(v, 0.65);
          const magNorm = Math.min(1, falloff * (0.35 + 0.85 * Math.min(1, slope * 1.2)));
          // Apply gentle S-curve so center is truly calm
          const curved = magNorm * magNorm * (3 - 2 * magNorm);

          const dispX = nx * curved;
          const dispY = ny * curved;

          // Map normalized -1..1 to 0..255 with 128 as neutral
          const r = Math.max(0, Math.min(255, Math.round(128 + dispX * 127)));
          const g = Math.max(0, Math.min(255, Math.round(128 + dispY * 127)));
          data[idx] = r;
          data[idx+1] = g;
          data[idx+2] = 128;
          data[idx+3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      // If we downscaled, produce URL at native size by drawing scaled canvas to target size?
      // Keep as is — filter will stretch via feImage width/height.
      if (scaleFactor !== 1) {
        // Scale back to native size by drawing to temp canvas at native dims
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const octx = out.getContext("2d");
        if (octx) {
          octx.imageSmoothingEnabled = true;
          octx.drawImage(canvas, 0, 0, w, h);
          return out.toDataURL("image/png");
        }
      }
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  function supportsBackdropFilterUrl() {
    try {
      return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("backdrop-filter", "url(#test)");
    } catch { return false; }
  }

  let backdropUrlSupported = null;
  function isBackdropUrlSupported() {
    if (backdropUrlSupported !== null) return backdropUrlSupported;
    backdropUrlSupported = supportsBackdropFilterUrl();
    return backdropUrlSupported;
  }

  function shapeGeometryChild(element) {
    return element.querySelector("rect,ellipse,circle,line,polyline,polygon,path");
  }

  function rememberOriginalFill(element, child) {
    if (!element.hasAttribute("data-design-tool-original-fill")) {
      element.setAttribute("data-design-tool-original-fill", child.getAttribute("fill") || "#d9d9d9");
    }
  }

  function applyShapeFill(element, color) {
    const child = shapeGeometryChild(element);
    if (!child) throw { code: "shape-fill-not-supported", message: "This shape has no paintable geometry" };
    rememberOriginalFill(element, child);
    child.setAttribute("fill", color);
    element.setAttribute("data-design-tool-fill", color);
  }

  function applyVectorGlass(element, level) {
    const child = shapeGeometryChild(element);
    if (!child) throw { code: "shape-glass-not-supported", message: "This shape has no paintable geometry" };
    // Ensure outline scales with the shape (remove legacy non-scaling-stroke)
    if (child.getAttribute("vector-effect") === "non-scaling-stroke") child.removeAttribute("vector-effect");
    if (level === null || level <= 0) {
      const original = element.getAttribute("data-design-tool-original-fill");
      if (original) child.setAttribute("fill", original);
      else child.setAttribute("fill", element.getAttribute("data-design-tool-fill") || "#d9d9d9");
      // Scrub liquid glass styles and filters
      removeLiquidFilter(element);
      element.style.removeProperty("backdrop-filter");
      try { element.style.removeProperty("-webkit-backdrop-filter"); } catch {}
      element.style.removeProperty("background");
      element.style.removeProperty("box-shadow");
      element.style.removeProperty("border-radius");
      element.style.removeProperty("overflow");
      element.style.removeProperty("clip-path");
      element.style.removeProperty("isolation");
      element.style.removeProperty("border");
      // Restore default overflow for SVG shapes
      element.style.overflow = "visible";
      // Legacy gradient cleanup (arrow head marker must survive)
      const rawId = element.getAttribute("data-design-element-id") || element.id || "shape";
      const gradientId = "design-tool-glass-" + String(rawId).replace(/[^a-zA-Z0-9_-]/g, "");
      const gradient = element.querySelector("linearGradient[id='" + gradientId + "']");
      if (gradient) gradient.remove();
      const defs = element.querySelector("defs");
      if (defs && !defs.firstChild) defs.remove();
      element.removeAttribute("data-design-tool-glass");
      return;
    }
    rememberOriginalFill(element, child);
    const fillAttr = child.getAttribute("fill") || element.getAttribute("data-design-tool-fill") || "";
    const isTransparentFill = fillAttr.trim().toLowerCase() === "transparent";
    const base = isTransparentFill ? null : (parseColorChannels(fillAttr) ||
      parseColorChannels(element.getAttribute("data-design-tool-fill")) || { r: 217, g: 217, b: 217 });
    const rawId = element.getAttribute("data-design-element-id") || element.id || "shape";
    const kind = element.getAttribute("data-design-tool-kind") || "rectangle";
    let bounds = null;
    try { bounds = JSON.parse(element.getAttribute("data-design-tool-bounds") || "null"); } catch { bounds = null; }
    const w = (bounds && bounds.width) ? bounds.width : (element.getBoundingClientRect ? element.getBoundingClientRect().width : 120) || 120;
    const h = (bounds && bounds.height) ? bounds.height : (element.getBoundingClientRect ? element.getBoundingClientRect().height : 80) || 80;
    const radiusAttr = Number(element.getAttribute("data-design-tool-radius") || 0);
    const radius = Math.max(0, Math.min(64, radiusAttr));

    // Build liquid visual — backdrop blur + tinted sheen + rim
    const bfBase = glassBackdropFilter(level);
    const bg = glassTintBackground(base, level);
    const shadow = GLASS_LIQUID_SHADOW;

    // Try to add edge refraction via SVG displacement (Chromium only, rectangle/ellipse)
    let backdropValue = bfBase;
    let hadRefraction = false;
    if ((kind === "rectangle" || kind === "ellipse") && isBackdropUrlSupported()) {
      try {
        const dataUrl = buildLiquidDisplacementDataUrl(w, h, level, radius, kind);
        if (dataUrl) {
          const fid = liquidFilterId(rawId);
          let container = ensureLiquidFilterContainer();
          let filter = container.querySelector("filter[id='" + fid + "']");
          if (!filter && typeof CSS !== "undefined" && CSS.escape) { try { filter = container.querySelector("#" + CSS.escape(fid)); } catch {} }
          if (!filter) {
            filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
            filter.setAttribute("id", fid);
            filter.setAttribute("x", "0");
            filter.setAttribute("y", "0");
            filter.setAttribute("width", "100%");
            filter.setAttribute("height", "100%");
            filter.setAttribute("color-interpolation-filters", "sRGB");
            container.appendChild(filter);
          } else {
            while (filter.firstChild) filter.removeChild(filter.firstChild);
          }
          const scale = glassDisplacementScale(level);
          const feImage = document.createElementNS("http://www.w3.org/2000/svg", "feImage");
          feImage.setAttribute("href", dataUrl);
          feImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);
          feImage.setAttribute("x", "0");
          feImage.setAttribute("y", "0");
          feImage.setAttribute("width", String(w));
          feImage.setAttribute("height", String(h));
          feImage.setAttribute("preserveAspectRatio", "none");
          feImage.setAttribute("result", "liquidDispMap");
          filter.appendChild(feImage);
          const feDisp = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
          feDisp.setAttribute("in", "SourceGraphic");
          feDisp.setAttribute("in2", "liquidDispMap");
          feDisp.setAttribute("scale", String(scale));
          feDisp.setAttribute("xChannelSelector", "R");
          feDisp.setAttribute("yChannelSelector", "G");
          filter.appendChild(feDisp);
          backdropValue = "url(#" + fid + ") " + bfBase;
          hadRefraction = true;
        }
      } catch {}
    }
    // Fallback: legacy gradient cleanup if refraction not used
    if (!hadRefraction) {
      const gradId = "design-tool-glass-" + String(rawId).replace(/[^a-zA-Z0-9_-]/g, "");
      const existingGrad = element.querySelector("linearGradient[id='" + gradId + "']");
      if (existingGrad) existingGrad.remove();
    }

    // Apply to outer element (the glass pane)
    element.style.setProperty("backdrop-filter", backdropValue, "important");
    try { element.style.setProperty("-webkit-backdrop-filter", backdropValue, "important"); } catch {}
    element.style.setProperty("background", bg, "important");
    element.style.setProperty("box-shadow", shadow, "important");
    element.style.setProperty("isolation", "isolate");
    // Ensure the pane clips to its shape so blur follows rounded corners / ellipse
    if (kind === "rectangle") {
      if (radius > 0) element.style.setProperty("border-radius", radius + "px", "important");
      else element.style.setProperty("border-radius", "0px", "important");
      element.style.setProperty("overflow", "hidden", "important");
      child.setAttribute("fill", "transparent");
      // Keep stroke visible as border — map stroke to CSS border via box-shadow? Preserve SVG stroke for now
      // The inner rect's stroke remains; ensure its fill is transparent so glass tint is visible
    } else if (kind === "ellipse") {
      element.style.setProperty("border-radius", "50%", "important");
      element.style.setProperty("overflow", "hidden", "important");
      child.setAttribute("fill", "transparent");
    } else {
      // Complex path shapes: best-effort — translucent fill tint + rectangular blur
      // For polygon/star we can add clip-path derived from points
      const alpha = glassTintAlpha(level);
      child.setAttribute("fill", rgba(base, alpha));
      element.style.setProperty("overflow", "hidden", "important");
      if ((kind === "polygon" || kind === "star") && bounds) {
        try {
          const ptsAttr = element.getAttribute("data-design-tool-points");
          const pts = ptsAttr ? JSON.parse(ptsAttr) : null;
          if (Array.isArray(pts) && pts.length >= 3) {
            const poly = pts.map(function(p) {
              const px = ((p.x - bounds.x) / (bounds.width || 1)) * 100;
              const py = ((p.y - bounds.y) / (bounds.height || 1)) * 100;
              return px.toFixed(2) + "% " + py.toFixed(2) + "%";
            }).join(", ");
            element.style.setProperty("clip-path", "polygon(" + poly + ")", "important");
          }
        } catch {}
      }
    }

    element.setAttribute("data-design-tool-glass", String(level));
  }

  function applySurfaceGlass(element, level) {
    if (level === null || level <= 0) {
      removeLiquidFilter(element);
      element.style.removeProperty("backdrop-filter");
      try { element.style.removeProperty("-webkit-backdrop-filter"); } catch {}
      element.style.removeProperty("background");
      element.style.removeProperty("box-shadow");
      element.style.removeProperty("border-radius");
      element.style.removeProperty("overflow");
      element.style.removeProperty("clip-path");
      element.style.removeProperty("isolation");
      element.removeAttribute("data-design-tool-glass");
      return;
    }
    const computed = window.getComputedStyle(element);
    const bgColorRaw = element.style.backgroundColor || computed.backgroundColor || "";
    const isTransparentBg = bgColorRaw.trim().toLowerCase() === "transparent" || bgColorRaw.trim() === "rgba(0, 0, 0, 0)";
    const base = isTransparentBg ? null : (parseColorChannels(bgColorRaw) || { r: 255, g: 255, b: 255 });
    const bfBase = glassBackdropFilter(level);
    const bg = glassTintBackground(base, level);
    const shadow = GLASS_LIQUID_SHADOW;

    // Surface (div/text) — compute bounds for displacement size if we want refraction
    let w = 200; let h = 80; let radius = 0;
    try {
      const csRadius = computed.getPropertyValue("border-radius") || "";
      const m = /(\\d+)/.exec(csRadius);
      if (m) radius = Math.max(0, Math.min(48, Number(m[1])));
      const rect = element.getBoundingClientRect();
      if (rect && rect.width > 0) w = rect.width;
      if (rect && rect.height > 0) h = rect.height;
    } catch {}
    let backdropValue = bfBase;
    const rawIdS = element.getAttribute("data-design-element-id") || element.id || "surface";
    if (isBackdropUrlSupported()) {
      try {
        const dataUrl = buildLiquidDisplacementDataUrl(w, h, level, radius, "rectangle");
        if (dataUrl) {
          const fid = liquidFilterId(rawIdS + "-surface");
          let container = ensureLiquidFilterContainer();
          let filter = container.querySelector("filter[id='" + fid + "']");
          if (!filter && typeof CSS !== "undefined" && CSS.escape) { try { filter = container.querySelector("#" + CSS.escape(fid)); } catch {} }
          if (!filter) {
            filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
            filter.setAttribute("id", fid);
            filter.setAttribute("x", "0");
            filter.setAttribute("y", "0");
            filter.setAttribute("width", "100%");
            filter.setAttribute("height", "100%");
            filter.setAttribute("color-interpolation-filters", "sRGB");
            container.appendChild(filter);
          } else {
            while (filter.firstChild) filter.removeChild(filter.firstChild);
          }
          const scale = glassDisplacementScale(level);
          const feImage = document.createElementNS("http://www.w3.org/2000/svg", "feImage");
          feImage.setAttribute("href", dataUrl);
          feImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);
          feImage.setAttribute("x", "0");
          feImage.setAttribute("y", "0");
          feImage.setAttribute("width", String(w));
          feImage.setAttribute("height", String(h));
          feImage.setAttribute("preserveAspectRatio", "none");
          feImage.setAttribute("result", "liquidDispMap");
          filter.appendChild(feImage);
          const feDisp = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
          feDisp.setAttribute("in", "SourceGraphic");
          feDisp.setAttribute("in2", "liquidDispMap");
          feDisp.setAttribute("scale", String(scale));
          feDisp.setAttribute("xChannelSelector", "R");
          feDisp.setAttribute("yChannelSelector", "G");
          filter.appendChild(feDisp);
          backdropValue = "url(#" + fid + ") " + bfBase;
        }
      } catch {}
    }

    element.style.setProperty("backdrop-filter", backdropValue, "important");
    try { element.style.setProperty("-webkit-backdrop-filter", backdropValue, "important"); } catch {}
    element.style.setProperty("background", bg, "important");
    element.style.setProperty("box-shadow", shadow, "important");
    element.style.setProperty("isolation", "isolate");
    // Keep existing radius but ensure clipping so backdrop follows it
    if (radius > 0) element.style.setProperty("overflow", "hidden", "important");
    element.setAttribute("data-design-tool-glass", String(level));
  }

  function createElementFromSpec(spec) {
    if (!isRecord(spec) || !isSafeString(spec.elementId, 512) || !isSafeString(spec.kind, 32) ||
      !safeBounds(spec.bounds) || findElement(spec.elementId)) {
      throw { code: "invalid-create", message: "The requested element definition is invalid" };
    }
    const kind = spec.kind;
    const bounds = spec.bounds;
    const fill = safeColor(spec.fill, "#d9d9d9");
    const stroke = safeColor(spec.stroke, "#222222");
    const strokeWidth = isFiniteNumber(spec.strokeWidth) && spec.strokeWidth >= 0 && spec.strokeWidth <= 100 ? spec.strokeWidth : 2;
    const radius = isFiniteNumber(spec.radius) && spec.radius >= 0 && spec.radius <= 256 ? spec.radius : 0;
    const parent = spec.parentId ? findElement(spec.parentId) : document.body;
    if (!parent || !(parent instanceof Element)) throw { code: "parent-not-found", message: "The requested parent does not exist" };
    let element;
    if (kind === "text") {
      element = document.createElement("div");
      element.textContent = isSafeString(spec.text, MAX_TEXT_LENGTH, true) ? spec.text : "";
      element.style.color = safeColor(spec.fill, "#171717");
      element.style.fontFamily = "Inter, ui-sans-serif, system-ui, -apple-system, \\\"Segoe UI\\\", Roboto, \\\"Helvetica Neue\\\", Arial, sans-serif";
      element.style.fontSize = "16px";
      element.style.fontWeight = "400";
      element.style.lineHeight = "1.5";
      element.style.letterSpacing = "0.01em";
      element.style.whiteSpace = "pre-wrap";
      element.style.overflowWrap = "break-word";
      element.style.textAlign = "left";
      element.style.padding = "4px 6px";
      element.style.position = "fixed";
      element.style.left = bounds.x + "px";
      element.style.top = bounds.y + "px";
      element.style.width = bounds.width + "px";
      element.style.height = "auto";
      element.style.boxSizing = "border-box";
      element.style.zIndex = "10";
      if (spec.editable !== false) {
        element.contentEditable = "true";
        element.setAttribute("spellcheck", "false");
      }
    } else if (kind === "image") {
      if (!safeDataImage(spec.src || "")) throw { code: "unsafe-image", message: "Images must be local data URLs" };
      element = document.createElement("img");
      element.src = spec.src;
      element.alt = isSafeString(spec.alt, 4096, true) ? spec.alt : "";
      element.style.objectFit = "cover";
      element.style.background = "transparent";
      styleCreatedElement(element, bounds);
    } else {
      if (kind !== "rectangle" && kind !== "ellipse" && !safePoints(spec.points)) {
        throw { code: "invalid-path", message: "A vector shape needs at least two safe points" };
      }
      element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      element.setAttribute("viewBox", "0 0 " + bounds.width + " " + bounds.height);
      element.setAttribute("aria-label", kind);
      element.setAttribute("shape-rendering", "geometricPrecision");
      styleCreatedElement(element, bounds);
      element.style.overflow = "visible";
      if (kind === "arrow") {
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", "design-tool-arrowhead");
        marker.setAttribute("markerUnits", "userSpaceOnUse");
        marker.setAttribute("markerWidth", "10");
        marker.setAttribute("markerHeight", "10");
        marker.setAttribute("refX", "9");
        marker.setAttribute("refY", "5");
        marker.setAttribute("orient", "auto");
        const tip = document.createElementNS("http://www.w3.org/2000/svg", "path");
        tip.setAttribute("d", "M1,1 L9,5 L1,9 L3.2,5 Z");
        tip.setAttribute("fill", stroke);
        marker.appendChild(tip);
        defs.appendChild(marker);
        element.appendChild(defs);
      }
      createSvgChild(element, kind, normalizePoints(spec.points || [], bounds), bounds, fill, stroke, strokeWidth, radius);
    }
    element.setAttribute("data-design-element-id", spec.elementId);
    element.setAttribute("data-design-tool-created", "true");
    element.setAttribute("data-design-tool-kind", kind);
    element.setAttribute("data-design-tool-bounds", JSON.stringify(bounds));
    element.setAttribute("data-design-tool-points", JSON.stringify(spec.points || []));
    element.setAttribute("data-design-tool-fill", fill);
    element.setAttribute("data-design-tool-stroke", stroke);
    element.setAttribute("data-design-tool-stroke-width", String(strokeWidth));
    element.setAttribute("data-design-tool-radius", String(radius));
    element.setAttribute("data-design-tool-editable", spec.editable === false ? "false" : "true");
    if (isRecord(spec.style)) {
      for (const [property, value] of Object.entries(spec.style)) {
        if (!SAFE_STYLE_PROPERTIES.has(property) || !isSafeStyleValue(value)) continue;
        element.style.setProperty(property, value, "important");
      }
    }
    const specGlass = isFiniteNumber(spec.glass) ? Math.max(0, Math.min(100, spec.glass)) : 0;
    if (specGlass > 0) {
      if (GLASS_VECTOR_KINDS.indexOf(kind) !== -1) applyVectorGlass(element, specGlass);
      else applySurfaceGlass(element, specGlass);
    }
    parent.appendChild(element);
    return element;
  }

  function createdSnapshot(element) {
    if (!(element instanceof Element) || element.getAttribute("data-design-tool-created") !== "true") return null;
    const boundsValue = element.getAttribute("data-design-tool-bounds");
    let bounds;
    try { bounds = JSON.parse(boundsValue || "null"); } catch { bounds = null; }
    if (!safeBounds(bounds)) return null;
    let points;
    try { points = JSON.parse(element.getAttribute("data-design-tool-points") || "[]"); } catch { points = []; }
    if (!Array.isArray(points) || !points.every(isPoint)) points = [];
    const style = {};
    for (const property of SAFE_STYLE_PROPERTIES) {
      const value = element.style.getPropertyValue(property);
      if (value) style[property] = value.slice(0, MAX_ATTRIBUTE_LENGTH);
    }
    return {
      elementId: elementId(element),
      kind: element.getAttribute("data-design-tool-kind") || "rectangle",
      bounds,
      text: (element.textContent || "").slice(0, MAX_TEXT_LENGTH),
      alt: element instanceof HTMLImageElement ? (element.alt || "").slice(0, 4096) : "",
      src: element instanceof HTMLImageElement ? (element.getAttribute("src") || "").slice(0, 16000000) : "",
      points,
      fill: element.getAttribute("data-design-tool-fill") || "#d9d9d9",
      stroke: element.getAttribute("data-design-tool-stroke") || "#222222",
      strokeWidth: Number(element.getAttribute("data-design-tool-stroke-width") || 2),
      radius: Math.max(0, Math.min(256, Number(element.getAttribute("data-design-tool-radius") || 0))),
      editable: element.getAttribute("data-design-tool-editable") !== "false",
      glass: (() => {
        const raw = element.getAttribute("data-design-tool-glass");
        if (raw === null) return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
      })(),
      style,
    };
  }

  function createCommandFromSnapshot(snapshot) {
    return {
      command: "create-element",
      elementId: snapshot.elementId,
      kind: snapshot.kind,
      bounds: snapshot.bounds,
      text: snapshot.text,
      alt: snapshot.alt,
      src: snapshot.src,
      points: snapshot.points,
      fill: snapshot.fill,
      stroke: snapshot.stroke,
      strokeWidth: snapshot.strokeWidth,
      radius: snapshot.radius,
      editable: snapshot.editable,
      glass: snapshot.glass === undefined ? null : snapshot.glass,
      style: snapshot.style,
    };
  }

  function collectAttributes(element) {
    const attributes = {};
    for (const attribute of Array.from(element.attributes).slice(0, 32)) {
      if (/^on/i.test(attribute.name)) continue;
      attributes[attribute.name] = attribute.value.slice(0, MAX_ATTRIBUTE_LENGTH);
    }
    return attributes;
  }

  const COMPUTED_PROPERTIES = [
    "display", "position", "box-sizing", "aspect-ratio", "white-space", "object-fit", "width", "height", "top", "right", "bottom", "left",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right",
    "padding-bottom", "padding-left", "gap", "color", "background-color", "backdrop-filter", "font-family", "font-size",
    "font-style", "font-weight", "line-height", "letter-spacing", "text-align", "text-decoration-line", "text-transform", "opacity",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
    "border-color", "border-width", "box-shadow", "background", "overflow", "transform", "z-index",
  ];

  function inspect(element) {
    const target = describe(element);
    if (!target) return null;
    const computedStyle = {};
    const inlineStyle = {};
    const computed = window.getComputedStyle(element);
    for (const property of COMPUTED_PROPERTIES) {
      computedStyle[property] = computed.getPropertyValue(property).slice(0, MAX_ATTRIBUTE_LENGTH);
      const inlineValue = element.style.getPropertyValue(property);
      if (inlineValue) inlineStyle[property] = inlineValue.slice(0, MAX_ATTRIBUTE_LENGTH);
    }
    return {
      target,
      text: (element.textContent || "").slice(0, MAX_TEXT_LENGTH),
      attributes: collectAttributes(element),
      inlineStyle,
      computedStyle,
    };
  }

  function snapshot() {
    const nodes = [];
    const rootIds = [];
    let truncated = false;

    function visit(element, parentId, depth) {
      if (nodes.length >= MAX_NODES || depth > MAX_DEPTH) {
        truncated = true;
        return null;
      }
      const target = describe(element, false);
      if (!target) return null;
      const node = { ...target, parentId, childIds: [] };
      nodes.push(node);
      if (parentId === null) rootIds.push(target.elementId);
      for (const child of Array.from(element.children)) {
        const childId = visit(child, target.elementId, depth + 1);
        if (childId) node.childIds.push(childId);
      }
      return target.elementId;
    }

    const root = document.documentElement || document.body;
    if (root) visit(root, null, 0);
    return { rootIds, nodes, truncated };
  }

  function eventPoint(event) {
    return {
      x: isFiniteNumber(event.clientX) ? event.clientX : 0,
      y: isFiniteNumber(event.clientY) ? event.clientY : 0,
    };
  }

  function isEditableTextElement(element) {
    return element instanceof HTMLElement &&
      !["HTML", "BODY", "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "IMG"].includes(element.tagName) &&
      element.children.length === 0 &&
      (element.textContent || "").length <= MAX_TEXT_LENGTH;
  }

  function restoreTextEdit(edit) {
    if (edit.contentEditable === null) edit.element.removeAttribute("contenteditable");
    else edit.element.setAttribute("contenteditable", edit.contentEditable);
    if (edit.spellcheck === null) edit.element.removeAttribute("spellcheck");
    else edit.element.setAttribute("spellcheck", edit.spellcheck);
    edit.element.removeAttribute("data-design-tool-editing");
  }

  function beginTextEdit(element, event) {
    if (!isEditableTextElement(element)) return false;
    if (activeTextEdit && activeTextEdit.element === element) {
      element.focus();
      return true;
    }
    const edit = {
      element,
      originalText: (element.textContent || "").slice(0, MAX_TEXT_LENGTH),
      contentEditable: element.getAttribute("contenteditable"),
      spellcheck: element.getAttribute("spellcheck"),
      pending: null,
    };
    activeTextEdit = edit;
    element.contentEditable = "true";
    element.setAttribute("spellcheck", "false");
    element.setAttribute("data-design-tool-editing", "true");
    element.focus();
    sendEvent("text-edit-start", event || { target: element, clientX: 0, clientY: 0 }, describe(element));
    return true;
  }

  function finishTextEdit(event) {
    if (!activeTextEdit || activeTextEdit.pending) return false;
    activeTextEdit.pending = "commit";
    sendEvent("text-commit", event, describe(activeTextEdit.element));
    return true;
  }

  function cancelTextEdit(event, notify = true) {
    if (!activeTextEdit) return false;
    const edit = activeTextEdit;
    activeTextEdit = null;
    edit.element.textContent = edit.originalText;
    restoreTextEdit(edit);
    if (notify) sendEvent("text-cancel", event || { target: edit.element, clientX: 0, clientY: 0 }, describe(edit.element));
    return true;
  }

  function sendEvent(eventName, event, target) {
    post({
      type: "event",
      event: eventName,
      target,
      point: eventPoint(event),
      ...(typeof event.key === "string" ? { key: event.key.slice(0, 64) } : {}),
      ...(typeof event.target?.textContent === "string" && eventName === "input"
        ? { text: event.target.textContent.slice(0, MAX_TEXT_LENGTH) }
        : {}),
      ...(typeof event.target?.textContent === "string" && (eventName === "text-edit-start" || eventName === "text-commit" || eventName === "text-cancel")
        ? { text: event.target.textContent.slice(0, MAX_TEXT_LENGTH) }
        : {}),
      ...(typeof event.buttons === "number" ? { buttons: event.buttons } : {}),
      ...(typeof event.pointerId === "number" ? { pointerId: event.pointerId } : {}),
      shiftKey: Boolean(event.shiftKey),
      altKey: Boolean(event.altKey),
      metaKey: Boolean(event.metaKey),
      ctrlKey: Boolean(event.ctrlKey),
    });
  }

  function handleHover(event) {
    const target = event.target instanceof Element ? describe(event.target) : null;
    const nextId = target ? target.elementId : null;
    if (nextId === lastHoveredElementId) return;
    lastHoveredElementId = nextId;
    sendEvent("hover", event, target);
  }

  function handlePointerOut(event) {
    if (event.relatedTarget instanceof Node && event.target instanceof Node && event.target.contains(event.relatedTarget)) return;
    if (lastHoveredElementId !== null) {
      lastHoveredElementId = null;
      sendEvent("hover", event, null);
    }
  }

  function dispatchPendingPointerMove() {
    pendingPointerMoveFrame = null;
    const event = pendingPointerMove;
    pendingPointerMove = null;
    if (!event) return;
    const target = event.target instanceof Element ? describe(event.target) : null;
    sendEvent("pointermove", event, target);
    const nextId = target ? target.elementId : null;
    if (nextId === lastHoveredElementId) return;
    lastHoveredElementId = nextId;
    sendEvent("hover", event, target);
  }

  function queuePointerMove(event) {
    pendingPointerMove = event;
    if (pendingPointerMoveFrame !== null) return;
    if (typeof requestAnimationFrame === "function") {
      pendingPointerMoveFrame = requestAnimationFrame(dispatchPendingPointerMove);
    } else {
      dispatchPendingPointerMove();
    }
  }

  function isSafeStyleValue(value) {
    return value === null || (
      isSafeString(value, 4096, true) &&
      !/[;]|url\\s*\\(|expression\\s*\\(|javascript\\s*:|@import|-moz-binding/i.test(value)
    );
  }

  function runCommand(command) {
    if (!isRecord(command) || !isSafeString(command.command, 64)) {
      throw { code: "invalid-command", message: "The bridge command shape is invalid" };
    }
    const needsTarget = command.command === "set-inline-style" || command.command === "set-text" ||
      command.command === "start-text-edit" || command.command === "cancel-text-edit" || command.command === "commit-text-edit" ||
      command.command === "set-shape-fill" || command.command === "set-shape-glass";
    const element = needsTarget ? findElement(command.targetId) : null;
    if (needsTarget && !element) throw { code: "target-not-found", message: "The requested element no longer exists" };

    if (command.command === "set-inline-style") {
      if (!SAFE_STYLE_PROPERTIES.has(command.property) || !isSafeStyleValue(command.value)) {
        throw { code: "unsafe-style", message: "The requested inline style is not allowed" };
      }
      const previousValue = element.style.getPropertyValue(command.property) || null;
      if (previousValue && previousValue.length > 4096) {
        throw { code: "style-too-large", message: "The existing inline style is too large to reverse safely" };
      }
      if (command.value === null || command.value === "") element.style.removeProperty(command.property);
      else {
        if (window.CSS && typeof window.CSS.supports === "function" && !window.CSS.supports(command.property, command.value)) {
          throw { code: "invalid-style", message: "The value is not valid for the requested style property" };
        }
        // Applied as !important so Canvas-owned edits stay authoritative over
        // the injected wireframe theme's blanket resets (transform, shadow…).
        element.style.setProperty(command.property, command.value, "important");
      }
      const value = element.style.getPropertyValue(command.property) || null;
      return {
        kind: "command",
        command: "set-inline-style",
        targetId: command.targetId,
        property: command.property,
        previousValue,
        value,
        undo: { command: "set-inline-style", targetId: command.targetId, property: command.property, value: previousValue },
      };
    }

    if (command.command === "set-text") {
      if (!isSafeString(command.text, MAX_TEXT_LENGTH, true) || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|IMG)$/.test(element.tagName)) {
        throw { code: "unsafe-text-target", message: "Text edits are not allowed for this element" };
      }
      const previousText = element.textContent || "";
      if (previousText.length > MAX_TEXT_LENGTH) {
        throw { code: "text-too-large", message: "The existing text is too large to reverse safely" };
      }
      element.textContent = command.text;
      return {
        kind: "command",
        command: "set-text",
        targetId: command.targetId,
        previousText,
        text: command.text,
        undo: { command: "set-text", targetId: command.targetId, text: previousText },
      };
    }
    if (command.command === "start-text-edit") {
      beginTextEdit(element, { target: element, clientX: 0, clientY: 0 });
      return { kind: "command", command: "start-text-edit", targetId: command.targetId };
    }
    if (command.command === "cancel-text-edit") {
      if (activeTextEdit && activeTextEdit.element === element) cancelTextEdit(null, false);
      return { kind: "command", command: "cancel-text-edit", targetId: command.targetId };
    }
    if (command.command === "commit-text-edit") {
      if (!isSafeString(command.text, MAX_TEXT_LENGTH, true) || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|IMG)$/.test(element.tagName)) {
        throw { code: "unsafe-text-target", message: "Text edits are not allowed for this element" };
      }
      const edit = activeTextEdit && activeTextEdit.element === element ? activeTextEdit : null;
      const previousText = edit ? edit.originalText : (element.textContent || "");
      element.textContent = command.text;
      if (edit) {
        restoreTextEdit(edit);
        activeTextEdit = null;
      }
      return {
        kind: "command",
        command: "set-text",
        targetId: command.targetId,
        previousText,
        text: command.text,
        undo: { command: "set-text", targetId: command.targetId, text: previousText },
      };
    }
    if (command.command === "create-element") {
      const element = createElementFromSpec(command);
      const target = describe(element);
      if (!target) throw { code: "create-failed", message: "The created element could not be inspected" };
      return {
        kind: "command",
        command: "create-element",
        targetId: target.elementId,
        target,
        undo: { command: "delete-element", targetId: target.elementId },
        replay: command,
      };
    }
    if (command.command === "delete-element") {
      const element = findElement(command.targetId);
      if (!element) throw { code: "target-not-found", message: "The requested element no longer exists" };
      if (element.getAttribute("data-design-tool-created") === "true") {
        const snapshotValue = createdSnapshot(element);
        if (!snapshotValue) throw { code: "delete-not-reversible", message: "The element cannot be reversed safely" };
        element.remove();
        return {
          kind: "command",
          command: "delete-element",
          targetId: command.targetId,
          undo: { command: "restore-element", snapshot: snapshotValue },
          replay: command,
        };
      }
      // Document-markup layers (agent-authored shader backgrounds and the
      // like) delete through a verbatim markup snapshot so undo can re-insert
      // them exactly where they lived.
      if (/^(HTML|BODY|HEAD)$/.test(element.tagName)) {
        throw { code: "delete-not-supported", message: "Structural document roots cannot be deleted" };
      }
      const parent = element.parentElement;
      if (!parent) throw { code: "delete-not-supported", message: "The element has no parent to remove it from" };
      const markup = element.outerHTML;
      // Whitespace-tolerant guard: authored documents legitimately contain
      // newlines, but stray control characters would corrupt the snapshot.
      if (typeof markup !== "string" || markup.length === 0 || markup.length > MAX_MARKUP_LENGTH ||
        /[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/.test(markup)) {
        throw { code: "delete-not-reversible", message: "The element is too large to reverse safely" };
      }
      const index = Array.prototype.indexOf.call(parent.children, element);
      element.remove();
      return {
        kind: "command",
        command: "delete-element",
        targetId: command.targetId,
        undo: { command: "restore-element", snapshot: { markup, parentId: elementId(parent), index } },
        replay: command,
      };
    }
    if (command.command === "restore-element") {
      const snapshot = command.snapshot;
      if (isRecord(snapshot) && typeof snapshot.markup === "string") {
        if (!snapshot.markup || snapshot.markup.length > MAX_MARKUP_LENGTH ||
          /[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/.test(snapshot.markup) ||
          !isFiniteNumber(snapshot.index) || snapshot.index < 0 || snapshot.index > 100000) {
          throw { code: "restore-failed", message: "The captured markup snapshot is invalid" };
        }
        let parent = null;
        if (snapshot.parentId !== null) {
          if (!isSafeString(snapshot.parentId, 512)) throw { code: "restore-failed", message: "The captured markup snapshot is invalid" };
          parent = findElement(snapshot.parentId);
        } else {
          parent = document.body;
        }
        if (!parent || !(parent instanceof Element)) {
          throw { code: "parent-not-found", message: "The requested parent does not exist" };
        }
        const template = document.createElement("template");
        template.innerHTML = snapshot.markup;
        const node = template.content.firstElementChild;
        if (!node) throw { code: "restore-failed", message: "The element could not be restored" };
        const reference = parent.children[snapshot.index] || null;
        parent.insertBefore(node, reference);
        const target = describe(node);
        if (!target) throw { code: "restore-failed", message: "The element could not be restored" };
        return {
          kind: "command",
          command: "restore-element",
          targetId: target.elementId,
          target,
          undo: { command: "delete-element", targetId: target.elementId },
          replay: { command: "delete-element", targetId: target.elementId },
        };
      }
      const element = createElementFromSpec(command.snapshot);
      const target = describe(element);
      if (!target) throw { code: "restore-failed", message: "The element could not be restored" };
      const replay = createCommandFromSnapshot(command.snapshot);
      return {
        kind: "command",
        command: "restore-element",
        targetId: target.elementId,
        target,
        undo: { command: "delete-element", targetId: target.elementId },
        replay,
      };
    }
    if (command.command === "duplicate-element") {
      const source = findElement(command.targetId);
      const sourceSnapshot = source ? createdSnapshot(source) : null;
      if (!sourceSnapshot) throw { code: "duplicate-not-supported", message: "Only editor-created elements can be duplicated safely" };
      const snapshotValue = {
        ...sourceSnapshot,
        elementId: command.elementId,
        bounds: { ...sourceSnapshot.bounds, x: sourceSnapshot.bounds.x + 16, y: sourceSnapshot.bounds.y + 16 },
      };
      const element = createElementFromSpec(snapshotValue);
      if (source.parentElement) source.parentElement.insertBefore(element, source.nextSibling);
      const target = describe(element);
      if (!target) throw { code: "duplicate-failed", message: "The duplicate could not be inspected" };
      return {
        kind: "command",
        command: "duplicate-element",
        targetId: target.elementId,
        target,
        undo: { command: "delete-element", targetId: target.elementId },
        replay: createCommandFromSnapshot(snapshotValue),
      };
    }
    if (command.command === "set-shape-radius") {
      if (!isFiniteNumber(command.radius) || command.radius < 0 || command.radius > 256) {
        throw { code: "invalid-radius", message: "The shape radius must be between 0 and 256" };
      }
      const element = findElement(command.targetId);
      if (!element || element.getAttribute("data-design-tool-created") !== "true") {
        throw { code: "target-not-found", message: "The requested shape no longer exists" };
      }
      const previousRadius = Math.max(0, Math.min(256, Number(element.getAttribute("data-design-tool-radius") || 0)));
      if (!applyShapeRadius(element, command.radius)) {
        throw { code: "shape-radius-not-supported", message: "Only created rectangles support a corner radius" };
      }
      return {
        kind: "command",
        command: "set-shape-radius",
        targetId: command.targetId,
        previousRadius,
        radius: command.radius,
        undo: { command: "set-shape-radius", targetId: command.targetId, radius: previousRadius },
      };
    }
    if (command.command === "set-shape-fill") {
      const color = command.color;
      if (color !== null && !(isSafeString(color, 128) && !/[;]|url\\s*\\(/i.test(color))) {
        throw { code: "unsafe-shape-color", message: "The requested fill color is not allowed" };
      }
      if (!element || element.getAttribute("data-design-tool-created") !== "true") {
        throw { code: "target-not-found", message: "The requested shape no longer exists" };
      }
      const previousColor = element.getAttribute("data-design-tool-fill") ||
        element.getAttribute("data-design-tool-original-fill") || null;
      if (color === null) {
        const original = element.getAttribute("data-design-tool-original-fill");
        if (original) applyShapeFill(element, original);
        else element.removeAttribute("data-design-tool-fill");
      } else {
        applyShapeFill(element, color);
      }
      return {
        kind: "command",
        command: "set-shape-fill",
        targetId: command.targetId,
        previousColor,
        color,
        undo: { command: "set-shape-fill", targetId: command.targetId, color: previousColor },
      };
    }
    if (command.command === "set-shape-glass") {
      const level = command.level;
      if (level !== null && !(isFiniteNumber(level) && level >= 0 && level <= 100)) {
        throw { code: "invalid-glass-level", message: "The glass level must be between 0 and 100" };
      }
      if (!element || element.getAttribute("data-design-tool-created") !== "true") {
        throw { code: "target-not-found", message: "The requested shape no longer exists" };
      }
      const previousLevelValue = element.getAttribute("data-design-tool-glass");
      const previousLevel = previousLevelValue === null ? null : Math.max(0, Math.min(100, Number(previousLevelValue)));
      const kind = element.getAttribute("data-design-tool-kind");
      if (kind && GLASS_VECTOR_KINDS.indexOf(kind) !== -1) applyVectorGlass(element, level);
      else applySurfaceGlass(element, level);
      return {
        kind: "command",
        command: "set-shape-glass",
        targetId: command.targetId,
        previousLevel,
        level,
        undo: { command: "set-shape-glass", targetId: command.targetId, level: previousLevel },
      };
    }
    if (command.command === "pick-element") {
      if (!isPoint(command.point) || typeof command.shiftKey !== "boolean") {
        throw { code: "invalid-pick", message: "The pick request is invalid" };
      }
      const element = document.elementFromPoint(command.point.x, command.point.y);
      const target = element instanceof Element ? describe(element) : null;
      sendEvent("select", {
        clientX: command.point.x,
        clientY: command.point.y,
        target: element,
        shiftKey: command.shiftKey,
      }, target);
      return { kind: "command", command: "pick-element" };
    }
    throw { code: "unsupported-command", message: "The requested bridge command is not supported" };
  }

  function handleParentMessage(event) {
    if (event.source !== window.parent || event.origin !== CONFIG.parentOrigin || !isEnvelope(event.data)) return;
    const message = event.data;
    if (message.type === "handshake") {
      sendReady();
      return;
    }
    if (message.type === "request") {
      if (!isSafeString(message.requestId, 256)) return;
      if (message.command === "snapshot") {
        sendResponse(message.requestId, { ok: true, result: { kind: "snapshot", snapshot: snapshot() } });
        return;
      }
      if (message.command === "inspect" && isSafeString(message.targetId, 512)) {
        sendResponse(message.requestId, { ok: true, result: { kind: "inspection", inspection: inspect(findElement(message.targetId)) } });
        return;
      }
      sendError(message.requestId, "invalid-request", "The requested inspection is invalid");
      return;
    }
    if (message.type === "command" && isSafeString(message.requestId, 256)) {
      try {
        sendResponse(message.requestId, { ok: true, result: { kind: "command", ack: runCommand(message.command) } });
      } catch (error) {
        const bridgeError = isRecord(error) && isSafeString(error.code, 128) && isSafeString(error.message, 2048)
          ? error
          : { code: "command-failed", message: "The bridge command could not be applied" };
        sendError(message.requestId, bridgeError.code, bridgeError.message);
      }
    }
  }

  function install() {
    // Migrate legacy shapes: outline should scale with shape (remove non-scaling-stroke)
    try {
      document.querySelectorAll("[data-design-tool-created='true']").forEach(function(el) {
        const child = el.querySelector("rect,ellipse,circle,line,polyline,polygon,path");
        if (child && child.getAttribute("vector-effect") === "non-scaling-stroke") child.removeAttribute("vector-effect");
      });
    } catch {}
    document.addEventListener("pointerover", handleHover, true);
    document.addEventListener("pointermove", queuePointerMove, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    ["pointerdown", "pointerup"].forEach((eventName) => {
      document.addEventListener(eventName, (event) => {
        const target = event.target instanceof Element ? describe(event.target) : null;
        sendEvent(eventName, event, target);
      }, true);
    });
    document.addEventListener("dblclick", (event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element && beginTextEdit(element, event)) event.preventDefault();
    }, true);
    document.addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? describe(event.target) : null;
      if (activeTextEdit && activeTextEdit.element === event.target) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelTextEdit(event);
        } else if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          finishTextEdit(event);
        }
      } else if (!activeTextEdit && event.key === "Enter" && lastSelectedElement) {
        event.preventDefault();
        beginTextEdit(lastSelectedElement, event);
      }
      sendEvent("keydown", event, target);
    }, true);
    document.addEventListener("input", (event) => {
      const target = event.target instanceof Element ? describe(event.target) : null;
      sendEvent("input", event, target);
    }, true);
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? describe(event.target) : null;
      lastSelectedElement = event.target instanceof Element ? event.target : null;
      sendEvent("select", event, target);
    }, true);
    document.addEventListener("blur", (event) => {
      if (activeTextEdit && activeTextEdit.element === event.target) finishTextEdit(event);
    }, true);
    sendReady();
  }

  window.addEventListener("message", handleParentMessage);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
`.trim();
}
