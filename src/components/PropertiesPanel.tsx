import {
  BoxSelect,
  Braces,
  ChevronDown,
  Droplets,
  Layers3,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Palette,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Type,
  Unlink,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SafeInlineStyleProperty } from "../bridge/protocol";
import {
  DEFAULT_GLASS_LEVEL,
  MAX_GLASS_LEVEL,
  MAX_SHAPE_RADIUS,
  clampGlassLevel,
  glassLevelFromAttribute,
} from "../editor/effects";
import type { FrameEntity, NodeEntity, SelectionState } from "../editor/model";
import {
  FONT_CATALOG,
  FONT_CATEGORIES,
  matchFontOption,
  primaryFontName,
} from "../fonts";
import {
  cssVariableReferenceForProperty,
  findTokenForCssValue,
  isOffSystemValue,
  isUnresolvedCssReference,
  resolveActiveThemeTokens,
  tokenScalarForCssProperty,
  tokenTypeForCssProperty,
  type TokenStoreState,
} from "../tokens";
import { summarizeTokenValue, TokenPreview } from "./token-preview";
import type { OverlayBridgeTargetState } from "../overlay/useNodeOverlayGestures";
import { elementProfile, mixedValue } from "./panel-model";
import { ColorField } from "./ColorField";
import { ShaderParamsEditor } from "./ShaderEditor";
import { SHADER_THUMB_URLS } from "./ShaderMenu";
import {
  clampShaderElementSize,
  getShaderDefinition,
  maxShaderElementRadius,
  SHADER_ELEMENT_DEFAULT_RADIUS,
  type CanvasShaderElement,
  type ShaderParams,
} from "../shaders";

export interface PropertiesPanelProps {
  frames: Record<string, FrameEntity>;
  nodes: Record<string, NodeEntity>;
  selection: SelectionState;
  bridgeTargets: Record<string, OverlayBridgeTargetState>;
  onUpdateFrame: (frameId: string, patch: Partial<Pick<FrameEntity, "width" | "height" | "background" | "name">>) => void;
  onMoveFrame: (frameId: string, position: { x: number; y: number }) => void;
  onEditNodeStyle: (property: SafeInlineStyleProperty, value: string | null) => void;
  onEditNodePosition: (frameId: string, nodeId: string, position: { x: number; y: number }) => void;
  onApplyGlassEffect: (level: number) => void;
  /** Live preview while the glass slider is being dragged (pre-transaction). */
  onPreviewGlassEffect?: (level: number) => void;
  tokens?: TokenStoreState;
  shapeRadius: number;
  shapeRadiusVisible: boolean;
  onShapeRadiusChange: (radius: number) => void;
  onShapeRadiusCommit: () => void;
  shaderElements?: CanvasShaderElement[];
  selectedShaderElementId?: string | null;
  onUpdateShaderElement?: (elementId: string, patch: Partial<Pick<CanvasShaderElement, "x" | "y" | "width" | "height" | "radius">>) => void;
  onUpdateShaderParams?: (elementId: string, params: ShaderParams) => void;
  onDeleteShaderElement?: (elementId: string) => void;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function numericValue(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function PropertyField({
  label,
  value,
  onCommit,
  type = "text",
  placeholder,
  testId,
  suffix,
  disabled = false,
  token,
}: {
  label: string;
  value: string | null;
  onCommit: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  testId?: string;
  suffix?: string;
  disabled?: boolean;
  /** Token apply/state control docked at the field's trailing edge. */
  token?: ReactNode;
}) {
  const isMixed = value === "mixed";
  const [draft, setDraft] = useState(isMixed || value === null ? "" : value);
  useEffect(() => setDraft(isMixed || value === null ? "" : value), [isMixed, value]);
  return (
    <label className={`property-field${disabled ? " is-disabled" : ""}${token ? " has-token" : ""}`}>
      <span>{label}</span>
      <span className="property-input-wrap">
        <input
          data-testid={testId}
          aria-label={label}
          type={type}
          value={draft}
          placeholder={placeholder ?? (isMixed ? "Mixed" : "—")}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const next = draft.trim();
            if (next === "") return;
            // Blurring without a real edit must not push a no-op undo step.
            if (!isMixed && next === value) return;
            onCommit(next);
          }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        {suffix ? <small>{suffix}</small> : null}
      </span>
      {token}
    </label>
  );
}

function PropertySection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="property-section"><div className="property-section-title"><span>{icon}{title}</span><ChevronDown size={13} /></div>{children}</section>;
}

/**
 * Font family picker for the bundled catalog — every family is OFL-licensed
 * and injected into frame documents (see src/fonts). The input stays free
 * text so off-catalog stacks can still be typed; while the list is open the
 * draft doubles as a search filter.
 */
