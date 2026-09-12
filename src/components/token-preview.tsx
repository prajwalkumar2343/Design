/**
 * Shared token preview glyphs + value summaries, used by the variables panel
 * and the properties-panel token picker. `resolvedValue` lets callers render
 * the concrete value an alias points at instead of the `{path}` reference.
 */
import type { DesignToken, MotionValue, TokenValue, TypographyValue } from "../tokens";

export function summarizeTokenValue(token: DesignToken, resolvedValue?: TokenValue): string {
  const value = resolvedValue ?? token.value;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (token.type === "typography") {
    const typeValue = value as TypographyValue;
    return `${typeValue.fontSize} ${typeValue.fontFamily}`;
  }
  const motionValue = value as MotionValue;
  return `${motionValue.duration} ${motionValue.easing}`;
}

function parsePx(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /([\d.]+)px/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function TokenPreview({
  token,
  resolvedValue,
  size = "md",
}: {
  token: DesignToken;
  resolvedValue?: TokenValue;
  size?: "sm" | "md";
}) {
  const value = resolvedValue ?? token.value;
  const className = `tkn-preview${size === "sm" ? " tkn-preview-sm" : ""}`;
  if (token.type === "color" && typeof value === "string") {
    return (
      <span className={`${className} tkn-preview-color`} aria-hidden="true">
        <span className="tkn-checker" />
        <span className="tkn-color-fill" style={{ backgroundColor: value }} />
        <span className="tkn-color-dots" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
      </span>
    );
  }
  if (token.type === "spacing" && typeof value === "string") {
    const px = parsePx(value);
    const w = px === null ? 28 : Math.max(4, Math.min(44, px));
    return (
      <span className={`${className} tkn-preview-spacing`} aria-hidden="true">
        <span className="tkn-spacing-bar" style={{ width: w }} />
      </span>
    );
  }
  if (token.type === "radius" && typeof value === "string") {
    return (
      <span className={`${className} tkn-preview-radius`} aria-hidden="true">
        <span className="tkn-radius-box" style={{ borderRadius: value }} />
      </span>
    );
  }
  if (token.type === "shadow" && typeof value === "string") {
    return (
      <span className={`${className} tkn-preview-shadow`} aria-hidden="true">
        <span className="tkn-shadow-box" style={{ boxShadow: value }} />
      </span>
    );
  }
  if (token.type === "typography") {
    const v = value as TypographyValue;
    return (
      <span
        className={`${className} tkn-preview-type`}
        aria-hidden="true"
        style={{ fontFamily: v.fontFamily, fontWeight: Number(v.fontWeight) || 500 }}
      >
        Ag
      </span>
    );
  }
  if (token.type === "motion") {
    const v = value as MotionValue;
    return (
      <span className={`${className} tkn-preview-motion`} aria-hidden="true" title={`${v.duration} ${v.easing}`}>
        <span className="tkn-motion-dot" />
        <span className="tkn-motion-track" />
      </span>
    );
  }
  if (token.type === "opacity" && typeof value === "number") {
    return (
      <span className={`${className} tkn-preview-opacity`} aria-hidden="true">
        <span className="tkn-checker" />
        <span className="tkn-opacity-fill" style={{ opacity: value }} />
      </span>
    );
  }
  return (
    <span className={`${className} tkn-preview-fallback`} aria-hidden="true">
      <span className="tkn-fallback-glyph">T</span>
    </span>
  );
}
