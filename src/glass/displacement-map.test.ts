import { describe, expect, it } from "vitest";

import {
  displacementAt,
  displacementMapKey,
  lensFalloff,
  renderDisplacementPixels,
  roundedRectSignedDistance,
} from "./displacement-map";

const options = { width: 200, height: 100, radius: 12, bezel: 24 };

describe("roundedRectSignedDistance", () => {
  it("is negative inside, zero on the boundary, positive outside", () => {
    expect(roundedRectSignedDistance(0, 0, 100, 50, 12)).toBeLessThan(-30);
    // Edge center sits exactly on the boundary regardless of radius.
    expect(roundedRectSignedDistance(100, 0, 100, 50, 12)).toBeCloseTo(0, 6);
    expect(roundedRectSignedDistance(112, 0, 100, 50, 12)).toBeCloseTo(12, 6);
    expect(roundedRectSignedDistance(130, 0, 100, 50, 12)).toBeCloseTo(30, 6);
  });

  it("measures straight edges without corner rounding", () => {
    expect(roundedRectSignedDistance(0, 40, 100, 50, 12)).toBeCloseTo(-10, 6);
    expect(roundedRectSignedDistance(0, 50, 100, 50, 12)).toBeCloseTo(0, 6);
    expect(roundedRectSignedDistance(0, 62, 100, 50, 12)).toBeCloseTo(12, 6);
  });
});

describe("lensFalloff", () => {
  it("peaks at the physical edge and vanishes at the inner bezel boundary", () => {
    expect(lensFalloff(0, 24)).toBe(1);
    expect(lensFalloff(24, 24)).toBe(0);
    expect(lensFalloff(25, 24)).toBe(0);
  });

  it("eases smoothly through the middle of the band", () => {
    const middle = lensFalloff(12, 24);
    expect(middle).toBeGreaterThan(0.4);
    expect(middle).toBeLessThan(0.6);
  });

  it("returns zero for a degenerate bezel", () => {
    expect(lensFalloff(0, 0)).toBe(0);
  });
});

describe("displacementAt", () => {
  it("keeps the interior optically clear", () => {
    expect(displacementAt(100, 50, options)).toEqual({ x: 0, y: 0 });
  });

  it("pushes samples outward along the edge normal with peak magnitude at the rim", () => {
    // Right edge, vertically centered: outward normal points +x. Pixel centers
    // sit half a pixel inside the boundary, so the falloff is near-peak.
    const rim = displacementAt(199, 50, options);
    expect(rim.x).toBeCloseTo(1, 2);
    expect(Math.abs(rim.y)).toBeLessThan(1e-6);

    // Halfway into the bezel the magnitude eases off.
    const midBand = displacementAt(187, 50, options);
    expect(midBand.x).toBeGreaterThan(0.3);
    expect(midBand.x).toBeLessThan(0.7);

    // Past the bezel the glass is clear again.
    expect(displacementAt(160, 50, options)).toEqual({ x: 0, y: 0 });
  });

  it("follows the corner normal around rounded corners", () => {
    // Bottom-right corner pixel: symmetric offsets from the corner center,
    // so the outward normal bisects the quadrant.
    const corner = displacementAt(194, 94, options);
    expect(corner.x).toBeGreaterThan(0);
    expect(corner.y).toBeGreaterThan(0);
    expect(Math.abs(corner.x - corner.y)).toBeLessThan(0.05);
  });

  it("points leftward along the left edge", () => {
    const rim = displacementAt(0, 50, options);
    expect(rim.x).toBeCloseTo(-1, 2);
  });
});

describe("renderDisplacementPixels", () => {
  it("encodes neutral 128/128 in the clear interior and clamps to byte range", () => {
    const pixels = renderDisplacementPixels(options);
    expect(pixels.length).toBe(options.width * options.height * 4);

    const centerIndex = (50 * options.width + 100) * 4;
    expect(pixels[centerIndex]).toBe(128);
    expect(pixels[centerIndex + 1]).toBe(128);
    expect(pixels[centerIndex + 2]).toBe(128);
    expect(pixels[centerIndex + 3]).toBe(255);

    // Rim pixel: red channel pushed fully toward 255 (+x displacement).
    const rimIndex = (50 * options.width + 199) * 4;
    expect(pixels[rimIndex]).toBe(255);

    let min = 255;
    let max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      min = Math.min(min, pixels[i], pixels[i + 1]);
      max = Math.max(max, pixels[i], pixels[i + 1]);
    }
    expect(min).toBeGreaterThanOrEqual(1);
    expect(max).toBeLessThanOrEqual(255);
  });
});

describe("displacementMapKey", () => {
  it("distinguishes geometry variants so maps are shared only when identical", () => {
    const base = displacementMapKey(options);
    expect(base).toBe(displacementMapKey({ ...options }));
    expect(base).not.toBe(displacementMapKey({ ...options, radius: 16 }));
    expect(base).not.toBe(displacementMapKey({ ...options, bezel: 20 }));
    expect(base).not.toBe(displacementMapKey({ ...options, width: 201 }));
  });
});
