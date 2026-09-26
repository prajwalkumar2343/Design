import { Globe, GripHorizontal } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IframeBridgeTransport, type IframeBridgeController } from "../bridge/transport";
import type { BridgeElementTarget, BridgeEventMessage, BridgeHierarchySnapshot, BridgeInspection } from "../bridge/protocol";
import type { CanvasFrame, Point } from "../canvas/types";
import type { ShapeVariantId } from "../editor/tools";
import { injectCanvasFonts } from "../fonts";
import { renderFrameDocument } from "./render-document";
import { injectTokenTheme } from "./token-theme";
import { injectWireframeTheme } from "./wireframe-theme";
import { ShapePreview } from "./shape-geometry";

interface FrameViewProps {
  frame: CanvasFrame;
  isLive: boolean;
  isSelected: boolean;
  isPanTool: boolean;
  onSelect: (frameId: string) => void;
  onStartMove: (frameId: string, event: ReactPointerEvent<HTMLElement>) => void;
  onStartPan: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onBridgeEvent?: (
    frameId: string,
    message: BridgeEventMessage,
    iframe: HTMLIFrameElement,
  ) => void;
  onBridgeInspection?: (frameId: string, inspection: BridgeInspection | null) => void;
  onBridgeSnapshot?: (frameId: string, snapshot: BridgeHierarchySnapshot, requestSequence: number) => void;
  onBridgeController?: (frameId: string, controller: IframeBridgeController | null) => void;
  /**
   * The frame's live document is actually going away (isLive turned off or the
   * view unmounted) — distinct from onBridgeController(null), which also fires
   * on mere transport teardown when this effect's dependencies change.
   */
  onBridgeDetach?: (frameId: string) => void;
  /** Fires when a DOM-mutating bridge command is dispatched to this frame. */
  onBridgeMutation?: (frameId: string) => void;
  isCreationMode?: boolean;
  creationShape?: ShapeVariantId | null;
  creationRadius?: number;
  onCreationPointerDown?: (frameId: string, point: Point, pointerId: number) => void;
  onCreationPointerMove?: (frameId: string, point: Point, pointerId: number) => void;
  onCreationPointerUp?: (frameId: string, point: Point, pointerId: number) => Promise<unknown> | void;
  onCreationPointerCancel?: (frameId: string, pointerId: number) => void;
  /**
   * Active theme CSS variables for design-mode frames. Wireframe frames ignore
   * this and keep the neutral grayscale theme.
   */
  tokenCss?: string;
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

function DeviceChrome({ chrome, width }: { chrome: NonNullable<CanvasFrame["chrome"]>; width: number }) {
  if (chrome.type === "none") return null;
  // Scale cutout slightly for smaller viewports to keep proportion
  const scale = width < 380 ? 0.9 : width > 420 ? 1.05 : 1;
  if (chrome.type === "notch") {
    const w = Math.round((chrome.width ?? 164) * scale);
    const h = Math.round((chrome.height ?? 30) * scale);
    return (
      <div className="device-cutout device-notch" aria-hidden="true" style={{ width: w, height: h }}>
        <span className="device-notch-speaker" />
        <span className="device-notch-camera" />
      </div>
    );
  }
  if (chrome.type === "dynamic-island") {
    const w = Math.round((chrome.width ?? 126) * scale);
    const h = Math.round((chrome.height ?? 36) * scale);
    return (
      <div className="device-cutout device-dynamic-island" aria-hidden="true" style={{ width: w, height: h }}>
        <span className="device-island-camera" />
        <span className="device-island-sensors" />
      </div>
    );
  }
  if (chrome.type === "punch-hole") {
    // Punch holes are absolute physical size (~3.0–4.0mm) → CSS px already encodes density
    // per-model in presets.ts (≈4.6% width for phones, absolute ~18px for tablets), so do not
    // apply viewport-proportion scaling like notches/islands. Use exact diameter.
    const d = Math.round(chrome.width ?? 18);
    const left = chrome.punchPosition === "left" ? "24%" : "50%";
    return (
      <div
        className="device-cutout device-punch-hole"
        aria-hidden="true"
        style={{ width: d, height: d, left, transform: left === "50%" ? "translateX(-50%)" : "none" }}
      >
        <span className="device-punch-lens" />
      </div>
    );
  }
  return null;
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
  onBridgeDetach,
  onBridgeMutation,
  isCreationMode = false,
  creationShape = null,
  creationRadius = 0,
  onCreationPointerDown,
  onCreationPointerMove,
  onCreationPointerUp,
  onCreationPointerCancel,
  tokenCss,
}: FrameViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [creationPreview, setCreationPreview] = useState<{ start: Point; end: Point } | null>(null);
  // Bumps once per drag so a slow create-ack can't clear a newer preview.
  const creationGestureRef = useRef(0);
  // The iframe rect only pays for one layout read per drag — but it goes stale
  // if the camera pans/zooms mid-drag, which CanvasSurface applies as imperative
  // ancestor style writes React never re-renders for. Watch those writes and
  // drop the cache; the next pointermove re-reads it once.
  const creationRectRef = useRef<DOMRect | null>(null);
  const creationRectObserverRef = useRef<MutationObserver | null>(null);
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

