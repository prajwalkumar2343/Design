import { getToolForShortcut, isToolAvailable, type ToolId } from "./tools";

export interface ShortcutInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type EditorShortcutAction =
  | { type: "activate-tool"; tool: ToolId; openFrameMenu: boolean }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "copy-selection" }
  | { type: "paste-selection" }
  | { type: "duplicate-selection" }
  | { type: "delete-selection" }
  | { type: "escape" }
  | { type: "fit-all" };

function hasCommandModifier(input: ShortcutInput): boolean {
  return Boolean(input.metaKey || input.ctrlKey);
}

export function resolveEditorShortcut(
  input: ShortcutInput,
): EditorShortcutAction | null {
  const key = input.key.toLowerCase();
  const commandModifier = hasCommandModifier(input);

  if (commandModifier && !input.altKey && key === "z") {
    return { type: input.shiftKey ? "redo" : "undo" };
  }

  if (commandModifier && !input.altKey && key === "y" && !input.shiftKey) {
    return { type: "redo" };
  }

  if (commandModifier && !input.altKey && !input.shiftKey && key === "c") {
    return { type: "copy-selection" };
  }
  if (commandModifier && !input.altKey && !input.shiftKey && key === "v") {
    return { type: "paste-selection" };
  }
  if (commandModifier && !input.altKey && !input.shiftKey && key === "d") {
    return { type: "duplicate-selection" };
  }

  if (commandModifier || input.shiftKey || input.altKey) {
    return null;
  }

  if (key === "escape") {
    return { type: "escape" };
  }

  if (key === "0") {
    return { type: "fit-all" };
  }

  if (key === "delete" || key === "backspace") {
    return { type: "delete-selection" };
  }

  const tool = getToolForShortcut(input.key);
  if (!tool || !isToolAvailable(tool)) {
    return null;
  }

  return {
    type: "activate-tool",
    tool: tool.id,
    openFrameMenu: tool.id === "frame",
  };
}

export function isSpaceShortcut(key: string): boolean {
  return key === " " || key.toLowerCase() === "spacebar";
}
