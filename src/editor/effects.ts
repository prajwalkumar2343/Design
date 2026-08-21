/**
 * Glass effect asset.
 *
 * Transforms an element's own surface into an Apple-style glass slab: a bright
 * sheen sweeping into the body color across a translucent gradient, finished
 * with a specular rim and a soft drop. The intensity level (0–100) controls
 * how dense and opaque the material reads. The math here mirrors the copy of
 * this recipe embedded in the iframe bridge runtime.
 */

export const MAX_GLASS_LEVEL = 100;

/** Specular top edge, hairline light border, and a floating drop shadow. */
export const GLASS_SURFACE_SHADOW =
  "inset 0 1px 0 rgba(255, 255, 255, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.35), 0 10px 26px rgba(20, 20, 18, 0.14)";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export const clampGlassLevel = (level: number): number =>
  Math.max(0, Math.min(MAX_GLASS_LEVEL, Math.round(level)));

export function parseCssColor(value: string | null | undefined): RgbColor | null {
  if (!value) return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1];
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+[\d.]+)?\s*\)$/i.exec(value.trim());
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
  const t = clampGlassLevel(level) / MAX_GLASS_LEVEL;
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

/** Reads the applied glass level back from the element's effect attribute. */
export function glassLevelFromAttribute(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampGlassLevel(parsed) : null;
}
