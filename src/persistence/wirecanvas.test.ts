import { describe, expect, it } from "vitest";

import {
  applyEditorCommand,
  createEditorStateFromFrameSeeds,
  createEditorStore,
  startBrainstormSessionCommand,
  updateBriefFieldCommand,
  addBriefReferenceCommand,
  addConfirmedDecisionCommand,
  type EditorState,
} from "../editor";
import {
  WIRECANVAS_LIMITS,
  exportWireCanvasProject,
  importWireCanvasProject,
  parseWireCanvasProject,
  serializeWireCanvasProject,
  wireCanvasStatesEqual,
  WireCanvasCodecError,
} from "./wirecanvas";

const designHtml = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><main>Brief</main></body></html>";
const wireframeHtml = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"></head><body><main class=\"layout\"><h1>Wireframe</h1></main><style>.layout{display:grid;gap:16px;max-width:640px}</style></body></html>";

function createState(html = designHtml, mode: "design" | "wireframe" = "design"): EditorState {
  let state = createEditorStateFromFrameSeeds([
    {
      id: "frame-a",
      name: "Desktop",
      documentId: "document-1",
      pageId: "page-1",
      pageName: "Overview",
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      srcDoc: html,
      mode,
      background: "#ffffff",
    },
    {
      id: "frame-b",
      name: "Mobile",
      documentId: "document-1",
      pageId: "page-2",
      pageName: "Mobile",
      x: 900,
      y: 20,
      width: 390,
      height: 844,
      srcDoc: html,
      mode,
      background: "#f5f5f5",
    },
  ]);
  state = applyEditorCommand(state, startBrainstormSessionCommand({
    sessionId: "session-1",
    briefFrameId: "brief-1",
    position: { x: -600, y: 20 },
    size: { width: 520, height: 720 },
  }));
  state = applyEditorCommand(state, updateBriefFieldCommand({
    field: "projectDescription",
    value: "A portable project",
  }, 1));
  state = applyEditorCommand(state, addBriefReferenceCommand({
    id: "reference-1",
    label: "Reference",
    url: "https://example.com/reference",
    note: "Useful context",
  }, 2));
  state = applyEditorCommand(state, addConfirmedDecisionCommand({
    id: "decision-1",
    statement: "Keep the first release small",
    rationale: "The brief should stay easy to revise",
  }, 3));
  state = applyEditorCommand(state, {
    type: "node/upsert",
    node: {
      id: "node-1",
      documentId: "document-1",
      parentId: null,
      kind: "element",
      name: "Main",
      tagName: "main",
      attributes: { class: "layout", role: "main" },
      childIds: [],
      frameId: "frame-a",
      locked: false,
    },
  });
  return state;
}

function asProjectJson(state: EditorState, mutate: (project: any) => void): string {
  const project = JSON.parse(serializeWireCanvasProject(state)) as any;
  mutate(project);
  return JSON.stringify(project);
}

