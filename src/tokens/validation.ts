/**
 * Fail-closed validation for the token theme store.
 * Every rejection carries a stable typed error code, matching the admission
 * modules (`src/router/wireframe-admission.ts`) convention.
 */
import {
  TOKEN_TYPES,
  type DesignToken,
  type MotionValue,
  type TokenSet,
  type TokenStoreState,
  type TokenTheme,
  type TokenType,
  type TokenValue,
  type TypographyValue,
} from "./model";

export type TokenValidationErrorCode =
  | "invalid-token-id"
  | "invalid-token-name"
  | "duplicate-token"
  | "unknown-token"
  | "invalid-token-type"
  | "invalid-token-value"
  | "duplicate-set"
  | "unknown-set"
  | "invalid-set-name"
  | "duplicate-theme"
  | "unknown-theme"
  | "invalid-theme-name"
  | "invalid-theme-sets"
  | "invalid-revision"
  | "stale-revision"
  | "invalid-input";

export class TokenValidationError extends Error {
  readonly code: TokenValidationErrorCode;
  readonly path: string;

  constructor(code: TokenValidationErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "TokenValidationError";
    this.code = code;
    this.path = path;
  }
}

function fail(code: TokenValidationErrorCode, path: string, message: string): never {
  throw new TokenValidationError(code, path, message);
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const NAME_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 160;

export function validateTokenId(id: unknown, path: string): string {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    fail("invalid-token-id", path, "must be 1-128 chars of letters, digits, _ or -");
  }
  return id;
}

export function validateTokenName(name: unknown, path: string): string {
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME_LENGTH) {
    fail("invalid-token-name", path, "must be a non-empty dot path up to 160 chars");
  }
  const segments = name.split(".");
  if (segments.length < 1 || segments.length > 4) {
    fail("invalid-token-name", path, "must have 1-4 dot-separated segments");
  }
  for (const segment of segments) {
    if (!NAME_SEGMENT_PATTERN.test(segment)) {
      fail("invalid-token-name", path, `segment "${segment}" must be lowercase kebab-case`);
    }
  }
  return name;
}

export function validateTokenType(type: unknown, path: string): TokenType {
  if (typeof type !== "string" || !(TOKEN_TYPES as readonly string[]).includes(type)) {
    fail("invalid-token-type", path, `must be one of ${TOKEN_TYPES.join(", ")}`);
  }
  return type as TokenType;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_COLOR = /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+\s*)?\)$/i;
const HSL_COLOR = /^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+\s*)?\)$/i;
const NAMED_COLOR = /^[a-z]+$/;
const OKLCH_COLOR = /^(?:oklch|oklab|lab|lch|color)\(/i;

function validateColorValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    fail("invalid-token-value", path, "color must be a non-empty string up to 256 chars");
  }
  const trimmed = value.trim();
  if (
    HEX_COLOR.test(trimmed) ||
    RGB_COLOR.test(trimmed) ||
    HSL_COLOR.test(trimmed) ||
    OKLCH_COLOR.test(trimmed) ||
    NAMED_COLOR.test(trimmed.toLowerCase())
  ) {
    return value;
  }
  fail("invalid-token-value", path, "color must be hex, rgb(), hsl(), oklch()/lab(), or a named color");
}

const DIMENSION_VALUE = /^-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|svh|svw|ch|ex|cm|mm|in|pt|pc)?$/;

function validateDimensionValue(value: unknown, path: string, field: "spacing" | "radius"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    fail("invalid-token-value", path, `${field} must be a non-empty string up to 64 chars`);
  }
  const trimmed = value.trim();
  if (trimmed === "0" || DIMENSION_VALUE.test(trimmed)) return value;
  if (field === "spacing" && trimmed === "auto") return value;
  fail("invalid-token-value", path, `${field} must be a CSS dimension (e.g. 8px, 0.5rem, 50%)`);
}

function validateShadowValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) {
    fail("invalid-token-value", path, "shadow must be a non-empty string up to 500 chars");
  }
  const lowered = value.toLowerCase();
  if (lowered.includes("url(") || lowered.includes("expression(") || lowered.includes("javascript:")) {
    fail("invalid-token-value", path, "shadow must not contain urls or executable content");
  }
  return value;
}

function validateOpacityValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail("invalid-token-value", path, "opacity must be a finite number between 0 and 1");
  }
  return value;
}

function requireNonEmptyString(value: unknown, path: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
    fail("invalid-token-value", path, `${label} must be a non-empty string up to 256 chars`);
  }
  return value;
}

