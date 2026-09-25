/**
 * Glass effect asset — Apple Liquid Glass (iOS 26 / macOS 26).
 *
 * Real Liquid Glass is not an opaque gradient. It is a physical light
 * interaction: the surface behind the element is sampled, lightly blurred,
 * saturated (vibrancy), brightened and refracted at the edges (a magnifying
 * lens driven by an SDF displacement map with a negative scale), then
 * composited under a nearly-transparent tinted pane with a specular rim,
 * a 1px light border and a soft drop. The intensity level (0–100) drives
 * tint opacity and refraction strength; blur stays low on purpose so the
 * lensing survives (a wide blur smears the refraction away).
 * The math here mirrors the copy embedded in the iframe bridge runtime.
 *
 * Recipe notes (Apple HIG "Materials" + LeonardSEO/liquid-glass-react, MIT):
 * - backdrop order is blur() url(#lens) saturate() brightness() contrast()
 * - saturate holds Apple's 180% vibrancy, contrast 1.04
 * - displacement scale is NEGATIVE (magnifying lens); positive scales pinch
 * - chromatic aberration runs the displacement 3x (R/G/B, +/- delta) and
 *   recombines with screen blending for the prism fringe at the rim
 */

export const MAX_GLASS_LEVEL = 100;

/** Level applied by the palette's Glass swatch — mid-frost, still clearly transparent. */
export const DEFAULT_GLASS_LEVEL = 60;

/** Corner radius ceiling for created shapes — high enough to fully round any practical shape into a pill/circle. */
export const MAX_SHAPE_RADIUS = 360;

export const clampShapeRadius = (radius: number): number =>
  Math.max(0, Math.min(MAX_SHAPE_RADIUS, Math.round(radius)));

/** Specular top edge, hairline light border, and a floating drop shadow — legacy flat fallback. */
export const GLASS_SURFACE_SHADOW =
  "inset 0 1px 0 rgba(255, 255, 255, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.35), 0 10px 26px rgba(20, 20, 18, 0.14)";

/** 1px light edge every glass pane carries, light and dark mode alike. */
export const GLASS_RIM_BORDER = "rgba(255, 255, 255, 0.35)";

/**
 * Apple-like liquid rim: strong top specular, softer bottom bounce, faint
 * side glows, plus a 1px hairline that reads as glass thickness.
 */
export const GLASS_LIQUID_RIM =
  "inset 0 1.5px 0.5px rgba(255, 255, 255, 0.6), inset 0 -1.5px 1px rgba(255, 255, 255, 0.35), inset 2px 0 3px -2px rgba(255, 255, 255, 0.35), inset -2px 0 3px -2px rgba(255, 255, 255, 0.35), inset 0 0 0 1px rgba(255, 255, 255, 0.12)";

export const GLASS_LIQUID_DROP = "0 10px 30px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.09)";

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

/**
 * Lens-path blur: 2px at 0% → 5px at 100%. Kept low on purpose — the
 * refraction lives in the edge band, and a wide blur averages it away.
 */
export function glassBlur(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round(2 + 3 * t);
}

/**
 * Frosted fallback blur for engines without backdrop-filter:url() support
 * (Safari/Firefox): 10px → 16px. Without refraction the pane needs more
 * diffusion to read as glass instead of clear film.
 */
export function glassFallbackBlur(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round(10 + 6 * t);
}

/** Vibrancy saturation — Apple glass holds 180% across the range. */
export function glassSaturate(_level: number): number {
  return 180;
}

/** Rim-light brightness lift: 1.06 → 1.12. */
export function glassBrightness(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round((1.06 + 0.06 * t) * 100) / 100;
}

/** Measured Apple contrast lift. */
export function glassContrast(): number {
  return 1.04;
}

/**
 * CSS `backdrop-filter` value for liquid glass at this level (lens path).
 * Refraction (`url(#id)`) is inserted after the blur by
 * `glassBackdropFilterWithRefraction` / the iframe runtime where
 * Chromium supports `backdrop-filter: url()`.
 */
