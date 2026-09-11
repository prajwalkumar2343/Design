/**
 * Theme resolution and token/value mapping.
 *
 * A theme merges its sets in order (later sets win on name collisions), so the
 * active theme yields one flat name -> token map. `findTokenForCssValue` maps a
 * live CSS property/value pair back to that map, which is how PropertiesPanel
 * shows token references and flags off-system raw values.
 *
 * Wireframe boundary: resolution only feeds design-mode rendering and editing.
 * Wireframe frames never consult tokens.
 *
 * Color comparison is canonical (hex incl. short forms vs. rgb()/rgba()),
 * because live computed styles report rgb() while authors write hex.
 */
import type { DesignToken, TokenStoreState, TokenType } from "./model";

export interface ResolvedToken {
  token: DesignToken;
  setId: string;
}

const COLOR_PROPERTIES: ReadonlySet<string> = new Set([
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
  "stop-color",
  "flood-color",
  "lighting-color",
]);

const SPACING_PROPERTIES: ReadonlySet<string> = new Set([
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "row-gap",
  "column-gap",
]);

const RADIUS_PROPERTIES: ReadonlySet<string> = new Set([
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
]);

const SHADOW_PROPERTIES: ReadonlySet<string> = new Set(["box-shadow", "text-shadow"]);

/** CSS property -> token type for properties the panel can map. Null = unmapped. */
export function tokenTypeForCssProperty(property: string): TokenType | null {
  const key = property.trim().toLowerCase();
  if (COLOR_PROPERTIES.has(key)) return "color";
  if (SPACING_PROPERTIES.has(key)) return "spacing";
  if (RADIUS_PROPERTIES.has(key)) return "radius";
  if (SHADOW_PROPERTIES.has(key)) return "shadow";
  if (key === "opacity") return "opacity";
  if (
    key === "font-family" ||
    key === "font-size" ||
    key === "font-weight" ||
    key === "line-height" ||
    key === "letter-spacing"
  ) {
    return "typography";
  }
  if (
    key === "transition-duration" ||
    key === "transition-timing-function" ||
    key === "animation-duration" ||
    key === "animation-timing-function"
  ) {
    return "motion";
  }
  return null;
}

function typographyFieldForProperty(property: string): string | null {
  switch (property.trim().toLowerCase()) {
    case "font-family":
      return "fontFamily";
    case "font-size":
      return "fontSize";
    case "font-weight":
      return "fontWeight";
    case "line-height":
      return "lineHeight";
    case "letter-spacing":
      return "letterSpacing";
    default:
      return null;
  }
}

function motionFieldForProperty(property: string): "duration" | "easing" | null {
  const key = property.trim().toLowerCase();
  if (key === "transition-duration" || key === "animation-duration") return "duration";
  if (key === "transition-timing-function" || key === "animation-timing-function") return "easing";
  return null;
}

export function normalizeCssValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Merges the active theme's sets in order; later sets win on name collisions. */
export function resolveActiveThemeTokens(store: TokenStoreState): ResolvedToken[] {
  const theme = store.activeThemeId ? store.themes[store.activeThemeId] : undefined;
  if (!theme) return [];
  const byName = new Map<string, ResolvedToken>();
  for (const setId of theme.setIds) {
    const set = store.sets[setId];
    if (!set) continue;
    for (const token of Object.values(set.tokens)) {
      byName.set(token.name, { token, setId });
    }
  }
  return [...byName.values()].sort((a, b) => a.token.name.localeCompare(b.token.name));
}

export interface TokenMatch {
  tokenId: string;
  tokenName: string;
  setId: string;
  type: TokenType;
}

/**
 * Returns the active-theme token whose value equals the live CSS value, or
 * null when the property is unmapped or the value is off-system (raw).
 */
export function findTokenForCssValue(
  store: TokenStoreState,
  property: string,
  rawValue: string,
): TokenMatch | null {
  const type = tokenTypeForCssProperty(property);
  if (!type || rawValue.trim().length === 0) return null;
  const wanted = normalizeCssValue(rawValue).toLowerCase();
  for (const { token, setId } of resolveActiveThemeTokens(store)) {
    if (token.type !== type) continue;
    if (tokenValueMatches(token, type, property, wanted)) {
      return { tokenId: token.id, tokenName: token.name, setId, type };
    }
  }
  return null;
}

/**
 * True when a mappable property holds a raw value with no matching token.
 * Unmapped properties and empty values are never flagged.
 */
export function isOffSystemValue(store: TokenStoreState, property: string, rawValue: string): boolean {
  if (tokenTypeForCssProperty(property) === null || rawValue.trim().length === 0) return false;
  return findTokenForCssValue(store, property, rawValue) === null;
}

