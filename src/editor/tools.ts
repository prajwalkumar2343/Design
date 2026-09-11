import type { CanvasCategory } from "../persistence/local-projects";

export type ToolId =
  | "select"
  | "hand"
  | "frame"
  | "rectangle"
  | "text"
  | "image"
  | "shader"
  | "comment";

export type ToolIconName =
  | "mouse-pointer-2"
  | "hand"
  | "frame"
  | "square"
  | "type"
  | "image"
  | "sparkles"
  | "message-circle";

export type ToolAvailability = "enabled" | "planned";

export type ToolPointerBehavior =
  | "select-move"
  | "pan"
  | "frame-menu"
  | "shader-menu"
  | "creation";

export type ShapeVariantId = "rectangle" | "ellipse" | "line" | "arrow" | "polygon" | "star";

export interface ShapeVariantDefinition {
  readonly id: ShapeVariantId;
  readonly label: string;
  readonly description: string;
}

export const SHAPE_VARIANTS: readonly ShapeVariantDefinition[] = [
  { id: "rectangle", label: "Rectangle", description: "Create a rectangle" },
  { id: "ellipse", label: "Ellipse", description: "Create an ellipse" },
  { id: "line", label: "Line", description: "Create a straight line" },
  { id: "arrow", label: "Arrow", description: "Create an arrow" },
  { id: "polygon", label: "Polygon", description: "Create a polygon" },
  { id: "star", label: "Star", description: "Create a star" },
];

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  readonly description: string;
  readonly shortcut: string;
  readonly icon: ToolIconName;
  readonly availability: ToolAvailability;
  readonly pointerBehavior: ToolPointerBehavior;
}

export const TOOL_REGISTRY: readonly ToolDefinition[] = [
  {
    id: "select",
    label: "Select",
    description: "Select and move frames",
    shortcut: "V",
    icon: "mouse-pointer-2",
    availability: "enabled",
    pointerBehavior: "select-move",
  },
  {
    id: "hand",
    label: "Hand",
    description: "Pan the canvas",
    shortcut: "H",
    icon: "hand",
    availability: "enabled",
    pointerBehavior: "pan",
  },
  {
    id: "frame",
    label: "Frame",
    description: "Add a responsive frame",
    shortcut: "F",
    icon: "frame",
    availability: "enabled",
    pointerBehavior: "frame-menu",
  },
  {
    id: "rectangle",
    label: "Rectangle",
    description: "Create a rectangle",
    shortcut: "R",
    icon: "square",
    availability: "enabled",
    pointerBehavior: "creation",
  },
  {
    id: "text",
    label: "Text",
    description: "Create a text layer",
    shortcut: "T",
    icon: "type",
    availability: "enabled",
    pointerBehavior: "creation",
  },
  {
    id: "image",
    label: "Image",
    description: "Place an image",
    shortcut: "I",
    icon: "image",
    availability: "enabled",
    pointerBehavior: "creation",
  },
  {
    id: "shader",
    label: "Shader",
    description: "Add an animated shader",
    shortcut: "S",
    icon: "sparkles",
    availability: "enabled",
    pointerBehavior: "shader-menu",
  },
  {
    id: "comment",
    label: "Comment",
    description: "Add a comment",
    shortcut: "C",
    icon: "message-circle",
    availability: "enabled",
    pointerBehavior: "creation",
  },
] as const;

export function getToolDefinition(toolId: ToolId): ToolDefinition {
  const definition = TOOL_REGISTRY.find((tool) => tool.id === toolId);
  if (!definition) {
    throw new Error(`Unknown editor tool: ${toolId}`);
  }
  return definition;
}

export function getToolForShortcut(key: string): ToolDefinition | undefined {
  const normalizedKey = key.trim().toUpperCase();
  return TOOL_REGISTRY.find(
    (tool) => tool.shortcut.length > 0 && tool.shortcut === normalizedKey,
  );
}

export function isToolAvailable(tool: ToolDefinition): boolean {
  return tool.availability === "enabled";
}

/** The store used `pan` before the professional tool registry introduced `hand`. */
export function normalizeActiveTool(tool: ToolId | "pan"): ToolId {
  return tool === "pan" ? "hand" : tool;
}

// ---------------------------------------------------------------------------
// Canvas category aware helpers
// Each canvas (website / mobile) has a slightly different tool palette and a
// different agent.md hardness spec (see CANVAS_AGENT_FILES).
// Tools overlap heavily — the divergence is in defaults, presets, and
// agent harness, not the core manipulation model.
// ---------------------------------------------------------------------------

/**
 * Tools per canvas category.
 * - website: all tools, full device family (mobile + tablet + desktop)
 * - mobile: same tools but frame presets are mobile+tablet only (no desktop)
 */
export function getToolsForCanvasCategory(canvas: CanvasCategory): readonly ToolDefinition[] {
  switch (canvas) {
    case "website":
      return TOOL_REGISTRY;
    case "mobile":
      // Mobile keeps the same gestures; the Dock will filter desktop
      // frame presets away. Subtle copy difference is surfaced in the UI
      // via getFramePresetSectionsForCanvasCategory.
      return TOOL_REGISTRY;
    default:
      return TOOL_REGISTRY;
  }
}

export function isToolVisibleForCanvas(toolId: ToolId, canvas: CanvasCategory): boolean {
  return getToolsForCanvasCategory(canvas).some((t) => t.id === toolId);
}
