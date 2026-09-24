import { describe, expect, it } from "vitest";

import {
  deriveShaderParamFields,
  shaderParamLabel,
  type ShaderPresetLike,
} from "./params";

const MESH_PRESETS: readonly ShaderPresetLike[] = [
  {
    name: "Default",
    params: {
      fit: "contain",
      scale: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      originX: 0.5,
      originY: 0.5,
      worldWidth: 0,
      worldHeight: 0,
      speed: 1,
      frame: 0,
      colors: ["#e0eaff", "#241d9a"],
      distortion: 0.8,
      swirl: 0.1,
      grainMixer: 0,
      grainOverlay: 0,
    },
  },
];

describe("deriveShaderParamFields", () => {
  it("classifies every param of a preset into an editor field", () => {
    const fields = deriveShaderParamFields("mesh-gradient", MESH_PRESETS);
    const byName = new Map(fields.map((field) => [field.name, field]));

    expect(byName.get("colors")?.kind).toBe("colors");
    expect(byName.get("distortion")?.kind).toBe("number");
    expect(byName.get("fit")?.kind).toBe("select");
    expect(byName.get("fit")?.options).toEqual(["none", "contain", "cover"]);
    expect(byName.get("speed")).toMatchObject({ kind: "number", min: -2, max: 2 });
    expect(byName.get("worldWidth")).toMatchObject({ kind: "number", min: 0, max: 4000 });
  });

  it("orders shader params first, then motion, then sizing", () => {
    const fields = deriveShaderParamFields("mesh-gradient", MESH_PRESETS);
    const names = fields.map((field) => field.name);
    expect(names.indexOf("colors")).toBeLessThan(names.indexOf("speed"));
    expect(names.indexOf("speed")).toBeLessThan(names.indexOf("frame"));
    expect(names.indexOf("frame")).toBeLessThan(names.indexOf("fit"));
    expect(names.indexOf("scale")).toBeGreaterThan(names.indexOf("frame"));
  });

  it("maps shader-specific enum params to their option lists", () => {
    const presets: readonly ShaderPresetLike[] = [
      {
        name: "Default",
        params: { fit: "cover", shape: "lines", distortionShape: "prism", edges: 0.25 },
      },
    ];
    const fields = deriveShaderParamFields("fluted-glass", presets);
    const byName = new Map(fields.map((field) => [field.name, field]));
    expect(byName.get("shape")?.options).toContain("linesIrregular");
    expect(byName.get("distortionShape")?.options).toEqual(["prism", "lens", "contour", "cascade", "flat"]);
  });

  it("adds an image field for image-capable shaders only", () => {
    const imagePresets: readonly ShaderPresetLike[] = [{ name: "Default", params: { fit: "contain" } }];
    expect(deriveShaderParamFields("water", imagePresets).some((field) => field.name === "image")).toBe(true);
    expect(deriveShaderParamFields("mesh-gradient", MESH_PRESETS).some((field) => field.name === "image")).toBe(false);
  });

  it("treats color-like strings as colors and other strings as selects/text", () => {
    const presets: readonly ShaderPresetLike[] = [
      {
        name: "Default",
        params: { colorBack: "#000000", dispersionColor: 0.6, type: "8x8", label: "x" },
      },
    ];
    const fields = deriveShaderParamFields("dithering", presets);
    const byName = new Map(fields.map((field) => [field.name, field]));
    expect(byName.get("colorBack")?.kind).toBe("color");
    // dispersionColor is a number despite the name — value type wins.
    expect(byName.get("dispersionColor")?.kind).toBe("number");
    expect(byName.get("type")?.options).toEqual(["random", "2x2", "4x4", "8x8"]);
    expect(byName.get("label")?.kind).toBe("text");
  });

  it("derives numeric ranges from the preset value span", () => {
    const presets: readonly ShaderPresetLike[] = [
      { name: "A", params: { size: 2, gapX: 32, proportion: 0.5, count: 6 } },
      { name: "B", params: { size: 4, gapX: 40, proportion: 0.8, count: 10 } },
    ];
    const fields = deriveShaderParamFields("dot-grid", presets);
    const byName = new Map(fields.map((field) => [field.name, field]));
    expect(byName.get("proportion")).toMatchObject({ min: 0, max: 1 });
    expect(byName.get("count")).toMatchObject({ kind: "number", step: 1, min: 0 });
    expect(byName.get("count")?.max).toBeGreaterThanOrEqual(10);
    expect(byName.get("gapX")?.max).toBeGreaterThanOrEqual(40);
  });

  it("describes custom shaders with their own field list", () => {
    const presets: readonly ShaderPresetLike[] = [
      { name: "Abyss", params: { mood: "Abyss", interactive: true } },
      { name: "Magma", params: { mood: "Magma", interactive: true } },
    ];
    const fields = deriveShaderParamFields("ferro-tide", presets);
    expect(fields.map((field) => field.name)).toEqual(["mood", "interactive"]);
    expect(fields[0]).toMatchObject({ kind: "select", options: ["Abyss", "Magma"] });
    expect(fields[1]?.kind).toBe("boolean");
  });

  it("returns an empty list when a shader has no preset table", () => {
    expect(deriveShaderParamFields("mesh-gradient", [])).toEqual([]);
  });
});

describe("shaderParamLabel", () => {
  it("splits camelCase param names into words", () => {
    expect(shaderParamLabel("colorBack")).toBe("Color Back");
    expect(shaderParamLabel("stepsPerColor")).toBe("Steps Per Color");
    expect(shaderParamLabel("gapX")).toBe("Gap X");
    expect(shaderParamLabel("angle1")).toBe("Angle 1");
    expect(shaderParamLabel("linesIrregular")).toBe("Lines Irregular");
    expect(shaderParamLabel("fit")).toBe("Fit");
  });
});
