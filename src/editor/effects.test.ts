import { describe, expect, it } from "vitest";

import {
  GLASS_RIM_SHADOW,
  glassBackdropFilter,
  glassBlurPixels,
  glassLevelFromBackdrop,
  glassSaturationPercent,
  glassTintAlpha,
  glassTintFromColor,
} from "./effects";

describe("glass effect levels", () => {
  it("spans from a whisper of frost to a heavy slab", () => {
    expect(glassBackdropFilter(0)).toBe("blur(2px) saturate(120%)");
    expect(glassBackdropFilter(50)).toBe("blur(15px) saturate(160%)");
    expect(glassBackdropFilter(100)).toBe("blur(28px) saturate(200%)");
  });

  it("clamps out-of-range levels", () => {
    expect(glassBlurPixels(-20)).toBe(glassBlurPixels(0));
    expect(glassBlurPixels(180)).toBe(glassBlurPixels(100));
    expect(glassBackdropFilter(42.4)).toBe(glassBackdropFilter(42));
  });

  it("grows the tint alpha with intensity", () => {
    expect(glassTintAlpha(0)).toBe(0.16);
    expect(glassTintAlpha(100)).toBe(0.38);
    expect(glassTintAlpha(50)).toBe(0.27);
  });

  it("keeps the specular rim constant across levels", () => {
    expect(GLASS_RIM_SHADOW).toContain("inset 0 1px 0 rgba(255, 255, 255, 0.6)");
  });
});

describe("glassLevelFromBackdrop", () => {
  it("round-trips generated values within blur quantization", () => {
    // One pixel of blur spans ~3.8 levels, so nearby levels share a step.
    for (const level of [0, 4, 17, 50, 83, 100]) {
      expect(Math.abs(glassLevelFromBackdrop(glassBackdropFilter(level))! - level)).toBeLessThanOrEqual(4);
    }
    expect(glassLevelFromBackdrop(glassBackdropFilter(0))).toBe(0);
    expect(glassLevelFromBackdrop(glassBackdropFilter(100))).toBe(100);
  });

  it("rejects non-glass values", () => {
    expect(glassLevelFromBackdrop(null)).toBeNull();
    expect(glassLevelFromBackdrop("")).toBeNull();
    expect(glassLevelFromBackdrop("none")).toBeNull();
    expect(glassLevelFromBackdrop("brightness(0.8)")).toBeNull();
  });
});

describe("glassTintFromColor", () => {
  it("derives the tint hue from rgb fills and hex fills", () => {
    expect(glassTintFromColor("rgb(217, 217, 217)", 50)).toBe("rgba(217, 217, 217, 0.27)");
    expect(glassTintFromColor("#5d5ce2", 0)).toBe("rgba(93, 92, 226, 0.16)");
    expect(glassTintFromColor("rgb(93 92 226 / 0.8)", 100)).toBe("rgba(93, 92, 226, 0.38)");
  });

  it("falls back to a neutral white frost for unparseable fills", () => {
    expect(glassTintFromColor(null, 50)).toBe("rgba(255, 255, 255, 0.27)");
    expect(glassTintFromColor("linear-gradient(red, blue)", 25)).toBe(`rgba(255, 255, 255, ${glassTintAlpha(25)})`);
    expect(glassTintFromColor("transparent", 75)).toBe(`rgba(255, 255, 255, ${glassTintAlpha(75)})`);
  });
});
