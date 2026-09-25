import { describe, expect, it } from "vitest";
import { getShaderMountProps } from "./sample-image";

describe("getShaderMountProps", () => {
  it("mounts image-filter shaders on the bundled sample image", () => {
    for (const shaderId of ["fluted-glass", "heatmap", "image-dithering", "lens-distortion"] as const) {
      const props = getShaderMountProps(shaderId);
      expect(String(props.image)).toContain("shader-filter-sample");
    }
  });

  it("mounts generated shaders with no props and a frozen record", () => {
    for (const shaderId of ["mesh-gradient", "water", "ferro-tide"] as const) {
      const props = getShaderMountProps(shaderId);
      expect(props).toEqual({});
      expect(Object.isFrozen(props)).toBe(true);
    }
  });
});
