import { describe, expect, it } from "vitest";

import { createEditorStateFromFrameSeeds } from "../editor";
import {
  parseWireCanvasProject,
  serializeWireCanvasProject,
  WIRECANVAS_FILE_KIND,
  WIRECANVAS_LIMITS,
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

  it("breaks child cycles that run through a root node", () => {
    const parsed = parsedJson(validProjectText());
    // Root a lists b; b lists a back but a has no parent — the parent-chain
    // walk cannot see this cycle, only the childIds graph can.
    parsed.state.nodes = [
      { id: "a", documentId: "document-1", parentId: null, kind: "element", name: "A", attributes: {}, childIds: ["b"] },
      { id: "b", documentId: "document-1", parentId: "a", kind: "element", name: "B", attributes: {}, childIds: ["a"] },
    ];
    parsed.state.documents[0].rootNodeIds = ["a"];
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.nodes["a"]).toBeDefined();
    expect(state.nodes["a"]!.parentId).toBeNull();
    expect(state.nodes["b"]).toBeDefined();
    expect(state.nodes["b"]!.childIds).toEqual([]);
  });

  it("detaches a listed child that does not claim the parent", () => {
    const parsed = parsedJson(validProjectText());
    // a lists b as a child, but b.parentId is null — a one-sided link the
    // strict codec rejects as inconsistent.
    parsed.state.nodes = [
      { id: "a", documentId: "document-1", parentId: null, kind: "element", name: "A", attributes: {}, childIds: ["b"] },
      { id: "b", documentId: "document-1", parentId: null, kind: "element", name: "B", attributes: {}, childIds: [] },
    ];
    parsed.state.documents[0].rootNodeIds = ["a"];
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.nodes["a"]!.childIds).toEqual([]);
    // b survives as a root of its document.
    expect(state.nodes["b"]).toBeDefined();
    expect(state.documents["document-1"]!.rootNodeIds).toEqual(["a", "b"]);
  });

  it("drops frame fields this schema does not support (freeform)", () => {
    const parsed = parsedJson(validProjectText());
    // A stored freeform flag must not poison the whole file — this branch's
    // strict codec rejects it as an unknown field.
    parsed.state.frames[0].freeform = true;
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.frames["frame-1"]).toBeDefined();
    expect("freeform" in state.frames["frame-1"]!).toBe(false);
  });

  it("drops only invalid tokens and keeps valid sets and themes", () => {
    const parsed = parsedJson(validProjectText());
    parsed.state.tokens = {
      sets: {
        "set-1": {
          id: "set-1",
          name: "Core",
          tokens: {
            "tok-1": { id: "tok-1", name: "color.accent", type: "color", value: "#ff0000" },
            "tok-2": { id: "tok-2", name: "color.broken", type: "color", value: "!!not-a-color!!" },
          },
        },
        "set-2": { id: "bad set!", name: "Broken", tokens: {} },
      },
      themes: {
        "theme-1": { id: "theme-1", name: "Main", setIds: ["set-1"] },
        "theme-2": { id: "theme-2", name: "Gone", setIds: ["set-2"] },
      },
      activeThemeId: "theme-1",
      revision: 4,
    };
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.tokens.sets["set-1"]).toBeDefined();
    expect(state.tokens.sets["set-1"]!.tokens["tok-1"]).toBeDefined();
    expect(state.tokens.sets["set-1"]!.tokens["tok-2"]).toBeUndefined();
    expect(state.tokens.sets["set-2"]).toBeUndefined();
    expect(state.tokens.themes["theme-1"]).toBeDefined();
    expect(state.tokens.themes["theme-2"]).toBeUndefined();
    expect(state.tokens.activeThemeId).toBe("theme-1");
    expect(state.tokens.revision).toBe(4);
  });

  it("salvages the intact members of a truncated payload", () => {
    const text = validProjectText();
    // Cut inside the frames array: the complete leading members (session,
    // documents, pages) still repair into a project that parses.
    const cut = text.indexOf('"frames"') + 12;
    const repaired = repairWireCanvasProjectJson(text.slice(0, cut));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.documents["document-1"]).toBeDefined();
    expect(state.pages["page-1"]).toBeDefined();
  });

  it("salvages a payload truncated inside a string value", () => {
    const text = validProjectText();
    const cut = text.indexOf("<main>Hi</main>") + 4;
    const repaired = repairWireCanvasProjectJson(text.slice(0, cut));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.documents["document-1"]).toBeDefined();
  });

  it("keeps the generated session id within the id length limit", () => {
    const parsed = parsedJson(validProjectText());
    const briefId = "b".repeat(256);
    parsed.state.session = {
      kind: "brainstorm-session",
      schemaVersion: 1,
      lifecycle: "briefing",
      sessionId: null,
      revision: 1,
      briefFrame: {
        id: briefId,
        kind: "brief",
        name: "Brief",
        x: 0,
        y: 0,
        width: 520,
        height: 720,
        revision: 1,
        content: {},
      },
      selection: { type: "none" },
    };
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    const sessionId = state.session.sessionId;
    expect(sessionId).not.toBeNull();
    expect(sessionId!.length).toBeLessThanOrEqual(WIRECANVAS_LIMITS.maxIdLength);
    expect(sessionId).not.toBe(briefId);
  });

  it("replaces finite but unsafe revision numbers with the fallback", () => {
    const parsed = parsedJson(validProjectText());
    parsed.state.documents[0].revision = 1e300;
    const repaired = repairWireCanvasProjectJson(JSON.stringify(parsed));
    expect(repaired).not.toBeNull();
    const state = parseWireCanvasProject(repaired!);
    expect(state.documents["document-1"]!.revision).toBe(1);
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
