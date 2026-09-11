import { describe, expect, it } from "vitest";
import { createEditorStore } from "../editor/store";
import { createEmptyEditorState } from "../editor/model";
import { buildCodeExportFiles } from "../export/code-export";
import { importWireCanvasProject, serializeWireCanvasProject } from "../persistence/wirecanvas";
import { HtmlAdmissionError, MAX_ROUTER_HTML_BYTES } from "../router/html-admission";
import {
  PASTED_FRAME_DEFAULT_HEIGHT,
  PASTED_FRAME_DEFAULT_WIDTH,
} from "../clipboard/paste-html";
import {
  IMPORTED_HTML_DEFAULT_NAME,
  importHtmlFileIntoStore,
  prepareHtmlFileImport,
  resolveImportedHtmlName,
} from "./html-file-import";

const SAVED_PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8"><title>Pricing plans</title>',
  "<style>.hero { color: #b91c1c; background: #fff7ed; padding: 24px; }</style></head>",
  '<body><main class="hero"><h1>Plans</h1><p>Simple pricing.</p></main></body>',
  "</html>",
].join("");

describe("resolveImportedHtmlName", () => {
  it("prefers the document title over the filename", () => {
    expect(resolveImportedHtmlName(SAVED_PAGE, "download.html")).toBe("Pricing plans");
  });

  it("humanizes the filename stem when there is no title", () => {
    const html = "<!doctype html><html><head></head><body><p>x</p></body></html>";
    expect(resolveImportedHtmlName(html, "pricing-page.html")).toBe("pricing page");
    expect(resolveImportedHtmlName(html, "my_site_backup.htm")).toBe("my site backup");
  });

  it("falls back to a default name when neither title nor stem helps", () => {
    const html = "<!doctype html><html><head></head><body><p>x</p></body></html>";
    expect(resolveImportedHtmlName(html, ".html")).toBe(IMPORTED_HTML_DEFAULT_NAME);
    expect(resolveImportedHtmlName(html, "")).toBe(IMPORTED_HTML_DEFAULT_NAME);
  });

  it("truncates long titles and stems", () => {
    const longTitle = `<!doctype html><html><head><title>${"A".repeat(80)}</title></head><body></body></html>`;
    expect(resolveImportedHtmlName(longTitle, "x.html")).toHaveLength(49);
    const longStem = "<!doctype html><html><head></head><body></body></html>";
    expect(resolveImportedHtmlName(longStem, `${"b".repeat(80)}.html`)).toHaveLength(49);
  });
});

describe("prepareHtmlFileImport", () => {
  it("keeps a clean saved page byte-for-byte with full styling", () => {
    const prepared = prepareHtmlFileImport(SAVED_PAGE, "pricing.html");
    expect(prepared.srcDoc).toBe(SAVED_PAGE);
    expect(prepared.name).toBe("Pricing plans");
    expect(prepared.removedExecutables).toBe(false);
  });

  it("wraps a bare fragment and names it from the filename", () => {
    const prepared = prepareHtmlFileImport('<section class="card">Hello</section>', "card.html");
    expect(prepared.srcDoc).toMatch(/^<!doctype html><html/i);
    expect(prepared.srcDoc).toContain('<section class="card">Hello</section>');
    expect(prepared.name).toBe("card");
  });

  it("adds a missing doctype to a structured document", () => {
    const prepared = prepareHtmlFileImport("<html><head></head><body><p>x</p></body></html>", "page.htm");
    expect(prepared.srcDoc.startsWith("<!doctype html>")).toBe(true);
  });

  it("strips scripts, event handlers, and javascript: URLs but keeps styling and embeds", () => {
    const raw = [
      "<!doctype html>",
      '<html lang="en"><head><title>Saved</title><script>alert(1)</script>',
      "<style>.hero { color: red; }</style>",
      '<link rel="stylesheet" href="https://example.com/site.css"></head>',
      '<body onload="steal()">',
      '<main><a href="javascript:steal()">click</a>',
      '<button onclick="steal()">buy</button>',
      '<iframe src="https://example.com/embed"></iframe>',
      '<img src="https://example.com/shot.png" alt="shot"></main></body></html>',
    ].join("");
    const prepared = prepareHtmlFileImport(raw, "saved.html");
    expect(prepared.removedExecutables).toBe(true);
    expect(prepared.srcDoc).not.toContain("<script");
    expect(prepared.srcDoc).not.toContain("onclick");
    expect(prepared.srcDoc).not.toContain("onload");
    expect(prepared.srcDoc).not.toContain("javascript:");
    expect(prepared.srcDoc).toContain("color: red");
    expect(prepared.srcDoc).toContain("<iframe");
    expect(prepared.srcDoc).toContain("<img");
    expect(prepared.srcDoc).toContain("site.css");
    expect(() => prepareHtmlFileImport(prepared.srcDoc, "saved.html")).not.toThrow();
  });

  it("rejects empty files without touching state", () => {
    expect(() => prepareHtmlFileImport("   ", "empty.html")).toThrow(HtmlAdmissionError);
  });

  it("rejects oversized files with a filename-specific message", () => {
    const big = `<div>${"x".repeat(MAX_ROUTER_HTML_BYTES + 1)}</div>`;
    try {
      prepareHtmlFileImport(big, "huge.html");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(HtmlAdmissionError);
      expect((error as HtmlAdmissionError).code).toBe("html-too-large");
      expect((error as HtmlAdmissionError).message).toContain("huge.html");
    }
  });

  it("rejects reserved runtime markers with a filename-specific message", () => {
    const hostile = '<!doctype html><html><head></head><body><div data-design-tool-iframe-bridge="1"></div></body></html>';
    try {
      prepareHtmlFileImport(hostile, "evil.html");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(HtmlAdmissionError);
      expect((error as HtmlAdmissionError).code).toBe("reserved-runtime-marker");
      expect((error as HtmlAdmissionError).message).toContain("evil.html");
    }
  });
});

