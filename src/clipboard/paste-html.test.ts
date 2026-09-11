import { describe, expect, it } from "vitest";
import { createEditorStore } from "../editor/store";
import { createEmptyEditorState, type EditorState } from "../editor/model";
import { HtmlAdmissionError, MAX_ROUTER_HTML_BYTES } from "../router/html-admission";
import {
  looksLikeHtml,
  pasteHtmlIntoStore,
  preparePastedHtml,
  resolvePastedFrameName,
  resolvePastedFrameSize,
  sanitizeImportedHtml,
  PASTED_FRAME_DEFAULT_WIDTH,
  PASTED_FRAME_MAX_SIZE,
  PASTED_FRAME_MIN_SIZE,
  PASTE_META_BACKGROUND_ATTR,
  PASTE_META_HEIGHT_ATTR,
  PASTE_META_SOURCE_ATTR,
  PASTE_META_TITLE_ATTR,
  PASTE_META_WIDTH_ATTR,
} from "./paste-html";

const CAPTURED_DOC = [
  "<!doctype html>",
  `<html lang="en" ${PASTE_META_SOURCE_ATTR}="https%3A%2F%2Fexample.com%2Fpricing" ${PASTE_META_TITLE_ATTR}="Pricing%20plans" ${PASTE_META_WIDTH_ATTR}="640" ${PASTE_META_HEIGHT_ATTR}="480" ${PASTE_META_BACKGROUND_ATTR}="rgb(255%2C%20255%2C%20255)">`,
  "<head><meta charset=\"utf-8\"><title>Pricing plans</title></head>",
  "<body><section style=\"padding: 24px\"><h2>Plans</h2><p>Simple pricing.</p></section></body>",
  "</html>",
].join("");

describe("preparePastedHtml", () => {
  it("extracts capture metadata and strips it from the stored document", () => {
    const { srcDoc, metadata } = preparePastedHtml(CAPTURED_DOC);
    expect(metadata.sourceUrl).toBe("https://example.com/pricing");
    expect(metadata.title).toBe("Pricing plans");
    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(480);
    expect(metadata.background).toBe("rgb(255, 255, 255)");
    expect(srcDoc).toContain("<!doctype html>");
    expect(srcDoc).toContain("<section");
    expect(srcDoc).not.toContain("data-canvas-paste-");
  });

  it("accepts a plain capture document without metadata", () => {
    const doc = "<!doctype html><html><head></head><body><div>Hi</div></body></html>";
    const { srcDoc, metadata } = preparePastedHtml(doc);
    expect(srcDoc).toBe(doc);
    expect(metadata.sourceUrl).toBeNull();
    expect(metadata.title).toBeNull();
    expect(metadata.width).toBeNull();
    expect(metadata.height).toBeNull();
    expect(metadata.background).toBeNull();
  });

  it("strips metadata written with single-quoted or unquoted attributes", () => {
    const singleQuoted = `<!doctype html><html lang='en' ${PASTE_META_SOURCE_ATTR}='https%3A%2F%2Fexample.com%2Fa'><head></head><body><p>x</p></body></html>`;
    expect(preparePastedHtml(singleQuoted).srcDoc).not.toContain("data-canvas-paste-");
    expect(preparePastedHtml(singleQuoted).metadata.sourceUrl).toBe("https://example.com/a");

    const unquoted = `<!doctype html><html ${PASTE_META_TITLE_ATTR}=Secret><head></head><body><p>x</p></body></html>`;
    expect(preparePastedHtml(unquoted).srcDoc).not.toContain("data-canvas-paste-");
    expect(preparePastedHtml(unquoted).metadata.title).toBe("Secret");
  });

  it("strips metadata carried on body, head, or fragment elements", () => {
    // Only <html> metadata is read, but attributes anywhere must be stripped
    // before the document is stored or exported.
    const onBody = `<!doctype html><html><head></head><body ${PASTE_META_SOURCE_ATTR}="https%3A%2F%2Fexample.com%2Fb"><p>x</p></body></html>`;
    const preparedBody = preparePastedHtml(onBody);
    expect(preparedBody.metadata.sourceUrl).toBeNull();
    expect(preparedBody.srcDoc).not.toContain("data-canvas-paste-");

    const fragment = `<section ${PASTE_META_SOURCE_ATTR}="https%3A%2F%2Fexample.com%2Ff">Hello</section>`;
    const preparedFragment = preparePastedHtml(fragment);
    expect(preparedFragment.metadata.sourceUrl).toBeNull();
    expect(preparedFragment.srcDoc).not.toContain("data-canvas-paste-");
  });

  it("wraps an HTML fragment into a complete document", () => {
    const { srcDoc } = preparePastedHtml('<div class="card">Hello</div>');
    expect(srcDoc).toMatch(/^<!doctype html><html/i);
    expect(srcDoc).toContain('<div class="card">Hello</div>');
    expect(() => preparePastedHtml(srcDoc)).not.toThrow();
  });

  it("adds a doctype to a document that is missing one", () => {
    const { srcDoc } = preparePastedHtml("<html><head></head><body><p>x</p></body></html>");
    expect(srcDoc.startsWith("<!doctype html>")).toBe(true);
  });

  it("rejects empty clipboard content but wraps bare text into a document", () => {
    expect(() => preparePastedHtml("")).toThrow(HtmlAdmissionError);
    expect(() => preparePastedHtml("   ")).toThrow(HtmlAdmissionError);
    const { srcDoc } = preparePastedHtml("just some text");
    expect(srcDoc).toContain("just some text");
    expect(srcDoc).toMatch(/^<!doctype html>/i);
  });

  it("rejects HTML carrying the reserved bridge marker", () => {
    const doc = "<!doctype html><html><head></head><body><div data-design-tool-iframe-bridge=\"1\"></div></body></html>";
    expect(() => preparePastedHtml(doc)).toThrow(HtmlAdmissionError);
  });

  it("rejects oversized documents with a friendly message", () => {
    const big = `<div>${"x".repeat(MAX_ROUTER_HTML_BYTES + 1)}</div>`;
    try {
      preparePastedHtml(big);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(HtmlAdmissionError);
      expect((error as HtmlAdmissionError).code).toBe("html-too-large");
      expect((error as HtmlAdmissionError).message).toContain("too large to paste");
    }
  });
});

