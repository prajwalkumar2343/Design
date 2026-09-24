import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseCssColor } from "../editor/effects";

/** A curated, gesture-friendly palette — no color wheel required. First swatch is transparent for pure glass. */
export const COLOR_SWATCHES = [
  "transparent", "#ffffff", "#ebebe8", "#d9d9d9", "#a8a8a1", "#666661", "#161615",
  "#f6b1a4", "#e5484d", "#ffab6b", "#e8792e",
  "#ffe9a8", "#f2ce4b", "#d9a514",
  "#b5e0a5", "#6cbf5d", "#2f9e57", "#1d6b40",
  "#bcd9f5", "#6faee0", "#3b74c2", "#24488f",
  "#e3cdf6", "#b98ae4", "#7a4fb0",
];

export function SwatchGrid({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (color: string) => void;
}) {
  return (
    <span className="color-swatch-grid">
      {COLOR_SWATCHES.map((color) => {
        const isTransparentSwatch = color === "transparent";
        const isTransparentValue = typeof value === "string" && value.trim().toLowerCase() === "transparent";
        const current = parseCssColor(value ?? undefined);
        const option = parseCssColor(color);
        const isActive = isTransparentSwatch ? isTransparentValue : current !== null && option !== null &&
          current.r === option.r && current.g === option.g && current.b === option.b;
        const swatchStyle: CSSProperties = isTransparentSwatch
          ? {
              backgroundColor: "transparent",
              backgroundImage:
                "linear-gradient(45deg, rgba(22,22,21,.08) 25%, transparent 25%, transparent 75%, rgba(22,22,21,.08) 75%), linear-gradient(45deg, rgba(22,22,21,.08) 25%, transparent 25%, transparent 75%, rgba(22,22,21,.08) 75%)",
              backgroundSize: "8px 8px",
              backgroundPosition: "0 0, 4px 4px",
            }
          : { background: color };
        return (
          <button
            key={color}
            type="button"
            className={`color-swatch${isActive ? " is-active" : ""}`}
            data-testid={`color-option-${color}`}
            style={swatchStyle}
            aria-label={color === "transparent" ? "transparent" : color}
            title={color === "transparent" ? "Transparent (pure glass)" : color}
            onClick={() => onPick(color)}
          />
        );
      })}
    </span>
  );
}

export function ColorField({
  label,
  value,
  onCommit,
  token,
}: {
  label: string;
  value: string | null;
  onCommit: (value: string) => void;
  token?: ReactNode;
}) {
  const isMixed = value === "mixed";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(isMixed || value === null ? "" : value);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => setDraft(isMixed || value === null ? "" : value), [isMixed, value]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !wrapRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  const commit = (next: string) => {
    onCommit(next);
    setOpen(false);
  };
  return (
    <span className="color-field" ref={wrapRef}>
      <span className="color-field-label">{label}</span>
      <button
        type="button"
        className="color-swatch-button"
        data-testid={`color-swatch-${label}`}
        aria-label={`${label} color`}
        aria-expanded={open}
        style={{ background: isMixed || !value ? "transparent" : value }}
        onClick={() => setOpen((current) => !current)}
      />
      <input
        aria-label={label}
        value={draft}
        placeholder={isMixed ? "Mixed" : "—"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          // Focus moving inside this field (e.g. a palette swatch) is not a
          // commit — the click handler owns that gesture.
          if (event.relatedTarget instanceof Node && wrapRef.current?.contains(event.relatedTarget)) return;
          const next = draft.trim();
          if (!next || next === value) return;
          commit(next);
        }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      {open ? (
        <span className="color-popover" data-testid={`color-popover-${label}`}>
          <SwatchGrid value={value} onPick={commit} />
        </span>
      ) : null}
      {token}
    </span>
  );
}
