import { afterEach, describe, expect, it } from "vitest";

import { attachLiquidGlass, supportsBackdropRefraction } from "./liquid-glass";

describe("supportsBackdropRefraction", () => {
  it("is false when CSS.supports cannot confirm SVG filters in backdrop-filter", () => {
    const fakeWindow = { CSS: undefined } as unknown as Window;
    expect(supportsBackdropRefraction(fakeWindow)).toBe(false);
  });

  it("is false when the user prefers reduced transparency", () => {
    const fakeWindow = {
      CSS: { supports: () => true },
      matchMedia: (query: string) => ({ matches: query.includes("reduced-transparency") }),
    } as unknown as Window;
    expect(supportsBackdropRefraction(fakeWindow)).toBe(false);
  });

  it("is true in a capable engine that welcomes transparency", () => {
    const fakeWindow = {
      CSS: { supports: () => true },
      matchMedia: () => ({ matches: false }),
    } as unknown as Window;
    expect(supportsBackdropRefraction(fakeWindow)).toBe(true);
  });
});

describe("attachLiquidGlass", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.querySelectorAll("[data-liquid-glass-defs]").forEach((node) => node.remove());
  });

  it("leaves the element untouched and returns a no-op when refraction is unsupported", () => {
    const originalSupports = window.CSS?.supports;
    (window as { CSS?: unknown }).CSS = undefined;
    try {
      const element = document.createElement("div");
      const cleanup = attachLiquidGlass(element, { radius: 13 });
      expect(element.style.backdropFilter).toBe("");
      cleanup();
      expect(document.querySelector("[data-liquid-glass-defs]")).toBeNull();
    } finally {
      (window as { CSS?: unknown }).CSS = originalSupports
        ? { supports: originalSupports }
        : undefined;
    }
  });
});