  // Changing the rendered srcDoc reloads the iframe and wipes live DOM edits
  // (including var() token links), so the theme block is frozen at render time
  // and updates flow through the `set-token-theme` bridge command instead.
  const tokenCssRef = useRef(tokenCss);
  tokenCssRef.current = tokenCss;

  // Reports the live document's unload only when it really goes away: the
  // bridge effect's cleanup also runs on dependency-change re-runs, so mount
  // bookkeeping must not hang off onBridgeController(null). StrictMode's
  // mount double-invoke would still fire this cleanup once on mount, so the
  // report is deferred a task — the immediate re-setup cancels it.
  const unloadTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (unloadTimerRef.current !== null) {
      window.clearTimeout(unloadTimerRef.current);
      unloadTimerRef.current = null;
    }
    return () => {
      unloadTimerRef.current = window.setTimeout(() => {
        unloadTimerRef.current = null;
        onBridgeDetach?.(frame.id);
      }, 0);
    };
  }, [frame.id, onBridgeDetach]);

  useEffect(() => {
    if (!isLive || !iframeRef.current) {
      transportRef.current?.destroy();
      transportRef.current = null;
      onBridgeController?.(frame.id, null);
      onBridgeDetach?.(frame.id);
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
          // bridgeSrcDoc keeps whatever theme was current when it last
          // recomputed, so a remounted (evicted) frame can come back with a
          // stale block — re-push the live theme now that the runtime is
          // listening. Idempotent when nothing changed; an empty css removes
          // a block left over from before the tokens were cleared.
          if (frame.mode !== "wireframe") {
            void transport
              .setTokenTheme({ command: "set-token-theme", css: tokenCssRef.current ?? "" })
              .catch(() => undefined);
          }
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
        onMutatingCommand: () => onBridgeMutation?.(frame.id),
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
      readDocument: () => transport.readDocument(),
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
      setShapeFill: (command) => transport.setShapeFill(command),
      setShapeGlass: (command) => transport.setShapeGlass(command),
      pickElement: (command) => transport.pickElement(command),
      injectFontFaces: (command) => transport.injectFontFaces(command),
      setTokenTheme: (command) => transport.setTokenTheme(command),
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
    onBridgeDetach,
    onBridgeEvent,
    onBridgeInspection,
    onBridgeMutation,
    onBridgeSnapshot,
  ]);

  const bridgeSrcDoc = useMemo(
    () => renderFrameDocument(frame.srcDoc, frame.mode, bridgeSession, tokenCssRef.current),
    [frame.srcDoc, frame.mode, bridgeSession],
  );

  const endCreationRectWatch = () => {
    creationRectRef.current = null;
    creationRectObserverRef.current?.disconnect();
    creationRectObserverRef.current = null;
  };

  useEffect(() => () => creationRectObserverRef.current?.disconnect(), []);

  const getCreationPoint = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const bounds =
      creationRectRef.current ??
      (creationRectRef.current = iframeRef.current?.getBoundingClientRect() ?? null);
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
    creationGestureRef.current += 1;
    creationRectRef.current = iframeRef.current?.getBoundingClientRect() ?? null;
    creationRectObserverRef.current?.disconnect();
    const observer = new MutationObserver(() => {
      creationRectRef.current = null;
    });
    for (let el: HTMLElement | null = event.currentTarget; el; el = el.parentElement) {
      observer.observe(el, { attributes: true, attributeFilter: ["style"] });
    }
    creationRectObserverRef.current = observer;
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
    const gesture = creationGestureRef.current;
    const result = onCreationPointerUp?.(frame.id, getCreationPoint(event), event.pointerId);
    endCreationRectWatch();
    const clearPreview = () => {
      if (gesture === creationGestureRef.current) setCreationPreview(null);
    };
    if (result) {
      // The ack resolves after the element is already in the iframe DOM, so the
      // preview can swap for it pixel-identically — one rAF lets the iframe
      // paint the new node first instead of flashing empty space.
      void Promise.resolve(result).then(() => requestAnimationFrame(clearPreview));
      window.setTimeout(clearPreview, 800);
    } else {
      clearPreview();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCreationPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onCreationPointerCancel?.(frame.id, event.pointerId);
    endCreationRectWatch();
    setCreationPreview(null);
  };

  const isDesktopFrame = frame.category === "desktop";
  // Fallback for legacy frames / demo seeds without explicit chrome
  const resolvedChrome = frame.chrome ?? (
    frame.category === "mobile"
      ? frame.width >= 430
        ? { type: "dynamic-island" as const, width: 136, height: 38, bezelRadius: 56 }
        : frame.width >= 393
          ? { type: "dynamic-island" as const, width: 126, height: 36, bezelRadius: 52 }
          : frame.width === 375
            ? { type: "notch" as const, width: 148, height: 28, bezelRadius: 44 }
            : { type: "notch" as const, width: 164, height: 30, bezelRadius: 48 }
      : frame.category === "tablet"
        ? { type: "none" as const, bezelRadius: 18 }
        : { type: "none" as const, bezelRadius: 5 }
  );
  const chrome = resolvedChrome;
  const isDeviceFrame = chrome.type !== "none";
  const bezelRadius = chrome.bezelRadius ?? (frame.category === "mobile" ? 28 : frame.category === "tablet" ? 18 : 5);
  const showHomeIndicator = isDeviceFrame && frame.category === "mobile";
  const showDeviceChrome = isDeviceFrame;

  const openFullPreview = () => {
    const previewDoc = injectCanvasFonts(
      frame.mode === "wireframe"
        ? injectWireframeTheme(frame.srcDoc)
        : tokenCss
          ? injectTokenTheme(frame.srcDoc, tokenCss)
          : frame.srcDoc,
    );
    const blob = new Blob([previewDoc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
  };

  return (
    <section
      className={`canvas-frame${isDeviceFrame ? " device-frame" : ""}${isSelected ? " is-device-selected" : ""}`}
      data-frame-id={frame.id}
      data-selected={isSelected ? "true" : "false"}
      data-chrome={chrome?.type ?? "none"}
      data-category={frame.category ?? "desktop"}
      data-bridge-status={bridgeState.status}
      data-bridge-hovered-element-id={bridgeState.hoveredElementId ?? undefined}
      data-bridge-selected-element-id={bridgeState.selectedElementId ?? undefined}
      data-bridge-inspected-tag-name={bridgeState.inspectedTagName ?? undefined}
      data-bridge-hierarchy-node-count={bridgeState.hierarchyNodeCount}
      data-bridge-error={bridgeState.error ?? undefined}
      data-freeform={frame.freeform ? "true" : undefined}
      aria-label={frame.name}
      style={{
        width: frame.width,
        height: frame.height,
        transform: `translate3d(${frame.x}px, ${frame.y}px, 0)`,
        background: frame.background,
        ["--bezel-radius" as string]: `${bezelRadius}px`,
      } as React.CSSProperties}
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

      <div className={`device-screen-wrap${showDeviceChrome ? " has-chrome" : ""}`}>
        <div className="device-screen" style={{ borderRadius: isDeviceFrame ? `var(--bezel-radius)` : "4px", background: frame.background }}>
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

          {showDeviceChrome ? <DeviceChrome chrome={chrome!} width={frame.width} /> : null}
          {showHomeIndicator ? <div className="device-home-indicator" aria-hidden="true" /> : null}

          {isCreationMode && isLive && !isPanTool ? (
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

          {/* Only paused frames and pan mode take the cover — a press inside
              a live frame always reaches the document. */}
          {!(isCreationMode && isLive && !isPanTool) && (!isLive || isPanTool) ? (
            <button
              className="frame-activation-layer"
              aria-label={isPanTool ? `Pan across ${frame.name}` : `Select ${frame.name}`}
              onClick={isPanTool || isCreationMode ? undefined : () => onSelect(frame.id)}
              onPointerDown={isPanTool ? onStartPan : (event) => onStartMove(frame.id, event)}
              type="button"
            />
          ) : null}
        </div>
      </div>

      {!isPanTool ? (
        <div
          aria-hidden="true"
          className="frame-drag-ring"
          onPointerDown={(event) => onStartMove(frame.id, event)}
        />
      ) : null}

      {isDesktopFrame ? (
        <button
          className="frame-preview-site"
          aria-label={`Open ${frame.name} as a full website in a new tab`}
          title="Open as full website"
          onClick={(event) => {
            event.stopPropagation();
            openFullPreview();
          }}
          type="button"
        >
          <Globe size={15} strokeWidth={1.6} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
});
