import type { PointerActivityKind } from "./types";

export type PointerBehavior = "select-move" | "pan" | "frame-menu" | "creation";

/**
 * Classifies what the person is doing with the pointer from the active tool's
 * pointer behavior and the pressed-button mask. Buttonless movement is always
 * "pointing"; pressing while creating/dragging a frame is "drawing"; pressing
 * while in the selection tool is "fixing" (moving/adjusting the target).
 */
export function classifyPointerActivity(
  pointerBehavior: PointerBehavior,
  options: { buttons?: number } = {},
): PointerActivityKind {
  const pressed = (options.buttons ?? 0) > 0;
  if (!pressed) return "pointing";
  if (pointerBehavior === "creation" || pointerBehavior === "frame-menu") return "drawing";
  if (pointerBehavior === "select-move") return "fixing";
  return "pointing";
}

export type NodeGestureKind = "move" | "resize" | "rotate";

/** Element-adjusting gestures (move/resize/rotate) are always "fixing". */
export function classifyGestureActivity(kind: NodeGestureKind): PointerActivityKind {
  return "fixing";
}

/** Bridge commands that edit an element's style, text, or geometry. */
export const FIXING_EDIT_COMMANDS = [
  "set-inline-style",
  "set-text",
  "commit-text-edit",
  "set-shape-radius",
  "delete-element",
] as const;

export function isFixingEditCommand(command: string): boolean {
  return (FIXING_EDIT_COMMANDS as readonly string[]).includes(command);
}