function expectCodecError(input: string, code: WireCanvasCodecError["code"]): void {
  try {
    parseWireCanvasProject(input);
    throw new Error("expected parse to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(WireCanvasCodecError);
    expect((error as WireCanvasCodecError).code).toBe(code);
  }
}

describe("WireCanvas project codec", () => {
  it("round-trips the complete durable editor state and preserves exact HTML", () => {
    const state = createState();
    const parsed = parseWireCanvasProject(serializeWireCanvasProject(state));

    expect(wireCanvasStatesEqual(parsed, state)).toBe(true);
    expect(parsed.documents["document-1"].srcDoc).toBe(designHtml);
    expect(parsed.session.briefFrame?.content.references[0].url).toBe("https://example.com/reference");
    expect(parsed.nodes["node-1"]).toMatchObject({ frameId: "frame-a", tagName: "main" });
  });

  it("serializes deterministically across map insertion order", () => {
    const state = createState();
    const reordered: EditorState = {
      ...state,
      documents: Object.fromEntries(Object.entries(state.documents).reverse()),
      pages: Object.fromEntries(Object.entries(state.pages).reverse()),
      frames: Object.fromEntries(Object.entries(state.frames).reverse()),
      nodes: Object.fromEntries(Object.entries(state.nodes).reverse()),
    };

    expect(serializeWireCanvasProject(state)).toBe(serializeWireCanvasProject(reordered));
  });

  it("rejects future file and session versions distinctly", () => {
    const state = createState();
    expectCodecError(asProjectJson(state, (project) => { project.schemaVersion = 2; }), "unsupported-file-version");
    expectCodecError(asProjectJson(state, (project) => { project.state.session.schemaVersion = 2; }), "unsupported-session-version");
  });

  it("rejects malformed JSON, unknown fields, oversized strings, and oversized files", () => {
    const state = createState();
    expectCodecError("{", "invalid-json");
    expectCodecError(asProjectJson(state, (project) => { project.extra = true; }), "unknown-field");
    expectCodecError(asProjectJson(state, (project) => {
      project.state.session.briefFrame.content.projectDescription = "x".repeat(WIRECANVAS_LIMITS.maxStringLength + 1);
    }), "string-too-large");
    expectCodecError("x".repeat(WIRECANVAS_LIMITS.maxFileBytes + 1), "file-too-large");
  });

  it("rejects invalid coordinates, sizes, revisions, and cross-references", () => {
    const state = createState();
    expectCodecError(asProjectJson(state, (project) => { project.state.frames[0].x = NaN; }), "invalid-coordinates");
    expectCodecError(asProjectJson(state, (project) => { project.state.frames[0].width = 0; }), "invalid-size");
    expectCodecError(asProjectJson(state, (project) => { project.state.documents[0].revision = 0; }), "invalid-revision");
    expectCodecError(asProjectJson(state, (project) => { project.state.pages[0].documentId = "missing"; }), "invalid-reference");
    expectCodecError(asProjectJson(state, (project) => { project.state.pages[0].frameIds = ["frame-a", "frame-a"]; }), "duplicate-id");
  });

  it("rejects a closed two-node cycle even when it has no document root", () => {
    const state = createState();
    expectCodecError(asProjectJson(state, (project) => {
      const template = project.state.nodes[0];
      project.state.documents[0].rootNodeIds = [];
      project.state.nodes = [
        { ...template, id: "cycle-a", parentId: "cycle-b", childIds: ["cycle-b"] },
        { ...template, id: "cycle-b", parentId: "cycle-a", childIds: ["cycle-a"] },
      ];
    }), "invalid-reference");
  });

  it("rejects a disconnected cyclic component alongside a valid rooted tree", () => {
    const state = createState();
    expectCodecError(asProjectJson(state, (project) => {
      const template = project.state.nodes[0];
      project.state.nodes.push(
        { ...template, id: "cycle-a", parentId: "cycle-b", childIds: ["cycle-b"] },
        { ...template, id: "cycle-b", parentId: "cycle-a", childIds: ["cycle-a"] },
      );
    }), "invalid-reference");
  });

  it("rejects equal session and Brief Frame ids and incoherent Brief revisions", () => {
    const state = createState();
    expectCodecError(asProjectJson(state, (project) => {
      project.state.session.sessionId = project.state.session.briefFrame.id;
    }), "invalid-field");
    expectCodecError(asProjectJson(state, (project) => {
      project.state.session.briefFrame.revision = project.state.session.revision + 1;
    }), "invalid-revision");
  });

  it("revalidates stored wireframe HTML and preserves design compatibility", () => {
    const wireframe = createState(wireframeHtml, "wireframe");
    expect(parseWireCanvasProject(serializeWireCanvasProject(wireframe)).documents["document-1"].mode).toBe("wireframe");
    expectCodecError(asProjectJson(wireframe, (project) => {
      project.state.documents[0].srcDoc = "<!doctype html><html><body><script>alert(1)</script></body></html>";
    }), "wireframe-admission");
    expect(parseWireCanvasProject(serializeWireCanvasProject(createState())).documents["document-1"].mode).toBe("design");
  });

  it("imports atomically, records one history entry, and restores with undo/redo", () => {
    const initial = createState();
    const imported = applyEditorCommand(initial, updateBriefFieldCommand({
      field: "audience",
      value: "Independent teams",
    }, initial.session.revision));
    const store = createEditorStore(initial);

    expect(() => importWireCanvasProject(store, "not json")).toThrow(WireCanvasCodecError);
    expect(store.getState()).toBe(initial);
    expect(store.getHistory().past).toHaveLength(0);

    expect(importWireCanvasProject(store, serializeWireCanvasProject(imported)).changed).toBe(true);
    expect(store.getHistory().past).toHaveLength(1);
    expect(store.getState().session.briefFrame?.content.audience).toBe("Independent teams");
    expect(store.undo()).toBe(true);
    expect(store.getState()).toBe(initial);
    expect(store.redo()).toBe(true);
    expect(wireCanvasStatesEqual(store.getState(), imported)).toBe(true);
  });

  it("does not add history for an equivalent import", () => {
    const state = createState();
    const store = createEditorStore(state);

    expect(importWireCanvasProject(store, serializeWireCanvasProject(state))).toEqual({
      changed: false,
      state,
    });
    expect(store.getHistory().past).toHaveLength(0);
  });

  it("exports the top-level file contract separately from the session contract", () => {
    const project = exportWireCanvasProject(createState());
    expect(project.kind).toBe("wirecanvas-project");
    expect(project.schemaVersion).toBe(1);
    expect(project.state.session.kind).toBe("brainstorm-session");
    expect(project.state.session.schemaVersion).toBe(1);
  });

  it("migrates legacy unscoped bridge node ids to frame-scoped ids", () => {
    // Files saved before frame-scoped ids carry data:/id:/path: node ids that
    // are only unique inside their frame's document. Loading rewrites them to
    // the scoped form so the next live bridge snapshot binds to the same
    // nodes instead of minting fresh ones.
    const json = asProjectJson(createState(), (project) => {
      const node = project.state.nodes.find((item: { id: string }) => item.id === "node-1");
      node.id = "data:shape-1";
      const document = project.state.documents.find((item: { id: string }) => item.id === "document-1");
      document.rootNodeIds = document.rootNodeIds.map((id: string) =>
        id === "node-1" ? "data:shape-1" : id);
      project.state.selection = {
        ...project.state.selection,
        frameIds: ["frame-a"],
        nodeIds: ["data:shape-1"],
        primaryFrameId: "frame-a",
        primaryNodeId: "data:shape-1",
      };
    });

    const parsed = parseWireCanvasProject(json);
    const migrated = parsed.nodes["frm~frame-a~data:shape-1"];
    expect(migrated).toBeDefined();
    expect(migrated!.frameId).toBe("frame-a");
    expect(parsed.documents["document-1"].rootNodeIds).toContain("frm~frame-a~data:shape-1");
    expect(parsed.selection.nodeIds).toEqual(["frm~frame-a~data:shape-1"]);
    expect(parsed.selection.primaryNodeId).toBe("frm~frame-a~data:shape-1");
  });
});
