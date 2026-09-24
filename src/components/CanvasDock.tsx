import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Frame,
  Hand,
  Image,
  MessageCircle,
  Minus,
  Monitor,
  MousePointer2,
  Pentagon,
  Smartphone,
  Sparkles,
  Square,
  Star,
  Tablet,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getToolsForCanvasCategory, isToolAvailable, normalizeActiveTool, SHAPE_VARIANTS, type ShapeVariantId, type ToolId } from "../editor/tools";
import type { ActiveTool } from "../editor/model";
import { getFramePresetSectionsForCanvasCategory, type DeviceCategory, type FramePreset } from "../frame/presets";
import type { CanvasCategory } from "../persistence/local-projects";
import type { ShaderId } from "../shaders";
import { ShaderMenu } from "./ShaderMenu";

interface CanvasDockProps {
  activeTool: ActiveTool;
  temporaryHand: boolean;
  isFrameMenuOpen: boolean;
  isShaderMenuOpen: boolean;
  onAddFrame: (preset: FramePreset) => void;
  onAddShader: (shaderId: ShaderId) => void;
  onSelectTool: (tool: ToolId) => void;
  activeShape: ShapeVariantId;
  onSelectShape: (shape: ShapeVariantId) => void;
  onToggleFrameMenu: () => void;
  onCloseFrameMenu: () => void;
  onToggleShaderMenu: () => void;
  onCloseShaderMenu: () => void;
  /** Active canvas category drives frame preset filtering (website: all, mobile: no desktop) */
  canvasCategory?: CanvasCategory;
}

const shapeIcons: Record<ShapeVariantId, typeof Square> = {
  rectangle: Square,
  ellipse: Circle,
  line: Minus,
  arrow: ArrowUpRight,
  polygon: Pentagon,
  star: Star,
};

const presetIcons: Record<FramePreset["category"], typeof Smartphone> = {
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
  sparkles: Sparkles,
  "message-circle": MessageCircle,
};

