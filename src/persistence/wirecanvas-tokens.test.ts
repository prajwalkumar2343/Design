import { describe, expect, it } from "vitest";
import {
  applyEditorCommand,
  createEditorStateFromFrameSeeds,
  createEditorStore,
  switchTokenThemeCommand,
  upsertTokenCommand,
  type EditorState,
} from "../editor";
import { createEmptyTokenStore } from "../tokens";
import {
  exportWireCanvasProject,
  importWireCanvasProject,
  parseWireCanvasProject,
  serializeWireCanvasProject,
  WireCanvasCodecError,
} from "./wirecanvas";

const designHtml = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><main>Tokens</main></body></html>";

function createState(): EditorState {
  return createEditorStateFromFrameSeeds([
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
      srcDoc: designHtml,
      mode: "design",
      background: "#ffffff",
    },
  ]);
}

describe("wirecanvas token persistence", () => {
  it("round-trips token sets, themes, and the active theme", () => {
    let state = createState();
    state = applyEditorCommand(state, switchTokenThemeCommand("dark"));
    state = applyEditorCommand(state, upsertTokenCommand("dark", {
      id: "dark-custom",
      name: "color.test.custom",
      type: "color",
      value: "#010203",
    }));
    const restored = parseWireCanvasProject(serializeWireCanvasProject(state));
    expect(restored.tokens).toEqual(state.tokens);
    expect(restored.tokens.activeThemeId).toBe("dark");
    expect(restored.tokens.sets.dark?.tokens["dark-custom"]?.value).toBe("#010203");
    expect(exportWireCanvasProject(state).state.tokens.revision).toBe(state.tokens.revision);
  });

  it("imports files written before tokens existed as an empty store", () => {
    const state = createState();
    const project = JSON.parse(serializeWireCanvasProject(state)) as Record<string, unknown>;
    const fileState = project.state as Record<string, unknown>;
    delete fileState.tokens;
    const restored = parseWireCanvasProject(JSON.stringify(project));
    expect(restored.tokens).toEqual(createEmptyTokenStore());
  });

  it("rejects stored tokens that fail revalidation", () => {
    const state = createState();
    const project = JSON.parse(serializeWireCanvasProject(state)) as Record<string, unknown>;
    const fileState = project.state as Record<string, unknown>;
    fileState.tokens = {
      sets: {},
      themes: { ghost: { id: "ghost", name: "Ghost", setIds: ["missing"] } },
      activeThemeId: "ghost",
      revision: 0,
    };
    expect(() => parseWireCanvasProject(JSON.stringify(project))).toThrowError(WireCanvasCodecError);
  });

  it("leaves live state untouched when a token import fails", () => {
    const store = createEditorStore(createState());
    const before = store.getState();
    const project = JSON.parse(serializeWireCanvasProject(before)) as Record<string, unknown>;
    const fileState = project.state as Record<string, unknown>;
    fileState.tokens = { sets: [], themes: {}, activeThemeId: null, revision: 0 };
    expect(() => importWireCanvasProject(store, JSON.stringify(project))).toThrowError(WireCanvasCodecError);
    expect(store.getState()).toBe(before);
    expect(store.getState().tokens.activeThemeId).toBe("light");
  });

  it("imports token changes as one undoable step", () => {
    const store = createEditorStore(createState());
    let next = createState();
    next = applyEditorCommand(next, switchTokenThemeCommand("brand"));
    const result = importWireCanvasProject(store, serializeWireCanvasProject(next));
    expect(result.changed).toBe(true);
    expect(store.getState().tokens.activeThemeId).toBe("brand");
    expect(store.undo()).toBe(true);
    expect(store.getState().tokens.activeThemeId).toBe("light");
  });
});
