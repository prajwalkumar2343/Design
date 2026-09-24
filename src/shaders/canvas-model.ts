import type { Point, Rect, Size } from "../canvas/types";
import type { ShaderParams } from "./params";
import { isShaderId, type ShaderId } from "./registry";

/**
 * A shader placed directly on the infinite canvas (world coordinates).
 * Shader elements are session-scoped canvas artifacts — they render live
 * Paper Shaders via the parent document, not inside a frame's iframe.
 *
 * `params` holds the user's edits to the shader's own props (colors, speed,
 * sizing, …); when absent the component renders its built-in defaults.
 * `radius` is the element's corner rounding in px (the stage inside is
 * inset, so its radius is SHADER_ELEMENT_RADIUS_INSET smaller).
 */
export interface CanvasShaderElement extends Rect {
  id: string;
  shaderId: ShaderId;
  params?: ShaderParams;
  radius?: number;
}

export const SHADER_ELEMENT_DEFAULT_SIZE: Size = { width: 340, height: 240 };
export const SHADER_ELEMENT_MIN_SIZE: Size = { width: 96, height: 72 };
export const SHADER_ELEMENT_DEFAULT_RADIUS = 12;
/** Gap between the element's outer radius and the clipped stage's radius. */
export const SHADER_ELEMENT_RADIUS_INSET = 3;

/** Corner radius can't exceed a full pill on the element's short axis. */
export function maxShaderElementRadius(element: Pick<CanvasShaderElement, "width" | "height">): number {
  return Math.max(0, Math.floor(Math.min(element.width, element.height) / 2));
}

export function createCanvasShaderElement(shaderId: string, worldCenter: Point): CanvasShaderElement | null {
  if (!isShaderId(shaderId)) return null;
  if (!Number.isFinite(worldCenter.x) || !Number.isFinite(worldCenter.y)) return null;
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
    width: Number.isFinite(width)
      ? Math.max(SHADER_ELEMENT_MIN_SIZE.width, Math.round(width))
      : SHADER_ELEMENT_MIN_SIZE.width,
    height: Number.isFinite(height)
      ? Math.max(SHADER_ELEMENT_MIN_SIZE.height, Math.round(height))
      : SHADER_ELEMENT_MIN_SIZE.height,
  };
}

function createElementId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