function FontFamilyField({
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
  const [query, setQuery] = useState("");
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

  const activeOption = matchFontOption(isMixed ? null : value);
  // The filter is what was typed since opening — a pasted stack
  // ("Space Grotesk", ui-sans-serif) filters on its primary family only.
  const needle = (primaryFontName(query) ?? query).trim().toLowerCase();
  const visible = needle.length === 0
    ? FONT_CATALOG
    : FONT_CATALOG.filter(
        (option) =>
          option.name.toLowerCase().includes(needle) || option.category.toLowerCase() === needle,
      );

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const commitOption = (stack: string) => {
    setDraft(stack);
    close();
    onCommit(stack);
  };

  return (
    <span className="font-field" ref={wrapRef}>
      <span className="font-field-label">{label}</span>
      <input
        aria-label={label}
        data-testid="font-family-input"
        value={draft}
        placeholder={isMixed ? "Mixed" : "—"}
        spellCheck={false}
        autoComplete="off"
        style={activeOption ? { fontFamily: `"${activeOption.name}"` } : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setQuery(event.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onBlur={(event) => {
          // Focus moving inside this field (a font option) is not a commit —
          // the option's click handler owns that gesture.
          if (event.relatedTarget instanceof Node && wrapRef.current?.contains(event.relatedTarget)) return;
          close();
          const next = draft.trim();
          if (!next || next === value) return;
          onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          else if (event.key === "Escape") close();
        }}
      />
      <button
        type="button"
        className="font-field-toggle"
        data-testid="font-family-toggle"
        aria-label={`${label} options`}
        aria-expanded={open}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
      >
        <ChevronDown size={12} strokeWidth={1.8} />
      </button>
      {open ? (
        <span className="font-popover" data-testid="font-popover">
          <span className="font-list" role="listbox" aria-label="Bundled fonts">
            {FONT_CATEGORIES.map((category) => {
              const options = visible.filter((option) => option.category === category);
              if (options.length === 0) return null;
              return (
                <span className="font-group" key={category}>
                  <span className="font-group-label">{category}</span>
                  {options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={activeOption?.id === option.id}
                      className={`font-option${activeOption?.id === option.id ? " is-active" : ""}`}
                      data-testid={`font-option-${option.id}`}
                      title={`${option.name} — ${option.license}`}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => commitOption(option.stack)}
                    >
                      <span className="font-option-name" style={{ fontFamily: `"${option.name}"` }}>
                        {option.name}
                      </span>
                      <span className="font-option-meta">{option.license}</span>
                    </button>
                  ))}
                </span>
              );
            })}
            {visible.length === 0 ? (
              <span className="font-empty">No bundled fonts match “{query.trim()}”.</span>
            ) : null}
          </span>
        </span>
      ) : null}
      {token}
    </span>
  );
}

function styleValue(entries: OverlayBridgeTargetState[], property: string): string | null {
  return mixedValue(entries.map((entry) => entry.inspection?.inlineStyle[property] ?? entry.inspection?.computedStyle[property] ?? ""));
}

function firstPosition(entries: OverlayBridgeTargetState[]): { x: string | null; y: string | null } {
  return {
    x: mixedValue(entries.map((entry) => entry.target.bounds.x).map(formatNumber)),
    y: mixedValue(entries.map((entry) => entry.target.bounds.y).map(formatNumber)),
  };
}

const TOKEN_POPOVER_WIDTH = 232;

/**
 * Variable affordance docked on mappable fields, modelled on Paper.design.
 * A field linked to a variable renders as a swatch+name chip *instead of* the
 * raw input (the `:has` rules in styles.css hide the input siblings); unlinked
 * fields show a link icon that opens the variable picker — blue when the raw
 * value already matches a variable, amber when nothing matches. Choosing a
 * variable writes `var(--token)` so the element tracks it; "Break link"
 * restores the resolved raw value. The popover is position:fixed so the
 * panel's scroll container can't clip it.
 */
