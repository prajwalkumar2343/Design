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
