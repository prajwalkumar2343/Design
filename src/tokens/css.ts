/**
 * Token exporters: CSS variables for live/render use and DTCG-style JSON for
 * interchange. Both derive from the resolved active theme (or an explicit
 * theme id), so exports always reflect what the canvas shows.
 *
 * Interchange profile, stated precisely: nested `$value` / `$type` groups
 * with string CSS values and plain `description`, matching the de-facto
 * tooling format this feature was scoped to. This is NOT strict conformance
 * with the W3C 2025.10 editors draft, which requires object-form values
 * (e.g. `{value, unit}` dimensions, `{colorSpace, components}` colors,
 * shadow/transition/typography composites), `$description`, no `$meta`, and
 * a closed `$type` enum without `opacity`. Verified against the draft schema
 * during audit; converting to it would make exports less useful to CSS
 * tooling, so the profile stays as scoped.
 */
import {
  cssVariableName,
  dtcgTypeForTokenType,
  type DesignToken,
  type MotionValue,
  type TokenStoreState,
  type TypographyValue,
} from "./model";
import { resolveActiveThemeTokens, type ResolvedToken } from "./resolve";

function cssDeclarationsForToken(token: DesignToken): Array<[string, string]> {
  const value = token.value;
  if (typeof value === "string") return [[cssVariableName(token.name), value]];
  if (typeof value === "number") return [[cssVariableName(token.name), String(value)]];
  if (token.type === "typography") {
    const typeValue = value as TypographyValue;
    const fields: Array<[string, string | undefined]> = [
      ["font-family", typeValue.fontFamily],
      ["font-size", typeValue.fontSize],
      ["font-weight", typeValue.fontWeight],
      ["line-height", typeValue.lineHeight],
      ["letter-spacing", typeValue.letterSpacing],
    ];
    return fields.flatMap(([suffix, field]) =>
      field !== undefined ? [[cssVariableName(token.name, suffix), field] as [string, string]] : [],
    );
  }
  if (token.type === "motion") {
    const motionValue = value as MotionValue;
    return [
      [cssVariableName(token.name, "duration"), motionValue.duration],
      [cssVariableName(token.name, "easing"), motionValue.easing],
    ];
  }
  return [];
}

/** `:root` variable block for the active theme; empty string when none. */
export function buildThemeCssVariables(store: TokenStoreState): string {
  const resolved = resolveActiveThemeTokens(store);
  if (resolved.length === 0) return "";
  const lines = [":root {"];
  for (const { token } of resolved) {
    for (const [name, cssValue] of cssDeclarationsForToken(token)) {
      lines.push(`  ${name}: ${cssValue};`);
    }
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/** Full `tokens.css` file text with a header comment. */
export function buildTokenCssFile(store: TokenStoreState, themeName?: string): string {
  const variables = buildThemeCssVariables(store);
  const label = themeName ?? store.activeThemeId ?? "tokens";
  return `/* Canvas design tokens: ${label} (generated, do not edit by hand) */\n${variables}`;
}

export interface DTCGTokenNode {
  $value: unknown;
  $type: string;
  description?: string;
}

interface DTCGGroup {
  [key: string]: DTCGGroup | DTCGTokenNode;
}

function isTokenNode(node: DTCGGroup | DTCGTokenNode): node is DTCGTokenNode {
  return typeof (node as DTCGTokenNode).$value !== "undefined";
}

function dtcgValueForToken(token: DesignToken): unknown {
  if (token.type === "motion") {
    const motionValue = token.value as MotionValue;
    return { duration: motionValue.duration, timingFunction: motionValue.easing };
  }
  return token.value;
}

function insertToken(root: DTCGGroup, resolved: ResolvedToken): void {
  const segments = resolved.token.name.split(".");
  let group = root;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      const existing = group[segment];
      const node: DTCGTokenNode = {
        $value: dtcgValueForToken(resolved.token),
        $type: dtcgTypeForTokenType(resolved.token.type),
      };
      if (resolved.token.description !== undefined) node.description = resolved.token.description;
      // A descendant name (e.g. "color.accent") may already have made this
      // segment a group — keep its children and let it carry the payload too.
      if (existing && !isTokenNode(existing)) {
        Object.assign(existing, node);
      } else {
        group[segment] = node;
      }
      return;
    }
    const next = group[segment];
    if (!next) {
      const created: DTCGGroup = {};
      group[segment] = created;
      group = created;
    } else {
      // Descend into token nodes as well: a token named "color" can also be
      // the group for "color.accent" — overwriting it would drop a token.
      group = next as DTCGGroup;
    }
  });
}

export interface DTCGDocument {
  $meta?: { theme?: string; generatedBy?: string };
  [group: string]: unknown;
}

/** W3C DTCG JSON document for the active theme, grouped by name path. */
export function buildDTCGDocument(store: TokenStoreState): DTCGDocument {
  const document: DTCGDocument = {};
  if (store.activeThemeId) {
    const theme = store.themes[store.activeThemeId];
    document.$meta = {
      theme: theme ? theme.name : store.activeThemeId,
      generatedBy: "agent-native-design-canvas tokens",
    };
  }
  for (const resolved of resolveActiveThemeTokens(store)) {
    insertToken(document as unknown as DTCGGroup, resolved);
  }
  return document;
}

export function serializeDTCGDocument(store: TokenStoreState): string {
  return `${JSON.stringify(buildDTCGDocument(store), null, 2)}\n`;
}
