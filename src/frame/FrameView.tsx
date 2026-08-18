import { GripHorizontal } from "lucide-react";
import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IframeBridgeTransport, type IframeBridgeController } from "../bridge/transport";
import type { BridgeElementTarget, BridgeEventMessage, BridgeHierarchySnapshot, BridgeInspection } from "../bridge/protocol";
import type { CanvasFrame, Point } from "../canvas/types";
import type { ShapeVariantId } from "../editor/tools";
import { renderFrameDocument } from "./render-document";
import { ShapePreview } from "./shape-geometry";

interface FrameViewProps {
  frame: CanvasFrame;
  isLive: boolean;
  isSelected: boolean;
  isPanTool: boolean;
  onSelect: (frameId: string) => void;
  onStartMove: (frameId: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onStartPan: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onBridgeEvent?: (
    frameId: string,
    message: BridgeEventMessage,
    iframe: HTMLIFrameElement,
  ) => void;
  onBridgeInspection?: (frameId: string, inspection: BridgeInspection | null) => void;
  onBridgeSnapshot?: (frameId: string, snapshot: BridgeHierarchySnapshot, requestSequence: number) => void;
  onBridgeController?: (frameId: string, controller: IframeBridgeController | null) => void;
  isCreationMode?: boolean;
  /** Active vector shape while the shape tool is selected; drives the live drag preview. */
  creationShape?: ShapeVariantId | null;
  /** Draft corner radius applied to the live drag preview. */
  creationRadius?: number;
  onCreationPointerDown?: (frameId: string, point: Point, pointerId: number) => void;
  onCreationPointerMove?: (frameId: string, point: Point, pointerId: number) => void;
  onCreationPointerUp?: (frameId: string, point: Point, pointerId: number) => void;
  onCreationPointerCancel?: (frameId: string, pointerId: number) => void;
}

interface BridgeViewState {
  status: "idle" | "waiting" | "ready" | "error";
  hoveredElementId: string | null;
  selectedElementId: string | null;
  inspectedTagName: string | null;
  hierarchyNodeCount: number;
  error: string | null;
}

function createBridgeSession(frameId: string) {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    frameId,
    channel: `frame-${frameId}-${randomPart}`,
    parentOrigin: typeof window === "undefined" ? "null" : window.location.origin,
  };
}

