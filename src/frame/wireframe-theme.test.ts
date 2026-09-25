import { describe, expect, it } from "vitest";
import { injectWireframeTheme, WIREFRAME_THEME_MARKER } from "./wireframe-theme";

const wireHtml =
  "<!doctype html><html><head><title>W</title></head><body><main>Sketch</main></body></html>";

describe("injectWireframeTheme", () => {
  it("adds one marked wireframe style block inside head and keeps the doctype", () => {
    const injected = injectWireframeTheme(wireHtml);
    expect(injected.startsWith("<!doctype html>")).toBe(true);
    const styleStart = injected.indexOf(`<style ${WIREFRAME_THEME_MARKER}`);
    expect(styleStart).toBeGreaterThan(injected.indexOf("<head>"));
    expect(styleStart).toBeLessThan(injected.indexOf("</head>"));
    expect(injected).toContain("color-scheme: light !important");
    expect(injected).toContain("animation: none !important");
    expect(injected).toContain("<main>Sketch</main>");
    // Canonical source stays unchanged; injection is render-only.
    expect(wireHtml).not.toContain(WIREFRAME_THEME_MARKER);
  });

  it("is idempotent", () => {
    const once = injectWireframeTheme(wireHtml);
    expect(injectWireframeTheme(once)).toBe(once);
  });

  it("synthesizes a head when the document lacks one", () => {
    const injected = injectWireframeTheme(
      "<!doctype html><html><body><p>x</p></body></html>",
    );
    const parsed = new DOMParser().parseFromString(injected, "text/html");
    const style = parsed.head.querySelector(`style[${WIREFRAME_THEME_MARKER}]`);
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain("outline: 1px dashed #b5b5b5");
    expect(parsed.body.querySelector("p")?.textContent).toBe("x");
  });
});
