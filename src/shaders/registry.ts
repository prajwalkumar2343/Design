import type { ComponentType } from "react";

type PaperShadersModule = typeof import("@paper-design/shaders-react");

type KeysMatching<Value, Expected> = {
  [Key in keyof Value]: Value[Key] extends Expected ? Key : never;
}[keyof Value];

type ShaderComponentExport = KeysMatching<
  PaperShadersModule,
  ComponentType<any>
>;

type ShaderPresetExport = KeysMatching<
  PaperShadersModule,
  readonly { name: string; params: unknown }[]
>;

interface ShaderDefinitionShape {
  label: string;
  componentExport: ShaderComponentExport;
  presetsExport: ShaderPresetExport;
}

/**
 * Internal catalog of Paper Shaders. It intentionally contains no rendering or
 * UI behavior; consumers opt into loading the runtime through `loadPaperShader`.
 */
export const PAPER_SHADER_DEFINITIONS = {
  "mesh-gradient": {
    label: "Mesh Gradient",
    componentExport: "MeshGradient",
    presetsExport: "meshGradientPresets",
  },
  "smoke-ring": {
    label: "Smoke Ring",
    componentExport: "SmokeRing",
    presetsExport: "smokeRingPresets",
  },
  "neuro-noise": {
    label: "Neuro Noise",
    componentExport: "NeuroNoise",
    presetsExport: "neuroNoisePresets",
  },
  "dot-orbit": {
    label: "Dot Orbit",
    componentExport: "DotOrbit",
    presetsExport: "dotOrbitPresets",
  },
  "dot-grid": {
    label: "Dot Grid",
    componentExport: "DotGrid",
    presetsExport: "dotGridPresets",
  },
  "simplex-noise": {
    label: "Simplex Noise",
    componentExport: "SimplexNoise",
    presetsExport: "simplexNoisePresets",
  },
  metaballs: {
    label: "Metaballs",
    componentExport: "Metaballs",
    presetsExport: "metaballsPresets",
  },
  waves: {
    label: "Waves",
    componentExport: "Waves",
    presetsExport: "wavesPresets",
  },
  "perlin-noise": {
    label: "Perlin Noise",
    componentExport: "PerlinNoise",
    presetsExport: "perlinNoisePresets",
  },
  voronoi: {
    label: "Voronoi",
    componentExport: "Voronoi",
    presetsExport: "voronoiPresets",
  },
  warp: {
    label: "Warp",
    componentExport: "Warp",
    presetsExport: "warpPresets",
  },
  "god-rays": {
    label: "God Rays",
    componentExport: "GodRays",
    presetsExport: "godRaysPresets",
  },
  spiral: {
    label: "Spiral",
    componentExport: "Spiral",
    presetsExport: "spiralPresets",
  },
  swirl: {
    label: "Swirl",
    componentExport: "Swirl",
    presetsExport: "swirlPresets",
  },
  dithering: {
    label: "Dithering",
    componentExport: "Dithering",
    presetsExport: "ditheringPresets",
  },
  "grain-gradient": {
    label: "Grain Gradient",
    componentExport: "GrainGradient",
    presetsExport: "grainGradientPresets",
  },
  "pulsing-border": {
    label: "Pulsing Border",
    componentExport: "PulsingBorder",
    presetsExport: "pulsingBorderPresets",
  },
  "color-panels": {
    label: "Color Panels",
    componentExport: "ColorPanels",
    presetsExport: "colorPanelsPresets",
  },
  "static-mesh-gradient": {
    label: "Static Mesh Gradient",
    componentExport: "StaticMeshGradient",
    presetsExport: "staticMeshGradientPresets",
  },
  "static-radial-gradient": {
    label: "Static Radial Gradient",
    componentExport: "StaticRadialGradient",
    presetsExport: "staticRadialGradientPresets",
  },
  "paper-texture": {
    label: "Paper Texture",
    componentExport: "PaperTexture",
    presetsExport: "paperTexturePresets",
  },
  "fluted-glass": {
    label: "Fluted Glass",
    componentExport: "FlutedGlass",
    presetsExport: "flutedGlassPresets",
  },
  water: {
    label: "Water",
    componentExport: "Water",
    presetsExport: "waterPresets",
  },
  "image-dithering": {
    label: "Image Dithering",
    componentExport: "ImageDithering",
    presetsExport: "imageDitheringPresets",
  },
  "lens-distortion": {
    label: "Lens Distortion",
    componentExport: "LensDistortion",
    presetsExport: "lensDistortionPresets",
  },
  heatmap: {
    label: "Heatmap",
    componentExport: "Heatmap",
    presetsExport: "heatmapPresets",
  },
  "liquid-metal": {
    label: "Liquid Metal",
    componentExport: "LiquidMetal",
    presetsExport: "liquidMetalPresets",
  },
  "halftone-dots": {
    label: "Halftone Dots",
    componentExport: "HalftoneDots",
    presetsExport: "halftoneDotsPresets",
  },
  "halftone-cmyk": {
    label: "Halftone CMYK",
    componentExport: "HalftoneCmyk",
    presetsExport: "halftoneCmykPresets",
  },
  "gem-smoke": {
    label: "Gem Smoke",
    componentExport: "GemSmoke",
    presetsExport: "gemSmokePresets",
  },
} as const satisfies Record<string, ShaderDefinitionShape>;