describe("importHtmlFileIntoStore", () => {
  it("creates one undoable design document, page, and frame with default sizing", () => {
    const store = createEditorStore(createEmptyEditorState());
    const prepared = prepareHtmlFileImport(SAVED_PAGE, "pricing.html");
    const historyLength = store.getHistory().past.length;

    const result = importHtmlFileIntoStore(store, prepared.srcDoc, prepared.name, { x: 100, y: 200 });

    const state = store.getState();
    expect(result.name).toBe("Pricing plans");
    expect(result.rect).toEqual({ x: 100, y: 200, width: PASTED_FRAME_DEFAULT_WIDTH, height: PASTED_FRAME_DEFAULT_HEIGHT });
    const frame = state.frames[result.frameId];
    expect(frame.name).toBe("Pricing plans");
    expect(frame.width).toBe(PASTED_FRAME_DEFAULT_WIDTH);
    expect(frame.height).toBe(PASTED_FRAME_DEFAULT_HEIGHT);
    const document = state.documents[frame.documentId];
    expect(document.mode).toBe("design");
    expect(document.revision).toBe(1);
    expect(document.srcDoc).toBe(SAVED_PAGE);
    expect(state.pages[frame.pageId].documentId).toBe(frame.documentId);
    expect(state.activePageId).toBe(frame.pageId);
    expect(state.selection).toMatchObject({ frameIds: [result.frameId], primaryFrameId: result.frameId });
    // One transaction, undone in one step.
    expect(store.getHistory().past).toHaveLength(historyLength + 1);
    expect(store.undo()).toBe(true);
    expect(Object.keys(store.getState().documents)).toHaveLength(0);
    expect(Object.keys(store.getState().frames)).toHaveLength(0);
  });

  it("round-trips through project export/import and code export byte-for-byte", () => {
    const store = createEditorStore(createEmptyEditorState());
    const prepared = prepareHtmlFileImport(SAVED_PAGE, "pricing.html");
    importHtmlFileIntoStore(store, prepared.srcDoc, prepared.name, { x: 0, y: 0 });

    const serialized = serializeWireCanvasProject(store.getState());
    const fresh = createEditorStore(createEmptyEditorState());
    const result = importWireCanvasProject(fresh, serialized);
    expect(result.changed).toBe(true);
    const restored = Object.values(fresh.getState().documents);
    expect(restored).toHaveLength(1);
    expect(restored[0].srcDoc).toBe(SAVED_PAGE);
    expect(restored[0].mode).toBe("design");

    const files = buildCodeExportFiles(fresh.getState());
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("index.html");
    expect(files[0].html).toBe(SAVED_PAGE);
  });

  it("leaves state and history untouched when preparation fails", () => {
    const store = createEditorStore(createEmptyEditorState());
    const before = store.getState();
    const historyLength = store.getHistory().past.length;
    expect(() => prepareHtmlFileImport("", "empty.html")).toThrow(HtmlAdmissionError);
    expect(store.getState()).toBe(before);
    expect(store.getHistory().past).toHaveLength(historyLength);
  });
});
