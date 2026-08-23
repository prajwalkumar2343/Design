import type { Point, Rect, Size } from "../canvas/types";
import { isPaperShaderId, type PaperShaderId } from "./registry";

/**
 * A shader placed directly on the infinite canvas (world coordinates).
 * Shader elements are session-scoped canvas artifacts — they render live
 * Paper Shaders via the parent document, not inside a frame's iframe.
 */
export interface CanvasShaderElement extends Rect {
  id: string;
  shaderId: PaperShaderId;
}

export const SHADER_ELEMENT_DEFAULT_SIZE: Size = { width: 340, height: 240 };
export const SHADER_ELEMENT_MIN_SIZE: Size = { width: 96, height: 72 };

export function createCanvasShaderElement(shaderId: string, worldCenter: Point): CanvasShaderElement | null {
  if (!isPaperShaderId(shaderId)) return null;
  return {
    id: createElementId("shader"),
    shaderId,
    x: Math.round(worldCenter.x - SHADER_ELEMENT_DEFAULT_SIZE.width / 2),
    y: Math.round(worldCenter.y - SHADER_ELEMENT_DEFAULT_SIZE.height / 2),
    width: SHADER_ELEMENT_DEFAULT_SIZE.width,
    height: SHADER_ELEMENT_DEFAULT_SIZE.height,
  };
}

export function clampShaderElementSize(width: number, height: number): Size {
  return {
    width: Math.max(SHADER_ELEMENT_MIN_SIZE.width, Math.round(width)),
    height: Math.max(SHADER_ELEMENT_MIN_SIZE.height, Math.round(height)),
  };
}

function createElementId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
