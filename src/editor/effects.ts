/**
 * Glass effect asset.
 *
 * Maps a user-facing intensity level (0–100) to the CSS that renders an
 * Apple-style frosted-glass slab on any canvas element: a backdrop blur with
 * saturation boost, a specular rim highlight, and a translucent tint derived
 * from the element's own fill so the material reads over any backdrop.
 */

export const MAX_GLASS_LEVEL = 100;

const MIN_BLUR_PX = 2;
const MAX_BLUR_PX = 28;
const MIN_SATURATION = 120;
const MAX_SATURATION = 200;
const MIN_TINT_ALPHA = 0.16;
const MAX_TINT_ALPHA = 0.38;

/** Specular top edge plus a hairline light border, the signature of glass. */
export const GLASS_RIM_SHADOW =
  "inset 0 1px 0 rgba(255, 255, 255, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.35)";

export const clampGlassLevel = (level: number): number =>
  Math.max(0, Math.min(MAX_GLASS_LEVEL, Math.round(level)));

export function glassBlurPixels(level: number): number {
  return Math.round(MIN_BLUR_PX + (clampGlassLevel(level) / MAX_GLASS_LEVEL) * (MAX_BLUR_PX - MIN_BLUR_PX));
}

export function glassSaturationPercent(level: number): number {
  return Math.round(MIN_SATURATION + (clampGlassLevel(level) / MAX_GLASS_LEVEL) * (MAX_SATURATION - MIN_SATURATION));
}

export function glassBackdropFilter(level: number): string {
  return `blur(${glassBlurPixels(level)}px) saturate(${glassSaturationPercent(level)}%)`;
}

export function glassTintAlpha(level: number): number {
  const t = clampGlassLevel(level) / MAX_GLASS_LEVEL;
  return Math.round((MIN_TINT_ALPHA + t * (MAX_TINT_ALPHA - MIN_TINT_ALPHA)) * 100) / 100;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

function parseCssColor(value: string): RgbColor | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1];
    const expanded = digits.length === 3
      ? digits.split("").map((ch) => ch + ch).join("")
      : digits;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: 1,
    };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(value.trim());
  if (rgb) {
    return {
      r: Math.min(255, Number(rgb[1])),
      g: Math.min(255, Number(rgb[2])),
      b: Math.min(255, Number(rgb[3])),
      alpha: rgb[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(rgb[4]))),
    };
  }
  return null;
}

/**
 * Translucent version of the element's own fill at the given level. Falls back
 * to a neutral white frost when the fill cannot be parsed (gradients, keywords).
 */
export function glassTintFromColor(color: string | null | undefined, level: number): string {
  const alpha = glassTintAlpha(level);
  const parsed = color ? parseCssColor(color) : null;
  const source = parsed ?? { r: 255, g: 255, b: 255 };
  return `rgba(${source.r}, ${source.g}, ${source.b}, ${alpha})`;
}

/** Inverse of `glassBackdropFilter`; null when the value is not a glass effect. */
export function glassLevelFromBackdrop(value: string | null | undefined): number | null {
  if (!value || value === "none") return null;
  const blur = /blur\(([\d.]+)px\)/.exec(value);
  if (!blur) return null;
  const pixels = Number(blur[1]);
  const level = ((pixels - MIN_BLUR_PX) / (MAX_BLUR_PX - MIN_BLUR_PX)) * MAX_GLASS_LEVEL;
  return clampGlassLevel(level);
}