export type PaperShaderId = keyof typeof PAPER_SHADER_DEFINITIONS;

export type PaperShaderDefinition<Id extends PaperShaderId = PaperShaderId> =
  (typeof PAPER_SHADER_DEFINITIONS)[Id];

export const PAPER_SHADER_IDS = Object.freeze(
  Object.keys(PAPER_SHADER_DEFINITIONS) as PaperShaderId[],
);

export class UnsupportedPaperShaderError extends Error {
  readonly shaderId: string;

  constructor(shaderId: string) {
    super(`Unsupported Paper Shader: ${shaderId}`);
    this.name = "UnsupportedPaperShaderError";
    this.shaderId = shaderId;
  }
}

export function isPaperShaderId(value: string): value is PaperShaderId {
  return Object.hasOwn(PAPER_SHADER_DEFINITIONS, value);
}

export function getPaperShaderDefinition(
  shaderId: string,
): PaperShaderDefinition {
  if (!isPaperShaderId(shaderId)) {
    throw new UnsupportedPaperShaderError(shaderId);
  }

  return PAPER_SHADER_DEFINITIONS[shaderId];
}

export type LoadedPaperShader<Id extends PaperShaderId = PaperShaderId> = {
  id: Id;
  definition: PaperShaderDefinition<Id>;
  Component: PaperShadersModule[
    PaperShaderDefinition<Id>["componentExport"]
  ];
  presets: PaperShadersModule[PaperShaderDefinition<Id>["presetsExport"]];
};

/** Loads the shader implementation only when a consumer requests it. */
export async function loadPaperShader<Id extends PaperShaderId>(
  shaderId: Id,
): Promise<LoadedPaperShader<Id>> {
  const definition = getPaperShaderDefinition(
    shaderId,
  ) as PaperShaderDefinition<Id>;
  const shaderModule = await import("@paper-design/shaders-react");

  return {
    id: shaderId,
    definition,
    Component: shaderModule[definition.componentExport],
    presets: shaderModule[definition.presetsExport],
  } as LoadedPaperShader<Id>;
}

export type PaperShaderSupport =
  | { supported: true }
  | {
      supported: false;
      reason: "document-unavailable" | "webgl2-unavailable";
    };

export interface DetectPaperShaderSupportOptions {
  createCanvas?: () => HTMLCanvasElement;
}

/** Checks the WebGL2 requirement without importing or mounting a shader. */
export function detectPaperShaderSupport(
  options: DetectPaperShaderSupportOptions = {},
): PaperShaderSupport {
  const createCanvas =
    options.createCanvas ??
    (typeof document === "undefined"
      ? undefined
      : () => document.createElement("canvas"));

  if (!createCanvas) {
    return { supported: false, reason: "document-unavailable" };
  }

  try {
    const context = createCanvas().getContext("webgl2");
    if (!context) {
      return { supported: false, reason: "webgl2-unavailable" };
    }

    context.getExtension("WEBGL_lose_context")?.loseContext();
    return { supported: true };
  } catch {
    return { supported: false, reason: "webgl2-unavailable" };
  }
}
