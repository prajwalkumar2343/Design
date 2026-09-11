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

function parseColorChannels(value: string): RgbChannels | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
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
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }
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
