/**
 * DTCG JSON import: flattens a nested `{ $value, $type }` document into the
 * flat dot-path token list this store uses. Accepts both `$`-prefixed and
 * legacy plain keys (`$type`/`type`, `$value`/`value`, `$description`/
 * `description`) so exports from Tokens Studio, Style Dictionary, and this
 * app's own exporter all load.
 *
 * Import is best-effort per token: entries that fail validation are skipped
 * with a human-readable warning instead of rejecting the whole file. Alias
 * values (`{group.path}`) pass through untouched — they validate as scalar
 * token values already.
 */
import {
  isTokenAlias,
  type DesignToken,
  type MotionValue,
  type TokenSet,
  type TokenType,
  type TypographyValue,
} from "./model";
import { TokenValidationError, validateToken } from "./validation";

export interface ImportedTokens {
  /** Suggested collection name (from `$meta` or the file name). */
  name?: string;
  tokens: DesignToken[];
  warnings: string[];
}

const MAX_IMPORT_TOKENS = 5_000;
const MAX_IMPORT_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kebab(segment: string): string {
  return segment
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tokenTypeForName(name: string, fallback: TokenType): TokenType {
  const head = name.split(".")[0] ?? "";
  if (head === "radius" || head === "radii" || head === "corner" || head === "corners") return "radius";
  if (head === "spacing" || head === "space" || head === "gap" || head === "inset" || head === "margin" || head === "padding") {
    return "spacing";
  }
  if (head === "shadow" || head === "elevation") return "shadow";
  if (head === "opacity" || head === "alpha") return "opacity";
  if (head === "motion" || head === "transition" || head === "duration" || head === "easing") return "motion";
  if (
    head === "typography" || head === "font" || head === "type" || head === "text"
  ) {
    return "typography";
  }
  return fallback;
}

function inferType(name: string, value: unknown): TokenType {
  if (typeof value === "number") return "opacity";
  if (isRecord(value)) {
    if ("fontFamily" in value || "fontSize" in value || "font-family" in value || "font-size" in value) {
      return "typography";
    }
    if ("duration" in value || "easing" in value || "timingFunction" in value) return "motion";
    if ("offsetX" in value || "offset-x" in value || "blur" in value || "spread" in value) return "shadow";
    return "typography";
  }
  if (typeof value === "string") {
    if (isTokenAlias(value)) return tokenTypeForName(name, "color");
    const trimmed = value.trim();
    if (/^(?:#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\(|[a-z]+$)/i.test(trimmed)) return "color";
    if (/^-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|ch|ex|cm|mm|in|pt|pc)?$/.test(trimmed)) {
      return tokenTypeForName(name, "spacing");
    }
    return tokenTypeForName(name, "color");
  }
  return tokenTypeForName(name, "color");
}

function dtcgTypeToTokenType(name: string, dtcgType: string): TokenType {
  switch (dtcgType.toLowerCase()) {
    case "color":
      return "color";
    case "dimension":
    case "fontsize":
    case "sizing":
    case "spacing":
      return tokenTypeForName(name, "spacing");
    case "borderradius":
    case "radius":
      return "radius";
    case "typography":
    case "fontfamily":
    case "fontweight":
      return "typography";
    case "shadow":
    case "boxshadow":
      return "shadow";
    case "transition":
    case "duration":
    case "timingfunction":
    case "cubic-bezier":
      return "motion";
    case "opacity":
    case "number":
      return "opacity";
    default:
      return tokenTypeForName(name, "color");
  }
}

function typographyValueFromDTCG(value: Record<string, unknown>): TypographyValue {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const entry = value[key];
      if (typeof entry === "string" && entry.trim().length > 0) return entry.trim();
      if (typeof entry === "number" && Number.isFinite(entry)) return String(entry);
    }
    return undefined;
  };
  const out: TypographyValue = {
    fontFamily: pick("fontFamily", "font-family", "family") ?? "Inter, sans-serif",
    fontSize: pick("fontSize", "font-size", "size") ?? "16px",
  };
  const weight = pick("fontWeight", "font-weight", "weight");
  if (weight) out.fontWeight = weight;
  const lineHeight = pick("lineHeight", "line-height");
  if (lineHeight) out.lineHeight = lineHeight;
  const tracking = pick("letterSpacing", "letter-spacing", "tracking");
  if (tracking) out.letterSpacing = tracking;
  return out;
}

function motionValueFromDTCG(value: Record<string, unknown>): MotionValue {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const entry = value[key];
      if (typeof entry === "string" && entry.trim().length > 0) return entry.trim();
    }
    return undefined;
  };
  return {
    duration: pick("duration") ?? "200ms",
    easing: pick("timingFunction", "easing", "timing-function") ?? "ease",
  };
}

function shadowValueFromDTCG(value: Record<string, unknown>): string {
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const entry = value[key];
      if (typeof entry === "string" && entry.trim().length > 0) return entry.trim();
    }
    return "";
  };
  const offsetX = pick("offsetX", "offset-x", "x") || "0";
  const offsetY = pick("offsetY", "offset-y", "y") || "0";
  const blur = pick("blur") || "0";
  const spread = pick("spread") || "0";
  const color = pick("color") || "rgba(0, 0, 0, 0.12)";
  const inset = value.inset === true || value.inset === "true" ? "inset " : "";
  return `${inset}${offsetX} ${offsetY} ${blur} ${spread} ${color}`;
}

