/**
 * Displacement-map generation for Apple-style Liquid Glass refraction.
 *
 * The map encodes, per pixel, how far `feDisplacementMap` should shift its
 * sample point: red drives the x offset, green the y offset, with 128 as the
 * neutral value. A rounded-rect signed distance field produces the convex
 * bezel profile that makes content compress toward the edges exactly like
 * Apple's glass slabs.
 */

export interface DisplacementMapOptions {
  width: number;
  height: number;
  /** Corner radius in px; must match the CSS border-radius of the surface. */
  radius: number;
  /** Width of the refracting bezel band measured inward from each edge. */
  bezel: number;
}

export const CHANNEL_NEUTRAL = 128;

/** Signed distance to a rounded-rect boundary; negative inside, positive outside. */
export function roundedRectSignedDistance(
  px: number,
  py: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): number {
  const qx = Math.abs(px) - halfWidth + radius;
  const qy = Math.abs(py) - halfHeight + radius;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * Convex-lens falloff across the bezel band: strongest at the physical edge,
 * easing to zero at the inner boundary so the lens melts into clear glass.
 */
export function lensFalloff(distanceInsideEdge: number, bezel: number): number {
  if (bezel <= 0) return 0;
  const t = Math.min(Math.max(distanceInsideEdge / bezel, 0), 1);
  const eased = 1 - t;
  return eased * eased * (3 - 2 * eased);
}

/** Outward unit normal of the rounded-rect SDF via a central-difference gradient. */
function sdfNormal(
  px: number,
  py: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): { x: number; y: number } {
  const e = 0.5;
  const gx =
    roundedRectSignedDistance(px + e, py, halfWidth, halfHeight, radius) -
    roundedRectSignedDistance(px - e, py, halfWidth, halfHeight, radius);
  const gy =
    roundedRectSignedDistance(px, py + e, halfWidth, halfHeight, radius) -
    roundedRectSignedDistance(px, py - e, halfWidth, halfHeight, radius);
  const length = Math.hypot(gx, gy);
  if (length < 1e-6) return { x: 0, y: 0 };
  return { x: gx / length, y: gy / length };
}

/**
 * Unit-domain displacement [-1, 1] for one pixel. Zero everywhere except the
 * bezel band, where the sample point is pushed along the outward normal with
 * the lens falloff applied.
 */
export function displacementAt(
  px: number,
  py: number,
  options: DisplacementMapOptions,
): { x: number; y: number } {
  const halfWidth = options.width / 2;
  const halfHeight = options.height / 2;
  const cx = px - halfWidth + 0.5;
  const cy = py - halfHeight + 0.5;
  const distance = roundedRectSignedDistance(cx, cy, halfWidth, halfHeight, options.radius);
  // Only pixels within the bezel band refract; the interior stays optically clear.
  if (distance > 0 || distance < -options.bezel) return { x: 0, y: 0 };
  const normal = sdfNormal(cx, cy, halfWidth, halfHeight, options.radius);
  const magnitude = lensFalloff(-distance, options.bezel);
  return { x: normal.x * magnitude, y: normal.y * magnitude };
}

const clampChannel = (value: number): number =>
  Math.round(CHANNEL_NEUTRAL + value * 127);

/** RGBA pixel buffer for the map, ready to be painted into a canvas. */
export function renderDisplacementPixels(options: DisplacementMapOptions): Uint8ClampedArray {
  const { width, height } = options;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const offset = displacementAt(px, py, options);
      const index = (py * width + px) * 4;
      pixels[index] = clampChannel(offset.x);
      pixels[index + 1] = clampChannel(offset.y);
      pixels[index + 2] = CHANNEL_NEUTRAL;
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

/** Cache key so identical surfaces share one encoded map. */
export function displacementMapKey(options: DisplacementMapOptions): string {
  return `${options.width}x${options.height}:r${options.radius}:b${options.bezel}`;
}