export function CanvasDock({
  activeTool,
  temporaryHand,
  isFrameMenuOpen,
  isShaderMenuOpen,
  onAddFrame,
  onAddShader,
  onSelectTool,
  activeShape,
  onSelectShape,
  onToggleFrameMenu,
  onCloseFrameMenu,
  onToggleShaderMenu,
  onCloseShaderMenu,
  canvasCategory = "website",
}: CanvasDockProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const shaderControlRef = useRef<HTMLDivElement>(null);
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<DeviceCategory | null>(null);
  const activeToolId = normalizeActiveTool(activeTool);
  const ActiveShapeIcon = shapeIcons[activeShape] ?? Square;
  const presetSections = useMemo(
    () => getFramePresetSectionsForCanvasCategory(canvasCategory),
    [canvasCategory],
  );
  const visibleTools = useMemo(() => getToolsForCanvasCategory(canvasCategory), [canvasCategory]);

  useEffect(() => {
    if (!isFrameMenuOpen) {
      setActiveCategory(null);
    }
  }, [isFrameMenuOpen]);

  useEffect(() => {
    if (!isFrameMenuOpen && !isShapeMenuOpen && !isShaderMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        onCloseFrameMenu();
        setIsShapeMenuOpen(false);
        onCloseShaderMenu();
        return;
      }
      const inFrameMenu = menuRef.current?.contains(event.target);
      const inShapeMenu = shapeMenuRef.current?.contains(event.target);
      const inShaderMenu = shaderControlRef.current?.contains(event.target);
      if (!inFrameMenu) onCloseFrameMenu();
      if (!inShapeMenu) setIsShapeMenuOpen(false);
      if (!inShaderMenu) onCloseShaderMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onCloseFrameMenu();
      setIsShapeMenuOpen(false);
      onCloseShaderMenu();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFrameMenuOpen, isShapeMenuOpen, isShaderMenuOpen, onCloseFrameMenu, onCloseShaderMenu]);

  // Human copy per canvas — surfaces in Dock tooltip / menu heading
  const frameButtonLabel = "Add frame";
  const frameMenuHint =
    canvasCategory === "mobile"
      ? "Phones & tablets · no desktop"
      : "All devices · mobile / tablet / desktop";

  return (
    <div className="canvas-dock" data-canvas-control aria-label="Canvas controls">
      <div className="tool-group" role="toolbar" aria-label="Design tools">
        {visibleTools.filter((tool) => tool.id !== "frame" && tool.id !== "shader" && tool.id !== "rectangle").map((tool) => {
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
            {SHAPE_VARIANTS.map((shape) => {
              const ShapeIcon = shapeIcons[shape.id] ?? Square;
              return (
                <button
                  className={`shape-menu-item${activeShape === shape.id ? " is-active" : ""}`}
                  data-testid={`shape-menu-${shape.id}`}
                  key={shape.id}
                  onClick={() => { onSelectShape(shape.id); setIsShapeMenuOpen(false); }}
                  role="menuitem"
                  type="button"
                >
                  <ShapeIcon size={14} />
                  <span>{shape.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <button
          aria-expanded={isShapeMenuOpen}
          aria-haspopup="menu"
          aria-label="Shape tools"
          aria-pressed={activeToolId === "rectangle"}
          className={`tool-button shape-menu-button${isShapeMenuOpen || activeToolId === "rectangle" ? " is-active" : ""}`}
          data-testid="shape-menu-button"
          onClick={() => setIsShapeMenuOpen((current) => !current)}
          title="Shape tools"
          type="button"
        >
          <ActiveShapeIcon size={14} strokeWidth={1.8} />
          <ChevronDown size={10} strokeWidth={1.8} />
        </button>
      </div>

      <div className="shader-control" ref={shaderControlRef}>
        {isShaderMenuOpen ? <ShaderMenu onAddShader={onAddShader} onClose={onCloseShaderMenu} /> : null}
        <button
          aria-expanded={isShaderMenuOpen}
          aria-haspopup="menu"
          aria-label="Add shader"
          aria-pressed={activeToolId === "shader"}
          aria-keyshortcuts="S"
          className={`tool-button shader-tool-button${isShaderMenuOpen || activeToolId === "shader" ? " is-active" : ""}`}
          data-testid="tool-button-shader"
          onClick={onToggleShaderMenu}
          title="Add shader · S"
          type="button"
        >
          <Sparkles size={15} strokeWidth={1.8} />
          <ChevronDown size={10} strokeWidth={1.8} />
        </button>
      </div>

      <span className="dock-divider" />

      <div className="add-frame-control" ref={menuRef}>
        {isFrameMenuOpen ? (
          activeCategory
            ? (() => {
              const section = presetSections.find((candidate) => candidate.category === activeCategory);
              if (!section) return null;
              const SectionIcon = presetIcons[section.category];
              const viewportCount = section.groups.reduce((count, group) => count + group.items.length, 0);
              return (
                <div className="frame-menu" role="menu" aria-label="Frame presets">
                  <button
                    className="frame-menu-back"
                    data-testid="frame-menu-back"
                    onClick={() => setActiveCategory(null)}
                    role="menuitem"
                    type="button"
                  >
                    <ChevronLeft size={13} strokeWidth={1.8} aria-hidden="true" />
                    All devices
                  </button>
                  <div className="frame-menu-category-title">
                    <SectionIcon size={13} strokeWidth={1.8} aria-hidden="true" />
                    <span>{section.title}</span>
                    <small>{viewportCount} viewports</small>
                  </div>
                  {section.groups.map((group) => (
                    <div key={group.title}>
                      <div className="frame-menu-group-label">{group.title}</div>
                      {group.items.map((preset) => {
                        const Icon = presetIcons[preset.category];
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
                  ))}
                </div>
              );
            })()
            : (
              <div className="frame-menu" role="menu" aria-label="Frame presets">
                <div className="frame-menu-heading">
                  <div>
                    <strong>New frame</strong>
                    <span>{frameMenuHint}</span>
                  </div>
                  <kbd>F</kbd>
                </div>
                {presetSections.map((section) => {
                  const SectionIcon = presetIcons[section.category];
                  return (
                    <button
                      className="frame-menu-category"
                      data-testid={`frame-category-${section.category}`}
                      key={section.category}
                      onClick={() => setActiveCategory(section.category)}
                      role="menuitem"
                      type="button"
                    >
                      <span className="preset-icon"><SectionIcon size={16} strokeWidth={1.7} /></span>
                      <span>
                        <strong>{section.title}</strong>
                        <small>{section.groups.map((group) => group.title).join(" · ")}</small>
                      </span>
                      <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )
        ) : null}

        <button
          aria-label={frameButtonLabel}
          aria-expanded={isFrameMenuOpen}
          aria-haspopup="menu"
          className={`dock-icon${isFrameMenuOpen ? " is-active" : ""}`}
          data-testid="add-frame-button"
          onClick={onToggleFrameMenu}
          type="button"
          title={frameButtonLabel}
        >
          <Frame size={15} strokeWidth={1.8} aria-hidden="true" />
          <ChevronDown size={10} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
