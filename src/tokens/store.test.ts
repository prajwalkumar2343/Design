import { describe, expect, it } from "vitest";
import {
  createEditorStateFromFrameSeeds,
  createEditorStore,
  createEmptyEditorState,
  removeTokenCommand,
  removeTokenSetCommand,
  removeTokenThemeCommand,
  renameTokenCommand,
  switchTokenThemeCommand,
  upsertTokenCommand,
  upsertTokenSetCommand,
  upsertTokenThemeCommand,
  EditorReducerError,
} from "../editor";
import { createSeedTokenStore } from "./index";

function createStore() {
  return createEditorStore(createEmptyEditorState());
}

describe("token reducer", () => {
  it("upserts tokens with monotonic revisions", () => {
    const store = createStore();
    const before = store.getState().tokens.revision;
    expect(store.execute(upsertTokenCommand("light", {
      id: "light-new",
      name: "color.test.new",
      type: "color",
      value: "#111111",
    }), { label: "Add token" })).toBe(true);
    const after = store.getState().tokens;
    expect(after.revision).toBe(before + 1);
    expect(after.sets.light?.tokens["light-new"]?.value).toBe("#111111");
  });

  it("is a no-op for identical upserts", () => {
    const store = createStore();
    const existing = store.getState().tokens.sets.light?.tokens["light-accent-primary"];
    expect(existing).toBeDefined();
    expect(store.execute(upsertTokenCommand("light", existing!), { label: "No-op" })).toBe(false);
  });

  it("rejects stale expected revisions", () => {
    const store = createStore();
    const revision = store.getState().tokens.revision;
    expect(() => store.execute(switchTokenThemeCommand("dark", revision + 5))).toThrowError(EditorReducerError);
    expect(store.getState().tokens.activeThemeId).toBe("light");
  });

  it("honours expected revisions on success", () => {
    const store = createStore();
    const revision = store.getState().tokens.revision;
    expect(store.execute(switchTokenThemeCommand("dark", revision), { label: "Dark" })).toBe(true);
    expect(store.getState().tokens.activeThemeId).toBe("dark");
    expect(store.getState().tokens.revision).toBe(revision + 1);
  });

  it("switches themes and reverts with undo/redo", () => {
    const store = createStore();
    expect(store.getState().tokens.activeThemeId).toBe("light");
    store.execute(switchTokenThemeCommand("dark"), { label: "Switch to dark" });
    expect(store.getState().tokens.activeThemeId).toBe("dark");
    expect(store.undo()).toBe(true);
    expect(store.getState().tokens.activeThemeId).toBe("light");
    expect(store.redo()).toBe(true);
    expect(store.getState().tokens.activeThemeId).toBe("dark");
  });

  it("records one undo entry per token mutation batch", () => {
    const store = createStore();
    const entries = store.getHistory().past.length;
    store.transact("Batch", () => {
      store.execute(upsertTokenCommand("light", {
        id: "light-a", name: "color.test.a", type: "color", value: "#aaaaaa",
      }), { history: "skip" });
      store.execute(upsertTokenCommand("light", {
        id: "light-b", name: "color.test.b", type: "color", value: "#bbbbbb",
      }), { history: "skip" });
    });
    expect(store.getHistory().past.length).toBe(entries + 1);
    expect(store.undo()).toBe(true);
    expect(store.getState().tokens.sets.light?.tokens["light-a"]).toBeUndefined();
    expect(store.getState().tokens.sets.light?.tokens["light-b"]).toBeUndefined();
  });

  it("removes tokens and sets", () => {
    const store = createStore();
    store.execute(removeTokenCommand("light", "light-accent-primary"), { label: "Remove" });
    expect(store.getState().tokens.sets.light?.tokens["light-accent-primary"]).toBeUndefined();
    expect(() => store.execute(removeTokenCommand("light", "light-accent-primary"))).toThrowError(EditorReducerError);
  });

  it("refuses to remove a set that themes still use", () => {
    const store = createStore();
    expect(() => store.execute(removeTokenSetCommand("light"))).toThrowError(/used by theme/);
    expect(store.getState().tokens.sets.light).toBeDefined();
  });

  it("creates and removes sets and themes", () => {
    const store = createStore();
    store.execute(upsertTokenSetCommand({ id: "extra", name: "Extra", tokens: {} }), { label: "Add set" });
    store.execute(upsertTokenThemeCommand({ id: "extra-theme", name: "Extra", setIds: ["core", "extra"] }), { label: "Add theme" });
    expect(store.getState().tokens.themes["extra-theme"]?.setIds).toEqual(["core", "extra"]);
    expect(() => store.execute(upsertTokenThemeCommand({ id: "bad", name: "Bad", setIds: ["missing"] })))
      .toThrowError(EditorReducerError);
    store.execute(switchTokenThemeCommand("extra-theme"), { label: "Switch" });
    store.execute(removeTokenThemeCommand("extra-theme"), { label: "Remove active theme" });
    expect(store.getState().tokens.activeThemeId).toBeNull();
    store.execute(removeTokenSetCommand("extra"), { label: "Remove set" });
    expect(store.getState().tokens.sets.extra).toBeUndefined();
  });

  it("rejects unknown theme switches", () => {
    const store = createStore();
    expect(() => store.execute(switchTokenThemeCommand("nope"))).toThrowError(EditorReducerError);
  });

  it("keeps seeded tokens when the editor state is fresh", () => {
    expect(createEmptyEditorState().tokens).toEqual(createSeedTokenStore());
  });

  it("renames a variable across mode sets and rewrites aliases + element links", () => {
    const state = createEditorStateFromFrameSeeds([{
      id: "frame-1",
      name: "Frame",
      documentId: "doc-1",
      pageId: "page-1",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      background: "#fff",
      srcDoc: '<html><body><div data-design-tool-element-id="a" style="background: var(--color-accent-primary); border: var(--color-accent-primary-2)"></div></body></html>',
    }]);
    const store = createEditorStore(state);
    // An alias in the core set points at the name being renamed.
    store.execute(upsertTokenCommand("core", {
      id: "core-alias",
      name: "color.accent.link",
      type: "color",
      value: "{color.accent.primary}",
    }), { label: "Alias" });
    const historyBefore = store.getHistory().past.length;

    store.execute(renameTokenCommand("light", "light-accent-primary", "color.accent.main"), { label: "Rename" });

    const tokens = store.getState().tokens;
    // Every same-named copy across sets is renamed (one variable, many modes).
    expect(tokens.sets.light?.tokens["light-accent-primary"]?.name).toBe("color.accent.main");
    expect(tokens.sets.dark?.tokens["dark-accent-primary"]?.name).toBe("color.accent.main");
    expect(tokens.sets.brand?.tokens["brand-accent-primary"]?.name).toBe("color.accent.main");
    // The alias follows the rename.
    expect(tokens.sets.core?.tokens["core-alias"]?.value).toBe("{color.accent.main}");
    // The var() link inside the document is rewritten; lookalikes stay.
    const doc = store.getState().documents["doc-1"];
    expect(doc?.srcDoc).toContain("var(--color-accent-main)");
    expect(doc?.srcDoc).toContain("var(--color-accent-primary-2)");
    expect(doc?.revision).toBe(2);
    // Single undo entry restores token names, alias, and document together.
    expect(store.getHistory().past.length).toBe(historyBefore + 1);
    expect(store.undo()).toBe(true);
    expect(store.getState().tokens.sets.light?.tokens["light-accent-primary"]?.name).toBe("color.accent.primary");
    expect(store.getState().documents["doc-1"]?.srcDoc).toContain("var(--color-accent-primary)");
  });

  it("rejects a rename that would collide with an existing token name", () => {
    const store = createStore();
    expect(() => store.execute(renameTokenCommand("light", "light-accent-primary", "color.accent.on-accent")))
      .toThrowError(EditorReducerError);
    expect(store.getState().tokens.sets.light?.tokens["light-accent-primary"]?.name).toBe("color.accent.primary");
  });
});
