import { describe, expect, it } from "vitest";
import { createBridgeRuntimeSource } from "./runtime";

describe("createBridgeRuntimeSource", () => {
  it("emits a runtime script that parses as valid JavaScript", () => {
    const source = createBridgeRuntimeSource({
      parentOrigin: "http://localhost:5173",
      channel: "test-channel",
      frameId: "frame-1",
    });
    expect(() => new Function(source)).not.toThrow();
  });

  it("keeps regex escapes intact inside the template literal", () => {
    const source = createBridgeRuntimeSource({
      parentOrigin: "http://localhost:5173",
      channel: "test-channel",
      frameId: "frame-1",
    });
    expect(source).toContain("/^rgba?\\(\\s*(\\d+)[\\s,]+(\\d+)[\\s,]+(\\d+)");
    expect(source).toContain("url\\s*\\(");
  });

  it("carries glass through snapshots, replays, and restores", () => {
    const source = createBridgeRuntimeSource({
      parentOrigin: "http://localhost:5173",
      channel: "test-channel",
      frameId: "frame-1",
    });
    expect(source).toContain("data-design-tool-glass");
    expect(source).toContain("glass: (() => {");
    expect(source).toContain("applyVectorGlass(element, specGlass)");
    expect(source).toContain("applySurfaceGlass(element, specGlass)");
  });

  it("renders Apple liquid glass with a chromatic lens and frosted fallback", () => {
    const source = createBridgeRuntimeSource({
      parentOrigin: "http://localhost:5173",
      channel: "test-channel",
      frameId: "frame-1",
    });
    // Chromatic aberration: 3 staggered displacements recombined as screen.
    expect(source).toContain("appendLiquidGlassLens(filter, dataUrl");
    expect(source).toContain("feColorMatrix");
    expect(source).toContain('"mode", "screen"');
    // Negative displacement scale bends a magnifying lens; positive pinches.
    expect(source).toContain("-(12 + 30 * t)");
    // Canonical backdrop order with vibrancy, rim light, and contrast.
    expect(source).toContain("glassFallbackBackdropFilter(level)");
    expect(source).toContain("glassBackdropFilterWithRefraction(level, fid)");
    expect(source).toContain("contrast(");
    expect(source).not.toContain('"url(#" + fid + ") " + bfBase');
    // Specular rim, hairline border, and soft drop on both glass paths.
    expect(source).toContain("GLASS_RIM_BORDER");
    expect(source).toContain('"border", "1px solid " + GLASS_RIM_BORDER');
    expect(source).toContain("inset 0 1.5px 0.5px");
  });

  it("paints var() shape fills through style, not the fill attribute", () => {
    const source = createBridgeRuntimeSource({
      parentOrigin: "http://localhost:5173",
      channel: "test-channel",
      frameId: "frame-1",
    });
    // var() never resolves in a presentation attribute — token links on shape
    // fills go through the geometry child's inline style with a fallback.
    expect(source).toContain('child.style.setProperty("fill", linked, "important")');
    expect(source).toContain('child.style.removeProperty("fill")');
  });

  it("keeps the fill tint when glass is re-applied over a cleared fill", () => {
    const source = createBridgeRuntimeSource({
      parentOrigin: "http://localhost:5173",
      channel: "test-channel",
      frameId: "frame-1",
    });
    // Re-stepping the slider must reuse the stored explicit fill so the
    // tint hue survives; an explicitly transparent fill stays pure glass.
    expect(source).toContain("storedBase");
    expect(source).toContain("data-design-tool-fill");
  });
});
