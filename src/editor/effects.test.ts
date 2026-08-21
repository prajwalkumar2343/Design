import { describe, expect, it } from "vitest";

import {
  GLASS_SURFACE_SHADOW,
  clampGlassLevel,
  glassGradientStops,
  glassLevelFromAttribute,
  glassSurfaceBackground,
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