interface RgbChannels {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** CSS named colors, keyed by lowercase name → hex (parsed through the hex path). */
const NAMED_COLOR_HEX: Record<string, string> = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4",
  azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000",
  blanchedalmond: "#ffebcd", blue: "#0000ff", blueviolet: "#8a2be2", brown: "#a52a2a",
  burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e",
  coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9", darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b", darkolivegreen: "#556b2f", darkorange: "#ff8c00", darkorchid: "#9932cc",
  darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3",
  deeppink: "#ff1493", deepskyblue: "#00bfff", dimgray: "#696969", dimgrey: "#696969",
  dodgerblue: "#1e90ff", firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22",
  fuchsia: "#ff00ff", gainsboro: "#dcdcdc", ghostwhite: "#f8f8ff", gold: "#ffd700",
  goldenrod: "#daa520", gray: "#808080", green: "#008000", greenyellow: "#adff2f",
  grey: "#808080", honeydew: "#f0fff0", hotpink: "#ff69b4", indianred: "#cd5c5c",
  indigo: "#4b0082", ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa",
  lavenderblush: "#fff0f5", lawngreen: "#7cfc00", lemonchiffon: "#fffacd", lightblue: "#add8e6",
  lightcoral: "#f08080", lightcyan: "#e0ffff", lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3",
  lightgreen: "#90ee90", lightgrey: "#d3d3d3", lightpink: "#ffb6c1", lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa", lightskyblue: "#87cefa", lightslategray: "#778899", lightslategrey: "#778899",
  lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", lime: "#00ff00", limegreen: "#32cd32",
  linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd", mediumorchid: "#ba55d3", mediumpurple: "#9370db", mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc", mediumvioletred: "#c71585",
  midnightblue: "#191970", mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5",
  navajowhite: "#ffdead", navy: "#000080", oldlace: "#fdf5e6", olive: "#808000",
  olivedrab: "#6b8e23", orange: "#ffa500", orangered: "#ff4500", orchid: "#da70d6",
  palegoldenrod: "#eee8aa", palegreen: "#98fb98", paleturquoise: "#afeeee", palevioletred: "#db7093",
  papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb",
  plum: "#dda0dd", powderblue: "#b0e0e6", purple: "#800080", rebeccapurple: "#663399",
  red: "#ff0000", rosybrown: "#bc8f8f", royalblue: "#4169e1", saddlebrown: "#8b4513",
  salmon: "#fa8072", sandybrown: "#f4a460", seagreen: "#2e8b57", seashell: "#fff5ee",
  sienna: "#a0522d", silver: "#c0c0c0", skyblue: "#87ceeb", slateblue: "#6a5acd",
  slategray: "#708090", slategrey: "#708090", snow: "#fffafa", springgreen: "#00ff7f",
  steelblue: "#4682b4", tan: "#d2b48c", teal: "#008080", thistle: "#d8bfd8",
  tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee", wheat: "#f5deb3",
  white: "#ffffff", whitesmoke: "#f5f5f5", yellow: "#ffff00", yellowgreen: "#9acd32",
};

const RGB_FUNCTION = /^rgba?\(\s*(-?[\d.]+%?)\s*,\s*(-?[\d.]+%?)\s*,\s*(-?[\d.]+%?)\s*(?:,\s*([\d.]+%?)\s*)?\)$/i;
const HSL_FUNCTION = /^hsla?\(\s*(-?[\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+%?)\s*)?\)$/i;

function parseRgbChannel(raw: string): number {
  const value = raw.endsWith("%") ? (Number(raw.slice(0, -1)) / 100) * 255 : Number(raw);
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseAlphaChannel(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * Math.min(1, Math.max(0, s));
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] :
    [c, 0, x];
  const m = l - c / 2;
  return [
    Math.min(255, Math.max(0, Math.round((r + m) * 255))),
    Math.min(255, Math.max(0, Math.round((g + m) * 255))),
    Math.min(255, Math.max(0, Math.round((b + m) * 255))),
  ];
}

function parseColorChannels(value: string): RgbChannels | null {
  const normalized = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(normalized);
  if (hex) {
    let digits = hex[1] as string;
    if (digits.length === 3 || digits.length === 4) {
      digits = digits.split("").map((channel) => channel + channel).join("");
    }
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = RGB_FUNCTION.exec(normalized);
  if (rgb) {
    return {
      r: parseRgbChannel(rgb[1]),
      g: parseRgbChannel(rgb[2]),
      b: parseRgbChannel(rgb[3]),
      a: parseAlphaChannel(rgb[4]),
    };
  }
  const hsl = HSL_FUNCTION.exec(normalized);
  if (hsl) {
    const [r, g, b] = hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
    return { r, g, b, a: parseAlphaChannel(hsl[4]) };
  }
  if (normalized === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED_COLOR_HEX[normalized];
  if (named) return parseColorChannels(named);
  return null;
}

/** Canonical color equality across hex and rgb() spellings. */
export function colorsEqual(left: string, right: string): boolean {
  if (left === right) return true;
  const a = parseColorChannels(left);
  const b = parseColorChannels(right);
  if (!a || !b) return false;
  return a.r === b.r && a.g === b.g && a.b === b.b && Math.abs(a.a - b.a) < 1e-6;
}

function tokenValueMatches(token: DesignToken, type: TokenType, property: string, wanted: string): boolean {
  switch (type) {
    case "color":
      return typeof token.value === "string" &&
        colorsEqual(normalizeCssValue(token.value).toLowerCase(), wanted);
    case "spacing":
    case "radius":
    case "shadow":
      return typeof token.value === "string" && normalizeCssValue(token.value).toLowerCase() === wanted;
    case "opacity":
      return typeof token.value === "number" && numbersEqual(token.value, Number(wanted));
    case "typography": {
      const field = typographyFieldForProperty(property);
      if (!field || typeof token.value !== "object") return false;
      const actual = (token.value as unknown as Record<string, unknown>)[field];
      return typeof actual === "string" && normalizeCssValue(actual).toLowerCase() === wanted;
    }
    case "motion": {
      const field = motionFieldForProperty(property);
      if (!field || typeof token.value !== "object") return false;
      const actual = (token.value as unknown as Record<string, unknown>)[field];
      return typeof actual === "string" && normalizeCssValue(actual).toLowerCase() === wanted;
    }
  }
}

function numbersEqual(left: number, right: number): boolean {
  return Number.isFinite(right) && Math.abs(left - right) < 1e-9;
}
