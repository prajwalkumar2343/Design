import {
  ArrowUpRight,
  Circle,
  ChevronDown,
  Frame,
  Hand,
  Image,
  Maximize2,
  MessageCircle,
  Minus,
  Monitor,
  MousePointer2,
  PenTool,
  Pipette,
  Plus,
  Redo2,
  Smartphone,
  Square,
  Star,
  Tablet,
  Type,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isToolAvailable, normalizeActiveTool, SHAPE_VARIANTS, TOOL_REGISTRY, type ShapeVariantId, type ToolId } from "../editor/tools";
import type { ActiveTool } from "../editor/model";
import { FRAME_PRESETS, type FramePreset } from "../frame/presets";

interface CanvasDockProps {
  zoom: number;
  activeTool: ActiveTool;
  temporaryHand: boolean;
  isFrameMenuOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onAddFrame: (preset: FramePreset) => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSelectTool: (tool: ToolId) => void;
  activeShape: ShapeVariantId;
  onSelectShape: (shape: ShapeVariantId) => void;
  onToggleFrameMenu: () => void;
  onCloseFrameMenu: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const presetIcons = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

const toolIcons = {
  "mouse-pointer-2": MousePointer2,
  hand: Hand,
  frame: Frame,
  square: Square,
  type: Type,
  image: Image,
  "pen-tool": PenTool,
  "message-circle": MessageCircle,
  pipette: Pipette,
};

export function CanvasDock({
  zoom,
  activeTool,
  temporaryHand,
  isFrameMenuOpen,
  canUndo,
  canRedo,
  onAddFrame,
  onFit,
  onZoomIn,
  onZoomOut,
  onSelectTool,
  activeShape,
  onSelectShape,
  onToggleFrameMenu,
  onCloseFrameMenu,
  onUndo,
  onRedo,
}: CanvasDockProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false);
  const activeToolId = normalizeActiveTool(activeTool);

  useEffect(() => {
    if (!isFrameMenuOpen && !isShapeMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || (!menuRef.current?.contains(event.target) && !shapeMenuRef.current?.contains(event.target))) {
        onCloseFrameMenu();
        setIsShapeMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isFrameMenuOpen, isShapeMenuOpen, onCloseFrameMenu]);

  return (
    <div className="canvas-dock" data-canvas-control aria-label="Canvas controls">
      <div className="tool-group" role="toolbar" aria-label="Design tools">
        {TOOL_REGISTRY.map((tool) => {
          const Icon = toolIcons[tool.icon];
          const isActive =
            tool.id === "hand"
              ? temporaryHand || activeToolId === "hand"
              : activeToolId === tool.id;
          const isAvailable = isToolAvailable(tool);
          const shortcutLabel = tool.shortcut ? ` · ${tool.shortcut}` : "";

          return (
            <button
              aria-disabled={!isAvailable}
              aria-label={tool.label}
              aria-pressed={isActive}
              aria-keyshortcuts={tool.shortcut || undefined}
              className={`tool-button${isActive ? " is-active" : ""}`}
              data-testid={`tool-button-${tool.id}`}
              disabled={!isAvailable}
              key={tool.id}
              onClick={() => onSelectTool(tool.id)}
              title={`${tool.description}${shortcutLabel}${isAvailable ? "" : " · Coming soon"}`}
              type="button"
            >
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
              {!isAvailable ? <span className="sr-only">Coming soon</span> : null}
            </button>
          );
        })}
      </div>

      <div className="shape-menu-control" ref={shapeMenuRef}>
        {isShapeMenuOpen ? (
          <div className="shape-menu" role="menu" aria-label="Shape tools">
            <div className="frame-menu-heading">
              <div><strong>Shape tools</strong><span>Choose a vector primitive</span></div>
              <kbd>R</kbd>
            </div>
            {SHAPE_VARIANTS.map((shape) => (
              <button
                className={`shape-menu-item${activeShape === shape.id ? " is-active" : ""}`}
                data-testid={`shape-menu-${shape.id}`}
                key={shape.id}
                onClick={() => { onSelectShape(shape.id); setIsShapeMenuOpen(false); }}
                role="menuitem"
                type="button"
              >
                {shape.id === "ellipse" ? <Circle size={14} /> : shape.id === "line" ? <Minus size={14} /> : shape.id === "arrow" ? <ArrowUpRight size={14} /> : shape.id === "star" ? <Star size={14} /> : <Square size={14} />}
                <span>{shape.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        <button
          aria-expanded={isShapeMenuOpen}
          aria-haspopup="menu"
          aria-label="Shape tools"
          className={`tool-button shape-menu-button${isShapeMenuOpen ? " is-active" : ""}`}
          data-testid="shape-menu-button"
          onClick={() => setIsShapeMenuOpen((current) => !current)}
          title="Shape tools"
          type="button"
        >
          <Square size={14} strokeWidth={1.8} />
          <ChevronDown size={10} strokeWidth={1.8} />
        </button>
      </div>

      <span className="dock-divider" />

      <div className="add-frame-control" ref={menuRef}>
        {isFrameMenuOpen ? (
          <div className="frame-menu" role="menu" aria-label="Frame presets">
            <div className="frame-menu-heading">
              <div>
                <strong>New frame</strong>
                <span>Choose a responsive viewport</span>
              </div>
              <kbd>F</kbd>
            </div>
            {FRAME_PRESETS.map((preset) => {
              const Icon = presetIcons[preset.id];
              return (
                <button
                  className="frame-preset"
                  data-testid={`add-${preset.id}-frame`}
                  key={preset.id}
                  onClick={() => {
                    onAddFrame(preset);
                    onCloseFrameMenu();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="preset-icon"><Icon size={16} strokeWidth={1.7} /></span>
                  <span>
                    <strong>{preset.label}</strong>
                    <small>{preset.detail}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <button
          className="dock-primary"
          data-testid="add-frame-button"
          aria-expanded={isFrameMenuOpen}
          aria-haspopup="menu"
          onClick={onToggleFrameMenu}
          type="button"
        >
          <Frame size={15} strokeWidth={1.8} aria-hidden="true" />
          Add frame
          <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <span className="dock-divider" />

      <button
        aria-label="Undo"
        className="dock-icon"
        data-testid="undo-button"
        disabled={!canUndo}
        onClick={onUndo}
        title="Undo · ⌘/Ctrl Z"
        type="button"
      >
        <Undo2 size={15} strokeWidth={1.8} />
      </button>
      <button
        aria-label="Redo"
        className="dock-icon"
        data-testid="redo-button"
        disabled={!canRedo}
        onClick={onRedo}
        title="Redo · ⇧⌘/Ctrl Z"
        type="button"
      >
        <Redo2 size={15} strokeWidth={1.8} />
      </button>

      <span className="dock-divider" />

      <div className="zoom-control" aria-label="Zoom controls">
        <button aria-label="Zoom out" onClick={onZoomOut} type="button">
          <Minus size={15} strokeWidth={1.8} />
        </button>
        <button className="zoom-value" aria-label="Fit all frames" onClick={onFit} type="button">
          {Math.round(zoom * 100)}%
        </button>
        <button aria-label="Zoom in" onClick={onZoomIn} type="button">
          <Plus size={15} strokeWidth={1.8} />
        </button>
      </div>

      <button className="dock-icon" aria-label="Fit all frames" onClick={onFit} type="button">
        <Maximize2 size={15} strokeWidth={1.7} />
      </button>
    </div>
  );
}