function TokenControl({
  tokens,
  property,
  value,
  onCommit,
}: {
  tokens?: TokenStoreState;
  property: string;
  value: string | null;
  onCommit: (value: string) => void;
}) {
  const type = tokenTypeForCssProperty(property);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const isMixed = value === "mixed";
  const match = tokens && value && !isMixed ? findTokenForCssValue(tokens, property, value) : null;
  const unresolved = tokens && value && !isMixed ? isUnresolvedCssReference(tokens, value) : false;
  const offSystem = Boolean(
    tokens && type && value && !isMixed && !match && !unresolved &&
    isOffSystemValue(tokens, property, value),
  );

  useEffect(() => {
    if (!open) return;
    // The popover portals to document.body, so "inside" means either the
    // docked control or the floating layer itself.
    const inside = (node: EventTarget | null) =>
      node instanceof Node &&
      (wrapRef.current?.contains(node) ||
        (node instanceof Element && node.closest(".token-popover") !== null));
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target)) setOpen(false);
    };
    // The panel scrolls; a floating popover must not stay anchored mid-air —
    // but scrolling inside the popover's own list is legitimate.
    const onScroll = (event: Event) => {
      if (inside(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const options = useMemo(() => {
    if (!tokens || !type) return [];
    const q = query.trim().toLowerCase();
    return resolveActiveThemeTokens(tokens).filter((resolved) => {
      if (resolved.token.type !== type) return false;
      if (!q) return true;
      const scalar = tokenScalarForCssProperty(resolved.token.type, resolved.resolvedValue, property);
      return (
        resolved.token.name.toLowerCase().includes(q) ||
        (scalar ?? "").toLowerCase().includes(q) ||
        (resolved.token.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [tokens, type, property, query]);

  if (!tokens || !type) return null;

  const detachValue = match
    ? tokenScalarForCssProperty(match.type, match.resolvedValue, property)
    : null;
  const linked = match?.via === "reference";

  const toggle = () => {
    if (!open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setAnchor({
        top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 300)),
        left: Math.max(8, rect.right - TOKEN_POPOVER_WIDTH),
      });
    }
    setOpen((current) => !current);
  };
  const apply = (tokenName: string) => {
    onCommit(cssVariableReferenceForProperty(tokenName, property));
    setOpen(false);
    setQuery("");
  };
  const detach = () => {
    if (detachValue !== null) onCommit(detachValue);
    setOpen(false);
    setQuery("");
  };

  return (
    <span className={`token-ctl${linked ? " is-linked" : ""}`} ref={wrapRef}>
      {linked && match ? (
        <button
          className="token-field-chip"
          data-testid={`token-hint-${property}`}
          title={`${match.tokenName} — the value follows the variable`}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={toggle}
          type="button"
        >
          <TokenPreview
            token={{ id: match.tokenId, name: match.tokenName, type: match.type, value: match.resolvedValue }}
            resolvedValue={match.resolvedValue}
            size="sm"
          />
          <span className="token-field-chip-name">{match.tokenName}</span>
        </button>
      ) : unresolved ? (
        <button
          className="token-hint is-unresolved"
          data-testid={`token-unresolved-${property}`}
          title="This var() does not resolve to a variable in the active mode — open to relink it"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={toggle}
          type="button"
        >
          <Unlink size={11} />
          Broken reference
        </button>
      ) : (
        <button
          className={`token-field-button${match ? " has-match" : ""}${offSystem ? " is-off" : ""}`}
          data-testid={offSystem ? `token-offsystem-${property}` : `token-picker-${property}`}
          aria-label={`Apply a variable to ${property}`}
          title={match ? `Matches ${match.tokenName} — click to link it` : offSystem ? "No matching variable — click to pick one" : "Apply a variable"}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={toggle}
          type="button"
        >
          <Braces size={11} />
        </button>
      )}
      {open && anchor ? createPortal(
        <span
          className="token-popover"
          data-canvas-control
          data-testid={`token-popover-${property}`}
          role="listbox"
          aria-label={`${type} variables`}
          style={{ top: anchor.top, left: anchor.left, width: TOKEN_POPOVER_WIDTH }}
        >
          <span className="token-popover-search">
            <Search size={11} aria-hidden="true" />
            <input
              aria-label="Search variables"
              data-testid={`token-search-${property}`}
              placeholder={`Search ${type} variables…`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
          <span className="token-popover-list">
            {options.map((resolved) => {
              const scalar = tokenScalarForCssProperty(resolved.token.type, resolved.resolvedValue, property)
                ?? summarizeTokenValue(resolved.token, resolved.resolvedValue);
              const active = match?.tokenId === resolved.token.id;
              return (
                <button
                  key={`${resolved.setId}:${resolved.token.id}`}
                  className={`token-option${active ? " is-active" : ""}`}
                  data-testid={`token-option-${property}-${resolved.token.name}`}
                  title={`${resolved.token.name} → ${scalar}`}
                  onClick={() => apply(resolved.token.name)}
                  type="button"
                  role="option"
                  aria-selected={active}
                >
                  <TokenPreview token={resolved.token} resolvedValue={resolved.resolvedValue} size="sm" />
                  <span className="token-option-name">{resolved.token.name}</span>
                  <span className="token-option-value">{scalar}</span>
                </button>
              );
            })}
            {options.length === 0 ? (
              <span className="token-popover-empty">
                {query ? "No variables match the search." : `No ${type} variables in the active mode.`}
              </span>
            ) : null}
          </span>
          {match ? (
            <button
              className="token-popover-detach"
              data-testid={`token-detach-${property}`}
              onClick={detach}
              type="button"
            >
              <Unlink size={11} />
              {linked ? `Break link — use ${detachValue ?? "resolved value"}` : `Keep raw value (matches ${match.tokenName})`}
            </button>
          ) : null}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}

function PositionSizeSection({
  entries,
  onEditNodeStyle,
  onEditNodePosition,
  includeHeight = true,
}: Pick<PropertiesPanelProps, "onEditNodeStyle" | "onEditNodePosition"> & { entries: OverlayBridgeTargetState[]; includeHeight?: boolean }) {
  const position = firstPosition(entries);
  const width = styleValue(entries, "width");
  const height = styleValue(entries, "height");
  const commitPosition = (axis: "x" | "y", raw: string) => {
    const next = numericValue(raw);
    if (next === null) return;
    entries.forEach((entry) => {
      const otherAxis = axis === "x" ? entry.target.bounds.y : entry.target.bounds.x;
      onEditNodePosition(entry.frameId, entry.target.elementId, axis === "x" ? { x: next, y: otherAxis } : { x: otherAxis, y: next });
    });
  };
  return (
    <PropertySection title={includeHeight ? "Position & size" : "Position & width"} icon={<BoxSelect size={13} />}>
      <div className="property-grid">
        <PropertyField label="X" value={position.x} type="number" suffix="px" testId="property-node-x" onCommit={(value) => commitPosition("x", value)} />
        <PropertyField label="Y" value={position.y} type="number" suffix="px" testId="property-node-y" onCommit={(value) => commitPosition("y", value)} />
        <PropertyField label="W" value={width} type="text" suffix="px" testId="property-node-width" onCommit={(value) => onEditNodeStyle("width", value)} />
        {includeHeight ? <PropertyField label="H" value={height} type="text" suffix="px" testId="property-node-height" onCommit={(value) => onEditNodeStyle("height", value)} /> : null}
      </div>
    </PropertySection>
  );
}

function TypographySection({ entries, onEditNodeStyle, tokens }: Pick<PropertiesPanelProps, "onEditNodeStyle" | "tokens"> & { entries: OverlayBridgeTargetState[] }) {
  const family = styleValue(entries, "font-family");
  const size = styleValue(entries, "font-size");
  const weight = styleValue(entries, "font-weight");
  const lineHeight = styleValue(entries, "line-height");
  const color = styleValue(entries, "color");
  const control = (property: SafeInlineStyleProperty, fieldValue: string | null) => (
    <TokenControl
      tokens={tokens}
      property={property}
      value={fieldValue}
      onCommit={(value) => onEditNodeStyle(property, value)}
    />
  );
  return (
    <PropertySection title="Typography" icon={<Type size={13} />}>
      <div className="property-grid property-grid-single">
        <FontFamilyField label="Family" value={family} onCommit={(value) => onEditNodeStyle("font-family", value)} token={control("font-family", family)} />
        <div className="property-grid"><PropertyField label="Size" value={size} onCommit={(value) => onEditNodeStyle("font-size", value)} token={control("font-size", size)} /><PropertyField label="Weight" value={weight} onCommit={(value) => onEditNodeStyle("font-weight", value)} token={control("font-weight", weight)} /></div>
        <PropertyField label="Line height" value={lineHeight} onCommit={(value) => onEditNodeStyle("line-height", value)} token={control("line-height", lineHeight)} />
        <div className="property-grid"><ColorField label="Color" value={color} onCommit={(value) => onEditNodeStyle("color", value)} token={control("color", color)} /><PropertyField label="Align" value={styleValue(entries, "text-align")} onCommit={(value) => onEditNodeStyle("text-align", value)} /></div>
      </div>
    </PropertySection>
  );
}

function FillBorderSection({ entries, onEditNodeStyle, onApplyGlassEffect, tokens }: Pick<PropertiesPanelProps, "onEditNodeStyle" | "tokens"> & { entries: OverlayBridgeTargetState[]; onApplyGlassEffect?: (level: number) => void }) {
  // Created vectors paint through `data-design-tool-fill` (the applied fill,
  // which may be a `var(--token)` link), not a background style.
  const fill = mixedValue(entries.map((entry) =>
    entry.inspection?.attributes["data-design-tool-fill"]
    ?? entry.inspection?.inlineStyle["background-color"]
    ?? entry.inspection?.computedStyle["background-color"]
    ?? "",
  )) ?? styleValue(entries, "background");
  const border = styleValue(entries, "border-color");
  const borderWidth = styleValue(entries, "border-width");
  const radius = styleValue(entries, "border-radius");
  const control = (property: SafeInlineStyleProperty, fieldValue: string | null) => (
    <TokenControl
      tokens={tokens}
      property={property}
      value={fieldValue}
      onCommit={(value) => onEditNodeStyle(property, value)}
    />
  );
  return (
    <PropertySection title="Fill & border" icon={<Palette size={13} />}>
      <div className="property-grid property-grid-single">
        <ColorField
          label="Fill"
          value={fill}
          onCommit={(value) => onEditNodeStyle("background-color", value)}
          onPickGlass={onApplyGlassEffect ? () => onApplyGlassEffect(DEFAULT_GLASS_LEVEL) : undefined}
          glassActive={entries.length > 0 && entries.every(entryHasGlass)}
          token={control("background-color", fill)}
        />
        <div className="property-grid"><PropertyField label="Border" value={border} onCommit={(value) => onEditNodeStyle("border-color", value)} token={control("border-color", border)} /><PropertyField label="Width" value={borderWidth} onCommit={(value) => onEditNodeStyle("border-width", value)} token={control("border-width", borderWidth)} /></div>
        <PropertyField label="Radius" value={radius} onCommit={(value) => onEditNodeStyle("border-radius", value)} token={control("border-radius", radius)} />
      </div>
    </PropertySection>
  );
}

function OpacityEffectsSection({ entries, onEditNodeStyle, tokens }: Pick<PropertiesPanelProps, "onEditNodeStyle" | "tokens"> & { entries: OverlayBridgeTargetState[] }) {
  const opacity = styleValue(entries, "opacity");
  const shadow = styleValue(entries, "box-shadow");
  return (
    <PropertySection title="Opacity & effects" icon={<SlidersHorizontal size={13} />}>
      <div className="property-grid property-grid-single"><PropertyField label="Opacity" value={opacity} onCommit={(value) => onEditNodeStyle("opacity", value)} token={<TokenControl tokens={tokens} property="opacity" value={opacity} onCommit={(value) => onEditNodeStyle("opacity", value)} />} /><PropertyField label="Shadow" value={shadow} onCommit={(value) => onEditNodeStyle("box-shadow", value)} token={<TokenControl tokens={tokens} property="box-shadow" value={shadow} onCommit={(value) => onEditNodeStyle("box-shadow", value)} />} /></div>
    </PropertySection>
  );
}

/**
 * Untracked glass: foreign surfaces carry the effect as inline styles with no
 * `data-design-tool-glass` attribute. The runtime stamps
 * `data-design-tool-backdrop` on every editor-driven backdrop-filter write,
 * which is how panel-applied glass lands on non-created elements — requiring
 * that marker keeps authored `linear-gradient` backgrounds and `inset 0 1`
 * shadows from being mistaken for glass and stripped on blur.
 */
function hasGlassSurfaceStyles(entry: OverlayBridgeTargetState): boolean {
  if (entry.inspection?.attributes["data-design-tool-backdrop"] == null) return false;
  const style = entry.inspection?.inlineStyle;
  if (!style) return false;
  const backdrop = style["backdrop-filter"];
  const background = style["background"];
  const shadow = style["box-shadow"];
  return (
    (typeof backdrop === "string" && backdrop.includes("blur(")) ||
    (typeof background === "string" && background.includes("linear-gradient(")) ||
    (typeof shadow === "string" && shadow.includes("inset 0 1"))
  );
}

/** Glass on an inspected node, tracked (attribute) or untracked (styles). */
function entryHasGlass(entry: OverlayBridgeTargetState): boolean {
  const level = glassLevelFromAttribute(entry.inspection?.attributes["data-design-tool-glass"]);
  return (level !== null && level > 0) || hasGlassSurfaceStyles(entry);
}

function GlassSection({
  entries,
  onApply,
  onPreview,
}: {
  entries: OverlayBridgeTargetState[];
  onApply: (level: number) => void;
  onPreview?: (level: number) => void;
}) {
  const currentLevel = useMemo(() => {
    for (const entry of entries) {
      const parsed = glassLevelFromAttribute(entry.inspection?.attributes["data-design-tool-glass"]);
      if (parsed !== null && parsed > 0) return parsed;
    }
    return 0;
  }, [entries]);
  // Foreign surfaces get glass via inline styles, which never write the
  // tracking attribute; the backdrop-filter + sheen + rim shadow identify them.
  const hasUntrackedGlass = useMemo(() => entries.some(hasGlassSurfaceStyles), [entries]);
  const [level, setLevel] = useState(currentLevel);
  const appliedLevelRef = useRef<number | null>(null);
  const selectionKey = entries.map((entry) => `${entry.frameId}:${entry.target.elementId}`).sort().join("|");
  const selectionKeyRef = useRef(selectionKey);
  useEffect(() => {
    if (selectionKeyRef.current !== selectionKey) {
      selectionKeyRef.current = selectionKey;
      appliedLevelRef.current = null;
      setLevel(currentLevel);
      return;
    }
    if (currentLevel > 0 || !hasUntrackedGlass) {
      appliedLevelRef.current = null;
      setLevel(currentLevel);
    }
  }, [currentLevel, hasUntrackedGlass, selectionKey]);
  const previewedRef = useRef(false);
  const preview = (next: number) => {
    if (!onPreview) return;
    previewedRef.current = true;
    onPreview(next);
  };
  const apply = (next: number) => {
    const clamped = clampGlassLevel(next);
    setLevel(clamped);
    appliedLevelRef.current = clamped;
    onApply(clamped);
  };
  // Dragging previews live on the shape; releasing commits one undoable
  // transaction anchored on the pre-drag state. A previewed release always
  // runs through apply so the host can settle the drag (even back at the
  // start value, where it becomes a no-op).
  const commit = () => {
    const wasPreviewed = previewedRef.current;
    previewedRef.current = false;
    if (appliedLevelRef.current === level && !wasPreviewed) return;
    if (level !== currentLevel || hasUntrackedGlass || wasPreviewed) apply(level);
  };
  return (
    <PropertySection title="Glass" icon={<Droplets size={13} />}>
      <div className="corner-radius-card" aria-label="Glass effect">
        <div className="corner-radius-head">
          <span className="corner-radius-label">Frost the backdrop</span>
          <span className="corner-radius-value-pill">
            <span data-testid="glass-level-value">{level > 0 ? `${level}%` : "Off"}</span>
          </span>
        </div>
        <div className="corner-radius-control-modern">
          <button
            aria-label="Decrease glass level"
            className="corner-radius-step"
            data-testid="glass-level-decrement"
            onClick={() => apply(level - 10)}
            type="button"
          >
            <Minus size={14} strokeWidth={1.8} />
          </button>
          <div className="corner-radius-slider-wrap">
            <div className="corner-radius-track" aria-hidden="true">
              <div className="corner-radius-track-fill" style={{ width: `${(level / MAX_GLASS_LEVEL) * 100}%` }} />
            </div>
            <input
              aria-label="Glass level"
              data-testid="glass-level-slider"
              max={MAX_GLASS_LEVEL}
              min={0}
              onBlur={commit}
              onChange={(event) => {
                const next = clampGlassLevel(Number(event.target.value));
                setLevel(next);
                preview(next);
              }}
              onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
              onKeyUp={commit}
              onPointerUp={commit}
              step={1}
              type="range"
              value={level}
            />
          </div>
          <button
            aria-label="Increase glass level"
            className="corner-radius-step"
            data-testid="glass-level-increment"
            onClick={() => apply(level + 10)}
            type="button"
          >
            <Plus size={14} strokeWidth={1.8} />
          </button>
        </div>
        <div className="corner-radius-meta">
          <span>Clear</span>
          <span>Frosted</span>
        </div>
      </div>
    </PropertySection>
  );
}

function CornerRadiusSection({
  radius,
  max = MAX_SHAPE_RADIUS,
  onChange,
  onCommit,
}: {
  radius: number;
  max?: number;
  onChange: (radius: number) => void;
  onCommit: () => void;
}) {
  const progress = Math.max(0, Math.min(100, (radius / max) * 100));
  const decrement = () => {
    const next = Math.max(0, radius - 1);
    if (next !== radius) {
      onChange(next);
      // Commit as a distinct step for button interactions
      queueMicrotask(() => onCommit());
    }
  };
  const increment = () => {
    const next = Math.min(max, radius + 1);
    if (next !== radius) {
      onChange(next);
      queueMicrotask(() => onCommit());
    }
  };
  return (
    <PropertySection title="Corner radius" icon={<Square size={13} />}>
      <div className="corner-radius-card" aria-label="Corner radius">
        <div className="corner-radius-head">
          <span className="corner-radius-label">Smooth the corners</span>
          <span className="corner-radius-value-pill">
            <span data-testid="shape-radius-value">{radius}</span>
            <small>px</small>
          </span>
        </div>
        <div className="corner-radius-control-modern">
          <button
            aria-label="Decrease radius"
            className="corner-radius-step"
            data-testid="shape-radius-decrement"
            onClick={decrement}
            type="button"
          >
            <Minus size={14} strokeWidth={1.8} />
          </button>
          <div className="corner-radius-slider-wrap">
            <div className="corner-radius-track" aria-hidden="true">
              <div className="corner-radius-track-fill" style={{ width: `${progress}%` }} />
            </div>
            <input
              aria-label="Corner radius"
              data-testid="shape-radius-slider"
              max={max}
              min={0}
              onBlur={onCommit}
              onChange={(event) => onChange(Number(event.target.value))}
              onKeyUp={onCommit}
              onPointerUp={onCommit}
              step={1}
              type="range"
              value={radius}
            />
          </div>
          <button
            aria-label="Increase radius"
            className="corner-radius-step"
            data-testid="shape-radius-increment"
            onClick={increment}
            type="button"
          >
            <Plus size={14} strokeWidth={1.8} />
          </button>
        </div>
        <div className="corner-radius-meta">
          <span>Sharp</span>
          <span>Rounded</span>
        </div>
      </div>
    </PropertySection>
  );
}

function NodeDesignPanel({
  entries,
  nodes,
  onEditNodeStyle,
  onEditNodePosition,
  onApplyGlassEffect,
  onPreviewGlassEffect,
  tokens,
}: Pick<PropertiesPanelProps, "nodes" | "onEditNodeStyle" | "onEditNodePosition" | "onApplyGlassEffect" | "onPreviewGlassEffect" | "tokens"> & { entries: OverlayBridgeTargetState[] }) {
  const primary = entries[0];
  const profile = primary ? elementProfile(primary.target, nodes[primary.target.elementId], primary.inspection?.attributes) : null;
  const positionProps = { entries, onEditNodeStyle, onEditNodePosition };
  const glassSection = <GlassSection entries={entries} onApply={onApplyGlassEffect} onPreview={onPreviewGlassEffect} />;
  return (
    <>
      <div className="selection-summary"><span className="selection-summary-mark"><BoxSelect size={15} /></span><span><strong>{entries.length === 1 ? primary?.inspection?.target.name ?? "Layer" : `${entries.length} layers`}</strong>{entries.length === 1 ? null : <small>Mixed selection</small>}</span></div>
      {!entries.every((entry) => entry.inspection) ? <div className="property-inspecting"><Sparkles size={13} /> Inspecting live layer…</div> : null}
      {profile === "button" ? (
        <>
          <PositionSizeSection {...positionProps} />
          {glassSection}
          <PropertySection title="Button style" icon={<Palette size={13} />}>
            <div className="property-grid property-grid-single">
              <ColorField
                label="Background"
                value={styleValue(entries, "background-color") ?? styleValue(entries, "background")}
                onCommit={(value) => onEditNodeStyle("background-color", value)}
                onPickGlass={() => onApplyGlassEffect(DEFAULT_GLASS_LEVEL)}
                glassActive={entries.length > 0 && entries.every(entryHasGlass)}
              />
              <PropertyField label="Radius" value={styleValue(entries, "border-radius")} onCommit={(value) => onEditNodeStyle("border-radius", value)} />
              <div className="property-grid"><PropertyField label="Border" value={styleValue(entries, "border-color")} onCommit={(value) => onEditNodeStyle("border-color", value)} /><PropertyField label="Width" value={styleValue(entries, "border-width")} onCommit={(value) => onEditNodeStyle("border-width", value)} /></div>
            </div>
          </PropertySection>
          <PropertySection title="Text" icon={<Type size={13} />}>
            <div className="property-grid property-grid-single">
              <FontFamilyField label="Family" value={styleValue(entries, "font-family")} onCommit={(value) => onEditNodeStyle("font-family", value)} />
              <div className="property-grid"><PropertyField label="Color" value={styleValue(entries, "color")} onCommit={(value) => onEditNodeStyle("color", value)} /><PropertyField label="Size" value={styleValue(entries, "font-size")} onCommit={(value) => onEditNodeStyle("font-size", value)} /></div>
            </div>
          </PropertySection>
          <OpacityEffectsSection entries={entries} onEditNodeStyle={onEditNodeStyle} tokens={tokens} />
        </>
      ) : profile === "text" ? (
        <>
          <PositionSizeSection {...positionProps} includeHeight={false} />
          {glassSection}
          <TypographySection entries={entries} onEditNodeStyle={onEditNodeStyle} tokens={tokens} />
          <FillBorderSection entries={entries} onEditNodeStyle={onEditNodeStyle} onApplyGlassEffect={onApplyGlassEffect} tokens={tokens} />
          <OpacityEffectsSection entries={entries} onEditNodeStyle={onEditNodeStyle} tokens={tokens} />
        </>
      ) : profile === "shape" ? (
        <>
          <PositionSizeSection {...positionProps} />
          {glassSection}
          <FillBorderSection entries={entries} onEditNodeStyle={onEditNodeStyle} onApplyGlassEffect={onApplyGlassEffect} tokens={tokens} />
          <OpacityEffectsSection entries={entries} onEditNodeStyle={onEditNodeStyle} tokens={tokens} />
        </>
      ) : profile === "image" ? (
        <>
          <PositionSizeSection {...positionProps} />
          <OpacityEffectsSection entries={entries} onEditNodeStyle={onEditNodeStyle} tokens={tokens} />
        </>
      ) : (
        <>
          <PositionSizeSection {...positionProps} />
          {glassSection}
          <TypographySection entries={entries} onEditNodeStyle={onEditNodeStyle} tokens={tokens} />
          <FillBorderSection entries={entries} onEditNodeStyle={onEditNodeStyle} onApplyGlassEffect={onApplyGlassEffect} tokens={tokens} />
          <OpacityEffectsSection entries={entries} onEditNodeStyle={onEditNodeStyle} tokens={tokens} />
        </>
      )}
    </>
  );
}

/**
 * Inspector for a placed canvas shader element: geometry (position, size,
 * corner rounding) plus the live param editor shared with the Shaders panel.
 */
function ShaderDesignPanel({
  element,
  onUpdateShaderElement,
  onUpdateShaderParams,
  onDeleteShaderElement,
}: Pick<PropertiesPanelProps, "onUpdateShaderElement" | "onUpdateShaderParams" | "onDeleteShaderElement"> & { element: CanvasShaderElement }) {
  const label = getShaderDefinition(element.shaderId).label;
  const thumb = SHADER_THUMB_URLS[element.shaderId];
  const radius = Math.min(element.radius ?? SHADER_ELEMENT_DEFAULT_RADIUS, maxShaderElementRadius(element));
  const commitGeometry = (patch: (next: number) => Partial<Pick<CanvasShaderElement, "x" | "y" | "width" | "height">>, raw: string) => {
    const next = numericValue(raw);
    if (next === null) return;
    const update: Partial<Pick<CanvasShaderElement, "x" | "y" | "width" | "height" | "radius">> = patch(next);
    // A size edit can shrink the pill cap below the stored radius; clamp it
    // so the canvas renders what this inspector shows.
    if (update.width !== undefined || update.height !== undefined) {
      const maxRadius = maxShaderElementRadius({ width: update.width ?? element.width, height: update.height ?? element.height });
      const stored = element.radius ?? SHADER_ELEMENT_DEFAULT_RADIUS;
      if (stored > maxRadius) update.radius = maxRadius;
    }
    onUpdateShaderElement?.(element.id, update);
  };
  return (
    <>
      <div className="selection-summary">
        <span className="selection-summary-mark">{thumb ? <img className="selection-summary-thumb" src={thumb} alt="" draggable={false} /> : <Sparkles size={15} />}</span>
        <span><strong>{label}</strong><small>Shader · {element.width}×{element.height}</small></span>
        <button
          className="shader-inspector-delete"
          type="button"
          aria-label={`Delete ${label} shader`}
          data-testid="shader-panel-delete"
          title="Delete shader"
          onClick={() => onDeleteShaderElement?.(element.id)}
        >
          <Trash2 size={13} strokeWidth={1.8} />
        </button>
      </div>
      <PropertySection title="Position & size" icon={<BoxSelect size={13} />}>
        <div className="property-grid">
          <PropertyField label="X" value={formatNumber(element.x)} type="number" suffix="px" testId="property-shader-x" onCommit={(value) => commitGeometry((next) => ({ x: Math.round(next) }), value)} />
          <PropertyField label="Y" value={formatNumber(element.y)} type="number" suffix="px" testId="property-shader-y" onCommit={(value) => commitGeometry((next) => ({ y: Math.round(next) }), value)} />
          <PropertyField label="W" value={formatNumber(element.width)} type="number" suffix="px" testId="property-shader-width" onCommit={(value) => commitGeometry((next) => ({ width: clampShaderElementSize(next, element.height).width }), value)} />
          <PropertyField label="H" value={formatNumber(element.height)} type="number" suffix="px" testId="property-shader-height" onCommit={(value) => commitGeometry((next) => ({ height: clampShaderElementSize(element.width, next).height }), value)} />
        </div>
      </PropertySection>
      <CornerRadiusSection
        radius={radius}
        max={maxShaderElementRadius(element)}
        onChange={(next) => onUpdateShaderElement?.(element.id, { radius: next })}
        onCommit={() => undefined}
      />
      <PropertySection title="Shader" icon={<Sparkles size={13} />}>
        <ShaderParamsEditor element={element} onUpdateParams={onUpdateShaderParams} />
      </PropertySection>
    </>
  );
}

function FrameDesignPanel({ frame, selection, onUpdateFrame, onMoveFrame }: Pick<PropertiesPanelProps, "selection" | "onUpdateFrame" | "onMoveFrame"> & { frame: FrameEntity }) {
  const multiple = selection.frameIds.length > 1;
  return <><div className="selection-summary"><span className="selection-summary-mark"><BoxSelect size={15} /></span><span><strong>{multiple ? `${selection.frameIds.length} frames` : frame.name}</strong>{multiple ? <small>Mixed selection</small> : null}</span></div><PropertySection title="Position & size" icon={<BoxSelect size={13} />}><div className="property-grid"><PropertyField label="X" value={multiple ? "mixed" : formatNumber(frame.x)} type="number" suffix="px" onCommit={(value) => { const next = numericValue(value); if (next !== null) onMoveFrame(frame.id, { x: next, y: frame.y }); }} /><PropertyField label="Y" value={multiple ? "mixed" : formatNumber(frame.y)} type="number" suffix="px" onCommit={(value) => { const next = numericValue(value); if (next !== null) onMoveFrame(frame.id, { x: frame.x, y: next }); }} /><PropertyField label="W" value={multiple ? "mixed" : formatNumber(frame.width)} type="number" suffix="px" testId="property-frame-width" onCommit={(value) => { const next = numericValue(value); if (next !== null) onUpdateFrame(frame.id, { width: Math.max(24, next) }); }} /><PropertyField label="H" value={multiple ? "mixed" : formatNumber(frame.height)} type="number" suffix="px" onCommit={(value) => { const next = numericValue(value); if (next !== null) onUpdateFrame(frame.id, { height: Math.max(24, next) }); }} /></div></PropertySection><PropertySection title="Fill" icon={<Palette size={13} />}><PropertyField label="Background" value={multiple ? "mixed" : frame.background} onCommit={(value) => onUpdateFrame(frame.id, { background: value })} /></PropertySection></>;
}

export function PropertiesPanel({ frames, nodes, selection, bridgeTargets, onUpdateFrame, onMoveFrame, onEditNodeStyle, onEditNodePosition, onApplyGlassEffect, onPreviewGlassEffect, tokens, shapeRadius, shapeRadiusVisible, onShapeRadiusChange, onShapeRadiusCommit, shaderElements, selectedShaderElementId, onUpdateShaderElement, onUpdateShaderParams, onDeleteShaderElement }: PropertiesPanelProps) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth <= 900);
  const [width, setWidth] = useState(304);
  const [dragging, setDragging] = useState<{ x: number; width: number } | null>(null);
  const selectedFrame = selection.primaryFrameId ? frames[selection.primaryFrameId] : null;
  const selectedShader = shaderElements?.find((entry) => entry.id === selectedShaderElementId) ?? null;
  const entries = useMemo(() => Object.values(bridgeTargets).filter((entry) => selection.nodeIds.includes(entry.target.elementId) && (selection.frameIds.length === 0 || selection.frameIds.includes(entry.frameId))), [bridgeTargets, selection.frameIds, selection.nodeIds]);
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging({ x: event.clientX, width }); };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => { if (dragging) setWidth(Math.min(420, Math.max(260, dragging.width - (event.clientX - dragging.x)))); };
  const stopResizing = () => setDragging(null);
  return <aside className={`right-properties-panel${collapsed ? " is-collapsed" : ""}`} data-canvas-control data-testid="properties-panel" onWheel={(event) => event.stopPropagation()} style={{ width: collapsed ? 48 : width }}><button className="properties-collapse-button" data-testid="right-sidebar-toggle" aria-label={collapsed ? "Expand properties panel" : "Collapse properties panel"} onClick={() => setCollapsed((current) => !current)} type="button">{collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}</button>{!collapsed ? <div className="properties-panel-inner"><div className="inspector-heading"><strong>{selectedShader ? "Shader" : "Design"}</strong></div><div className="properties-scroll">{shapeRadiusVisible && !selectedShader ? <CornerRadiusSection radius={shapeRadius} onChange={onShapeRadiusChange} onCommit={onShapeRadiusCommit} /> : null}      {selection.nodeIds.length > 0 ? <NodeDesignPanel entries={entries} nodes={nodes} onEditNodeStyle={onEditNodeStyle} onEditNodePosition={onEditNodePosition} onApplyGlassEffect={onApplyGlassEffect} onPreviewGlassEffect={onPreviewGlassEffect} tokens={tokens} /> : selectedShader ? <ShaderDesignPanel element={selectedShader} onUpdateShaderElement={onUpdateShaderElement} onUpdateShaderParams={onUpdateShaderParams} onDeleteShaderElement={onDeleteShaderElement} /> : selectedFrame ? <FrameDesignPanel frame={selectedFrame} selection={selection} onUpdateFrame={onUpdateFrame} onMoveFrame={onMoveFrame} /> : <div className="properties-empty"><span className="properties-empty-icon"><Layers3 size={18} /></span><strong>Nothing selected</strong><span>Select a frame or layer.</span></div>}</div><button className="properties-resize-handle" aria-label="Resize properties panel" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stopResizing} onPointerCancel={stopResizing} onLostPointerCapture={stopResizing} type="button" /></div> : null}</aside>;
}
