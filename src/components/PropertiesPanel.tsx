import {
  BoxSelect,
  ChevronDown,
  Layers3,
  PanelRightClose,
  PanelRightOpen,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SafeInlineStyleProperty } from "../bridge/protocol";
import type { FrameEntity, NodeEntity, SelectionState } from "../editor/model";
import type { OverlayBridgeTargetState } from "../overlay/useNodeOverlayGestures";
import { elementProfile, mixedValue } from "./panel-model";

export interface PropertiesPanelProps {
  frames: Record<string, FrameEntity>;
  nodes: Record<string, NodeEntity>;
  selection: SelectionState;
  bridgeTargets: Record<string, OverlayBridgeTargetState>;
  onUpdateFrame: (frameId: string, patch: Partial<Pick<FrameEntity, "width" | "height" | "background" | "name">>) => void;
  onMoveFrame: (frameId: string, position: { x: number; y: number }) => void;
  onEditNodeStyle: (property: SafeInlineStyleProperty, value: string | null) => void;
  onEditNodePosition: (frameId: string, nodeId: string, position: { x: number; y: number }) => void;
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
}: {
  label: string;
  value: string | null;
  onCommit: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  testId?: string;
  suffix?: string;
  disabled?: boolean;
}) {
  const isMixed = value === "mixed";
  const [draft, setDraft] = useState(isMixed || value === null ? "" : value);
  useEffect(() => setDraft(isMixed || value === null ? "" : value), [isMixed, value]);
  return (
    <label className={`property-field${disabled ? " is-disabled" : ""}`}>
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
          onBlur={() => { if (draft.trim() !== "") onCommit(draft.trim()); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        {suffix ? <small>{suffix}</small> : null}
      </span>
    </label>
  );
}

function PropertySection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="property-section"><div className="property-section-title"><span>{icon}{title}</span><ChevronDown size={13} /></div>{children}</section>;
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

function TypographySection({ entries, onEditNodeStyle }: Pick<PropertiesPanelProps, "onEditNodeStyle"> & { entries: OverlayBridgeTargetState[] }) {
  return (
    <PropertySection title="Typography" icon={<Type size={13} />}>
      <div className="property-grid property-grid-single">
        <PropertyField label="Family" value={styleValue(entries, "font-family")} onCommit={(value) => onEditNodeStyle("font-family", value)} />
        <div className="property-grid"><PropertyField label="Size" value={styleValue(entries, "font-size")} onCommit={(value) => onEditNodeStyle("font-size", value)} /><PropertyField label="Weight" value={styleValue(entries, "font-weight")} onCommit={(value) => onEditNodeStyle("font-weight", value)} /></div>
        <PropertyField label="Line height" value={styleValue(entries, "line-height")} onCommit={(value) => onEditNodeStyle("line-height", value)} />
        <div className="property-grid"><PropertyField label="Color" value={styleValue(entries, "color")} onCommit={(value) => onEditNodeStyle("color", value)} /><PropertyField label="Align" value={styleValue(entries, "text-align")} onCommit={(value) => onEditNodeStyle("text-align", value)} /></div>
      </div>
    </PropertySection>
  );
}

function FillBorderSection({ entries, onEditNodeStyle }: Pick<PropertiesPanelProps, "onEditNodeStyle"> & { entries: OverlayBridgeTargetState[] }) {
  return (
    <PropertySection title="Fill & border" icon={<Palette size={13} />}>
      <div className="property-grid property-grid-single">
        <PropertyField label="Background" value={styleValue(entries, "background-color") ?? styleValue(entries, "background")} onCommit={(value) => onEditNodeStyle("background-color", value)} />
        <div className="property-grid"><PropertyField label="Border" value={styleValue(entries, "border-color")} onCommit={(value) => onEditNodeStyle("border-color", value)} /><PropertyField label="Width" value={styleValue(entries, "border-width")} onCommit={(value) => onEditNodeStyle("border-width", value)} /></div>
        <PropertyField label="Radius" value={styleValue(entries, "border-radius")} onCommit={(value) => onEditNodeStyle("border-radius", value)} />
      </div>
    </PropertySection>
  );
}

function OpacityEffectsSection({ entries, onEditNodeStyle }: Pick<PropertiesPanelProps, "onEditNodeStyle"> & { entries: OverlayBridgeTargetState[] }) {
  return (
    <PropertySection title="Opacity & effects" icon={<SlidersHorizontal size={13} />}>
      <div className="property-grid property-grid-single"><PropertyField label="Opacity" value={styleValue(entries, "opacity")} onCommit={(value) => onEditNodeStyle("opacity", value)} /><PropertyField label="Shadow" value={styleValue(entries, "box-shadow")} onCommit={(value) => onEditNodeStyle("box-shadow", value)} /></div>
    </PropertySection>
  );
}

function NodeDesignPanel({
  entries,
  nodes,
  onEditNodeStyle,
  onEditNodePosition,
}: Pick<PropertiesPanelProps, "nodes" | "onEditNodeStyle" | "onEditNodePosition"> & { entries: OverlayBridgeTargetState[] }) {
  const primary = entries[0];
  const profile = primary ? elementProfile(primary.target, nodes[primary.target.elementId]) : null;
  const positionProps = { entries, onEditNodeStyle, onEditNodePosition };
  return (
    <div className="properties-scroll">
      <div className="selection-summary"><span className="selection-summary-mark"><BoxSelect size={15} /></span><span><strong>{entries.length === 1 ? primary?.inspection?.target.name ?? "Layer" : `${entries.length} layers`}</strong><small>{entries.length === 1 ? "Selected layer" : "Mixed selection"}</small></span></div>
      {!entries.every((entry) => entry.inspection) ? <div className="property-inspecting"><Sparkles size={13} /> Inspecting live layer…</div> : null}
      {profile === "button" ? (
        <>
          <PositionSizeSection {...positionProps} />
          <PropertySection title="Button style" icon={<Palette size={13} />}>
            <div className="property-grid property-grid-single">
              <PropertyField label="Background" value={styleValue(entries, "background-color") ?? styleValue(entries, "background")} onCommit={(value) => onEditNodeStyle("background-color", value)} />
              <PropertyField label="Radius" value={styleValue(entries, "border-radius")} onCommit={(value) => onEditNodeStyle("border-radius", value)} />
              <div className="property-grid"><PropertyField label="Border" value={styleValue(entries, "border-color")} onCommit={(value) => onEditNodeStyle("border-color", value)} /><PropertyField label="Width" value={styleValue(entries, "border-width")} onCommit={(value) => onEditNodeStyle("border-width", value)} /></div>
            </div>
          </PropertySection>
          <PropertySection title="Text" icon={<Type size={13} />}>
            <div className="property-grid property-grid-single">
              <div className="property-grid"><PropertyField label="Color" value={styleValue(entries, "color")} onCommit={(value) => onEditNodeStyle("color", value)} /><PropertyField label="Size" value={styleValue(entries, "font-size")} onCommit={(value) => onEditNodeStyle("font-size", value)} /></div>
            </div>
          </PropertySection>
        </>
      ) : profile === "text" ? (
        <>
          <PositionSizeSection {...positionProps} includeHeight={false} />
          <TypographySection entries={entries} onEditNodeStyle={onEditNodeStyle} />
        </>
      ) : profile === "shape" ? (
        <>
          <PositionSizeSection {...positionProps} />
          <FillBorderSection entries={entries} onEditNodeStyle={onEditNodeStyle} />
          <OpacityEffectsSection entries={entries} onEditNodeStyle={onEditNodeStyle} />
        </>
      ) : profile === "image" ? (
        <>
          <PositionSizeSection {...positionProps} />
          <OpacityEffectsSection entries={entries} onEditNodeStyle={onEditNodeStyle} />
        </>
      ) : (
        <>
          <PositionSizeSection {...positionProps} />
          <FillBorderSection entries={entries} onEditNodeStyle={onEditNodeStyle} />
          <OpacityEffectsSection entries={entries} onEditNodeStyle={onEditNodeStyle} />
        </>
      )}
    </div>
  );
}

function FrameDesignPanel({ frame, selection, onUpdateFrame, onMoveFrame }: Pick<PropertiesPanelProps, "selection" | "onUpdateFrame" | "onMoveFrame"> & { frame: FrameEntity }) {
  const multiple = selection.frameIds.length > 1;
  return <div className="properties-scroll"><div className="selection-summary"><span className="selection-summary-mark"><BoxSelect size={15} /></span><span><strong>{multiple ? `${selection.frameIds.length} frames` : frame.name}</strong><small>{multiple ? "Mixed selection" : "Responsive frame"}</small></span></div><PropertySection title="Position & size" icon={<BoxSelect size={13} />}><div className="property-grid"><PropertyField label="X" value={multiple ? "mixed" : formatNumber(frame.x)} type="number" suffix="px" onCommit={(value) => { const next = numericValue(value); if (next !== null) onMoveFrame(frame.id, { x: next, y: frame.y }); }} /><PropertyField label="Y" value={multiple ? "mixed" : formatNumber(frame.y)} type="number" suffix="px" onCommit={(value) => { const next = numericValue(value); if (next !== null) onMoveFrame(frame.id, { x: frame.x, y: next }); }} /><PropertyField label="W" value={multiple ? "mixed" : formatNumber(frame.width)} type="number" suffix="px" testId="property-frame-width" onCommit={(value) => { const next = numericValue(value); if (next !== null) onUpdateFrame(frame.id, { width: Math.max(24, next) }); }} /><PropertyField label="H" value={multiple ? "mixed" : formatNumber(frame.height)} type="number" suffix="px" onCommit={(value) => { const next = numericValue(value); if (next !== null) onUpdateFrame(frame.id, { height: Math.max(24, next) }); }} /></div></PropertySection><PropertySection title="Fill" icon={<Palette size={13} />}><PropertyField label="Background" value={multiple ? "mixed" : frame.background} onCommit={(value) => onUpdateFrame(frame.id, { background: value })} /></PropertySection></div>;
}

export function PropertiesPanel({ frames, nodes, selection, bridgeTargets, onUpdateFrame, onMoveFrame, onEditNodeStyle, onEditNodePosition }: PropertiesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(304);
  const [dragging, setDragging] = useState<{ x: number; width: number } | null>(null);
  const selectedFrame = selection.primaryFrameId ? frames[selection.primaryFrameId] : null;
  const entries = useMemo(() => Object.values(bridgeTargets).filter((entry) => selection.nodeIds.includes(entry.target.elementId) && (selection.frameIds.length === 0 || selection.frameIds.includes(entry.frameId))), [bridgeTargets, selection.frameIds, selection.nodeIds]);
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging({ x: event.clientX, width }); };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => { if (dragging) setWidth(Math.min(420, Math.max(260, dragging.width - (event.clientX - dragging.x)))); };
  return <aside className={`right-properties-panel${collapsed ? " is-collapsed" : ""}`} data-canvas-control data-testid="properties-panel" onWheel={(event) => event.stopPropagation()} style={{ width: collapsed ? 48 : width }}><button className="properties-collapse-button" data-testid="right-sidebar-toggle" aria-label={collapsed ? "Expand properties panel" : "Collapse properties panel"} onClick={() => setCollapsed((current) => !current)} type="button">{collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}</button>{!collapsed ? <div className="properties-panel-inner">{selection.nodeIds.length > 0 ? <NodeDesignPanel entries={entries} nodes={nodes} onEditNodeStyle={onEditNodeStyle} onEditNodePosition={onEditNodePosition} /> : selectedFrame ? <FrameDesignPanel frame={selectedFrame} selection={selection} onUpdateFrame={onUpdateFrame} onMoveFrame={onMoveFrame} /> : <div className="properties-empty"><span className="properties-empty-icon"><Layers3 size={18} /></span><strong>Nothing selected</strong><span>Select a frame or layer to inspect its properties.</span></div>}<button className="properties-resize-handle" aria-label="Resize properties panel" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => setDragging(null)} type="button" /></div> : null}</aside>;
}
