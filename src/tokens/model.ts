/**
 * Native token theme store: domain model.
 *
 * Tokens are W3C DTCG-compatible by construction: every token carries a dot-path
 * `name` (e.g. `color.accent.primary`), a `$type`-mappable `type`, a `$value`
 * (`value`), and an optional `description`, so JSON export matches the DTCG
 * shape `{ $value, $type, description? }` nested by name path.
 *
 * Wireframe boundary: tokens apply to design mode only. Wireframe rendering
 * keeps its Canvas-owned neutral grayscale theme (`src/frame/wireframe-theme.ts`)
 * and never receives token CSS; see `src/frame/token-theme.ts`.
 */

export type TokenType =
  | "color"
  | "typography"
  | "spacing"
  | "radius"
  | "shadow"
  | "motion"
  | "opacity";

export interface TypographyValue {
  fontFamily: string;
  fontSize: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
}

export interface MotionValue {
  duration: string;
  easing: string;
}

export type TokenValue = string | number | TypographyValue | MotionValue;

export interface DesignToken {
  id: string;
  /** Dot path such as `color.accent.primary`; segments are lowercase kebab. */
  name: string;
  type: TokenType;
  value: TokenValue;
  description?: string;
}

export interface TokenSet {
  id: string;
  name: string;
  description?: string;
  tokens: Record<string, DesignToken>;
}

export interface TokenTheme {
  id: string;
  name: string;
  description?: string;
  /** Set ids merged in order; later sets win on name collisions. */
  setIds: string[];
}

export interface TokenStoreState {
  sets: Record<string, TokenSet>;
  themes: Record<string, TokenTheme>;
  activeThemeId: string | null;
  /** Monotonic revision; every accepted mutation increments by one. */
  revision: number;
}

export function createEmptyTokenStore(): TokenStoreState {
  return { sets: {}, themes: {}, activeThemeId: null, revision: 0 };
}

export const TOKEN_TYPES: readonly TokenType[] = [
  "color",
  "typography",
  "spacing",
  "radius",
  "shadow",
  "motion",
  "opacity",
];

export const TOKEN_TYPE_LABELS: Record<TokenType, string> = {
  color: "Color",
  typography: "Typography",
  spacing: "Spacing",
  radius: "Radius",
  shadow: "Shadow",
  motion: "Motion",
  opacity: "Opacity",
};

/** Maps internal token types to W3C DTCG `$type` names for JSON export. */
export function dtcgTypeForTokenType(type: TokenType): string {
  switch (type) {
    case "color":
      return "color";
    case "typography":
      return "typography";
    case "spacing":
      return "dimension";
    case "radius":
      return "dimension";
    case "shadow":
      return "shadow";
    case "motion":
      return "transition";
    case "opacity":
      return "opacity";
  }
}

/** Turns `color.accent.primary` into `--color-accent-primary` (+ suffix). */
export function cssVariableName(tokenName: string, suffix?: string): string {
  const base = `--${tokenName.split(".").join("-")}`;
  return suffix ? `${base}-${suffix}` : base;
}

/**
 * DTCG alias syntax: a whole-string `{group.path}` reference. Only scalar
 * (string-valued) tokens may hold aliases; composite typography/motion values
 * keep their object shape.
 */
export const TOKEN_ALIAS_PATTERN = /^\{([a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*){0,3})\}$/;

/** True when the value is a `{token.path}` alias reference. */
export function isTokenAlias(value: unknown): boolean {
  return typeof value === "string" && TOKEN_ALIAS_PATTERN.test(value.trim());
}

/** Returns the referenced dot path for an alias value, else null. */
export function tokenAliasTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = TOKEN_ALIAS_PATTERN.exec(value.trim());
  return match ? (match[1] as string) : null;
}

/** Builds the `{token.path}` alias string for a token name. */
export function tokenAliasReference(name: string): string {
  return `{${name}}`;
}

/**
 * `var(--token-name)` applied to an element style is a durable link: it keeps
 * resolving to the token through value edits and theme switches, unlike a
 * coincidental value match. This is the apply mechanism for the properties
 * panel, mirroring Figma's "linked variable" state.
 */
const CSS_VAR_REFERENCE = /^var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)$/i;

/** True when the CSS value is a single `var(--x)` reference. */
export function isCssVariableReference(value: unknown): boolean {
  return typeof value === "string" && CSS_VAR_REFERENCE.test(value.trim());
}

/** `var(--color-accent-primary)` → `color-accent-primary` (no leading `--`). */
export function cssVariableReferenceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = CSS_VAR_REFERENCE.exec(value.trim());
  return match ? match[1].slice(2).toLowerCase() : null;
}

/** `color.accent.primary` → `var(--color-accent-primary)` (+ optional suffix). */
export function cssVariableReference(tokenName: string, suffix?: string): string {
  return `var(${cssVariableName(tokenName, suffix)})`;
}

/**
 * The CSS sub-property a token field emits for composite values, e.g. a
 * typography token's `fontSize` becomes the `-font-size` var suffix.
 */
export function cssVariableSuffixForProperty(property: string): string | null {
  switch (property.trim().toLowerCase()) {
    case "font-family":
      return "font-family";
    case "font-size":
      return "font-size";
    case "font-weight":
      return "font-weight";
    case "line-height":
      return "line-height";
    case "letter-spacing":
      return "letter-spacing";
    case "transition-duration":
    case "animation-duration":
      return "duration";
    case "transition-timing-function":
    case "animation-timing-function":
      return "easing";
    default:
      return null;
  }
}

/** The `var(--…)` an element style should carry to link this token on that CSS property. */
export function cssVariableReferenceForProperty(tokenName: string, property: string): string {
  const suffix = cssVariableSuffixForProperty(property);
  return cssVariableReference(tokenName, suffix ?? undefined);
}

/**
 * Inverts a `var(--x)` style back to a token dot path. Composite tokens emit
 * suffixed vars (`--typography-body-font-size`), so candidate names are
 * generated longest-suffix-first; callers check them against known tokens.
 */
export function tokenNameCandidatesForCssVariable(value: unknown): string[] {
  const varName = cssVariableReferenceName(value);
  if (!varName) return [];
  const candidates = [varName.replace(/-/g, ".")];
  const suffixes = [
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
    "duration", "easing",
  ];
  for (const suffix of suffixes) {
    const tail = `-${suffix}`;
    if (varName.endsWith(tail) && varName.length > tail.length) {
      candidates.push(varName.slice(0, -tail.length).replace(/-/g, "."));
    }
  }
  return candidates;
}

/**
 * Rewrites `var(--old-name…)` references inside document HTML after a token
 * rename. Only the exact var name plus known composite suffixes
 * (`--name-font-size`, …) are touched; `--name-other` is left alone.
 */
export function rewriteTokenCssReference(srcDoc: string, oldName: string, newName: string): string {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const oldVar = escape(cssVariableName(oldName).slice(2));
  const suffix = "(?:-(?:font-family|font-size|font-weight|line-height|letter-spacing|duration|easing))?";
  const pattern = new RegExp(`(--${oldVar})(${suffix})(?![\\w-])`, "g");
  return srcDoc.replace(pattern, `--${cssVariableName(newName).slice(2)}$2`);
}