function coerceValue(
  type: TokenType,
  value: unknown,
): { ok: true; value: DesignToken["value"] } | { ok: false } {
  switch (type) {
    case "color":
    case "spacing":
    case "radius":
    case "shadow": {
      if (typeof value === "string") return { ok: true, value: value.trim() };
      if (type === "shadow" && isRecord(value)) return { ok: true, value: shadowValueFromDTCG(value) };
      if ((type === "spacing" || type === "radius") && typeof value === "number" && Number.isFinite(value)) {
        return { ok: true, value: `${value}px` };
      }
      if (isRecord(value) && typeof value.value === "number" && typeof value.unit === "string") {
        return { ok: true, value: `${value.value}${value.unit}` };
      }
      return { ok: false };
    }
    case "opacity": {
      if (typeof value === "number" && Number.isFinite(value)) {
        return { ok: true, value: Math.min(1, Math.max(0, value)) };
      }
      if (typeof value === "string") {
        const parsed = Number(value.trim().replace(/%$/, ""));
        if (Number.isFinite(parsed)) {
          return { ok: true, value: value.trim().endsWith("%") ? parsed / 100 : parsed };
        }
      }
      return { ok: false };
    }
    case "typography": {
      if (isRecord(value)) return { ok: true, value: typographyValueFromDTCG(value) };
      return { ok: false };
    }
    case "motion": {
      if (isRecord(value)) return { ok: true, value: motionValueFromDTCG(value) };
      if (typeof value === "string" && /^\d+(?:\.\d+)?(?:ms|s)$/.test(value.trim())) {
        return { ok: true, value: { duration: value.trim(), easing: "ease" } };
      }
      return { ok: false };
    }
  }
}

/**
 * Parses DTCG JSON text into a flat token list. Throws a plain `Error` when
 * the text is not JSON or not a token-shaped document at all.
 */
export function parseDTCGTokens(text: string, sourceName?: string): ImportedTokens {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("The token file is empty.");
  }
  if (text.length > MAX_IMPORT_BYTES) {
    throw new Error("The token file is larger than 1 MB.");
  }
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error("The token file is not valid JSON.");
  }
  if (!isRecord(root)) {
    throw new Error("The token file must contain a JSON object.");
  }

  const warnings: string[] = [];
  const tokens: DesignToken[] = [];
  const seenNames = new Set<string>();
  let suggestedName: string | undefined;

  const meta = root.$meta;
  if (isRecord(meta) && typeof meta.name === "string" && meta.name.trim().length > 0) {
    suggestedName = meta.name.trim().slice(0, 80);
  } else if (isRecord(meta) && typeof meta.theme === "string" && meta.theme.trim().length > 0) {
    suggestedName = meta.theme.trim().slice(0, 80);
  }

  const walk = (node: Record<string, unknown>, path: string[], inheritedType: string | undefined): void => {
    if (tokens.length >= MAX_IMPORT_TOKENS) {
      return;
    }
    const localType = typeof node.$type === "string" ? node.$type
      : typeof node.type === "string" ? node.type
      : inheritedType;
    const rawValue = node.$value !== undefined ? node.$value : node.value;
    if (rawValue !== undefined) {
      if (path.length === 0) return;
      const segments = path.map(kebab).filter((segment) => segment.length > 0);
      if (segments.length === 0 || segments.length > 4) {
        warnings.push(`Skipped ${path.join(".")}: name is empty or deeper than 4 segments.`);
        return;
      }
      const name = segments.join(".");
      if (seenNames.has(name)) {
        warnings.push(`Skipped duplicate ${name}.`);
        return;
      }
      const type = localType ? dtcgTypeToTokenType(name, localType) : inferType(name, rawValue);
      const coerced = coerceValue(type, rawValue);
      if (!coerced.ok) {
        warnings.push(`Skipped ${name}: value does not fit type ${type}.`);
        return;
      }
      const description = typeof node.$description === "string" ? node.$description
        : typeof node.description === "string" ? node.description
        : undefined;
      const token: DesignToken = {
        id: `import-${tokens.length.toString(36)}-${name.replace(/\./g, "-")}`.slice(0, 128),
        name,
        type,
        value: coerced.value,
      };
      if (description) token.description = description.slice(0, 500);
      try {
        tokens.push(validateToken(token, `import.${name}`));
        seenNames.add(name);
      } catch (error) {
        warnings.push(
          `Skipped ${name}: ${error instanceof TokenValidationError ? error.message : "invalid token"}.`,
        );
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$") || key === "description" || key === "type") continue;
      if (!isRecord(child)) continue;
      walk(child, [...path, key], localType);
    }
  };
  walk(root, [], undefined);

  if (tokens.length === 0) {
    throw new Error(
      warnings.length > 0
        ? `No tokens imported. ${warnings[0]}`
        : "The file contains no $value tokens.",
    );
  }
  const out: ImportedTokens = { tokens, warnings };
  if (suggestedName) out.name = suggestedName;
  else if (sourceName) {
    const base = sourceName.replace(/\.[^.]+$/, "").trim();
    if (base) out.name = base.slice(0, 80);
  }
  return out;
}

/** Wraps imported tokens in a set with a collision-free id. */
export function buildImportedTokenSet(
  imported: ImportedTokens,
  existingIds: ReadonlySet<string>,
): TokenSet {
  const name = imported.name?.trim() || "Imported";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "imported";
  let id = slug;
  let counter = 2;
  while (existingIds.has(id)) {
    id = `${slug}-${counter}`;
    counter += 1;
  }
  const tokens: TokenSet["tokens"] = {};
  const usedTokenIds = new Set<string>();
  for (const token of imported.tokens) {
    let tokenId = token.id;
    let suffix = 2;
    while (usedTokenIds.has(tokenId)) {
      tokenId = `${token.id}-${suffix}`;
      suffix += 1;
    }
    usedTokenIds.add(tokenId);
    tokens[tokenId] = { ...token, id: tokenId };
  }
  return { id, name, tokens, description: "Imported from a DTCG tokens file." };
}
