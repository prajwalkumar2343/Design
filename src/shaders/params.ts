import { isCustomShaderId, type ShaderId } from "./registry";

/**
 * Editable surface of a shader element: every param is a plain serializable
 * value that maps 1:1 onto the underlying component's props (Paper Shaders
 * params for upstream shaders, FerroTideProps for custom ones).
 */
export type ShaderParamValue = number | boolean | string | string[];
export type ShaderParams = Record<string, ShaderParamValue>;

/** Minimal structural view of a library preset used by the editor UI. */
export interface ShaderPresetLike {
  readonly name: string;
  readonly params: Record<string, unknown>;
}

export type ShaderParamFieldKind =
  | "number"
  | "boolean"
  | "color"
  | "colors"
  | "select"
  | "image"
  | "text";

/** Visual grouping inside the shader inspector. */
export type ShaderParamGroup = "color" | "param" | "motion" | "sizing";

export interface ShaderParamField {
  name: string;
  label: string;
  kind: ShaderParamFieldKind;
  group: ShaderParamGroup;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}

/**
 * Enum params are string keys into the library's option maps
 * (DotGridShapes, DitheringTypes, …). Keyed by shader id + param name because
 * e.g. `shape` means something different on every shader — and is a plain
 * number on `waves`.
 */
const SHADER_ENUM_OPTIONS: Record<string, Record<string, readonly string[]>> = {
  dithering: {
    shape: ["simplex", "warp", "dots", "wave", "ripple", "swirl", "sphere"],
    type: ["random", "2x2", "4x4", "8x8"],
  },
  "image-dithering": {
    type: ["random", "2x2", "4x4", "8x8"],
  },
  "dot-grid": {
    shape: ["circle", "diamond", "square", "triangle"],
  },
  "fluted-glass": {
    shape: ["lines", "linesIrregular", "wave", "zigzag", "pattern"],
    distortionShape: ["prism", "lens", "contour", "cascade", "flat"],
  },
  "gem-smoke": {
    shape: ["none", "circle", "daisy", "diamond", "metaballs"],
  },
  "liquid-metal": {
    shape: ["none", "circle", "daisy", "diamond", "metaballs"],
  },
  "grain-gradient": {
    shape: ["wave", "dots", "truchet", "corners", "ripple", "blob", "sphere"],
  },
  "halftone-cmyk": {
    type: ["dots", "ink", "sharp"],
  },
  "halftone-dots": {
    type: ["classic", "gooey", "holes", "soft"],
    grid: ["square", "hex"],
  },
  "pulsing-border": {
    aspectRatio: ["auto", "square"],
  },
  warp: {
    shape: ["checks", "stripes", "edge"],
  },
};

/** Params whose option list is identical on every shader that has them. */
const SHARED_ENUM_OPTIONS: Record<string, readonly string[]> = {
  fit: ["none", "contain", "cover"],
};

/**
 * Shaders with an `image` param. The library omits `image` from preset params
 * (it isn't part of a preset's identity), so it's added to the field list
 * explicitly; an empty string maps to the shader's built-in imagery.
 */
const IMAGE_PARAM_SHADERS: ReadonlySet<string> = new Set([
  "fluted-glass",
  "gem-smoke",
  "halftone-cmyk",
  "halftone-dots",
  "heatmap",
  "image-dithering",
  "lens-distortion",
  "liquid-metal",
  "paper-texture",
  "water",
]);

/** Fixed ranges for params whose domain is defined by convention. */
const NUMBER_FIELD_RANGES: Record<string, { min: number; max: number; step: number }> = {
  speed: { min: -2, max: 2, step: 0.05 },
  frame: { min: 0, max: 100000, step: 100 },
  scale: { min: 0.01, max: 4, step: 0.01 },
  rotation: { min: -360, max: 360, step: 1 },
  angle: { min: -360, max: 360, step: 1 },
  angle1: { min: -360, max: 360, step: 1 },
  angle2: { min: -360, max: 360, step: 1 },
  focalAngle: { min: -360, max: 360, step: 1 },
  originX: { min: 0, max: 1, step: 0.01 },
  originY: { min: 0, max: 1, step: 0.01 },
  offsetX: { min: -1, max: 1, step: 0.01 },
  offsetY: { min: -1, max: 1, step: 0.01 },
  offset: { min: -1, max: 1, step: 0.01 },
  worldWidth: { min: 0, max: 4000, step: 10 },
  worldHeight: { min: 0, max: 4000, step: 10 },
};

/** Whole-number count-like params (checked before the 0..1 fallback). */
const INTEGER_PARAMS: ReadonlySet<string> = new Set([
  "count",
  "positions",
  "stepsPerColor",
  "octaveCount",
  "noiseIterations",
  "swirlIterations",
  "foldCount",
  "folds",
  "colorSteps",
  "spots",
  "bandCount",
  "repetition",
]);

/** Sizing/motion params render at the bottom of the editor, in this order. */
const SIZING_PARAM_ORDER = [
  "fit",
  "scale",
  "rotation",
  "originX",
  "originY",
  "offsetX",
  "offsetY",
  "worldWidth",
  "worldHeight",
] as const;
const MOTION_PARAM_ORDER = ["speed", "frame"] as const;