describe("looksLikeHtml", () => {
  it("detects documents and common fragments", () => {
    expect(looksLikeHtml("<!doctype html><html></html>")).toBe(true);
    expect(looksLikeHtml("<div>card</div>")).toBe(true);
    expect(looksLikeHtml("<section class=\"hero\">x</section>")).toBe(true);
    expect(looksLikeHtml("<table><tr><td>1</td></tr></table>")).toBe(true);
  });

  it("rejects plain text", () => {
    expect(looksLikeHtml("")).toBe(false);
    expect(looksLikeHtml("hello world")).toBe(false);
    expect(looksLikeHtml("https://example.com")).toBe(false);
  });
});

describe("resolvePastedFrameSize", () => {
  it("rounds and clamps captured sizes", () => {
    expect(resolvePastedFrameSize({ sourceUrl: null, title: null, width: 640, height: 480, background: null }))
      .toEqual({ width: 640, height: 480 });
    expect(resolvePastedFrameSize({ sourceUrl: null, title: null, width: 20, height: 5000, background: null }))
      .toEqual({ width: PASTED_FRAME_MIN_SIZE, height: PASTED_FRAME_MAX_SIZE });
  });

  it("falls back to defaults for missing sizes", () => {
    const size = resolvePastedFrameSize({ sourceUrl: null, title: null, width: null, height: null, background: null });
    expect(size.width).toBe(PASTED_FRAME_DEFAULT_WIDTH);
  });
});

describe("resolvePastedFrameName", () => {
  it("prefers the captured page title", () => {
    expect(resolvePastedFrameName({ sourceUrl: "https://example.com", title: "Pricing plans", width: null, height: null, background: null }))
      .toBe("Pricing plans");
  });

  it("falls back to the source host", () => {
    expect(resolvePastedFrameName({ sourceUrl: "https://example.com/pricing", title: null, width: null, height: null, background: null }))
      .toBe("Pasted from example.com");
  });

  it("truncates long titles", () => {
    const title = "A".repeat(80);
    expect(resolvePastedFrameName({ sourceUrl: null, title, width: null, height: null, background: null }))
      .toBe(`${"A".repeat(48)}…`);
  });
});

function pastedState(): EditorState {
  const store = createEditorStore(createEmptyEditorState());
  const { srcDoc, metadata } = preparePastedHtml(CAPTURED_DOC);
  pasteHtmlIntoStore(store, srcDoc, metadata, { x: 100, y: 200 });
  return store.getState();
}

