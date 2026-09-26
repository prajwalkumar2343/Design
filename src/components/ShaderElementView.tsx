import { RotateCcw, Trash2 } from "lucide-react";
import { Component as ReactComponent, memo, useEffect, useMemo, useRef, type ComponentType, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { SafeShaderMount } from "./SafeShaderMount";
import { useLoadedShader, type ShaderFailureKind } from "./useLoadedShader";
import {
  clampShaderElementSize,
  getShaderDefinition,
  getShaderMountProps,
  isShaderId,
  SHADER_ELEMENT_RADIUS_INSET,
  type CanvasShaderElement,
} from "../shaders";
import type { Camera, Point } from "../canvas/types";

interface ShaderElementViewProps {
  element: CanvasShaderElement;
  camera: Camera;
  isSelected: boolean;
  onSelect: (elementId: string | null) => void;
  onChange: (elementId: string, patch: Partial<Pick<CanvasShaderElement, "x" | "y" | "width" | "height">>) => void;
  onDelete: (elementId: string) => void;
}

interface ElementDragState {
  kind: "move" | "resize";
  pointerId: number;
  startScreen: Point;
  origin: { x: number; y: number; width: number; height: number };
}

const FAILURE_MESSAGES: Record<ShaderFailureKind, string> = {
  unsupported: "WebGL2 unavailable",
  unknown: "Unknown shader",
  "load-error": "Shader failed to load",
};

/**
 * A transient render crash (lost GL state, a bad param write) shouldn't
 * brick the element forever: when the shader id, params, or load attempt
 * changes, the boundary opens back up and the shader gets another mount.
 */
class ShaderElementBoundary extends ReactComponent<
  { children: ReactNode; resetKey: string },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.warn("Shader element crashed", error);
  }

  override componentDidUpdate(previous: { resetKey: string }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render() {
    if (this.state.failed) {
      return <div className="shader-element-unsupported">Shader failed to render</div>;
    }
    return this.props.children;
  }
}

export const ShaderElementView = memo(function ShaderElementView({
  element,
  camera,
  isSelected,
  onSelect,
  onChange,
  onDelete,
}: ShaderElementViewProps) {
  const rootRef = useRef<HTMLElement>(null);
  const dragRef = useRef<ElementDragState | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const { shader, failure, retry, attempt } = useLoadedShader(element.shaderId);
  const Component = shader?.Component as ComponentType<{ width?: string; height?: string }> | undefined;
  // The registry knows the label synchronously — no module fetch needed.
  const definitionLabel = isShaderId(element.shaderId)
    ? getShaderDefinition(element.shaderId).label
    : element.shaderId;

  // Clicking anywhere outside a selected shader element deselects it —
  // except clicks on canvas chrome (sidebars, inspector), which are edits,
  // not canvas gestures.
  useEffect(() => {
    if (!isSelected) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-canvas-control]")) return;
      onSelect(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isSelected, onSelect]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, kind: ElementDragState["kind"]) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind,
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      origin: { x: element.x, y: element.y, width: element.width, height: element.height },
    };
    onSelect(element.id);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const zoom = cameraRef.current.zoom || 1;
    const worldDelta = {
      x: (event.clientX - drag.startScreen.x) / zoom,
      y: (event.clientY - drag.startScreen.y) / zoom,
    };
    if (drag.kind === "move") {
      onChange(element.id, {
        x: Math.round(drag.origin.x + worldDelta.x),
        y: Math.round(drag.origin.y + worldDelta.y),
      });
      return;
    }
    const next = clampShaderElementSize(
      drag.origin.width + worldDelta.x,
      drag.origin.height + worldDelta.y,
    );
    onChange(element.id, { width: next.width, height: next.height });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const style: CSSProperties = {
    width: element.width,
    height: element.height,
    transform: `translate3d(${element.x}px, ${element.y}px, 0)`,
  };
  if (element.radius !== undefined) style.borderRadius = element.radius;
  const stageStyle: CSSProperties | undefined =
    element.radius === undefined
      ? undefined
      : { borderRadius: Math.max(0, element.radius - SHADER_ELEMENT_RADIUS_INSET) };
  // SafeShaderMount is memoized — keep componentProps referentially stable
  // so unrelated canvas updates don't remount the WebGL stage.
  const mountProps = useMemo(
    () => ({ ...getShaderMountProps(element.shaderId), ...element.params }),
    [element.shaderId, element.params],
  );

  return (
    <section
      className={`canvas-shader-element${isSelected ? " is-selected" : ""}`}
      data-shader-element-id={element.id}
      data-testid="shader-element"
      aria-label={`Shader: ${definitionLabel}`}
      onPointerCancel={endDrag}
      onPointerDown={(event) => beginDrag(event, "move")}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      ref={rootRef}
      style={style}
    >
      <div className="shader-element-stage" style={stageStyle}>
        {failure ? (
          <div className="shader-element-unsupported">
            <span>{FAILURE_MESSAGES[failure]}</span>
            {failure !== "unknown" ? (
              <button
                aria-label={`Retry loading ${definitionLabel}`}
                className="shader-element-retry"
                data-testid="shader-element-retry"
                onClick={(event) => {
                  event.stopPropagation();
                  retry();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                <RotateCcw size={10} strokeWidth={2} aria-hidden="true" />
                Retry
              </button>
            ) : null}
          </div>
        ) : Component ? (
          <ShaderElementBoundary resetKey={`${element.shaderId}:${attempt}:${JSON.stringify(element.params ?? null)}`}>
            <SafeShaderMount className="shader-element-mount" component={Component} componentProps={mountProps} />
          </ShaderElementBoundary>
        ) : (
          <div aria-hidden="true" className="shader-element-loading" />
        )}
      </div>

      {isSelected ? (
        <>
          <span className="shader-element-label">{definitionLabel}</span>
          <button
            aria-label={`Delete ${definitionLabel} shader`}
            className="shader-element-delete"
            data-testid="shader-element-delete"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(element.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title="Delete shader"
            type="button"
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
          <div
            aria-hidden="true"
            className="shader-element-resize-handle"
            data-testid="shader-element-resize"
            onPointerCancel={endDrag}
            onPointerDown={(event) => beginDrag(event, "resize")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
          />
        </>
      ) : null}
    </section>
  );
});