const SIZING_PARAMS: ReadonlySet<string> = new Set(SIZING_PARAM_ORDER);
const MOTION_PARAMS: ReadonlySet<string> = new Set(MOTION_PARAM_ORDER);

export function shaderParamLabel(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isColorishValue(value: string): boolean {
  return /^\s*(#|rgb|hsl|okl)/i.test(value);
}

function isColorishName(name: string): boolean {
  return /^color/i.test(name) || /color$/i.test(name);
}

/**
 * Slider domain for a numeric param: the curated name table first, then the
 * span of values the shader's own presets use (a good proxy for the intended
 * range), then a magnitude heuristic. The paired text input is never clamped,
 * so the slider only needs to be a sensible convenience range.
 */
function inferNumberRange(
  name: string,
  presets: readonly ShaderPresetLike[],
): { min: number; max: number; step: number } {
  const override = NUMBER_FIELD_RANGES[name];
  if (override) return override;

  const values = presets
    .map((preset) => preset.params[name])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const lo = values.length > 0 ? Math.min(...values) : 0;
  const hi = values.length > 0 ? Math.max(...values) : 0;

  if (INTEGER_PARAMS.has(name)) {
    return { min: Math.min(0, Math.floor(lo)), max: Math.max(8, Math.ceil(hi * 2)), step: 1 };
  }
  if (lo >= 0 && hi <= 1) return { min: 0, max: 1, step: 0.01 };
  if (lo >= -1 && hi <= 1) return { min: -1, max: 1, step: 0.01 };

  const integerish = values.every((value) => Number.isInteger(value));
  const min = lo < 0 ? Math.floor(lo * 1.5) : 0;
  if (integerish) {
    return { min, max: Math.max(4, Math.ceil(hi * 2)), step: hi > 20 ? 1 : 0.1 };
  }
  return { min, max: Math.ceil(Math.max(hi, 1) * 15) / 10, step: 0.01 };
}

function fieldForParam(
  shaderId: ShaderId,
  name: string,
  value: unknown,
  presets: readonly ShaderPresetLike[],
  group: ShaderParamGroup,
): ShaderParamField {
  const label = shaderParamLabel(name);
  const options = SHADER_ENUM_OPTIONS[shaderId]?.[name] ?? SHARED_ENUM_OPTIONS[name];
  if (options) {
    return { name, label, kind: "select", group, options };
  }
  if (Array.isArray(value)) {
    return { name, label, kind: "colors", group: "color" };
  }
  switch (typeof value) {
    case "boolean":
      return { name, label, kind: "boolean", group };
    case "number":
      return { name, label, kind: "number", group, ...inferNumberRange(name, presets) };
    case "string":
      return {
        name,
        label,
        kind: isColorishName(name) || isColorishValue(value) ? "color" : "text",
        group: isColorishName(name) || isColorishValue(value) ? "color" : group,
      };
    default:
      return { name, label, kind: "text", group };
  }
}

/**
 * Local shaders have no library preset table describing their props, so the
 * field list is hand-written per shader id. Ferro Tide's mood options are the
 * preset names themselves (loadPaperShader publishes the mood list as
 * presets), keeping the panel and the shader source in sync.
 */
function customShaderParamFields(
  shaderId: ShaderId,
  presets: readonly ShaderPresetLike[],
): ShaderParamField[] {
  if (shaderId === "ferro-tide") {
    return [
      { name: "mood", label: "Mood", kind: "select", group: "param", options: presets.map((preset) => preset.name) },
      { name: "interactive", label: "Interactive", kind: "boolean", group: "param" },
    ];
  }
  return [];
}

/**
 * Every editable param of a shader, as field descriptors in display order:
 * image source, then the shader's own params in preset order, then motion
 * (speed, frame), then canvas sizing (fit, scale, rotation, …). The preset
 * list doubles as the param source — the library types preset params as
 * Required<Params>, so preset[0] enumerates the complete editable surface.
 */
export function deriveShaderParamFields(
  shaderId: ShaderId,
  presets: readonly ShaderPresetLike[],
): ShaderParamField[] {
  if (isCustomShaderId(shaderId)) {
    return customShaderParamFields(shaderId, presets);
  }
  const params = presets[0]?.params;
  if (!params) return [];

  const fields: ShaderParamField[] = [];
  if (IMAGE_PARAM_SHADERS.has(shaderId)) {
    fields.push({ name: "image", label: "Image", kind: "image", group: "param" });
  }
  const keys = Object.keys(params);
  const own = keys.filter((key) => !SIZING_PARAMS.has(key) && !MOTION_PARAMS.has(key));
  const motion = MOTION_PARAM_ORDER.filter((key) => key in params);
  const sizing = SIZING_PARAM_ORDER.filter((key) => key in params);
  for (const name of own) {
    fields.push(fieldForParam(shaderId, name, params[name], presets, "param"));
  }
  for (const name of motion) {
    fields.push(fieldForParam(shaderId, name, params[name], presets, "motion"));
  }
  for (const name of sizing) {
    fields.push(fieldForParam(shaderId, name, params[name], presets, "sizing"));
  }
  return fields;
}