const TYPOGRAPHY_KEYS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"] as const;

function validateTypographyValue(value: unknown, path: string): TypographyValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid-token-value", path, "typography must be an object with fontFamily and fontSize");
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(TYPOGRAPHY_KEYS as readonly string[]).includes(key)) {
      fail("invalid-token-value", `${path}.${key}`, "unknown typography field");
    }
  }
  const output: TypographyValue = {
    fontFamily: requireNonEmptyString(input.fontFamily, `${path}.fontFamily`, "fontFamily"),
    fontSize: requireNonEmptyString(input.fontSize, `${path}.fontSize`, "fontSize"),
  };
  if (input.fontWeight !== undefined) output.fontWeight = requireNonEmptyString(input.fontWeight, `${path}.fontWeight`, "fontWeight");
  if (input.lineHeight !== undefined) output.lineHeight = requireNonEmptyString(input.lineHeight, `${path}.lineHeight`, "lineHeight");
  if (input.letterSpacing !== undefined) output.letterSpacing = requireNonEmptyString(input.letterSpacing, `${path}.letterSpacing`, "letterSpacing");
  return output;
}

const EASING_VALUE = /^(?:ease|linear|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\([^)]*\)|steps\([^)]*\))$/;
const DURATION_VALUE = /^\d+(?:\.\d+)?(?:ms|s)$/;

function validateMotionValue(value: unknown, path: string): MotionValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid-token-value", path, "motion must be an object with duration and easing");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes("duration") || !keys.includes("easing")) {
    fail("invalid-token-value", path, "motion must have exactly duration and easing");
  }
  const duration = requireNonEmptyString(input.duration, `${path}.duration`, "duration");
  if (!DURATION_VALUE.test(duration.trim())) {
    fail("invalid-token-value", `${path}.duration`, "duration must be ms or s (e.g. 200ms, 0.3s)");
  }
  const easing = requireNonEmptyString(input.easing, `${path}.easing`, "easing");
  if (!EASING_VALUE.test(easing.trim())) {
    fail("invalid-token-value", `${path}.easing`, "easing must be a CSS easing keyword or cubic-bezier()/steps()");
  }
  return { duration, easing };
}

/**
 * Angle brackets never appear in legitimate CSS values, but a `</style`
 * sequence inside a token value would terminate an injected style block when
 * themed HTML is serialized. Reject them fail-closed at the trust boundary.
 */
function assertNoMarkup(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (/[<>]/.test(value)) {
      fail("invalid-token-value", path, "token values must not contain < or >");
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      assertNoMarkup(entry, `${path}.${key}`);
    }
  }
}

export function validateTokenValue(type: TokenType, value: unknown, path: string): TokenValue {
  const result = validateTokenValueInner(type, value, path);
  assertNoMarkup(result, path);
  return result;
}

function validateTokenValueInner(type: TokenType, value: unknown, path: string): TokenValue {
  switch (type) {
    case "color":
      return validateColorValue(value, path);
    case "spacing":
      return validateDimensionValue(value, path, "spacing");
    case "radius":
      return validateDimensionValue(value, path, "radius");
    case "shadow":
      return validateShadowValue(value, path);
    case "opacity":
      return validateOpacityValue(value, path);
    case "typography":
      return validateTypographyValue(value, path);
    case "motion":
      return validateMotionValue(value, path);
  }
}

function validateDescription(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 500) {
    fail("invalid-input", path, "description must be a string up to 500 chars");
  }
  return value;
}

export function validateToken(input: unknown, path: string): DesignToken {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("invalid-token-value", path, "token must be an object");
  }
  const record = input as Record<string, unknown>;
  const type = validateTokenType(record.type, `${path}.type`);
  const token: DesignToken = {
    id: validateTokenId(record.id, `${path}.id`),
    name: validateTokenName(record.name, `${path}.name`),
    type,
    value: validateTokenValue(type, record.value, `${path}.value`),
  };
  const description = validateDescription(record.description, `${path}.description`);
  if (description !== undefined) token.description = description;
  return token;
}