export function glassBackdropFilter(level: number): string {
  return `blur(${glassBlur(level)}px) saturate(${glassSaturate(level)}%) brightness(${glassBrightness(level)}) contrast(${glassContrast()})`;
}

/** Frosted `backdrop-filter` fallback for engines without `url()` support. */
export function glassFallbackBackdropFilter(level: number): string {
  return `blur(${glassFallbackBlur(level)}px) saturate(${glassSaturate(level)}%) brightness(${glassBrightness(level)}) contrast(${glassContrast()})`;
}

/**
 * Lens `backdrop-filter` with SVG refraction, in Apple's canonical order:
 * blur() url(#lens) saturate() brightness() contrast().
 */
export function glassBackdropFilterWithRefraction(level: number, filterId: string): string {
  return `blur(${glassBlur(level)}px) url(#${filterId}) saturate(${glassSaturate(level)}%) brightness(${glassBrightness(level)}) contrast(${glassContrast()})`;
}

/** Tint opacity: 0.10 (clear) → 0.18 — the pane stays nearly transparent. */
export function glassTintAlpha(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round((0.1 + 0.08 * t) * 100) / 100;
}

/**
 * Liquid glass background: a soft top light plus a faint bottom bounce,
 * layered over a thin tint of the element's own fill color. The three layers
 * are comma-separated so `background: <top>, <bottom>, <tint>` works as a
 * shorthand. Transparent fills get the sheens over a whisper of white so
 * the pane still reads on any backdrop.
 */
export function glassTintBackground(color: string | null | undefined, level: number): string {
  const isTransparent = typeof color === "string" && color.trim().toLowerCase() === "transparent";
  const base = isTransparent ? null : (parseCssColor(color) ?? DEFAULT_BASE);
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  const topAlpha = Math.round((0.3 + 0.08 * t) * 100) / 100;
  const bottomAlpha = Math.round((0.12 + 0.06 * t) * 100) / 100;
  const topSheen = `linear-gradient(to bottom, rgba(255, 255, 255, ${topAlpha}) 0%, rgba(255, 255, 255, 0) 36%)`;
  const bottomSheen = `linear-gradient(to top, rgba(255, 255, 255, ${bottomAlpha}) 0%, rgba(255, 255, 255, 0) 26%)`;
  if (isTransparent || !base) return `${topSheen}, ${bottomSheen}, rgba(255, 255, 255, 0.08)`;
  const alpha = glassTintAlpha(level);
  const tint = `rgba(${base.r}, ${base.g}, ${base.b}, ${alpha})`;
  return `${topSheen}, ${bottomSheen}, ${tint}`;
}

/**
 * Refraction displacement scale — NEGATIVE by design. A negative scale bends
 * the backdrop into a magnifying lens bulge (the Apple look); a positive
 * scale pinches/fish-eyes it. Range: -12 (clear) → -42 (frosted).
 */
export function glassDisplacementScale(level: number): number {
  const t = Math.max(0, Math.min(MAX_GLASS_LEVEL, level)) / MAX_GLASS_LEVEL;
  return Math.round(-(12 + 30 * t));
}

/** Per-channel stagger for the chromatic-aberration prism fringe. */
export function glassChromaDelta(): number {
  return 3;
}

/** Full liquid shadow: rim highlights plus a soft drop. */
export function glassLiquidShadow(_level: number): string {
  return `${GLASS_LIQUID_RIM}, ${GLASS_LIQUID_DROP}`;
}

/** Convenience: all CSS needed to turn any surface into liquid glass. */
export function liquidGlassStyle(color: string | null | undefined, level: number): {
  backdropFilter: string;
  background: string;
  boxShadow: string;
  border: string;
} {
  return {
    backdropFilter: glassBackdropFilter(level),
    background: glassTintBackground(color, level),
    boxShadow: glassLiquidShadow(level),
    border: `1px solid ${GLASS_RIM_BORDER}`,
  };
}

/** Reads the applied glass level back from the element's effect attribute. */
export function glassLevelFromAttribute(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampGlassLevel(parsed) : null;
}
