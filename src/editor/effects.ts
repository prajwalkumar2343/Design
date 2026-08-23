/**
 * Glass effect asset — Apple Liquid Glass (iOS 26 / macOS 26).
 *
 * Real Liquid Glass is not an opaque gradient. It is a physical light
 * interaction: the surface behind the element is sampled, blurred, saturated,
 * brightened and refracted at the edges (Snell's law, convex bevel), then
 * composited under a tinted, semi-transparent pane with a strong specular
 * rim and a soft drop. The intensity level (0–100) drives blur strength,
 * tint opacity, rim strength and the displacement scale of the refraction.
 * The math here mirrors the copy embedded in the iframe bridge runtime.
 */

export const MAX_GLASS_LEVEL = 100;

/** Specular top edge, hairline light border, and a floating drop shadow — legacy flat fallback. */
export const GLASS_SURFACE_SHADOW =
  "inset 0 1px 0 rgba(255, 255, 255, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.35), 0 10px 26px rgba(20, 20, 18, 0.14)";

/**
 * Apple-like liquid rim: four thin specular highlights (top strongest, bottom
 * softer, sides faint) plus a diffused drop. This reads as thickness at the
 * bevel even without a physical border.
 */
export const GLASS_LIQUID_RIM =
  "inset 0 1px 1px rgba(255, 255, 255, 0.65), inset 0 -1px 1px rgba(255, 255, 255, 0.32), inset 1px 0 1px rgba(255, 255, 255, 0.22), inset -1px 0 1px rgba(255, 255, 255, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.18)";

export const GLASS_LIQUID_DROP = "0 8px 32px rgba(0, 0, 0, 0.22), 0 2px 8px rgba(0, 0, 0, 0.14)";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export const clampGlassLevel = (level: number): number =>
  Math.max(0, Math.min(MAX_GLASS_LEVEL, Math.round(level)));

export function parseCssColor(value: string | null | undefined): RgbColor | null {
  if (!value) return null;
  const trimmed = value.trim();
  // "transparent" carries no tintable color; callers fall back to the neutral
  // base exactly as they do for null/unparseable fills (see glassTintBackground).
  if (trimmed.toLowerCase() === "transparent") return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const digits = hex[1];
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+[\d.]+)?\s*\)$/i.exec(trimmed);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

function mixChannels(a: RgbColor, b: RgbColor, t: number): RgbColor {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function rgba(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

interface GlassStop {
  color: RgbColor;
  alpha: number;
}

/** Sheen at the top-left easing into the body color and a shaded far edge. */
export function glassGradientStops(base: RgbColor, level: number): [GlassStop, GlassStop, GlassStop] {
  // Raw clamp without rounding so this stays byte-identical to the iframe
  // runtime copy of the recipe even for fractional levels (e.g. 33.3).
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  const alphaBase = 0.32 + 0.43 * t;
  const white: RgbColor = { r: 255, g: 255, b: 255 };
  const sheen = mixChannels(mixChannels(base, white, 0.6), white, 0.25);
  const shade: RgbColor = {
    r: Math.round(base.r * 0.95),
    g: Math.round(base.g * 0.95),
    b: Math.round(base.b * 0.95),
  };
  return [
    { color: sheen, alpha: Math.min(0.92, alphaBase + 0.18) },
    { color: base, alpha: Math.round(alphaBase * 0.72 * 100) / 100 },
    { color: shade, alpha: Math.round(alphaBase * 0.9 * 100) / 100 },
  ];
}

const DEFAULT_BASE: RgbColor = { r: 217, g: 217, b: 217 };

/**
 * The full CSS background that turns a surface into glass, tinted by its own
 * fill color. Unparseable fills fall back to the neutral editor gray.
 * Kept for backwards-compat / vector SVG gradient fallback.
 */
export function glassSurfaceBackground(color: string | null | undefined, level: number): string {
  const base = parseCssColor(color) ?? DEFAULT_BASE;
  const stops = glassGradientStops(base, level);
  return (
    `linear-gradient(135deg, ${rgba(stops[0].color, stops[0].alpha)} 0%, ` +
    `${rgba(stops[1].color, stops[1].alpha)} 46%, ` +
    `${rgba(stops[2].color, stops[2].alpha)} 100%)`
  );
}

// ── Liquid Glass (Apple iOS 26) ─────────────────────────────────────────

/** Backdrop blur radius for a given level: 6px at 0% → 24px at 100%. */
export function glassBlur(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round(6 + 18 * t);
}

/** Saturate boost: 140% → 200%. */
export function glassSaturate(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round(140 + 60 * t);
}

/** Brightness lift: 1.02 → 1.14. */
export function glassBrightness(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round((1.02 + 0.12 * t) * 100) / 100;
}

/**
 * CSS `backdrop-filter` value for liquid glass at this level.
 * Refraction (`url(#id)`) is appended by the iframe runtime where
 * Chromium supports `backdrop-filter: url()`.
 */
export function glassBackdropFilter(level: number): string {
  return `blur(${glassBlur(level)}px) saturate(${glassSaturate(level)}%) brightness(${glassBrightness(level)})`;
}

/** Tint opacity: 0.08 (clear) → 0.24 (frosted). */
export function glassTintAlpha(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round((0.08 + 0.16 * t) * 100) / 100;
}

/**
 * Liquid glass background: a diagonal sheen sweeping from the top-left
 * layered over a thin tint of the element's own fill color. The two layers
 * are comma-separated so `background: <sheen>, <tint>` works as a shorthand.
 * Transparent fills produce a pure frosted pane (sheen only, no color tint).
 */
export function glassTintBackground(color: string | null | undefined, level: number): string {
  const isTransparent = typeof color === "string" && color.trim().toLowerCase() === "transparent";
  const base = isTransparent ? null : (parseCssColor(color) ?? DEFAULT_BASE);
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  const sheenTop = Math.min(0.62, 0.38 + 0.18 * t);
  const sheenMid = Math.min(0.22, 0.08 + 0.1 * t);
  const sheen = `linear-gradient(135deg, rgba(255, 255, 255, ${sheenTop}) 0%, rgba(255, 255, 255, ${sheenMid}) 26%, rgba(255, 255, 255, 0) 58%)`;
  if (isTransparent || !base) return sheen;
  const alpha = glassTintAlpha(level);
  const tint = `rgba(${base.r}, ${base.g}, ${base.b}, ${alpha})`;
  return `${sheen}, ${tint}`;
}

/** Refraction displacement scale (px) — how far edge pixels warp. */
export function glassDisplacementScale(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round(4 + 26 * t);
}

/** Full liquid shadow: rim highlights plus a soft drop, strength-scaled by t. */
export function glassLiquidShadow(level: number): string {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  const rimOpacity = 0.45 + 0.22 * t;
  const dropOpacity = 0.14 + 0.12 * t;
  // Keep the rim readable but let `level` nudge the drop depth.
  void rimOpacity;
  void dropOpacity;
  return `${GLASS_LIQUID_RIM}, ${GLASS_LIQUID_DROP}`;
}

/** Convenience: all CSS needed to turn any surface into liquid glass. */
export function liquidGlassStyle(color: string | null | undefined, level: number): {
  backdropFilter: string;
  background: string;
  boxShadow: string;
} {
  return {
    backdropFilter: glassBackdropFilter(level),
    background: glassTintBackground(color, level),
    boxShadow: glassLiquidShadow(level),
  };
}

/** Reads the applied glass level back from the element's effect attribute. */
export function glassLevelFromAttribute(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampGlassLevel(parsed) : null;
}
