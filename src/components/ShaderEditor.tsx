import {
  ChevronDown,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { parseCssColor } from "../editor/effects";
import {
  deriveShaderParamFields,
  shaderParamLabel,
  type CanvasShaderElement,
  type ShaderParamField,
  type ShaderParamGroup,
  type ShaderParams,
  type ShaderParamValue,
  type ShaderPresetLike,
} from "../shaders";
import { ColorField, SwatchGrid } from "./ColorField";
import { useLoadedShader } from "./useLoadedShader";

const MAX_COLORS = 10;

function isParamValue(value: unknown): value is ShaderParamValue {
  const type = typeof value;
  return type === "number" || type === "boolean" || type === "string" || Array.isArray(value);
}

/** Subset match: every param the preset declares equals the current value. */
function paramsMatchPreset(presetParams: Record<string, unknown>, current: Record<string, unknown>): boolean {
  return Object.keys(presetParams).every((key) => {
    const va = presetParams[key];
    const vb = current[key];
    if (Array.isArray(va) && Array.isArray(vb)) {
      return va.length === vb.length && va.every((item, index) => item === vb[index]);
    }
    return va === vb;
  });
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

/** Native color inputs need #rrggbb; alpha (hex8) is preserved on write-back. */
function toPickerHex(value: string): string {
  const trimmed = value.trim();
  const hex8 = /^#([0-9a-f]{6})[0-9a-f]{2}$/i.exec(trimmed);
  if (hex8) return `#${hex8[1]}`;
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  const hex3 = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (hex3) {
    const [r, g, b] = hex3[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgb = parseCssColor(trimmed);
  if (rgb) return `#${hexByte(rgb.r)}${hexByte(rgb.g)}${hexByte(rgb.b)}`;
  return "#000000";
}

function applyPickedHex(previous: string, picked: string): string {
  const alpha = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(previous.trim());
  return alpha ? `${picked}${alpha[1]}` : picked;
}

function formatNumber(value: number, step?: number): string {
  if (step && step >= 1) return String(Math.round(value));
  return Number(value.toFixed(2)).toString();
}

function ShaderNumberField({
  field,
  value,
  onCommit,
}: {
  field: ShaderParamField;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(formatNumber(value, field.step));
  useEffect(() => setDraft(formatNumber(value, field.step)), [value, field.step]);
  const commitDraft = () => {
    const next = Number.parseFloat(draft);
    if (Number.isFinite(next) && next !== value) onCommit(next);
    else setDraft(formatNumber(value, field.step));
  };
  const clamped = Math.min(field.max ?? value, Math.max(field.min ?? value, value));
  const progress =
    field.min !== undefined && field.max !== undefined && field.max > field.min
      ? ((clamped - field.min) / (field.max - field.min)) * 100
      : 0;
  return (
    <label className="shader-param" data-testid={`shader-param-${field.name}`}>
      <span className="shader-param-label" title={field.name}>{field.label}</span>
      <span className="shader-param-controls">
        <input
          className="shader-slider"
          type="range"
          aria-label={`${field.label} slider`}
          min={field.min}
          max={field.max}
          step={field.step}
          value={clamped}
          style={{ "--p": `${progress}%` } as CSSProperties}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value);
            if (Number.isFinite(next)) onCommit(next);
          }}
        />
        <input
          className="shader-param-number"
          type="number"
          aria-label={field.label}
          min={field.min}
          max={field.max}
          step={field.step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </span>
    </label>
  );
}

function ShaderBooleanField({
  field,
  value,
  onCommit,
}: {
  field: ShaderParamField;
  value: boolean;
  onCommit: (value: boolean) => void;
}) {
  return (
    <label className="shader-param" data-testid={`shader-param-${field.name}`}>
      <span className="shader-param-label">{field.label}</span>
      <input
        className="shader-switch"
        type="checkbox"
        role="switch"
        aria-label={field.label}
        checked={value}
        onChange={(event) => onCommit(event.target.checked)}
      />
    </label>
  );
}

function ShaderColorField({
  field,
  value,
  onCommit,
}: {
  field: ShaderParamField;
  value: string;
  onCommit: (value: string) => void;
}) {
  return (
    <div className="shader-param shader-param-color" data-testid={`shader-param-${field.name}`}>
      <ColorField label={field.label} value={value} onCommit={onCommit} />
    </div>
  );
}

function ShaderColorsField({
  field,
  value,
  onCommit,
}: {
  field: ShaderParamField;
  value: string[];
  onCommit: (value: string[]) => void;
}) {
  const colors = value.length > 0 ? value : ["#000000"];
  // One popover per row, anchored to the row (never clipped by the panel edge).
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rowRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (openIndex === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !rowRef.current?.contains(event.target)) setOpenIndex(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [openIndex]);
  const setColor = (index: number, color: string) => {
    const next = [...colors];
    next[index] = color;
    onCommit(next);
  };
  return (
    <div className="shader-param is-colors" data-testid={`shader-param-${field.name}`}>
      <span className="shader-param-label">{field.label}</span>
      <span className="shader-colors-row" ref={rowRef}>
        {colors.map((color, index) => (
          <span className="shader-color-stop" key={index}>
            <button
              className="color-swatch-button"
              type="button"
              aria-label={`${field.label} ${index + 1}`}
              aria-expanded={openIndex === index}
              title={color}
              style={{ background: color }}
              onClick={() => setOpenIndex((current) => (current === index ? null : index))}
            />
            {colors.length > 1 ? (
              <button
                className="shader-color-remove"
                type="button"
                aria-label={`Remove ${field.label} ${index + 1}`}
                onClick={() => onCommit(colors.filter((_, entry) => entry !== index))}
              >
                <X size={9} strokeWidth={2.4} />
              </button>
            ) : null}
          </span>
        ))}
        {colors.length < MAX_COLORS ? (
          <button
            className="shader-color-add"
            type="button"
            aria-label={`Add ${field.label}`}
            title="Add color"
            onClick={() => onCommit([...colors, colors[colors.length - 1]])}
          >
            <Plus size={11} strokeWidth={2.2} />
          </button>
        ) : null}
        {openIndex !== null && colors[openIndex] !== undefined ? (
          <span className="color-popover shader-color-popover">
            <SwatchGrid
              value={colors[openIndex]}
              onPick={(picked) => {
                setColor(openIndex, applyPickedHex(colors[openIndex], picked));
                setOpenIndex(null);
              }}
            />
          </span>
        ) : null}
      </span>
    </div>
  );
}

function ShaderSelect({
  label,
  value,
  options,
  testId,
  onCommit,
}: {
  label: string;
  value: string;
  options: readonly string[];
  testId?: string;
  onCommit: (value: string) => void;
}) {
  return (
    <span className="shader-select-wrap">
      <select
        aria-label={label}
        data-testid={testId}
        value={value}
        onChange={(event) => onCommit(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {shaderParamLabel(option)}
          </option>
        ))}
        {!options.includes(value) ? (
          <option value={value}>{value === "" ? "Custom" : shaderParamLabel(value)}</option>
        ) : null}
      </select>
      <ChevronDown size={11} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

function ShaderSelectField({
  field,
  value,
  onCommit,
}: {
  field: ShaderParamField;
  value: string;
  onCommit: (value: string) => void;
}) {
  return (
    <label className="shader-param" data-testid={`shader-param-${field.name}`}>
      <span className="shader-param-label">{field.label}</span>
      <ShaderSelect label={field.label} value={value} options={field.options ?? []} onCommit={onCommit} />
    </label>
  );
}

function ShaderTextField({
  field,
  value,
  onCommit,
  placeholder,
}: {
  field: ShaderParamField;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commitDraft = () => {
    const next = draft.trim();
    if (next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <label className="shader-param" data-testid={`shader-param-${field.name}`}>
      <span className="shader-param-label">{field.label}</span>
      <input
        className="shader-param-text"
        type="text"
        aria-label={field.label}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

const GROUP_HEADINGS: Partial<Record<ShaderParamGroup, string>> = {
  color: "Colors",
  motion: "Motion",
  sizing: "Sizing",
};
const GROUP_ORDER: readonly ShaderParamGroup[] = ["color", "param", "motion", "sizing"];

function ShaderParamFieldView({
  field,
  value,
  onCommit,
}: {
  field: ShaderParamField;
  value: ShaderParamValue | undefined;
  onCommit: (value: ShaderParamValue | undefined) => void;
}) {
  switch (field.kind) {
    case "number":
      return (
        <ShaderNumberField
          field={field}
          value={typeof value === "number" ? value : 0}
          onCommit={(next) => onCommit(next)}
        />
      );
    case "boolean":
      return (
        <ShaderBooleanField
          field={field}
          value={value === true}
          onCommit={(next) => onCommit(next)}
        />
      );
    case "color":
      return (
        <ShaderColorField
          field={field}
          value={typeof value === "string" ? value : "#000000"}
          onCommit={(next) => onCommit(next)}
        />
      );
    case "colors":
      return (
        <ShaderColorsField
          field={field}
          value={Array.isArray(value) ? value : []}
          onCommit={(next) => onCommit(next)}
        />
      );
    case "select":
      return (
        <ShaderSelectField
          field={field}
          value={typeof value === "string" ? value : ""}
          onCommit={(next) => onCommit(next)}
        />
      );
    case "image":
      return (
        <ShaderTextField
          field={field}
          value={typeof value === "string" ? value : ""}
          placeholder="Built-in sample"
          onCommit={(next) => onCommit(next)}
        />
      );
    default:
      return (
        <ShaderTextField
          field={field}
          value={typeof value === "string" ? value : String(value ?? "")}
          onCommit={(next) => onCommit(next)}
        />
      );
  }
}

/**
 * The full editable surface of one shader element: preset picker plus every
 * param the shader exposes (derived from its preset table), grouped for the
 * inspector. Edits are applied on top of the default preset so a first edit
 * produces a complete params object that fully describes the render.
 */
export function ShaderParamsEditor({
  element,
  onUpdateParams,
}: {
  element: CanvasShaderElement;
  onUpdateParams?: (elementId: string, params: ShaderParams) => void;
}) {
  // The editor only reads preset metadata — no GL probe, so controls stay
  // usable on machines where the preview itself can't render.
  const { shader, failure, retry } = useLoadedShader(element.shaderId, { checkSupport: false });
  const loaded = useMemo<{
    presets: readonly ShaderPresetLike[];
    fields: ShaderParamField[];
  } | null>(() => {
    if (!shader) return null;
    const presets = shader.presets as unknown as readonly ShaderPresetLike[];
    return { presets, fields: deriveShaderParamFields(element.shaderId, presets) };
  }, [shader, element.shaderId]);

  const defaults = useMemo(
    () => (loaded?.presets[0]?.params ?? {}) as ShaderParams,
    [loaded],
  );
  const current = useMemo<ShaderParams>(
    () => ({ ...defaults, ...element.params }),
    [defaults, element.params],
  );

  const commitParam = (name: string, value: ShaderParamValue | undefined) => {
    if (!onUpdateParams) return;
    const next: ShaderParams = {};
    for (const [key, entry] of Object.entries(defaults)) {
      if (isParamValue(entry)) next[key] = entry;
    }
    Object.assign(next, element.params);
    if (value === undefined || (name === "image" && value === "")) delete next[name];
    else next[name] = value;
    onUpdateParams(element.id, next);
  };

  const applyPreset = (preset: ShaderPresetLike) => {
    if (!onUpdateParams) return;
    const next: ShaderParams = {};
    for (const [key, entry] of Object.entries(preset.params)) {
      if (isParamValue(entry)) next[key] = entry;
    }
    // Library presets never carry `image` — switching looks shouldn't drop
    // the user's source image.
    if (typeof current.image === "string" && current.image) next.image = current.image;
    onUpdateParams(element.id, next);
  };

  if (!loaded) {
    if (failure) {
      return (
        <div className="shader-element-editor">
          <span className="shader-editor-hint">
            {failure === "unknown" ? "Unknown shader." : "Shader controls failed to load."}
          </span>
          {failure !== "unknown" ? (
            <button className="shader-reset-button" type="button" onClick={retry}>
              <RotateCcw size={11} strokeWidth={2} />
              Retry
            </button>
          ) : null}
        </div>
      );
    }
    return <div className="shader-element-editor is-loading" aria-label="Loading shader controls" />;
  }
  if (loaded.fields.length === 0) {
    return <div className="shader-element-editor"><span className="shader-editor-hint">No editable params.</span></div>;
  }

  const activePreset = loaded.presets.find((preset) => paramsMatchPreset(preset.params, current));
  const groups = GROUP_ORDER
    .map((group) => ({ group, fields: loaded.fields.filter((field) => field.group === group) }))
    .filter((entry) => entry.fields.length > 0);

  return (
    <div className="shader-element-editor" data-testid={`shader-editor-${element.id}`}>
      {loaded.presets.length > 0 ? (
        <label className="shader-param">
          <span className="shader-param-label">Preset</span>
          <ShaderSelect
            label="Shader preset"
            testId="shader-preset-select"
            value={activePreset?.name ?? ""}
            options={loaded.presets.map((preset) => preset.name)}
            onCommit={(name) => {
              const preset = loaded.presets.find((entry) => entry.name === name);
              if (preset) applyPreset(preset);
            }}
          />
        </label>
      ) : null}
      {groups.map(({ group, fields }) => {
        const heading = GROUP_HEADINGS[group];
        return (
          <div className="shader-param-section" key={group}>
            {heading ? <div className="shader-param-group">{heading}</div> : null}
            {fields.map((field) => (
              <ShaderParamFieldView
                key={field.name}
                field={field}
                value={current[field.name]}
                onCommit={(next) => commitParam(field.name, next)}
              />
            ))}
          </div>
        );
      })}
      <button
        className="shader-reset-button"
        type="button"
        onClick={() => {
          const preset = loaded.presets[0];
          if (preset) applyPreset(preset);
        }}
      >
        <RotateCcw size={11} strokeWidth={2} />
        Reset to defaults
      </button>
    </div>
  );
}
