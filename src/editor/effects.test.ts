import { describe, expect, it } from "vitest";

import {
  GLASS_LIQUID_DROP,
  GLASS_LIQUID_RIM,
  GLASS_RIM_BORDER,
  GLASS_SURFACE_SHADOW,
  clampGlassLevel,
  glassBackdropFilter,
  glassBackdropFilterWithRefraction,
  glassBlur,
  glassBrightness,
  glassChromaDelta,
  glassContrast,
  glassDisplacementScale,
  glassFallbackBackdropFilter,
  glassFallbackBlur,
  glassGradientStops,
  glassLevelFromAttribute,
  glassLiquidShadow,
  glassSaturate,
  glassSurfaceBackground,
  glassTintAlpha,
  glassTintBackground,
  liquidGlassStyle,
  parseCssColor,
} from "./effects";

describe("glass effect levels", () => {
  it("clamps to the 0–100 range", () => {
    expect(clampGlassLevel(-20)).toBe(0);
    expect(clampGlassLevel(42.4)).toBe(42);
    expect(clampGlassLevel(180)).toBe(100);
  });

  it("keeps the specular rim and drop in the surface shadow", () => {
    expect(GLASS_SURFACE_SHADOW).toContain("inset 0 1px 0 rgba(255, 255, 255, 0.6)");
    expect(GLASS_SURFACE_SHADOW).toContain("0 10px 26px");
  });

  it("parses hex and rgb fills", () => {
    expect(parseCssColor("#5d5ce2")).toEqual({ r: 93, g: 92, b: 226 });
    expect(parseCssColor("rgb(217, 217, 217)")).toEqual({ r: 217, g: 217, b: 217 });
    expect(parseCssColor("rgba(93, 92, 226, 0.8)")).toEqual({ r: 93, g: 92, b: 226 });
    expect(parseCssColor("linear-gradient(red, blue)")).toBeNull();
    expect(parseCssColor(null)).toBeNull();
  });

  it("builds a denser gradient as the level rises", () => {
    const low = glassGradientStops({ r: 217, g: 217, b: 217 }, 10);
    const high = glassGradientStops({ r: 217, g: 217, b: 217 }, 90);
    expect(high[1].alpha).toBeGreaterThan(low[1].alpha);
    // The sheen stop is brighter than the body color.
    expect(low[0].color.r).toBeGreaterThan(217);
    expect(glassSurfaceBackground("#d9d9d9", 50)).toMatch(/^linear-gradient\(135deg, rgba\(/);
    expect(glassSurfaceBackground("transparent", 50)).toBe(glassSurfaceBackground(null, 50));
  });
});

describe("glassLevelFromAttribute", () => {
  it("reads applied levels back", () => {
    expect(glassLevelFromAttribute("50")).toBe(50);
    expect(glassLevelFromAttribute("0")).toBe(0);
    expect(glassLevelFromAttribute("120")).toBe(100);
  });

  it("returns null when no effect is applied", () => {
    expect(glassLevelFromAttribute(null)).toBeNull();
    expect(glassLevelFromAttribute(undefined)).toBeNull();
    expect(glassLevelFromAttribute("")).toBeNull();
    expect(glassLevelFromAttribute("nonsense")).toBeNull();
  });
});

describe("apple liquid glass recipe", () => {
  it("keeps the lens blur low so the edge refraction survives", () => {
    expect(glassBlur(0)).toBe(2);
    expect(glassBlur(100)).toBe(5);
    // The frosted fallback (no refraction) diffuses more to read as glass.
    expect(glassFallbackBlur(0)).toBe(10);
    expect(glassFallbackBlur(100)).toBe(16);
    expect(glassFallbackBlur(60)).toBeGreaterThan(glassBlur(60));
  });

  it("holds Apple's vibrancy, rim light, and contrast", () => {
    expect(glassSaturate(0)).toBe(180);
    expect(glassSaturate(100)).toBe(180);
    expect(glassBrightness(0)).toBe(1.06);
    expect(glassBrightness(100)).toBe(1.12);
    expect(glassContrast()).toBe(1.04);
  });

  it("builds the lens backdrop filter without a refraction url", () => {
    const lens = glassBackdropFilter(60);
    expect(lens).toContain("blur(");
    expect(lens).toContain("saturate(180%)");
    expect(lens).toContain("brightness(");
    expect(lens).toContain("contrast(1.04)");
    expect(lens).not.toContain("url(");
    expect(glassFallbackBackdropFilter(60)).toContain(`blur(${glassFallbackBlur(60)}px)`);
  });

  it("orders the refraction filter as blur() url() saturate() brightness() contrast()", () => {
    const value = glassBackdropFilterWithRefraction(60, "liquid-lens");
    const order = ["blur(", "url(#liquid-lens)", "saturate(", "brightness(", "contrast("].map((token) =>
      value.indexOf(token),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("uses a negative displacement scale for a magnifying lens bulge", () => {
    expect(glassDisplacementScale(0)).toBe(-12);
    expect(glassDisplacementScale(100)).toBe(-42);
    expect(glassDisplacementScale(60)).toBeLessThan(0);
    expect(glassChromaDelta()).toBe(3);
  });

  it("keeps the tint nearly transparent with a top light and bottom bounce", () => {
    expect(glassTintAlpha(0)).toBe(0.1);
    expect(glassTintAlpha(100)).toBe(0.18);
    const background = glassTintBackground("#5d5ce2", 60);
    expect(background.match(/linear-gradient/g)?.length).toBe(2);
    expect(background).toContain("to bottom");
    expect(background).toContain("to top");
    expect(background).toContain("rgba(93, 92, 226,");
    const pure = glassTintBackground("transparent", 60);
    expect(pure.match(/linear-gradient/g)?.length).toBe(2);
    expect(pure).toContain("rgba(255, 255, 255, 0.08)");
  });

  it("dresses the pane with a specular rim, hairline, drop, and border", () => {
    expect(GLASS_LIQUID_RIM).toContain("inset 0 1.5px 0.5px rgba(255, 255, 255, 0.6)");
    expect(GLASS_LIQUID_RIM).toContain("inset 0 0 0 1px rgba(255, 255, 255, 0.12)");
    expect(GLASS_LIQUID_DROP).toContain("0 10px 30px");
    expect(GLASS_RIM_BORDER).toBe("rgba(255, 255, 255, 0.35)");
    const shadow = glassLiquidShadow(60);
    expect(shadow).toContain("inset 0 1.5px");
    expect(shadow).toContain("0 10px 30px");
    expect(liquidGlassStyle("#d9d9d9", 60).border).toBe(`1px solid ${GLASS_RIM_BORDER}`);
  });
});
