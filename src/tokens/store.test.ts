import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createEmptyEditorState,
  removeTokenCommand,
  removeTokenSetCommand,
  removeTokenThemeCommand,
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
});
