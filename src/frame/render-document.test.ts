import { describe, expect, it } from "vitest";

import { BRIDGE_RUNTIME_MARKER, injectBridgeRuntime } from "../bridge";
import { validateRouterHtml } from "../router/document-exchange";
import { renderFrameDocument } from "./render-document";
import {
  injectWireframeTheme,
  WIREFRAME_THEME_CSS,
  WIREFRAME_THEME_MARKER,
} from "./wireframe-theme";
import { TOKEN_THEME_MARKER } from "./token-theme";

const bridgeSession = {
  channel: "frame-desktop-channel",
  frameId: "desktop",
  parentOrigin: "http://127.0.0.1:4173",
};

const completeDocument = "<!doctype html><html><head><title>Wireframe</title></head><body><main>Content</main></body></html>";

function countMarker(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

describe("Canvas-owned wireframe rendering", () => {
  it("injects one deterministic theme into a complete document and is idempotent", () => {
    const themed = injectWireframeTheme(completeDocument);

    expect(themed).toContain(`${WIREFRAME_THEME_MARKER}=\"1\"`);
    expect(themed).toContain(WIREFRAME_THEME_CSS);
    expect(countMarker(themed, WIREFRAME_THEME_MARKER)).toBe(1);
    expect(injectWireframeTheme(themed)).toBe(themed);
  });

  it("creates a renderable head/body when browser parsing supplies them", () => {
    const source = "<!doctype html><html><main>Content</main></html>";
    const themed = injectWireframeTheme(source);
    const parsed = new DOMParser().parseFromString(themed, "text/html");

    expect(parsed.head.querySelector(`[${WIREFRAME_THEME_MARKER}]`)).not.toBeNull();
    expect(parsed.body.querySelector("main")?.textContent).toBe("Content");
  });

  it("leaves canonical HTML unchanged and preserves the existing design render path", () => {
    const canonical = completeDocument;
    const rendered = renderFrameDocument(canonical, "wireframe", bridgeSession);

    expect(canonical).toBe(completeDocument);
    expect(rendered).not.toBe(canonical);
    expect(rendered).toContain(WIREFRAME_THEME_MARKER);
    expect(rendered).toContain(BRIDGE_RUNTIME_MARKER);

    const designRendered = renderFrameDocument(canonical, "design", bridgeSession);
    expect(designRendered).toBe(injectBridgeRuntime(canonical, bridgeSession));
    expect(designRendered).not.toContain(WIREFRAME_THEME_MARKER);
  });

  it("keeps bridge injection compatible with the sandboxed runtime", () => {
    const rendered = renderFrameDocument(completeDocument, "wireframe", bridgeSession);

    expect(countMarker(rendered, WIREFRAME_THEME_MARKER)).toBe(1);
    expect(countMarker(rendered, BRIDGE_RUNTIME_MARKER)).toBe(1);
    expect(rendered).not.toContain("allow-same-origin");
    expect(rendered.indexOf(BRIDGE_RUNTIME_MARKER)).toBeLessThan(rendered.indexOf("<title>"));
  });

  it("rejects the Canvas-owned theme marker at the HTML admission boundary", () => {
    expect(() => validateRouterHtml(
      `<!doctype html><html><head><style ${WIREFRAME_THEME_MARKER}=\"1\"></style></head><body></body></html>`,
    )).toThrowError(expect.objectContaining({ code: "reserved-wireframe-theme-marker" }));
  });
});

describe("Canvas-owned token theme rendering", () => {
  const tokenCss = ":root {\n  --color-accent-primary: #3b74c2;\n}\n";

  it("injects active-theme variables into design frames only", () => {
    const rendered = renderFrameDocument(completeDocument, "design", bridgeSession, tokenCss);

    expect(countMarker(rendered, TOKEN_THEME_MARKER)).toBe(1);
    expect(rendered).toContain("--color-accent-primary: #3b74c2;");
    expect(rendered).toContain(BRIDGE_RUNTIME_MARKER);
    expect(completeDocument).not.toContain(TOKEN_THEME_MARKER);
  });

  it("keeps wireframe frames on the neutral theme even when token CSS is present", () => {
    const rendered = renderFrameDocument(completeDocument, "wireframe", bridgeSession, tokenCss);

    expect(rendered).toContain(WIREFRAME_THEME_MARKER);
    expect(rendered).not.toContain(TOKEN_THEME_MARKER);
  });

  it("renders design frames unthemed without token CSS", () => {
    const rendered = renderFrameDocument(completeDocument, "design", bridgeSession);

    expect(rendered).not.toContain(TOKEN_THEME_MARKER);
  });

  it("rejects the token theme marker at the HTML admission boundary", () => {
    expect(() => validateRouterHtml(
      `<!doctype html><html><head><style ${TOKEN_THEME_MARKER}="1"></style></head><body></body></html>`,
    )).toThrowError(expect.objectContaining({ code: "reserved-token-theme-marker" }));
  });
});