describe("pasteHtmlIntoStore", () => {
  it("creates a design-mode document, page, and frame in one transaction", () => {
    const state = pastedState();
    expect(Object.keys(state.documents)).toHaveLength(1);
    expect(Object.keys(state.pages)).toHaveLength(1);
    expect(Object.keys(state.frames)).toHaveLength(1);

    const document = Object.values(state.documents)[0];
    const page = Object.values(state.pages)[0];
    const frame = Object.values(state.frames)[0];

    expect(document.mode).toBe("design");
    expect(document.revision).toBe(1);
    expect(document.srcDoc).toContain("<section");
    expect(document.srcDoc).not.toContain("data-canvas-paste-");
    expect(page.documentId).toBe(document.id);
    expect(frame.documentId).toBe(document.id);
    expect(frame.pageId).toBe(page.id);
    expect(frame.x).toBe(100);
    expect(frame.y).toBe(200);
    expect(frame.width).toBe(640);
    expect(frame.height).toBe(480);
    expect(frame.background).toBe("rgb(255, 255, 255)");
    expect(frame.name).toBe("Pricing plans");
    expect(state.activePageId).toBe(page.id);
    expect(state.selection.primaryFrameId).toBe(frame.id);
    expect(state.activeTool).toBe("select");
  });

  it("is undoable as a single step", () => {
    const store = createEditorStore(createEmptyEditorState());
    const before = store.getState();
    const { srcDoc, metadata } = preparePastedHtml(CAPTURED_DOC);
    pasteHtmlIntoStore(store, srcDoc, metadata, { x: 100, y: 200 });
    expect(store.getState()).not.toBe(before);
    expect(store.undo()).toBe(true);
    expect(store.getState()).toEqual(before);
  });

  it("gives each paste its own document", () => {
    const store = createEditorStore(createEmptyEditorState());
    const { srcDoc, metadata } = preparePastedHtml(CAPTURED_DOC);
    pasteHtmlIntoStore(store, srcDoc, metadata, { x: 0, y: 0 });
    pasteHtmlIntoStore(store, srcDoc, metadata, { x: 600, y: 0 });
    const state = store.getState();
    expect(Object.keys(state.documents)).toHaveLength(2);
    expect(Object.keys(state.pages)).toHaveLength(2);
    expect(Object.keys(state.frames)).toHaveLength(2);
  });
});

describe("sanitizeImportedHtml", () => {
  it("returns clean HTML byte-for-byte unchanged", () => {
    const clean = "<!doctype html><html><head><style>.a { color: red; }</style></head><body><div>Hi</div></body></html>";
    expect(sanitizeImportedHtml(clean)).toEqual({ html: clean, removedExecutables: false });
  });

  it("strips script elements and event-handler attributes", () => {
    const raw = '<!doctype html><html><head><script>alert(1)</script></head><body onload="x()"><button onclick="y()">go</button></body></html>';
    const result = sanitizeImportedHtml(raw);
    expect(result.removedExecutables).toBe(true);
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("onload");
    expect(result.html).toContain("go");
  });

  it("neutralizes javascript: URLs and removes srcdoc embeds", () => {
    const raw = '<!doctype html><html><head></head><body><a href="javascript:steal()">x</a><iframe srcdoc="<p>hi</p>" src="https://example.com/e"></iframe></body></html>';
    const result = sanitizeImportedHtml(raw);
    expect(result.removedExecutables).toBe(true);
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("srcdoc");
    expect(result.html).toContain('href="#');
    expect(result.html).toContain("<iframe");
  });

  it("removes base hijacks and plugin-like executable embeds", () => {
    const raw = '<!doctype html><html><head><base href="https://evil.example/"></head><body><object data="x.swf"></object><embed src="y.swf"><p>ok</p></body></html>';
    const result = sanitizeImportedHtml(raw);
    expect(result.removedExecutables).toBe(true);
    expect(result.html).not.toContain("<base");
    expect(result.html).not.toContain("<object");
    expect(result.html).not.toContain("<embed");
    expect(result.html).toContain("ok");
  });

  it("keeps full styling, media, links, and navigation", () => {
    const raw = '<!doctype html><html><head><link rel="stylesheet" href="https://example.com/a.css"><style>.a { color: red; }</style></head><body><a href="https://example.com/">out</a><img src="https://example.com/i.png"><video src="https://example.com/v.mp4"></video></body></html>';
    const result = sanitizeImportedHtml(raw);
    expect(result.removedExecutables).toBe(false);
    expect(result.html).toBe(raw);
  });
});

describe("preparePastedHtml executable hardening", () => {
  it("accepts generic text/html from any source and strips executables", () => {
    const raw = '<!doctype html><html><head><title>Elsewhere</title></head><body><script>bad()</script><div onmouseover="bad()">Card</div></body></html>';
    const { srcDoc, metadata, removedExecutables } = preparePastedHtml(raw);
    expect(removedExecutables).toBe(true);
    expect(srcDoc).not.toContain("<script");
    expect(srcDoc).not.toContain("onmouseover");
    expect(srcDoc).toContain("Card");
    expect(metadata.title).toBeNull();
  });

  it("accepts an HTML fragment from text/plain and keeps it styled", () => {
    const { srcDoc, removedExecutables } = preparePastedHtml('<div style="color: red">Hello</div>');
    expect(removedExecutables).toBe(false);
    expect(srcDoc).toContain('style="color: red"');
    expect(srcDoc).toContain("Hello");
  });

  it("still rejects reserved markers after sanitizing", () => {
    const raw = '<!doctype html><html><head><script>bad()</script></head><body><div data-design-tool-iframe-bridge="1">x</div></body></html>';
    expect(() => preparePastedHtml(raw)).toThrow(HtmlAdmissionError);
  });
});
