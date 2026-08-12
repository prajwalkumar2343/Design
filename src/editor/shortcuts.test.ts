import { describe, expect, it } from "vitest";

import { resolveEditorShortcut } from "./shortcuts";

describe("editor keyboard shortcuts", () => {
  it("activates enabled tools and opens the frame menu for F", () => {
    expect(resolveEditorShortcut({ key: "v" })).toEqual({
      type: "activate-tool",
      tool: "select",
      openFrameMenu: false,
    });
    expect(resolveEditorShortcut({ key: "h" })).toEqual({
      type: "activate-tool",
      tool: "hand",
      openFrameMenu: false,
    });
    expect(resolveEditorShortcut({ key: "f" })).toEqual({
      type: "activate-tool",
      tool: "frame",
      openFrameMenu: true,
    });
  });

  it("activates the core creation tools and reserves I for images", () => {
    expect(resolveEditorShortcut({ key: "r" })).toMatchObject({ type: "activate-tool", tool: "rectangle" });
    expect(resolveEditorShortcut({ key: "t" })).toMatchObject({ type: "activate-tool", tool: "text" });
    expect(resolveEditorShortcut({ key: "p" })).toMatchObject({ type: "activate-tool", tool: "pen" });
    expect(resolveEditorShortcut({ key: "c" })).toMatchObject({ type: "activate-tool", tool: "comment" });
    expect(resolveEditorShortcut({ key: "i" })).toMatchObject({ type: "activate-tool", tool: "image" });
    expect(resolveEditorShortcut({ key: "i", shiftKey: true })).toBeNull();
  });

  it("resolves undo and redo across platform modifier conventions", () => {
    expect(resolveEditorShortcut({ key: "z", metaKey: true })).toEqual({ type: "undo" });
    expect(resolveEditorShortcut({ key: "z", ctrlKey: true, shiftKey: true })).toEqual({
      type: "redo",
    });
    expect(resolveEditorShortcut({ key: "y", ctrlKey: true })).toEqual({ type: "redo" });
  });

  it("reserves modified keys for safe editing commands", () => {
    expect(resolveEditorShortcut({ key: "v", ctrlKey: true })).toEqual({ type: "paste-selection" });
    expect(resolveEditorShortcut({ key: "f", metaKey: true })).toBeNull();
  });

  it("supports escape and fit-all semantics", () => {
    expect(resolveEditorShortcut({ key: "Escape" })).toEqual({ type: "escape" });
    expect(resolveEditorShortcut({ key: "0" })).toEqual({ type: "fit-all" });
  });
});
