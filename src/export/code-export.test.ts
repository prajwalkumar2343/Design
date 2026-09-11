import { describe, expect, it } from "vitest";
import { createEmptyEditorState } from "../editor/model";
import {
  buildCodeExportFiles,
  buildCodeExportPayload,
  slugifyFileName,
  stripBridgeRuntime,
} from "./code-export";

const BRIDGE_SNIPPET =
  '<script data-design-tool-iframe-bridge="1">(function(){window.__bridge=1})()</script>';

describe("stripBridgeRuntime", () => {
  it("removes the injected bridge script and leaves design code intact", () => {
    const html = `<!doctype html><html><head><meta charset="utf-8">${BRIDGE_SNIPPET}<style>h1{color:red}</style></head><body><h1>Hi</h1></body></html>`;
    const cleaned = stripBridgeRuntime(html);
    expect(cleaned).not.toContain("data-design-tool-iframe-bridge");
    expect(cleaned).toContain("<style>h1{color:red}</style>");
    expect(cleaned).toContain("<h1>Hi</h1>");
    expect(cleaned.startsWith("<!doctype html>")).toBe(true);
  });

  it("keeps ordinary scripts untouched", () => {
    const html = `<html><head>${BRIDGE_SNIPPET}</head><body><script>alert(1)</script></body></html>`;
    const cleaned = stripBridgeRuntime(html);
    expect(cleaned).toContain("<script>alert(1)</script>");
  });
});

describe("slugifyFileName", () => {
  it("produces safe lowercase stems", () => {
    expect(slugifyFileName("Lumina Station — Home")).toBe("lumina-station-home");
    expect(slugifyFileName("  Page 2 ")).toBe("page-2");
    expect(slugifyFileName("Ünïcøde Pàge")).toBe("unicode-page");
  });

  it("falls back when nothing usable remains", () => {
    expect(slugifyFileName("///")).toBe("page");
    expect(slugifyFileName("")).toBe("page");
    expect(slugifyFileName("x".repeat(80))).toHaveLength(48);
  });
});

describe("buildCodeExportFiles", () => {
  it("collapses frames sharing a document into a single index.html", () => {
    const state = createEmptyEditorState();
    state.documents["doc-1"] = {
      id: "doc-1",
      name: "Fieldwork",
      mode: "design",
      srcDoc: `<html><head>${BRIDGE_SNIPPET}</head><body>One</body></html>`,
      revision: 1,
      rootNodeIds: [],
      pageIds: ["page-1"],
    };
    state.pages["page-1"] = { id: "page-1", documentId: "doc-1", name: "Page 1", frameIds: [] };

    const files = buildCodeExportFiles(state);
    expect(files).toEqual([{ filename: "index.html", html: "<html><head></head><body>One</body></html>" }]);
  });

  it("names subsequent documents after their first page and skips empty sources", () => {
    const state = createEmptyEditorState();
    state.documents["doc-a"] = {
      id: "doc-a",
      name: "A",
      mode: "design",
      srcDoc: "<html>A</html>",
      revision: 1,
      rootNodeIds: [],
      pageIds: ["p-a"],
    };
    state.pages["p-a"] = { id: "p-a", documentId: "doc-a", name: "Home Page", frameIds: [] };
    state.documents["doc-empty"] = {
      id: "doc-empty",
      name: "Empty",
      mode: "design",
      srcDoc: "",
      revision: 1,
      rootNodeIds: [],
      pageIds: [],
    };
    state.documents["doc-b"] = {
      id: "doc-b",
      name: "B",
      mode: "design",
      srcDoc: "<html>B</html>",
      revision: 1,
      rootNodeIds: [],
      pageIds: ["p-b"],
    };
    state.pages["p-b"] = { id: "p-b", documentId: "doc-b", name: "Pricing Page", frameIds: [] };

    const files = buildCodeExportFiles(state);
    expect(files.map((file) => file.filename)).toEqual(["index.html", "pricing-page.html"]);
    expect(files[0]!.html).toBe("<html>A</html>");
  });

  it("returns no files for an empty canvas", () => {
    expect(buildCodeExportFiles(createEmptyEditorState())).toEqual([]);
  });
});

describe("buildCodeExportPayload", () => {
  it("returns null when there is nothing to export", () => {
    expect(buildCodeExportPayload(createEmptyEditorState())).toBeNull();
  });

  it("emits a single named HTML file for one-page designs", () => {
    const state = createEmptyEditorState();
    state.documents["doc-1"] = {
      id: "doc-1",
      name: "Fieldwork",
      mode: "design",
      srcDoc: "<html><body>Landing</body></html>",
      revision: 1,
      rootNodeIds: [],
      pageIds: [],
    };
    const payload = buildCodeExportPayload(state, "Lumina Station!");
    expect(payload).toMatchObject({
      filename: "lumina-station.html",
      mimeType: "text/html;charset=utf-8",
      fileCount: 1,
    });
    expect(String(payload!.text)).toContain("Landing");
  });

  it("zips multi-page designs behind an index.html", () => {
    const state = createEmptyEditorState();
    for (const [id, body] of [["d1", "One"], ["d2", "Two"], ["d3", "Three"]] as const) {
      state.documents[id] = {
        id,
        name: id,
        mode: "design",
        srcDoc: `<html><body>${body}</body></html>`,
        revision: 1,
        rootNodeIds: [],
        pageIds: [`p-${id}`],
      };
      state.pages[`p-${id}`] = { id: `p-${id}`, documentId: id, name: `Page ${body}`, frameIds: [] };
    }
    const payload = buildCodeExportPayload(state, "My Site");
    expect(payload).toMatchObject({
      filename: "my-site-code.zip",
      mimeType: "application/zip",
      fileCount: 3,
    });
    const bytes = payload!.text as Uint8Array;
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const decoder = new TextDecoder();
    const raw = decoder.decode(bytes);
    expect(raw).toContain("index.html");
    expect(raw).toContain("page-two.html");
    expect(raw).toContain("page-three.html");
  });
});
