/**
 * Apple-style Liquid Glass for the app chrome.
 *
 * Chromium can run an SVG `feDisplacementMap` inside `backdrop-filter`, which
 * is the only web path to true edge refraction (lensing). Elsewhere — and when
 * the user prefers reduced transparency — surfaces keep the frosted
 * blur+saturate fallback defined in CSS, which reads as the same material
 * minus the lens distortion.
 */

import {
  displacementMapKey,
  renderDisplacementPixels,
  type DisplacementMapOptions,
} from "./displacement-map";

export interface LiquidGlassOptions {
  /** Corner radius in px; keep in sync with the surface's CSS border-radius. */
  radius?: number;
  /** Refracting bezel width in px. */
  bezel?: number;
  /** Maximum sample displacement in px (the `feDisplacementMap` scale). */
  scale?: number;
  /** Frost applied after refraction. */
  blur?: number;
  /** Backdrop saturation boost, matching Apple's vivid glass treatment. */
  saturation?: number;
}

const RESIZE_DEBOUNCE_MS = 120;
const MAX_MAP_DIMENSION = 1024;

let defsHost: SVGSVGElement | null = null;
let filterSequence = 0;
const mapCache = new Map<string, string>();

function ensureDefsHost(doc: Document): SVGSVGElement {
  if (defsHost && defsHost.isConnected) return defsHost;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-liquid-glass-defs", "");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "fixed";
  svg.style.pointerEvents = "none";
  doc.body.appendChild(svg);
  defsHost = svg;
  return svg;
}

/** True only where SVG filters work inside backdrop-filter and transparency is welcome. */
export function supportsBackdropRefraction(win: Window = window): boolean {
  const css = (win as typeof window).CSS;
  if (!css || typeof css.supports !== "function") return false;
  if (!css.supports("backdrop-filter", "url(#liquid-glass-probe)") &&
      !css.supports("-webkit-backdrop-filter", "url(#liquid-glass-probe)")) {
    return false;
  }
  if (typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-transparency: reduce)").matches) {
    return false;
  }
  return true;
}

function createCanvas(doc: Document, width: number, height: number): HTMLCanvasElement | null {
  const canvas = doc.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  return canvas;
}

function displacementMapDataURL(doc: Document, options: DisplacementMapOptions): string | null {
  const key = displacementMapKey(options);
  const cached = mapCache.get(key);
  if (cached) return cached;
  const canvas = createCanvas(doc, options.width, options.height);
  if (!canvas) return null;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(options.width, options.height);
  image.data.set(renderDisplacementPixels(options));
  context.putImageData(image, 0, 0);
  let url: string;
  try {
    url = canvas.toDataURL();
  } catch {
    return null;
  }
  mapCache.set(key, url);
  return url;
}

interface GlassFilter {
  id: string;
  filter: SVGFilterElement;
  image: SVGFEImageElement;
  dispose: () => void;
}

function createGlassFilter(doc: Document, options: DisplacementMapOptions & { scale: number }): GlassFilter | null {
  const url = displacementMapDataURL(doc, options);
  if (!url) return null;
  const svg = ensureDefsHost(doc);
  const filterId = `liquid-glass-filter-${++filterSequence}`;
  const filter = doc.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", filterId);
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "100%");
  filter.setAttribute("height", "100%");
  // sRGB keeps the encoded channel values from being gamma-shifted.
  filter.setAttribute("color-interpolation-filters", "sRGB");

  const image = doc.createElementNS("http://www.w3.org/2000/svg", "feImage");
  image.setAttribute("href", url);
  image.setAttribute("x", "0");
  image.setAttribute("y", "0");
  image.setAttribute("width", String(options.width));
  image.setAttribute("height", String(options.height));
  image.setAttribute("preserveAspectRatio", "none");
  image.setAttribute("result", "map");

  const displacement = doc.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
  displacement.setAttribute("in", "SourceGraphic");
  displacement.setAttribute("in2", "map");
  displacement.setAttribute("scale", String(options.scale));
  displacement.setAttribute("xChannelSelector", "R");
  displacement.setAttribute("yChannelSelector", "G");

  filter.appendChild(image);
  filter.appendChild(displacement);
  svg.appendChild(filter);
  return {
    id: filterId,
    filter,
    image,
    dispose: () => filter.remove(),
  };
}

/**
 * Attaches Liquid Glass refraction to a floating surface. Returns a cleanup
 * function; when refraction is unsupported it returns a no-op and the surface
 * keeps its CSS frost fallback.
 */
export function attachLiquidGlass(element: HTMLElement, options: LiquidGlassOptions = {}): () => void {
  if (!supportsBackdropRefraction(element.ownerDocument.defaultView ?? undefined)) {
    return () => undefined;
  }
  const doc = element.ownerDocument;
  const radius = Math.max(0, options.radius ?? 14);
  const bezel = Math.max(1, options.bezel ?? 24);
  const scale = Math.max(0, options.scale ?? 56);
  const blur = Math.max(0, options.blur ?? 6);
  const saturation = options.saturation ?? 1.7;

  let glass: GlassFilter | null = null;
  let lastKey = "";
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  const apply = () => {
    const width = Math.min(element.clientWidth, MAX_MAP_DIMENSION);
    const height = Math.min(element.clientHeight, MAX_MAP_DIMENSION);
    if (width <= 0 || height <= 0) return;
    const key = `${width}x${height}`;
    if (key === lastKey && glass) return;
    lastKey = key;
    glass?.dispose();
    glass = createGlassFilter(doc, { width, height, radius, bezel, scale });
    if (!glass) {
      // Filter creation failed: drop the inline filter so the CSS frost
      // fallback applies instead of referencing a missing filter id.
      element.style.backdropFilter = "";
      return;
    }
    element.style.backdropFilter = `url(#${glass.id}) blur(${blur}px) saturate(${saturation})`;
  };

  apply();

  const observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        apply();
      }, RESIZE_DEBOUNCE_MS);
    })
    : null;
  observer?.observe(element);

  return () => {
    observer?.disconnect();
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    glass?.dispose();
    glass = null;
    element.style.backdropFilter = "";
  };
}
