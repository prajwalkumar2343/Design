import { describe, expect, it } from "vitest";

import { createEditorStateFromFrameSeeds } from "../editor";
import {
  parseWireCanvasProject,
  serializeWireCanvasProject,
  WIRECANVAS_FILE_KIND,
} from "./wirecanvas";
import { repairWireCanvasProjectJson } from "./wirecanvas-repair";

const SRC_DOC = "<!doctype html><html><body><main>Hi</main></body></html>";

function validProjectText(): string {
  return serializeWireCanvasProject(
    createEditorStateFromFrameSeeds([
      {
        id: "frame-1",
        name: "Frame",
        documentId: "document-1",
        pageId: "page-1",
        pageName: "Page",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        srcDoc: SRC_DOC,
        mode: "design",
        background: "#ffffff",
      },
    ]),
  );
}

function parsedJson(text: string): Record<string, any> {
  return JSON.parse(text) as Record<string, any>;
}

describe("repairWireCanvasProjectJson", () => {
  it("round-trips a healthy payload unchanged in content", () => {
    const text = validProjectText();
    const repaired = repairWireCanvasProjectJson(text);
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.frames["frame-1"]).toBeDefined();
    expect(state.documents["document-1"]?.srcDoc).toContain("<main>Hi</main>");
    expect(state.pages["page-1"]).toBeDefined();
  });

  it("returns null for input that is not JSON", () => {
    expect(repairWireCanvasProjectJson("{{{ not json")).toBeNull();
    expect(repairWireCanvasProjectJson("")).toBeNull();
  });

  it("returns null for payloads that are not wirecanvas projects", () => {
    expect(repairWireCanvasProjectJson(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(repairWireCanvasProjectJson(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it("refuses to guess future schema versions", () => {
    const parsed = parsedJson(validProjectText());
    parsed.schemaVersion = 99;
    expect(repairWireCanvasProjectJson(JSON.stringify(parsed))).toBeNull();
  });

  it("strips unknown fields and fills missing state sections", () => {
    const parsed = parsedJson(validProjectText());
    parsed.state.futureField = { x: 1 };
    delete parsed.state.selection;
    delete parsed.state.activeTool;
    delete parsed.state.tokens;
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.selection).toEqual({
      frameIds: [],
      nodeIds: [],
      primaryFrameId: null,
      primaryNodeId: null,
    });
    expect(state.activeTool).toBe("select");
    expect(state.frames["frame-1"]).toBeDefined();
  });

  it("drops frames whose page reference dangles and rebuilds page membership", () => {
    const parsed = parsedJson(validProjectText());
    parsed.state.frames.push({
      id: "frame-orphan",
      pageId: "page-missing",
      documentId: "document-1",
      name: "Ghost",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      background: "#fff",
    });
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.frames["frame-orphan"]).toBeUndefined();
    expect(state.frames["frame-1"]).toBeDefined();
    expect(state.pages["page-1"]!.frameIds).toEqual(["frame-1"]);
  });

  it("filters selection references to entities that survived repair", () => {
    const parsed = parsedJson(validProjectText());
    parsed.state.selection = {
      frameIds: ["frame-1", "frame-gone"],
      nodeIds: ["node-gone"],
      primaryFrameId: "frame-gone",
      primaryNodeId: null,
    };
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    const state = parseWireCanvasProject(repaired!);
    expect(state.selection.frameIds).toEqual(["frame-1"]);
    expect(state.selection.primaryFrameId).toBeNull();
  });

  it("strips persisted canvas-injected markers from stored documents", () => {
    const parsed = parsedJson(validProjectText());
    parsed.state.documents[0].srcDoc =
      '<!doctype html><html><head><style data-design-tool-token-theme="">:root{}</style></head><body><main>Hi</main><script data-design-tool-iframe-bridge="">evil()</script></body></html>';
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    const srcDoc = state.documents["document-1"]!.srcDoc;
    expect(srcDoc).not.toContain("data-design-tool-token-theme");
    expect(srcDoc).not.toContain("data-design-tool-iframe-bridge");
    expect(srcDoc).toContain("<main>Hi</main>");
  });

  it("replaces an unrecoverable document with a minimal page", () => {
    const parsed = parsedJson(validProjectText());
    parsed.state.documents[0].srcDoc = "totally not html";
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    const state = parseWireCanvasProject(repaired!);
    expect(state.documents["document-1"]!.srcDoc).toContain("<!doctype html>");
  });

  it("breaks node parent cycles instead of rejecting the file", () => {
    const parsed = parsedJson(validProjectText());
    parsed.state.nodes = [
      { id: "a", documentId: "document-1", parentId: "b", kind: "element", name: "A", attributes: {}, childIds: ["b"] },
      { id: "b", documentId: "document-1", parentId: "a", kind: "element", name: "B", attributes: {}, childIds: ["a"] },
    ];
    parsed.state.documents[0].rootNodeIds = ["a"];
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    // Both nodes survive; the cycle is broken so the graph is a valid tree.
    expect(state.nodes["a"]).toBeDefined();
    expect(state.nodes["b"]).toBeDefined();
  });

  it("repairs a session missing required brief invariants", () => {
    const parsed = parsedJson(validProjectText());
    parsed.state.session = {
      kind: "brainstorm-session",
      schemaVersion: 1,
      lifecycle: "briefing",
      sessionId: null,
      revision: 3,
      briefFrame: null,
      selection: { type: "none" },
    };
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    const state = parseWireCanvasProject(repaired!);
    // No salvageable brief frame → session collapses to a clean not-started state.
    expect(state.session.lifecycle).toBe("not-started");
    expect(state.session.briefFrame).toBeNull();
  });

  it("produces a valid empty project when state is missing entirely", () => {
    const repaired = repairWireCanvasProjectJson(
      JSON.stringify({ kind: WIRECANVAS_FILE_KIND, schemaVersion: 1, state: {} }),
    );
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.documents).toEqual({});
    expect(state.frames).toEqual({});
  });
});