export const FrameView = memo(function FrameView({
  frame,
  isLive,
  isSelected,
  isPanTool,
  onSelect,
  onStartMove,
  onStartPan,
  onBridgeEvent,
  onBridgeInspection,
  onBridgeSnapshot,
  onBridgeController,
  isCreationMode = false,
  creationShape = null,
  creationRadius = 0,
  onCreationPointerDown,
  onCreationPointerMove,
  onCreationPointerUp,
  onCreationPointerCancel,
}: FrameViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [creationPreview, setCreationPreview] = useState<{ start: Point; end: Point } | null>(null);
  const [initialBridgeSession] = useState(() => createBridgeSession(frame.id));
  const bridgeSessionRef = useRef(initialBridgeSession);
  if (bridgeSessionRef.current.frameId !== frame.id) {
    bridgeSessionRef.current = createBridgeSession(frame.id);
  }
  const bridgeSession = bridgeSessionRef.current;
  const transportRef = useRef<IframeBridgeTransport | null>(null);
  const latestInspectionTargetRef = useRef<string | null>(null);
  const [bridgeState, setBridgeState] = useState<BridgeViewState>({
    status: isLive ? "waiting" : "idle",
    hoveredElementId: null,
    selectedElementId: null,
    inspectedTagName: null,
    hierarchyNodeCount: 0,
    error: null,
  });

  useEffect(() => {
    if (!isLive || !iframeRef.current) {
      transportRef.current?.destroy();
      transportRef.current = null;
      onBridgeController?.(frame.id, null);
      setBridgeState((current) => ({ ...current, status: "idle" }));
      return;
    }

    const iframe = iframeRef.current;
    let transport: IframeBridgeTransport;
    let snapshotRequestSequence = 0;
    const inspectTarget = (target: BridgeElementTarget | null) => {
      if (!target) {
        latestInspectionTargetRef.current = null;
        onBridgeInspection?.(frame.id, null);
        return;
      }
      latestInspectionTargetRef.current = target.elementId;
      void transport.inspect(target.elementId).then((inspection) => {
        if (latestInspectionTargetRef.current !== target.elementId) return;
        setBridgeState((current) => ({
          ...current,
          inspectedTagName: inspection?.target.tagName ?? null,
          error: null,
        }));
        onBridgeInspection?.(frame.id, inspection);
      }).catch((error: unknown) => {
        if (latestInspectionTargetRef.current !== target.elementId) return;
        setBridgeState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "Inspection failed",
        }));
      });
    };

    transport = new IframeBridgeTransport({
      iframe,
      frameId: bridgeSession.frameId,
      channel: bridgeSession.channel,
      handlers: {
        onReady: () => {
          setBridgeState((current) => ({ ...current, status: "ready", error: null }));
          void requestSnapshot().catch((error: unknown) => {
            setBridgeState((current) => ({
              ...current,
              status: "error",
              error: error instanceof Error ? error.message : "Hierarchy inspection failed",
            }));
          });
        },
        onEvent: (message) => {
          setBridgeState((current) => ({
            ...current,
            hoveredElementId: message.event === "hover"
              ? message.target?.elementId ?? null
              : current.hoveredElementId,
            selectedElementId: message.event === "select"
              ? message.target?.elementId ?? null
              : current.selectedElementId,
          }));
          onBridgeEvent?.(frame.id, message, iframe);
          if (message.event === "hover" || message.event === "select") inspectTarget(message.target);
        },
      },
    });

    function requestSnapshot() {
      const requestSequence = ++snapshotRequestSequence;
      return transport.requestSnapshot().then((snapshot) => {
        setBridgeState((current) => ({
          ...current,
          hierarchyNodeCount: snapshot.nodes.length,
          error: null,
        }));
        onBridgeSnapshot?.(frame.id, snapshot, requestSequence);
        return snapshot;
      });
    }

    transportRef.current = transport;
    onBridgeController?.(frame.id, {
      requestSnapshot,
      inspect: (targetId) => transport.inspect(targetId),
      setInlineStyle: (command) => transport.setInlineStyle(command),
      setText: (command) => transport.setText(command),
      startTextEdit: (targetId) => transport.startTextEdit(targetId),
      cancelTextEdit: (targetId) => transport.cancelTextEdit(targetId),
      commitTextEdit: (command) => transport.commitTextEdit(command),
      createElement: (command) => transport.createElement(command),
      deleteElement: (command) => transport.deleteElement(command),
      restoreElement: (command) => transport.restoreElement(command),
      duplicateElement: (command) => transport.duplicateElement(command),
      setShapeRadius: (command) => transport.setShapeRadius(command),
    });
    transport.attach();

    return () => {
      latestInspectionTargetRef.current = null;
      onBridgeController?.(frame.id, null);
      transport.destroy();
      if (transportRef.current === transport) transportRef.current = null;
    };
  }, [
    bridgeSession.channel,
    bridgeSession.frameId,
    frame.id,
    isLive,
    onBridgeController,
    onBridgeEvent,
    onBridgeInspection,
    onBridgeSnapshot,
  ]);

  const bridgeSrcDoc = renderFrameDocument(frame.srcDoc, frame.mode, bridgeSession);

  const getCreationPoint = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const iframe = iframeRef.current;
    const bounds = iframe?.getBoundingClientRect();
    if (!bounds) return { x: event.clientX, y: event.clientY };
    const scaleX = frame.width / Math.max(bounds.width, 1);
    const scaleY = frame.height / Math.max(bounds.height, 1);
    return {
      x: Math.max(0, Math.min(frame.width, (event.clientX - bounds.left) * scaleX)),
      y: Math.max(0, Math.min(frame.height, (event.clientY - bounds.top) * scaleY)),
    };
  };

  const handleCreationPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getCreationPoint(event);
    setCreationPreview({ start: point, end: point });
    onCreationPointerDown?.(frame.id, point, event.pointerId);
  };

  const handleCreationPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getCreationPoint(event);
    setCreationPreview((current) => (current ? { ...current, end: point } : current));
    onCreationPointerMove?.(frame.id, point, event.pointerId);
  };

  const handleCreationPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    onCreationPointerUp?.(frame.id, getCreationPoint(event), event.pointerId);
    setCreationPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCreationPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onCreationPointerCancel?.(frame.id, event.pointerId);
    setCreationPreview(null);
  };

  return (
    <section
      className="canvas-frame"
      data-frame-id={frame.id}
      data-selected={isSelected ? "true" : "false"}
      data-bridge-status={bridgeState.status}
      data-bridge-hovered-element-id={bridgeState.hoveredElementId ?? undefined}
      data-bridge-selected-element-id={bridgeState.selectedElementId ?? undefined}
      data-bridge-inspected-tag-name={bridgeState.inspectedTagName ?? undefined}
      data-bridge-hierarchy-node-count={bridgeState.hierarchyNodeCount}
      data-bridge-error={bridgeState.error ?? undefined}
      aria-label={frame.name}
      style={{
        width: frame.width,
        height: frame.height,
        transform: `translate3d(${frame.x}px, ${frame.y}px, 0)`,
        background: frame.background,
      }}
    >
      <button
        className="frame-label"
        data-frame-drag-handle={frame.id}
        aria-label={`Move ${frame.name}`}
        onPointerDown={(event) => onStartMove(frame.id, event)}
        onClick={() => onSelect(frame.id)}
        type="button"
      >
        <span>{frame.name}</span>
        <GripHorizontal size={14} strokeWidth={1.6} aria-hidden="true" />
      </button>
      {isLive ? (
        <iframe
          ref={iframeRef}
          className="frame-document"
          title={`${frame.name} preview`}
          srcDoc={bridgeSrcDoc}
          sandbox="allow-scripts"
        />
      ) : (
        <div className="frame-placeholder" aria-label={`${frame.name} is paused`}>
          <span>{frame.width} × {frame.height}</span>
        </div>
      )}
      {isCreationMode && isLive ? (
        <div
          aria-label={`Create inside ${frame.name}`}
          className="frame-creation-layer"
          data-testid="frame-creation-layer"
          onPointerCancel={handleCreationPointerCancel}
          onPointerDown={handleCreationPointerDown}
          onPointerMove={handleCreationPointerMove}
          onPointerUp={handleCreationPointerUp}
          role="presentation"
        >
          {creationPreview && creationShape ? (
            <ShapePreview
              end={creationPreview.end}
              radius={creationRadius}
              shape={creationShape}
              start={creationPreview.start}
            />
          ) : null}
        </div>
      ) : null}
      {!isSelected || isPanTool ? (
        <button
          className="frame-activation-layer"
          aria-label={isPanTool ? `Pan across ${frame.name}` : `Select ${frame.name}`}
          onClick={isPanTool ? undefined : () => onSelect(frame.id)}
          onPointerDown={isPanTool ? onStartPan : undefined}
          type="button"
        />
      ) : null}
    </section>
  );
});
