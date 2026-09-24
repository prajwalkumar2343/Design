import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getShaderDefinition,
  type CanvasShaderElement,
  type ShaderParams,
} from "../shaders";
import { ShaderParamsEditor } from "./ShaderEditor";

export interface ShadersPanelProps {
  shaderElements: CanvasShaderElement[];
  selectedShaderElementId?: string | null;
  onSelectShaderElement?: (elementId: string | null) => void;
  onUpdateShaderParams?: (elementId: string, params: ShaderParams) => void;
  onDeleteShaderElement?: (elementId: string) => void;
}

function ShadersPanel({
  shaderElements,
  selectedShaderElementId,
  onSelectShaderElement,
  onUpdateShaderParams,
  onDeleteShaderElement,
}: ShadersPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Selecting a shader element on the canvas expands its editor here —
  // fired only on selection transitions so a replaced element array (param
  // edits) can't re-expand a row the user collapsed.
  const lastSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const selected = selectedShaderElementId ?? null;
    if (selected === lastSelectedIdRef.current) return;
    lastSelectedIdRef.current = selected;
    if (selected && shaderElements.some((entry) => entry.id === selected)) {
      setExpandedId(selected);
    }
  }, [selectedShaderElementId, shaderElements]);

  // Drop a stale expansion when its element is removed.
  useEffect(() => {
    if (expandedId && !shaderElements.some((entry) => entry.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, shaderElements]);

  return (
    <section className="sidebar-panel-content" aria-label="Shaders panel">
      <div className="sidebar-panel-heading">
        <span className="sidebar-count">
          {shaderElements.length} {shaderElements.length === 1 ? "shader" : "shaders"}
        </span>
      </div>
      {shaderElements.length === 0 ? (
        <div className="sidebar-empty">
          <Sparkles size={20} />
          <strong>No shaders yet</strong>
          <span>Press <kbd>S</kbd> or use the shader tool to place one on the canvas.</span>
        </div>
      ) : (
        <div className="shader-element-list">
          {shaderElements.map((element) => {
            const isSelected = element.id === selectedShaderElementId;
            const isExpanded = expandedId === element.id;
            const label = getShaderDefinition(element.shaderId).label;
            return (
              <div
                className={`shader-element-item${isSelected ? " is-selected" : ""}`}
                data-testid={`shader-element-row-${element.id}`}
                key={element.id}
              >
                <div className="shader-element-head">
                  <button
                    className="shader-element-toggle"
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label} controls`}
                    onClick={() => {
                      setExpandedId(isExpanded ? null : element.id);
                      onSelectShaderElement?.(element.id);
                    }}
                  >
                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <Sparkles size={11} className="shader-element-mark" />
                    <span className="shader-element-name">{label}</span>
                    <small>
                      {element.width}×{element.height}
                    </small>
                  </button>
                  <button
                    className="layer-action-button"
                    type="button"
                    aria-label={`Delete ${label}`}
                    title="Delete shader"
                    onClick={() => onDeleteShaderElement?.(element.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {isExpanded ? (
                  <ShaderParamsEditor element={element} onUpdateParams={onUpdateShaderParams} />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export { ShadersPanel };
