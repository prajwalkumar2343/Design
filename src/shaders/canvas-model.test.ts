import { describe, expect, it } from "vitest";

import {
  SHADER_ELEMENT_DEFAULT_SIZE,
  SHADER_ELEMENT_MIN_SIZE,
  clampShaderElementSize,
  createCanvasShaderElement,
} from "./canvas-model";

describe("canvas shader elements", () => {
  it("creates a registered shader centered on the requested world point", () => {
    const element = createCanvasShaderElement("mesh-gradient", { x: 100, y: 200 });
    expect(element).not.toBeNull();
    expect(element?.shaderId).toBe("mesh-gradient");
    expect(element?.width).toBe(SHADER_ELEMENT_DEFAULT_SIZE.width);
    expect(element?.height).toBe(SHADER_ELEMENT_DEFAULT_SIZE.height);
    expect(element?.x).toBe(Math.round(100 - SHADER_ELEMENT_DEFAULT_SIZE.width / 2));
    expect(element?.y).toBe(Math.round(200 - SHADER_ELEMENT_DEFAULT_SIZE.height / 2));
    expect(element?.id).toMatch(/^shader-/);
  });

  it("rejects unregistered shader identifiers", () => {
    expect(createCanvasShaderElement("unknown-effect", { x: 0, y: 0 })).toBeNull();
  });

  it("clamps resize attempts to the minimum element size", () => {
    expect(clampShaderElementSize(20, 10)).toEqual(SHADER_ELEMENT_MIN_SIZE);
    expect(clampShaderElementSize(320.6, 199.4)).toEqual({ width: 321, height: 199 });
  });
});