export function validateTokenSet(input: unknown, path: string): TokenSet {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("invalid-input", path, "token set must be an object");
  }
  const record = input as Record<string, unknown>;
  const id = validateTokenId(record.id, `${path}.id`);
  if (typeof record.name !== "string" || record.name.trim().length === 0 || record.name.length > 80) {
    fail("invalid-set-name", `${path}.name`, "set name must be a non-empty string up to 80 chars");
  }
  if (typeof record.tokens !== "object" || record.tokens === null || Array.isArray(record.tokens)) {
    fail("invalid-input", `${path}.tokens`, "tokens must be an object keyed by token id");
  }
  const tokens: Record<string, DesignToken> = {};
  const names = new Set<string>();
  for (const [key, item] of Object.entries(record.tokens as Record<string, unknown>)) {
    const token = validateToken(item, `${path}.tokens.${key}`);
    if (token.id !== key) {
      fail("invalid-token-id", `${path}.tokens.${key}.id`, "token id must match its key in the set");
    }
    if (tokens[key]) fail("duplicate-token", `${path}.tokens.${key}`, `duplicate token ${key}`);
    if (names.has(token.name)) {
      fail("duplicate-token", `${path}.tokens.${key}.name`, `duplicate token name ${token.name}`);
    }
    names.add(token.name);
    tokens[key] = token;
  }
  const set: TokenSet = { id, name: record.name, tokens };
  const description = validateDescription(record.description, `${path}.description`);
  if (description !== undefined) set.description = description;
  return set;
}

export function validateTokenTheme(
  input: unknown,
  path: string,
  knownSetIds?: ReadonlySet<string>,
): TokenTheme {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("invalid-input", path, "theme must be an object");
  }
  const record = input as Record<string, unknown>;
  const id = validateTokenId(record.id, `${path}.id`);
  if (typeof record.name !== "string" || record.name.trim().length === 0 || record.name.length > 80) {
    fail("invalid-theme-name", `${path}.name`, "theme name must be a non-empty string up to 80 chars");
  }
  if (!Array.isArray(record.setIds) || record.setIds.length === 0 || record.setIds.length > 64) {
    fail("invalid-theme-sets", `${path}.setIds`, "theme must combine 1-64 token sets");
  }
  const seen = new Set<string>();
  const setIds: string[] = [];
  record.setIds.forEach((item, index) => {
    const setId = validateTokenId(item, `${path}.setIds[${index}]`);
    if (seen.has(setId)) fail("invalid-theme-sets", `${path}.setIds[${index}]`, `duplicate set ${setId}`);
    seen.add(setId);
    if (knownSetIds && !knownSetIds.has(setId)) {
      fail("unknown-set", `${path}.setIds[${index}]`, `unknown token set ${setId}`);
    }
    setIds.push(setId);
  });
  const theme: TokenTheme = { id, name: record.name, setIds };
  const description = validateDescription(record.description, `${path}.description`);
  if (description !== undefined) theme.description = description;
  return theme;
}

export function validateTokenRevision(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("invalid-revision", path, "revision must be a safe integer >= 0");
  }
  return value;
}

/** Revalidates a stored token state (e.g. on project import); fail-closed. */
export function validateTokenStore(input: unknown, path: string): TokenStoreState {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("invalid-input", path, "token store must be an object");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.sets !== "object" || record.sets === null || Array.isArray(record.sets)) {
    fail("invalid-input", `${path}.sets`, "sets must be an object keyed by set id");
  }
  if (typeof record.themes !== "object" || record.themes === null || Array.isArray(record.themes)) {
    fail("invalid-input", `${path}.themes`, "themes must be an object keyed by theme id");
  }
  const sets: Record<string, TokenSet> = {};
  for (const [key, item] of Object.entries(record.sets as Record<string, unknown>)) {
    const set = validateTokenSet(item, `${path}.sets.${key}`);
    if (set.id !== key) fail("duplicate-set", `${path}.sets.${key}.id`, "set id must match its key");
    sets[key] = set;
  }
  const knownSetIds = new Set(Object.keys(sets));
  const themes: Record<string, TokenTheme> = {};
  for (const [key, item] of Object.entries(record.themes as Record<string, unknown>)) {
    const theme = validateTokenTheme(item, `${path}.themes.${key}`, knownSetIds);
    if (theme.id !== key) fail("duplicate-theme", `${path}.themes.${key}.id`, "theme id must match its key");
    themes[key] = theme;
  }
  let activeThemeId: string | null = null;
  if (record.activeThemeId !== undefined && record.activeThemeId !== null) {
    activeThemeId = validateTokenId(record.activeThemeId, `${path}.activeThemeId`);
    if (!themes[activeThemeId]) {
      fail("unknown-theme", `${path}.activeThemeId`, `unknown theme ${activeThemeId}`);
    }
  }
  return {
    sets,
    themes,
    activeThemeId,
    revision: validateTokenRevision(record.revision, `${path}.revision`),
  };
}
