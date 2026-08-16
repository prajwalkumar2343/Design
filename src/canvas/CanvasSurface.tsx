import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { CanvasDock } from "../components/CanvasDock";
import { LeftSidebar } from "../components/LeftSidebar";
import { PropertiesPanel } from "../components/PropertiesPanel";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { CommentPopover } from "../comments/CommentPopover";
import { useComments } from "../comments/useComments";
import { mapIframePointToCanvas, mapIframeRectToCanvas } from "../bridge/coordinates";
import { EmptyCanvasState } from "./EmptyCanvasState";
import type {
  BridgeElementTarget,
  BridgeEventMessage,
  BridgeCommand,
  BridgeCreationKind,
  BridgeHierarchySnapshot,
  BridgeInspection,
  SafeInlineStyleProperty,
} from "../bridge/protocol";
import type { IframeBridgeController } from "../bridge/transport";
import {
  createFrameCommand,
  createPageCommand,
  moveBriefFrameCommand,
  moveFrameCommand,
  renamePageCommand,
  selectBriefFrameCommand,
  setSelectionCommand,
  switchPageCommand,
} from "../editor/commands";
import {
  createEditorStateFromFrameSeeds,
  selectAllFrameRenderModels,
  selectFrameRenderModels,
  type NodeEntity,
} from "../editor/model";
import {
  isSpaceShortcut,
  normalizeActiveTool,
  resolveEditorShortcut,
} from "../editor";
import { setActiveToolCommand } from "../editor/commands";
import type { ShapeVariantId, ToolId } from "../editor/tools";
import {
  createEditorStore,
  type EditorStore,
} from "../editor/store";
import { prependTranslationTransform } from "../editor/position";
import { BriefFrameView } from "../frame/BriefFrameView";
import { FrameView } from "../frame/FrameView";
import { createFrameFromPreset, type FramePreset } from "../frame/presets";
import { useBrainstormSessionController } from "./brainstorm-session-controller";
import {
  BrowserPersistenceAdapter,
  importWireCanvasProject,
  serializeWireCanvasProject,
  WIRECANVAS_FILE_MIME_TYPE,
  WIRECANVAS_FILE_NAME,
  WireCanvasCodecError,
  type BrowserDownloadAdapter,
  type PersistenceAdapter,
} from "../persistence";
import {
  NodeOverlayLayer,
  type OverlayNodeTarget,
} from "../overlay/NodeOverlayLayer";
import {
  useNodeOverlayGestures,
  type NodeInteractionMode,
  type OverlayBridgeTargetState,
} from "../overlay/useNodeOverlayGestures";
import {
  cameraTransform,
  fitRect,
  panCamera,
  screenToWorld,
  zoomCameraAtPoint,
} from "./camera";
import type { Camera, CanvasFrame, Point, Rect, Size } from "./types";
import { rankVisibleFrames } from "./virtualization";

const CAMERA_FIT_PADDING = 148;
const CAMERA_SETTLE_MS = 140;

function cameraFitPadding(viewport: Size): number {
  return viewport.width < 760 ? 18 : CAMERA_FIT_PADDING;
}

const surfaceStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100vw",
  height: "100vh",
  overflow: "clip",
  touchAction: "none",
  userSelect: "none",
};

const worldStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  transformOrigin: "0 0",
  willChange: "transform",
};

type PointerOperation =
  | { type: "pan"; pointerId: number; last: Point }
  | { type: "move-frame"; pointerId: number; last: Point; frameId: string }
  | { type: "move-brief-frame"; pointerId: number; last: Point; briefFrameId: string };

type CreationOperation =
  | { type: "box"; tool: "rectangle" | "text" | "image"; frameId: string; pointerId: number; start: Point; last: Point }
  | { type: "pen"; frameId: string; pointerId: number; points: Point[] };

interface PendingImagePlacement {
  frameId: string;
  bounds: Rect;
}

function targetStateKey(frameId: string, nodeId: string): string {
  return `${frameId}:${nodeId}`;
}

function createElementId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function normalizedBounds(start: Point, end: Point, minimum = 16): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(minimum, Math.abs(end.x - start.x)),
    height: Math.max(minimum, Math.abs(end.y - start.y)),
  };
}

function isCreationTool(tool: ToolId): boolean {
  return tool === "rectangle" || tool === "text" || tool === "image" || tool === "pen" || tool === "comment";
}

function creationToolLabel(tool: ToolId, shape: ShapeVariantId): string {
  if (tool === "rectangle") return shape[0].toUpperCase() + shape.slice(1);
  return tool[0].toUpperCase() + tool.slice(1);
}

function shapePoints(shape: ShapeVariantId, bounds: Rect): Point[] {
  if (shape === "line" || shape === "arrow") {
    return [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }];
  }
  if (shape === "polygon") {
    return [
      { x: bounds.x + bounds.width / 2, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height * 0.38 },
      { x: bounds.x + bounds.width * 0.82, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width * 0.18, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height * 0.38 },
    ];
  }
  if (shape === "star") {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const outer = Math.min(bounds.width, bounds.height) / 2;
    const inner = outer * 0.42;
    return Array.from({ length: 10 }, (_, index) => {
      const radius = index % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });
  }
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}


function getFramesBounds(frames: readonly Rect[]): Rect {
  if (frames.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function getPointerPosition(
  event: { clientX: number; clientY: number },
  surface: HTMLElement,
): Point {
  const bounds = surface.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function getViewportSize(surface: HTMLElement): Size {
  const bounds = surface.getBoundingClientRect();
  return {
    width: surface.clientWidth || bounds.width || window.innerWidth,
    height: surface.clientHeight || bounds.height || window.innerHeight,
  };
}

function isFrameTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-frame-id]") !== null;
}

function isCanvasControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-canvas-control]") !== null;
}

function isNodeOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-testid=\"node-overlay-layer\"]") !== null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export interface CanvasSurfaceProps {
  frames?: CanvasFrame[];
  persistenceAdapter?: PersistenceAdapter;
  downloadAdapter?: BrowserDownloadAdapter;
}

export function CanvasSurface({
  frames: suppliedFrames = [],
  persistenceAdapter,
  downloadAdapter,
}: CanvasSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editorStoreRef = useRef<EditorStore | null>(null);
  if (editorStoreRef.current === null) {
    editorStoreRef.current = createEditorStore(
      createEditorStateFromFrameSeeds(suppliedFrames),
    );
  }
  const editorStore = editorStoreRef.current;
  const persistenceAdapterRef = useRef<PersistenceAdapter | null>(null);
  if (persistenceAdapterRef.current === null) {
    persistenceAdapterRef.current = persistenceAdapter ?? new BrowserPersistenceAdapter();
  }
  const downloadAdapterRef = useRef<BrowserDownloadAdapter | null>(null);
  if (downloadAdapterRef.current === null) {
    downloadAdapterRef.current = downloadAdapter ?? new BrowserPersistenceAdapter();
  }
  const editorState = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getState,
    editorStore.getState,
  );
  const frames = useMemo(() => selectFrameRenderModels(editorState), [editorState]);
  const allFrames = useMemo(() => selectAllFrameRenderModels(editorState), [editorState]);
  const briefFrame = editorState.session.briefFrame;
  const renderRects = useMemo(
    () => briefFrame ? [...frames, briefFrame] : frames,
    [briefFrame, frames],
  );
  const isEmptyState = frames.length === 0
    && briefFrame === null
    && Object.keys(editorState.documents).length === 0
    && Object.keys(editorState.pages).length === 0;
  const showDesignChrome = !isEmptyState;
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const pointerRef = useRef<PointerOperation | null>(null);
  const creationRef = useRef<CreationOperation | null>(null);
  const pendingImageRef = useRef<PendingImagePlacement | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const clipboardTargetRef = useRef<{ frameId: string; nodeId: string } | null>(null);
  const spacePressedRef = useRef(false);
  const cameraInitializedRef = useRef(false);
  const motionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextFrameSequenceRef = useRef(suppliedFrames.length + 1);
  const lastBridgeTargetRef = useRef<{
    frameId: string;
    elementId: string;
    screen: Point;
    world: Point;
    bounds: Rect;
  } | null>(null);
  const bridgeControllersRef = useRef(new Map<string, IframeBridgeController>());
  const snapshotQueuesRef = useRef(new Map<string, Promise<void>>());
  const snapshotSequenceRef = useRef(new Map<string, number>());
  const refreshSnapshotRef = useRef<(frameId: string) => Promise<void>>(async () => undefined);
  const createLiveElementRef = useRef<(frameId: string, command: Extract<BridgeCommand, { command: "create-element" }>, label: string) => Promise<boolean>>(async () => false);
  const addCommentRef = useRef<(frameId: string, point: Point) => void>(() => undefined);
  const deleteSelectedNodesRef = useRef<() => Promise<void>>(async () => undefined);

  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [bridgeTargets, setBridgeTargets] = useState<Record<string, OverlayBridgeTargetState>>({});
  const [bridgeHierarchies, setBridgeHierarchies] = useState<Record<string, BridgeHierarchySnapshot>>({});
  const [hoveredOverlayTarget, setHoveredOverlayTarget] = useState<OverlayNodeTarget | null>(null);
  const selectedFrameId = editorState.selection.primaryFrameId;
  const selectedBriefFrameId = editorState.session.selection.type === "brief-frame"
    ? editorState.session.selection.briefFrameId
    : null;
  const [interactionMode, setInteractionMode] = useState<NodeInteractionMode>("idle");
  const [spacePressed, setSpacePressed] = useState(false);
  const [isFrameMenuOpen, setIsFrameMenuOpen] = useState(false);
  const [activeShape, setActiveShape] = useState<ShapeVariantId>("rectangle");
  const [sampledColor, setSampledColor] = useState<string | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [persistenceVersion, setPersistenceVersion] = useState(0);
  const [persistenceFeedback, setPersistenceFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const {
    comments,
    selectedCommentId,
    feedback: commentFeedback,
    addComment,
    selectComment,
    updateComment,
    toggleCommentResolved,
    deleteComment,
  } = useComments(editorStore);
  const activeTool = normalizeActiveTool(editorState.activeTool);
  const activeToolRef = useRef<ToolId>(activeTool);
  const activeShapeRef = useRef<ShapeVariantId>(activeShape);
  activeToolRef.current = activeTool;
  activeShapeRef.current = activeShape;
  const creationMode = isCreationTool(activeTool);

  const setSelectedFrameId = useCallback(
    (frameId: string | null) => {
      editorStore.execute(selectBriefFrameCommand(null), { history: "skip" });
      editorStore.execute(
        setSelectionCommand({
          frameIds: frameId ? [frameId] : [],
          nodeIds: [],
          primaryFrameId: frameId,
          primaryNodeId: null,
        }),
        { history: "skip" },
      );
    },
    [editorStore],
  );

  const {
    selectBriefFrame,
    startBrainstorming,
    updateBriefField,
    addBriefReference,
    updateBriefReference,
    removeBriefReference,
    addConfirmedDecision,
    updateConfirmedDecision,
    removeConfirmedDecision,
  } = useBrainstormSessionController({
    editorStore,
    surfaceRef,
    viewport,
    cameraRef,
    setCamera,
  });

  const exportProject = useCallback(() => {
    if (editorStore.getState().session.lifecycle === "not-started") {
      setPersistenceFeedback({ kind: "error", message: "Start a brainstorming session before exporting." });
      return;
    }
    try {
      downloadAdapterRef.current?.downloadProjectFile({
        text: serializeWireCanvasProject(editorStore.getState()),
        filename: WIRECANVAS_FILE_NAME,
        mimeType: WIRECANVAS_FILE_MIME_TYPE,
      });
      setPersistenceFeedback({ kind: "success", message: "Project exported as a .wirecanvas.json file." });
    } catch (error) {
      setPersistenceFeedback({
        kind: "error",
        message: `Could not export project: ${error instanceof Error ? error.message : "download failed"}`,
      });
    }
  }, [editorStore]);

  const importProject = useCallback(async (file: File) => {
    try {
      const text = await persistenceAdapterRef.current!.readProjectFile(file);
      const result = importWireCanvasProject(editorStore, text);
      if (result.changed) {
        bridgeControllersRef.current.clear();
        snapshotQueuesRef.current.clear();
        snapshotSequenceRef.current.clear();
        setBridgeTargets({});
        setBridgeHierarchies({});
        setPersistenceVersion((current) => current + 1);
        setPersistenceFeedback({ kind: "success", message: "Project imported successfully." });
      } else {
        setPersistenceFeedback({ kind: "success", message: "This project already matches the current canvas." });
      }
    } catch (error) {
      const message = error instanceof WireCanvasCodecError
        ? error.message
        : error instanceof Error
          ? error.message
          : "The project could not be imported.";
      setPersistenceFeedback({ kind: "error", message: `Could not import project: ${message}` });
    }
  }, [editorStore]);

  const toOverlayTarget = useCallback(
    (entry: OverlayBridgeTargetState): OverlayNodeTarget | null => {
      const frame = editorStore.getState().frames[entry.frameId];
      if (!frame) return null;
      return {
        frameId: entry.frameId,
        nodeId: entry.target.elementId,
        tagName: entry.target.tagName,
        name: entry.target.name,
        bounds: {
          x: frame.x + entry.target.bounds.x,
          y: frame.y + entry.target.bounds.y,
          width: entry.target.bounds.width,
          height: entry.target.bounds.height,
        },
        locked: editorStore.getState().nodes[entry.target.elementId]?.locked ?? entry.target.locked,
      };
    },
    [editorStore],
  );

  const openImagePicker = useCallback(() => {
    const selectedFrameId = editorStore.getState().selection.primaryFrameId;
    if (!pendingImageRef.current && selectedFrameId) {
      pendingImageRef.current = {
        frameId: selectedFrameId,
        bounds: { x: 48, y: 48, width: 160, height: 120 },
      };
    }
    if (!pendingImageRef.current) {
      setCreationError("Select a live frame before choosing an image.");
      return;
    }
    const input = imageInputRef.current;
    if (!input) {
      setCreationError("The image picker is unavailable. Try selecting the Image tool again.");
      return;
    }
    setCreationError(null);
    input.click();
  }, [editorStore]);

  const beginCreationPointer = useCallback((frameId: string, point: Point, pointerId: number) => {
    const tool = activeToolRef.current;
    if (!isCreationTool(tool)) return;
    surfaceRef.current?.focus({ preventScroll: true });
    setCreationError(null);
    setInteractionMode("creating");
    if (tool === "comment") {
      addCommentRef.current(frameId, point);
      setInteractionMode("idle");
      return;
    }
    if (tool === "pen") {
      const current = creationRef.current;
      creationRef.current = current?.type === "pen" && current.frameId === frameId
        ? { ...current, pointerId, points: [...current.points, point] }
        : { type: "pen", frameId, pointerId, points: [point] };
      return;
    }
    creationRef.current = {
      type: "box",
      tool: tool as "rectangle" | "text" | "image",
      frameId,
      pointerId,
      start: point,
      last: point,
    };
  }, []);

  const moveCreationPointer = useCallback((frameId: string, point: Point, pointerId: number) => {
    const operation = creationRef.current;
    if (!operation || operation.frameId !== frameId || operation.pointerId !== pointerId) return;
    if (operation.type === "pen") {
      const previous = operation.points.at(-1);
      if (!previous || previous.x !== point.x || previous.y !== point.y) {
        operation.points = [...operation.points, point];
      }
      return;
    }
    creationRef.current = { ...operation, last: point };
  }, []);

  const finishCreationPointer = useCallback((frameId: string, point: Point, pointerId: number) => {
    const operation = creationRef.current;
    if (!operation || operation.type !== "box" || operation.frameId !== frameId || operation.pointerId !== pointerId) {
      return;
    }
    creationRef.current = null;
    setInteractionMode("idle");
    const bounds = normalizedBounds(operation.start, point);
    if (operation.tool === "image") {
      pendingImageRef.current = { frameId, bounds };
      openImagePicker();
      return;
    }
    const shape = activeShapeRef.current;
    const kind: BridgeCreationKind = operation.tool === "text" ? "text" : shape;
    void createLiveElementRef.current(frameId, {
      command: "create-element",
      elementId: createElementId(kind),
      kind,
      bounds,
      ...(kind === "text" ? { text: "Type to edit", editable: true } : { points: shapePoints(shape, bounds) }),
      fill: kind === "text" ? "#171717" : "#d9d9d9",
      stroke: kind === "text" ? "#171717" : "#222222",
      strokeWidth: 2,
    }, kind === "text" ? "Create text" : `Create ${shape}`);
  }, [openImagePicker]);

  const cancelCreationPointer = useCallback((frameId: string, pointerId: number) => {
    const operation = creationRef.current;
    if (!operation || operation.frameId !== frameId || operation.pointerId !== pointerId) return;
    creationRef.current = null;
    pendingImageRef.current = null;
    setInteractionMode("idle");
  }, []);

  const handleBridgeEvent = useCallback(
    (frameId: string, message: BridgeEventMessage, iframe: HTMLIFrameElement) => {
      const surface = surfaceRef.current;
      const frame = editorStore.getState().frames[frameId];
      if (!surface || !frame) return;

      const currentTool = activeToolRef.current;
      const currentShape = activeShapeRef.current;
      const isCreationToolActive = isCreationTool(currentTool);
      if (message.event === "pointerdown" && isCreationToolActive) {
        if (currentTool === "pen") {
          const current = creationRef.current;
          creationRef.current = current?.type === "pen" && current.frameId === frameId
            ? { ...current, pointerId: message.pointerId ?? current.pointerId, points: [...current.points, message.point] }
            : { type: "pen", frameId, pointerId: message.pointerId ?? 0, points: [message.point] };
        } else if (currentTool === "comment") {
          addCommentRef.current(frameId, message.point);
        } else {
          creationRef.current = { type: "box", tool: currentTool as "rectangle" | "text" | "image", frameId, pointerId: message.pointerId ?? 0, start: message.point, last: message.point };
          if (currentTool === "image") {
            pendingImageRef.current = {
              frameId,
              bounds: { x: message.point.x, y: message.point.y, width: 160, height: 120 },
            };
          }
        }
        return;
      }
      if (message.event === "pointermove" && creationRef.current?.type === "box" && creationRef.current.frameId === frameId) {
        creationRef.current = { ...creationRef.current, last: message.point };
        return;
      }
      if (message.event === "pointerup" && creationRef.current?.type === "box" && creationRef.current.frameId === frameId) {
        const operation = creationRef.current;
        creationRef.current = null;
        const bounds = normalizedBounds(operation.start, message.point);
        if (operation.tool === "image") {
          pendingImageRef.current = { frameId, bounds };
        } else {
          const kind: BridgeCreationKind = operation.tool === "text" ? "text" : currentShape;
          const command = {
            command: "create-element" as const,
            elementId: createElementId(kind),
            kind,
            bounds,
            ...(kind === "text" ? { text: "Type to edit", editable: true } : { points: shapePoints(currentShape, bounds) }),
            fill: kind === "text" ? "#171717" : "#d9d9d9",
            stroke: kind === "text" ? "#171717" : "#222222",
            strokeWidth: 2,
          };
          void createLiveElementRef.current(frameId, command, kind === "text" ? "Create text" : `Create ${currentShape}`);
        }
        return;
      }
      if (message.event === "keydown") {
        if (currentTool === "select" && (message.key === "Delete" || message.key === "Backspace")) {
          void deleteSelectedNodesRef.current();
          return;
        }
        if (currentTool === "pen" && (message.key === "Enter" || message.key === "Escape")) {
          const operation = creationRef.current;
          creationRef.current = null;
          if (message.key === "Enter" && operation?.type === "pen" && operation.points.length >= 2) {
            const minX = Math.min(...operation.points.map((point) => point.x));
            const minY = Math.min(...operation.points.map((point) => point.y));
            const maxX = Math.max(...operation.points.map((point) => point.x));
            const maxY = Math.max(...operation.points.map((point) => point.y));
            const bounds = { x: minX, y: minY, width: Math.max(16, maxX - minX), height: Math.max(16, maxY - minY) };
            void createLiveElementRef.current(frameId, {
              command: "create-element",
              elementId: createElementId("path"),
              kind: "path",
              bounds,
              points: operation.points,
              fill: "none",
              stroke: "#222222",
              strokeWidth: 2,
            }, "Create path");
          }
          return;
        }
      }
      if (message.event === "input" && message.target && message.text !== undefined) {
        if (editorStore.getState().nodes[message.target.elementId]) {
          editorStore.execute({ type: "node/update", nodeId: message.target.elementId, patch: { name: message.text.slice(0, 80) || "Text" } }, { history: "skip" });
        }
        return;
      }
      if (message.event === "text-commit" && message.target && message.text !== undefined) {
        const controller = bridgeControllersRef.current.get(frameId);
        if (!controller) return;
        void controller.commitTextEdit({
          command: "commit-text-edit",
          targetId: message.target.elementId,
          text: message.text,
        }).then((ack) => {
          if (ack.command !== "set-text") return;
          const nextText = message.text!;
          const node = editorStore.getState().nodes[message.target!.elementId];
          editorStore.beginTransaction("Edit text");
          if (node) {
            editorStore.execute({
              type: "node/update",
              nodeId: message.target!.elementId,
              patch: { name: nextText.slice(0, 80) || "Text" },
            }, { history: "skip" });
          }
          editorStore.commitTransaction({
            undo: () => {
              void controller.setText(ack.undo as Extract<BridgeCommand, { command: "set-text" }>)
                .then(() => refreshSnapshotRef.current(frameId))
                .catch(() => undefined);
            },
            redo: () => {
              void controller.setText({ command: "set-text", targetId: message.target!.elementId, text: nextText })
                .then(() => refreshSnapshotRef.current(frameId))
                .catch(() => undefined);
            },
          });
          return refreshSnapshotRef.current(frameId);
        }).catch(() => undefined);
        return;
      }
      if (message.event === "text-edit-start" || message.event === "text-cancel") return;
      if (message.event === "select" && currentTool !== "select" && currentTool !== "eyedropper") return;

      const surfaceRect = surface.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();
      const context = {
        iframeRect: {
          x: iframeRect.x,
          y: iframeRect.y,
          width: iframeRect.width,
          height: iframeRect.height,
        },
        surfaceRect: {
          x: surfaceRect.x,
          y: surfaceRect.y,
          width: surfaceRect.width,
          height: surfaceRect.height,
        },
        camera: cameraRef.current,
      };

      if (message.target) {
        const mappedPoint = mapIframePointToCanvas(message.point, context);
        lastBridgeTargetRef.current = {
          frameId,
          elementId: message.target.elementId,
          screen: mappedPoint.screen,
          world: mappedPoint.world,
          bounds: mapIframeRectToCanvas(message.target.bounds, context),
        };
        setBridgeTargets((current) => {
          const key = targetStateKey(frameId, message.target!.elementId);
          return {
            ...current,
            [key]: {
              frameId,
              target: message.target!,
              inspection: current[key]?.inspection ?? null,
            },
          };
        });
        if (message.event === "hover") {
          setHoveredOverlayTarget(
            toOverlayTarget({ frameId, target: message.target, inspection: null }),
          );
        }
      } else {
        lastBridgeTargetRef.current = null;
        if (message.event === "hover") setHoveredOverlayTarget(null);
      }

      if (message.event !== "select" || !message.target) return;

      const existingNode = editorStore.getState().nodes[message.target.elementId];
      const node: NodeEntity = {
        id: message.target.elementId,
        documentId: frame.documentId,
        parentId: null,
        kind: "element",
        name: existingNode?.name ?? message.target.name,
        tagName: message.target.tagName,
        attributes: existingNode?.attributes ?? (message.target.role ? { role: message.target.role } : {}),
        childIds: [],
        locked: existingNode?.locked ?? message.target.locked,
        hidden: existingNode?.hidden,
        frameId,
      };
      editorStore.execute({ type: "node/upsert", node }, { history: "skip" });
      const currentSelection = editorStore.getState().selection;
      const selected = currentSelection.nodeIds.includes(node.id);
      const nodeIds = message.shiftKey
        ? selected
          ? currentSelection.nodeIds.filter((id) => id !== node.id)
          : [...currentSelection.nodeIds, node.id]
        : [node.id];
      const frameIds = message.shiftKey
        ? selected
          ? currentSelection.frameIds
          : Array.from(new Set([...currentSelection.frameIds, frameId]))
        : [frameId];
      editorStore.execute(
        setSelectionCommand({
          frameIds,
          nodeIds,
          primaryFrameId: nodeIds.includes(node.id)
            ? frameId
            : currentSelection.primaryFrameId,
          primaryNodeId: nodeIds.includes(node.id)
            ? node.id
            : nodeIds[0] ?? null,
        }),
        { history: "skip" },
      );
    },
    [bridgeControllersRef, editorStore, toOverlayTarget],
  );

  const handleBridgeInspection = useCallback(
    (frameId: string, inspection: BridgeInspection | null) => {
      if (!inspection) return;
      if (activeToolRef.current === "eyedropper") {
        const candidates = [
          inspection.computedStyle.color,
          inspection.computedStyle["background-color"],
          inspection.computedStyle["border-color"],
        ];
        const color = candidates.find((value) => value && value !== "transparent" && !/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/i.test(value));
        if (color) {
          setSampledColor(color);
          if (navigator.clipboard) void navigator.clipboard.writeText(color).catch(() => undefined);
        }
      }
      setBridgeTargets((current) => {
        const key = targetStateKey(frameId, inspection.target.elementId);
        return {
          ...current,
          [key]: {
            frameId,
            target: inspection.target,
            inspection,
          },
        };
      });
    },
    [],
  );

  const handleBridgeSnapshot = useCallback(
    (frameId: string, snapshot: BridgeHierarchySnapshot, requestSequence?: number) => {
      if (requestSequence !== undefined) {
        const previousSequence = snapshotSequenceRef.current.get(frameId) ?? 0;
        if (requestSequence < previousSequence) return;
        snapshotSequenceRef.current.set(frameId, requestSequence);
      }
      const frame = editorStore.getState().frames[frameId];
      if (!frame) return;
      setBridgeHierarchies((current) => ({ ...current, [frameId]: snapshot }));
      for (const target of snapshot.nodes) {
        const existingNode = editorStore.getState().nodes[target.elementId];
        editorStore.execute(
          {
            type: "node/upsert",
            node: {
              id: target.elementId,
              documentId: frame.documentId,
              parentId: target.parentId,
              kind: "element",
              name: existingNode?.name ?? target.name,
              tagName: target.tagName,
              attributes: existingNode?.attributes ?? (target.role ? { role: target.role } : {}),
              childIds: target.childIds,
              locked: existingNode?.locked ?? target.locked,
              hidden: existingNode?.hidden,
              frameId,
            },
          },
          { history: "skip" },
        );
        setBridgeTargets((current) => ({
          ...current,
          [targetStateKey(frameId, target.elementId)]: {
            frameId,
            target,
            inspection: current[targetStateKey(frameId, target.elementId)]?.inspection ?? null,
          },
        }));
      }
    },
    [editorStore, snapshotSequenceRef],
  );

  const handleBridgeController = useCallback(
    (frameId: string, controller: IframeBridgeController | null) => {
      if (controller) bridgeControllersRef.current.set(frameId, controller);
      else {
        bridgeControllersRef.current.delete(frameId);
        snapshotSequenceRef.current.delete(frameId);
      }
    },
    [snapshotSequenceRef],
  );

  const refreshBridgeSnapshot = useCallback(async (frameId: string) => {
    const previous = snapshotQueuesRef.current.get(frameId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const controller = bridgeControllersRef.current.get(frameId);
      const snapshot = await controller?.requestSnapshot();
      if (!snapshot) return;
      handleBridgeSnapshot(frameId, snapshot);

      const selectedNodeIds = new Set(editorStore.getState().selection.nodeIds);
      await Promise.all(
        snapshot.nodes
          .filter((target) => selectedNodeIds.has(target.elementId))
          .map(async (target) => {
            const inspection = await controller?.inspect(target.elementId);
            if (inspection) handleBridgeInspection(frameId, inspection);
          }),
      );
    });
    snapshotQueuesRef.current.set(frameId, next);
    try {
      await next;
    } finally {
      if (snapshotQueuesRef.current.get(frameId) === next) snapshotQueuesRef.current.delete(frameId);
    }
  }, [bridgeControllersRef, editorStore, handleBridgeInspection, handleBridgeSnapshot, snapshotQueuesRef]);
  refreshSnapshotRef.current = refreshBridgeSnapshot;

  const refreshBridgeTarget = useCallback(async (frameId: string, targetId: string) => {
    const inspection = await bridgeControllersRef.current.get(frameId)?.inspect(targetId);
    if (inspection) handleBridgeInspection(frameId, inspection);
    return inspection ?? null;
  }, [bridgeControllersRef, handleBridgeInspection]);

  const createLiveElement = useCallback(async (
    frameId: string,
    command: Extract<BridgeCommand, { command: "create-element" }>,
    label: string,
  ): Promise<boolean> => {
    const controller = bridgeControllersRef.current.get(frameId);
    const frame = editorStore.getState().frames[frameId];
    if (!controller || !frame) {
      setCreationError("The selected frame is not ready. Select a live frame and try again.");
      return false;
    }
    try {
      const ack = await controller.createElement(command);
      if (!("target" in ack) || !ack.target) {
        setCreationError(`Could not ${label.toLowerCase()}: the bridge returned no created layer.`);
        return false;
      }
      const target = ack.target;
      const node: NodeEntity = {
        id: target.elementId,
        documentId: frame.documentId,
        parentId: null,
        kind: command.kind === "text" ? "text" : command.kind === "path" ? "component" : "element",
        name: target.name,
        tagName: target.tagName,
        attributes: { "data-design-tool-created": "true" },
        childIds: [],
        frameId,
      };
      editorStore.beginTransaction(label);
      editorStore.execute({ type: "node/upsert", node }, { history: "skip" });
      editorStore.execute(setSelectionCommand({
        frameIds: [frameId],
        nodeIds: [target.elementId],
        primaryFrameId: frameId,
        primaryNodeId: target.elementId,
      }), { history: "skip" });
      const replay = ack.replay;
      editorStore.commitTransaction({
        undo: () => {
          if (ack.undo.command === "delete-element") {
            void controller.deleteElement(ack.undo).then(() => refreshSnapshotRef.current(frameId)).catch(() => undefined);
          }
        },
        redo: () => {
          if (replay.command === "create-element") {
            void controller.createElement(replay).then(() => refreshSnapshotRef.current(frameId)).catch(() => undefined);
          }
        },
      });
      await refreshBridgeSnapshot(frameId);
      setCreationError(null);
      return true;
    } catch (error) {
      if (editorStore.hasActiveTransaction()) editorStore.rollbackTransaction();
      const detail = error instanceof Error ? error.message : "the bridge rejected the request";
      setCreationError(`Could not ${label.toLowerCase()}: ${detail}`);
      return false;
    }
  }, [bridgeControllersRef, editorStore, refreshBridgeSnapshot]);
  createLiveElementRef.current = createLiveElement;

  addCommentRef.current = addComment;

  const handleImageFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const pendingPlacement = pendingImageRef.current;
    pendingImageRef.current = null;
    event.target.value = "";
    const fallbackFrameId = editorStore.getState().selection.primaryFrameId;
    const placement = pendingPlacement ?? (fallbackFrameId ? {
      frameId: fallbackFrameId,
      bounds: { x: 48, y: 48, width: 160, height: 120 },
    } : null);
    if (!file) {
      setCreationError("No image was selected. Choose a PNG, JPEG, GIF, WebP, or AVIF file.");
      return;
    }
    if (!placement) {
      setCreationError("Select a live frame before placing an image.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setCreationError("That file is not an image. Choose a PNG, JPEG, GIF, WebP, or AVIF file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setCreationError("That image is larger than 10 MB. Choose a smaller file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.startsWith("data:image/")) {
        setCreationError("The image could not be read. Try exporting it as PNG or JPEG and choose it again.");
        return;
      }
      void createLiveElementRef.current(placement.frameId, {
        command: "create-element",
        elementId: createElementId("image"),
        kind: "image",
        bounds: placement.bounds,
        src: reader.result,
        alt: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
      }, "Place image").then((created) => {
        if (!created) return;
        setCreationError(null);
        creationRef.current = null;
        pendingImageRef.current = null;
        setInteractionMode("idle");
        editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
      });
    };
    reader.onerror = () => {
      setCreationError("The image could not be read. Check the file and try again.");
    };
    reader.readAsDataURL(file);
  }, [editorStore]);

  const duplicateSelectedNode = useCallback(async () => {
    const selection = editorStore.getState().selection;
    const sourceId = selection.primaryNodeId ?? selection.nodeIds[0];
    const source = sourceId ? editorStore.getState().nodes[sourceId] : undefined;
    const frameId = source?.frameId ?? selection.primaryFrameId;
    const controller = frameId ? bridgeControllersRef.current.get(frameId) : undefined;
    if (!source || !frameId || !controller || source.attributes["data-design-tool-created"] !== "true") return;
    const elementId = createElementId("duplicate");
    try {
      const ack = await controller.duplicateElement({ command: "duplicate-element", targetId: source.id, elementId });
      if (!("target" in ack) || !ack.target) return;
      const target = ack.target;
      const node: NodeEntity = {
        id: target.elementId,
        documentId: source.documentId,
        parentId: source.parentId,
        kind: source.kind,
        name: `${source.name} copy`,
        tagName: target.tagName,
        attributes: { ...source.attributes },
        childIds: [],
        frameId,
      };
      editorStore.beginTransaction("Duplicate layer");
      editorStore.execute({ type: "node/upsert", node }, { history: "skip" });
      editorStore.execute(setSelectionCommand({ frameIds: [frameId], nodeIds: [target.elementId], primaryFrameId: frameId, primaryNodeId: target.elementId }), { history: "skip" });
      editorStore.commitTransaction({
        undo: () => {
          if (ack.undo.command === "delete-element") void controller.deleteElement(ack.undo).then(() => refreshSnapshotRef.current(frameId)).catch(() => undefined);
        },
        redo: () => {
          if (ack.replay.command === "create-element") void controller.createElement(ack.replay).then(() => refreshSnapshotRef.current(frameId)).catch(() => undefined);
        },
      });
      await refreshBridgeSnapshot(frameId);
    } catch {
      // Ignore unsupported or stale duplicate targets.
    }
  }, [bridgeControllersRef, editorStore, refreshBridgeSnapshot]);

  const deleteSelectedNodes = useCallback(async () => {
    const state = editorStore.getState();
    const selected = state.selection.nodeIds
      .map((nodeId) => state.nodes[nodeId])
      .filter((node): node is NodeEntity => Boolean(node && node.frameId && node.attributes["data-design-tool-created"] === "true"));
    if (selected.length === 0) return;
    const applied: Array<{ frameId: string; ack: Extract<import("../bridge/protocol").BridgeCommandAck, { command: "delete-element" }> }> = [];
    try {
      for (const node of selected) {
        const controller = bridgeControllersRef.current.get(node.frameId!);
        if (!controller) throw new Error("bridge unavailable");
        const ack = await controller.deleteElement({ command: "delete-element", targetId: node.id });
        if (ack.command !== "delete-element") throw new Error("delete acknowledgement invalid");
        applied.push({ frameId: node.frameId!, ack });
      }
    } catch {
      for (const { frameId, ack } of [...applied].reverse()) {
        if (ack.undo.command === "restore-element") void bridgeControllersRef.current.get(frameId)?.restoreElement(ack.undo);
      }
      return;
    }
    editorStore.beginTransaction("Delete layers");
    for (const node of selected) editorStore.execute({ type: "node/remove", nodeId: node.id }, { history: "skip" });
    editorStore.execute(setSelectionCommand({ frameIds: [], nodeIds: [], primaryFrameId: null, primaryNodeId: null }), { history: "skip" });
    editorStore.commitTransaction({
      undo: () => {
        for (const { frameId, ack } of [...applied].reverse()) {
          if (ack.undo.command === "restore-element") void bridgeControllersRef.current.get(frameId)?.restoreElement(ack.undo).then(() => refreshSnapshotRef.current(frameId)).catch(() => undefined);
        }
      },
      redo: () => {
        for (const { frameId, ack } of applied) void bridgeControllersRef.current.get(frameId)?.deleteElement(ack.replay as Extract<BridgeCommand, { command: "delete-element" }>).then(() => refreshSnapshotRef.current(frameId)).catch(() => undefined);
      },
    });
    for (const { frameId } of applied) await refreshBridgeSnapshot(frameId);
  }, [bridgeControllersRef, editorStore, refreshBridgeSnapshot]);
  deleteSelectedNodesRef.current = deleteSelectedNodes;

  const applyLocalBridgeStyle = useCallback(
    (frameId: string, targetId: string, property: SafeInlineStyleProperty, value: string | null) => {
      setBridgeTargets((current) => {
        const key = targetStateKey(frameId, targetId);
        const entry = current[key];
        if (!entry?.inspection) return current;
        return {
          ...current,
          [key]: {
            ...entry,
            inspection: {
              ...entry.inspection,
              inlineStyle: value === null
                ? Object.fromEntries(Object.entries(entry.inspection.inlineStyle).filter(([name]) => name !== property))
                : { ...entry.inspection.inlineStyle, [property]: value },
              computedStyle: value === null
                ? entry.inspection.computedStyle
                : { ...entry.inspection.computedStyle, [property]: value },
            },
          },
        };
      });
    },
    [],
  );

  const runBridgeStyleEdit = useCallback(
    async (
      changes: readonly { frameId: string; targetId: string; property: SafeInlineStyleProperty; value: string | null }[],
      label: string,
      mutateState?: () => void,
    ) => {
      const applicable = changes.filter(({ frameId }) => bridgeControllersRef.current.has(frameId));
      if (applicable.length === 0) return;
      editorStore.beginTransaction(label);
      mutateState?.();
      const applied: Array<{ frameId: string; command: Extract<import("../bridge/protocol").BridgeCommand, { command: "set-inline-style" }>; undo: Extract<import("../bridge/protocol").BridgeUndoCommand, { command: "set-inline-style" }> }> = [];
      try {
        for (const change of applicable) {
          const command = { command: "set-inline-style", targetId: change.targetId, property: change.property, value: change.value } as const;
          const controller = bridgeControllersRef.current.get(change.frameId);
          if (!controller) continue;
          const ack = await controller.setInlineStyle(command);
          if (!("undo" in ack) || ack.command !== "set-inline-style") throw new Error("style acknowledgement invalid");
          applied.push({ frameId: change.frameId, command, undo: ack.undo as Extract<import("../bridge/protocol").BridgeUndoCommand, { command: "set-inline-style" }> });
          applyLocalBridgeStyle(change.frameId, change.targetId, change.property, ack.value);
        }
      } catch {
        for (const appliedChange of [...applied].reverse()) {
          await bridgeControllersRef.current.get(appliedChange.frameId)?.setInlineStyle(appliedChange.undo).catch(() => undefined);
        }
        editorStore.rollbackTransaction();
        return;
      }
      const affectedFrameIds = Array.from(new Set(applied.map(({ frameId }) => frameId)));
      const refreshAffectedFrames = () => Promise.all(
        affectedFrameIds.map((frameId) => refreshBridgeSnapshot(frameId).catch(() => undefined)),
      );
      const replay = (direction: "undo" | "redo") => {
        const requests = applied.map(({ frameId, command, undo }) => {
          const next = direction === "undo" ? undo : command;
          applyLocalBridgeStyle(frameId, next.targetId, next.property, next.value);
          return bridgeControllersRef.current.get(frameId)?.setInlineStyle(next);
        });
        void Promise.all(requests)
          .then(() => Promise.all(affectedFrameIds.map((frameId) => refreshBridgeSnapshot(frameId).catch(() => undefined))))
          .catch(() => undefined);
      };
      if (!editorStore.commitTransaction({ undo: () => replay("undo"), redo: () => replay("redo") })) return;
      void refreshAffectedFrames();
    },
    [applyLocalBridgeStyle, bridgeControllersRef, editorStore, refreshBridgeSnapshot],
  );

  const createPage = useCallback(() => {
    const documentId = Object.keys(editorState.documents)[0];
    if (!documentId) return;
    let sequence = 2;
    while (editorState.pages[`page-${sequence}`]) sequence += 1;
    const pageId = `page-${sequence}`;
    editorStore.execute(createPageCommand({ id: pageId, documentId, name: `Page ${sequence}`, frameIds: [] }));
    editorStore.execute(switchPageCommand(pageId), { history: "skip" });
  }, [editorState.documents, editorState.pages, editorStore]);

  const renamePage = useCallback((pageId: string, name: string) => {
    editorStore.execute(renamePageCommand(pageId, name));
  }, [editorStore]);

  const selectNode = useCallback((frameId: string, nodeId: string, shiftKey: boolean) => {
    const current = editorStore.getState().selection;
    const alreadySelected = current.nodeIds.includes(nodeId);
    const nodeIds = shiftKey
      ? alreadySelected ? current.nodeIds.filter((id) => id !== nodeId) : [...current.nodeIds, nodeId]
      : [nodeId];
    const frameIds = shiftKey
      ? alreadySelected ? current.frameIds : Array.from(new Set([...current.frameIds, frameId]))
      : [frameId];
    editorStore.execute(setSelectionCommand({ frameIds, nodeIds, primaryFrameId: nodeIds.includes(nodeId) ? frameId : current.primaryFrameId, primaryNodeId: nodeIds.includes(nodeId) ? nodeId : nodeIds[0] ?? null }), { history: "skip" });
    const controller = bridgeControllersRef.current.get(frameId);
    if (controller) void controller.inspect(nodeId).then((inspection) => { if (inspection) handleBridgeInspection(frameId, inspection); }).catch(() => undefined);
  }, [bridgeControllersRef, editorStore, handleBridgeInspection]);

  const startSelectedTextEdit = useCallback(() => {
    const selection = editorStore.getState().selection;
    const nodeId = selection.primaryNodeId ?? selection.nodeIds[0];
    const node = nodeId ? editorStore.getState().nodes[nodeId] : undefined;
    if (!node?.frameId) return;
    void bridgeControllersRef.current.get(node.frameId)?.startTextEdit(node.id).catch(() => undefined);
  }, [bridgeControllersRef, editorStore]);

  const cancelSelectedTextEdit = useCallback(() => {
    const selection = editorStore.getState().selection;
    const nodeId = selection.primaryNodeId ?? selection.nodeIds[0];
    const node = nodeId ? editorStore.getState().nodes[nodeId] : undefined;
    if (!node?.frameId) return;
    void bridgeControllersRef.current.get(node.frameId)?.cancelTextEdit(node.id).catch(() => undefined);
  }, [bridgeControllersRef, editorStore]);

  const startTextEdit = useCallback((target: OverlayNodeTarget) => {
    void bridgeControllersRef.current.get(target.frameId)?.startTextEdit(target.nodeId).catch(() => undefined);
  }, [bridgeControllersRef]);

  const renameNode = useCallback((nodeId: string, name: string) => {
    editorStore.execute({ type: "node/update", nodeId, patch: { name } });
  }, [editorStore]);

  const toggleNodeLock = useCallback((nodeId: string) => {
    const node = editorStore.getState().nodes[nodeId];
    if (node) editorStore.execute({ type: "node/update", nodeId, patch: { locked: !node.locked } });
  }, [editorStore]);

  const toggleNodeHidden = useCallback((frameId: string, nodeId: string) => {
    const node = editorStore.getState().nodes[nodeId];
    const entry = bridgeTargets[targetStateKey(frameId, nodeId)];
    const hidden = !(node?.hidden ?? false);
    if (!entry) {
      if (node) editorStore.execute({ type: "node/update", nodeId, patch: { hidden } });
      return;
    }
    void runBridgeStyleEdit(
      [{ frameId, targetId: nodeId, property: "display", value: hidden ? "none" : null }],
      `${hidden ? "Hide" : "Show"} layer`,
      () => editorStore.execute({ type: "node/update", nodeId, patch: { hidden } }, { history: "skip" }),
    );
  }, [bridgeTargets, editorStore, runBridgeStyleEdit]);

  const editNodeStyle = useCallback((property: SafeInlineStyleProperty, value: string | null) => {
    const state = editorStore.getState();
    const changes = Object.values(bridgeTargets)
      .filter((entry) => state.selection.nodeIds.includes(entry.target.elementId) && (state.selection.frameIds.length === 0 || state.selection.frameIds.includes(entry.frameId)))
      .map((entry) => ({ frameId: entry.frameId, targetId: entry.target.elementId, property, value }));
    void runBridgeStyleEdit(changes, `Change ${property}`);
  }, [bridgeTargets, editorStore, runBridgeStyleEdit]);

  const editNodePosition = useCallback((frameId: string, nodeId: string, position: { x: number; y: number }) => {
    const entry = bridgeTargets[targetStateKey(frameId, nodeId)];
    const controller = bridgeControllersRef.current.get(frameId);
    if (!entry || !controller) return;
    void controller.inspect(nodeId).then((inspection) => {
      if (!inspection) return;
      handleBridgeInspection(frameId, inspection);
      const currentTransform = inspection.inlineStyle.transform ?? inspection.computedStyle.transform;
      const value = prependTranslationTransform(currentTransform, {
        x: position.x - inspection.target.bounds.x,
        y: position.y - inspection.target.bounds.y,
      });
      void runBridgeStyleEdit([{ frameId, targetId: nodeId, property: "transform", value }], "Move layer");
    }).catch(() => undefined);
  }, [bridgeControllersRef, bridgeTargets, handleBridgeInspection, runBridgeStyleEdit]);

  const updateFrameFromPanel = useCallback((frameId: string, patch: { width?: number; height?: number; background?: string; name?: string }) => {
    editorStore.execute({ type: "frame/update", frameId, patch });
  }, [editorStore]);

  const moveFrameFromPanel = useCallback((frameId: string, position: { x: number; y: number }) => {
    editorStore.execute(moveFrameCommand({ frameId, position }));
  }, [editorStore]);

  const {
    alignmentGuides,
    beginNodeGesture,
    cancelNodeGesture,
    endNodeGesture,
    moveNodeGesture,
    selectedOverlayTargets,
  } = useNodeOverlayGestures({
    surfaceRef,
    cameraRef,
    editorStore,
    bridgeTargets,
    bridgeControllersRef,
    refreshSnapshot: refreshBridgeSnapshot,
    refreshTarget: refreshBridgeTarget,
    selection: editorState.selection,
    toOverlayTarget,
    setInteractionMode,
  });

  const setActiveTool = useCallback(
    (tool: ToolId) => {
      creationRef.current = null;
      pendingImageRef.current = null;
      setCreationError(null);
      setInteractionMode("idle");
      editorStore.execute(setActiveToolCommand(tool), { history: "skip" });
      setIsFrameMenuOpen(tool === "frame");
    },
    [editorStore],
  );

  const toggleFrameMenu = useCallback(() => {
    creationRef.current = null;
    pendingImageRef.current = null;
    setCreationError(null);
    editorStore.execute(setActiveToolCommand("frame"), { history: "skip" });
    setIsFrameMenuOpen((current) => !current);
  }, [editorStore]);

  const liveFrameIds = useMemo(
    () =>
      rankVisibleFrames({
        frames,
        camera,
        viewport,
        pinnedFrameId: selectedFrameId ?? undefined,
      }).liveFrameIds,
    [camera, frames, selectedFrameId, viewport],
  );
  const liveFrameIdSet = useMemo(() => new Set(liveFrameIds), [liveFrameIds]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    const updateViewport = (size = getViewportSize(surface)) => {
      if (size.width <= 0 || size.height <= 0) {
        return;
      }
      setViewport((current) =>
        current.width === size.width && current.height === size.height ? current : size,
      );
    };

    updateViewport();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const measured = getViewportSize(surface);
      updateViewport({
        width: entry.contentRect.width || measured.width,
        height: entry.contentRect.height || measured.height,
      });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const updateCamera = useCallback((nextCamera: Camera) => {
    cameraRef.current = nextCamera;
    setCamera(nextCamera);
  }, []);

  const switchPage = useCallback((pageId: string) => {
    editorStore.execute(switchPageCommand(pageId), { history: "skip" });
    const nextState = editorStore.getState();
    const pageFrameIds = nextState.pages[pageId]?.frameIds ?? [];
    const pageFrames = pageFrameIds
      .map((frameId) => nextState.frames[frameId])
      .filter((frame): frame is NonNullable<typeof frame> => Boolean(frame));
    if (pageFrames.length > 0 && viewport.width > 0 && viewport.height > 0) {
      updateCamera(fitRect(getFramesBounds(pageFrames), viewport, cameraFitPadding(viewport)));
    }
  }, [editorStore, updateCamera, viewport]);

  const fitAllFrames = useCallback(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }
    updateCamera(fitRect(getFramesBounds(renderRects), viewport, cameraFitPadding(viewport)));
  }, [renderRects, updateCamera, viewport]);

  useEffect(() => {
    if (
      cameraInitializedRef.current ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      return;
    }
    if (renderRects.length === 0) return;
    cameraInitializedRef.current = true;
    const openingFrame = renderRects[0];
    updateCamera(fitRect(openingFrame, viewport, cameraFitPadding(viewport)));
  }, [renderRects, updateCamera, viewport]);

  useEffect(
    () => () => {
      if (motionTimeoutRef.current !== null) {
        clearTimeout(motionTimeoutRef.current);
      }
      if (editorStore.hasActiveTransaction()) {
        editorStore.rollbackTransaction();
      }
    },
    [editorStore],
  );

  const settleInteraction = useCallback((delay = CAMERA_SETTLE_MS) => {
    if (motionTimeoutRef.current !== null) {
      clearTimeout(motionTimeoutRef.current);
    }
    motionTimeoutRef.current = setTimeout(() => {
      setInteractionMode("idle");
      motionTimeoutRef.current = null;
    }, delay);
  }, []);

  const zoomAtViewportCenter = useCallback(
    (factor: number) => {
      const center = { x: viewport.width / 2, y: viewport.height / 2 };
      updateCamera(
        zoomCameraAtPoint(cameraRef.current, cameraRef.current.zoom * factor, center),
      );
      setInteractionMode("zooming");
      settleInteraction();
    },
    [settleInteraction, updateCamera, viewport],
  );

  const addFrame = useCallback(
    (preset: FramePreset) => {
      const measuredViewport = surfaceRef.current ? getViewportSize(surfaceRef.current) : viewport;
      const usableViewport = measuredViewport.width > 0 && measuredViewport.height > 0
        ? measuredViewport
        : { width: Math.max(viewport.width, 1), height: Math.max(viewport.height, 1) };
      const viewportCenter = screenToWorld(
        { x: usableViewport.width / 2, y: usableViewport.height / 2 },
        cameraRef.current,
      );
      const position = renderRects.length === 0
        ? viewportCenter
        : {
            x:
              Math.max(...renderRects.map((frame) => frame.x + frame.width)) +
              140 +
              preset.width / 2,
            y: Math.min(...renderRects.map((frame) => frame.y)) + preset.height / 2,
          };
      const sequence = nextFrameSequenceRef.current++;
      const frame = {
        ...createFrameFromPreset({
        preset,
        position,
        sequence,
        }),
        pageId: editorState.activePageId ?? "page-1",
      };
      editorStore.beginTransaction("Add frame");
      editorStore.execute(createFrameCommand(frame), { history: "skip" });
      setSelectedFrameId(frame.id);
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
      editorStore.commitTransaction();
      setIsFrameMenuOpen(false);
      updateCamera(fitRect(frame, usableViewport, cameraFitPadding(usableViewport)));
    },
    [editorState.activePageId, editorStore, renderRects, setSelectedFrameId, updateCamera, viewport],
  );

  const beginFramePointer = useCallback(
    (frameId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      const surface = surfaceRef.current;
      if (!surface || event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      surface.focus({ preventScroll: true });
      surface.setPointerCapture(event.pointerId);
      const currentTool = normalizeActiveTool(editorStore.getState().activeTool);
      if (spacePressedRef.current || currentTool === "hand") {
        pointerRef.current = {
          type: "pan",
          pointerId: event.pointerId,
          last: getPointerPosition(event, surface),
        };
        setInteractionMode("panning");
        return;
      }
      if (currentTool !== "select") {
        return;
      }
      setSelectedFrameId(frameId);
      editorStore.beginTransaction(`Move ${frameId}`);
      pointerRef.current = {
        type: "move-frame",
        pointerId: event.pointerId,
        last: getPointerPosition(event, surface),
        frameId,
      };
      setInteractionMode("moving-frame");
    },
    [editorStore, setSelectedFrameId],
  );

  const beginBriefFramePointer = useCallback(
    (briefFrameId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      const surface = surfaceRef.current;
      if (!surface || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      surface.focus({ preventScroll: true });
      surface.setPointerCapture(event.pointerId);
      const currentTool = normalizeActiveTool(editorStore.getState().activeTool);
      if (spacePressedRef.current || currentTool === "hand") {
        pointerRef.current = {
          type: "pan",
          pointerId: event.pointerId,
          last: getPointerPosition(event, surface),
        };
        setInteractionMode("panning");
        return;
      }
      if (currentTool !== "select") return;
      selectBriefFrame(briefFrameId);
      editorStore.beginTransaction(`Move ${briefFrameId}`);
      pointerRef.current = {
        type: "move-brief-frame",
        pointerId: event.pointerId,
        last: getPointerPosition(event, surface),
        briefFrameId,
      };
      setInteractionMode("moving-frame");
    },
    [editorStore, selectBriefFrame],
  );

  const beginCanvasPan = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const surface = surfaceRef.current;
      if (!surface || event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      surface.focus({ preventScroll: true });
      surface.setPointerCapture(event.pointerId);
      pointerRef.current = {
        type: "pan",
        pointerId: event.pointerId,
        last: getPointerPosition(event, surface),
      };
      setInteractionMode("panning");
    },
    [],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    if (isCanvasControlTarget(event.target) || isNodeOverlayTarget(event.target)) {
      return;
    }
    if (activeTool === "frame" && !spacePressedRef.current) {
      return;
    }
    if (!spacePressedRef.current && activeTool !== "hand" && isFrameTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      last: getPointerPosition(event, event.currentTarget),
    };
    if (!spacePressedRef.current) {
      setSelectedFrameId(null);
    }
    setInteractionMode("panning");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (moveNodeGesture(event)) {
      return;
    }
    const operation = pointerRef.current;
    if (!operation || operation.pointerId !== event.pointerId) {
      return;
    }

    const next = getPointerPosition(event, event.currentTarget);
    const delta = { x: next.x - operation.last.x, y: next.y - operation.last.y };
    operation.last = next;
    if (delta.x === 0 && delta.y === 0) {
      return;
    }

    if (operation.type === "pan") {
      updateCamera(panCamera(cameraRef.current, delta));
      return;
    }

    const worldDelta = {
      x: delta.x / cameraRef.current.zoom,
      y: delta.y / cameraRef.current.zoom,
    };
    if (operation.type === "move-brief-frame") {
      const currentBriefFrame = editorStore.getState().session.briefFrame;
      if (!currentBriefFrame || currentBriefFrame.id !== operation.briefFrameId) return;
      editorStore.execute(
        moveBriefFrameCommand({
          position: {
            x: currentBriefFrame.x + worldDelta.x,
            y: currentBriefFrame.y + worldDelta.y,
          },
        }),
        { history: "skip" },
      );
      return;
    }
    const frame = editorStore.getState().frames[operation.frameId];
    if (!frame) {
      return;
    }
    editorStore.execute(
      moveFrameCommand({
        frameId: operation.frameId,
        position: {
          x: frame.x + worldDelta.x,
          y: frame.y + worldDelta.y,
        },
      }),
    );
  };

  const endPointerOperation = (event: ReactPointerEvent<HTMLDivElement>) => {
    endNodeGesture(event);
    const operation = pointerRef.current;
    pointerRef.current = null;
    if ((operation?.type === "move-frame" || operation?.type === "move-brief-frame") && editorStore.hasActiveTransaction()) {
      editorStore.commitTransaction();
    }
    setInteractionMode("idle");
  };

  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A node gesture initially captures its handle, then hands capture to the
    // canvas once dragging crosses the threshold. Ignore that intermediate
    // lost-capture event; the node gesture owns its own pointer lifecycle.
    if (!pointerRef.current || pointerRef.current.pointerId !== event.pointerId) return;
    endPointerOperation(event);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (isCanvasControlTarget(event.target)) {
      return;
    }
    event.preventDefault();
    const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    const delta = { x: event.deltaX * multiplier, y: event.deltaY * multiplier };

    if (event.ctrlKey || event.metaKey) {
      const pointer = getPointerPosition(event, event.currentTarget);
      updateCamera(
        zoomCameraAtPoint(
          cameraRef.current,
          cameraRef.current.zoom * Math.exp(-delta.y / 360),
          pointer,
        ),
      );
      setInteractionMode("zooming");
    } else {
      updateCamera(panCamera(cameraRef.current, delta));
      setInteractionMode("panning");
    }
    settleInteraction();
  };

  const cancelInteraction = useCallback(() => {
    cancelNodeGesture();
    const operation = pointerRef.current;
    pointerRef.current = null;
    if ((operation?.type === "move-frame" || operation?.type === "move-brief-frame") && editorStore.hasActiveTransaction()) {
      editorStore.rollbackTransaction();
    }
    setInteractionMode("idle");
  }, [cancelNodeGesture, editorStore]);

  const handleEscape = useCallback(() => {
    cancelSelectedTextEdit();
    cancelInteraction();
    creationRef.current = null;
    pendingImageRef.current = null;
    setCreationError(null);
    setIsFrameMenuOpen(false);
    if (activeTool !== "select") {
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
    }
  }, [activeTool, cancelInteraction, cancelSelectedTextEdit, editorStore]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) && event.target !== imageInputRef.current) {
        return;
      }
      if (isSpaceShortcut(event.key)) {
        if (!event.repeat) {
          event.preventDefault();
          spacePressedRef.current = true;
          setSpacePressed(true);
        }
        return;
      }

      if (event.key === "Enter" && activeTool === "select" && editorStore.getState().selection.nodeIds.length > 0) {
        event.preventDefault();
        startSelectedTextEdit();
        return;
      }

      const action = resolveEditorShortcut(event);
      if (!action) {
        return;
      }
      event.preventDefault();
      switch (action.type) {
        case "activate-tool":
          setActiveTool(action.tool);
          break;
        case "undo":
          if (!editorStore.hasActiveTransaction()) {
            editorStore.undo();
          }
          break;
        case "redo":
          if (!editorStore.hasActiveTransaction()) {
            editorStore.redo();
          }
          break;
        case "copy-selection": {
          const selection = editorStore.getState().selection;
          const nodeId = selection.primaryNodeId ?? selection.nodeIds[0];
          const node = nodeId ? editorStore.getState().nodes[nodeId] : undefined;
          if (node?.frameId && node.attributes["data-design-tool-created"] === "true") {
            clipboardTargetRef.current = { frameId: node.frameId, nodeId: node.id };
          }
          break;
        }
        case "paste-selection":
          if (clipboardTargetRef.current) {
            const clipboard = clipboardTargetRef.current;
            editorStore.execute(setSelectionCommand({ frameIds: [clipboard.frameId], nodeIds: [clipboard.nodeId], primaryFrameId: clipboard.frameId, primaryNodeId: clipboard.nodeId }), { history: "skip" });
          }
          void duplicateSelectedNode();
          break;
        case "duplicate-selection":
          void duplicateSelectedNode();
          break;
        case "delete-selection":
          void deleteSelectedNodes();
          break;
        case "escape":
          handleEscape();
          break;
        case "fit-all":
          fitAllFrames();
          break;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isSpaceShortcut(event.key)) {
        return;
      }
      event.preventDefault();
      spacePressedRef.current = false;
      setSpacePressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [deleteSelectedNodes, duplicateSelectedNode, editorStore, fitAllFrames, handleEscape, setActiveTool, startSelectedTextEdit]);

  const guardIframes = (interactionMode !== "idle" && interactionMode !== "creating") || spacePressed;

  return (
    <main
      ref={surfaceRef}
      className="canvas-surface"
      data-testid="canvas-surface"
      data-interaction={interactionMode}
      aria-label="Infinite canvas"
      tabIndex={0}
      style={surfaceStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointerOperation}
      onPointerCancel={endPointerOperation}
      onLostPointerCapture={handleLostPointerCapture}
      onWheel={handleWheel}
      onBlur={() => {
        spacePressedRef.current = false;
        setSpacePressed(false);
      }}
    >
      <div
        className="canvas-world"
        data-testid="canvas-world"
        style={{ ...worldStyle, transform: cameraTransform(camera) }}
      >
        {briefFrame ? (
          <BriefFrameView
            key={`brief-frame-${persistenceVersion}-${briefFrame.id}`}
            briefFrame={briefFrame}
            isSelected={briefFrame.id === selectedBriefFrameId}
            onSelect={selectBriefFrame}
            onStartMove={beginBriefFramePointer}
            onUpdateBriefField={updateBriefField}
            onAddReference={addBriefReference}
            onUpdateReference={updateBriefReference}
            onRemoveReference={removeBriefReference}
            onAddDecision={addConfirmedDecision}
            onUpdateDecision={updateConfirmedDecision}
            onRemoveDecision={removeConfirmedDecision}
          />
        ) : null}
        {frames.map((frame) => (
          <FrameView
            key={frame.id}
            frame={frame}
            isLive={liveFrameIdSet.has(frame.id)}
            isSelected={frame.id === selectedFrameId}
            isPanTool={activeTool === "hand" || spacePressed}
            onSelect={setSelectedFrameId}
            onStartMove={beginFramePointer}
            onStartPan={beginCanvasPan}
            onBridgeEvent={handleBridgeEvent}
            onBridgeInspection={handleBridgeInspection}
            onBridgeSnapshot={handleBridgeSnapshot}
            onBridgeController={handleBridgeController}
            isCreationMode={creationMode && frame.id === selectedFrameId}
            onCreationPointerDown={beginCreationPointer}
            onCreationPointerMove={moveCreationPointer}
            onCreationPointerUp={finishCreationPointer}
            onCreationPointerCancel={cancelCreationPointer}
          />
        ))}
        <NodeOverlayLayer
          zoom={camera.zoom}
          hoveredTarget={hoveredOverlayTarget}
          selectedTargets={selectedOverlayTargets}
          interactive={!creationMode}
          guides={alignmentGuides}
          onGestureStart={beginNodeGesture}
          onGestureMove={moveNodeGesture}
          onGestureEnd={endNodeGesture}
          onTextEditStart={startTextEdit}
        />
        {comments.map((comment) => {
          const frame = frames.find((entry) => entry.id === comment.frameId);
          if (!frame) return null;
          return (
            <div key={comment.id}>
              <button
                aria-label={comment.body ? `Canvas comment: ${comment.body}` : "Canvas comment: Add a note"}
                className="canvas-comment-marker"
                data-canvas-control
                data-comment-status={comment.status}
                data-testid="comment-marker"
                onClick={(event) => {
                  event.stopPropagation();
                  selectComment(comment.id);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                style={{ left: frame.x + comment.point.x, top: frame.y + comment.point.y }}
                title={comment.body || "Add a note"}
                type="button"
              >
                <span>{comment.status === "resolved" ? "✓" : "•"}</span>
              </button>
              {selectedCommentId === comment.id ? (
                <CommentPopover
                  comment={comment}
                  feedback={commentFeedback}
                  onClose={() => selectComment(null)}
                  onDelete={deleteComment}
                  onSave={updateComment}
                  onToggleResolved={toggleCommentResolved}
                  style={{ left: frame.x + comment.point.x + 18, top: frame.y + comment.point.y + 18 }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {guardIframes ? (
        <div
          className="canvas-input-shield"
          data-testid="canvas-camera-overlay"
          aria-hidden="true"
        />
      ) : null}

      {isEmptyState ? (
        <EmptyCanvasState onStartBrainstorming={startBrainstorming} />
      ) : null}

      <WorkspaceHeader
        frameCount={frames.length}
        projectMeta={briefFrame ? `${frames.length} frames · Brainstorming` : undefined}
        projectName={isEmptyState ? "Untitled canvas" : briefFrame ? "Project brief" : undefined}
        canExport={editorState.session.lifecycle !== "not-started"}
        onImportFile={importProject}
        onExport={exportProject}
        persistenceFeedback={persistenceFeedback}
      />
      {showDesignChrome ? (
        <CanvasDock
          zoom={camera.zoom}
          activeTool={activeTool}
          temporaryHand={spacePressed}
          isFrameMenuOpen={isFrameMenuOpen}
          canUndo={editorStore.canUndo()}
          canRedo={editorStore.canRedo()}
          onAddFrame={addFrame}
          onFit={fitAllFrames}
          onZoomIn={() => zoomAtViewportCenter(1.22)}
          onZoomOut={() => zoomAtViewportCenter(1 / 1.22)}
          onSelectTool={setActiveTool}
          activeShape={activeShape}
          onSelectShape={(shape) => { setActiveShape(shape); setActiveTool("rectangle"); }}
          onToggleFrameMenu={toggleFrameMenu}
          onCloseFrameMenu={() => setIsFrameMenuOpen(false)}
          onUndo={() => {
            if (!editorStore.hasActiveTransaction()) editorStore.undo();
          }}
          onRedo={() => {
            if (!editorStore.hasActiveTransaction()) editorStore.redo();
          }}
        />
      ) : null}

      {creationMode ? (
        <div
          className={`creation-mode-status${creationError ? " is-error" : ""}`}
          data-canvas-control
          data-testid="creation-mode-status"
          role={creationError ? "alert" : "status"}
        >
          <strong>{creationToolLabel(activeTool, activeShape)} mode</strong>
          <span>{creationError ?? (selectedFrameId
            ? activeTool === "image"
              ? "Drag inside the active frame, then choose a local image."
              : `Drag inside ${frames.find((frame) => frame.id === selectedFrameId)?.name ?? "the active frame"}.`
            : "Select a live frame to begin.")}</span>
          {activeTool === "image" ? (
            <button data-testid="choose-image-button" onClick={openImagePicker} type="button">
              Choose image
            </button>
          ) : null}
        </div>
      ) : null}

      <input
        ref={imageInputRef}
        accept="image/*"
        aria-label="Choose local image"
        className="canvas-image-input"
        data-testid="canvas-image-input"
        onChange={handleImageFile}
        type="file"
      />
      {sampledColor ? (
        <div className="eyedropper-readout" data-testid="eyedropper-readout" role="status">
          <span className="eyedropper-swatch" style={{ background: sampledColor }} />
          <span>{sampledColor}</span>
        </div>
      ) : null}
      {commentFeedback && selectedCommentId === null ? (
        <div className="comment-feedback-toast" data-testid="comment-feedback" data-canvas-control role="status">
          {commentFeedback}
        </div>
      ) : null}

      {showDesignChrome ? (
        <>
          <LeftSidebar
            pages={Object.values(editorState.pages)}
            activePageId={editorState.activePageId}
            frames={allFrames}
            hierarchies={bridgeHierarchies}
            nodes={editorState.nodes}
            selection={editorState.selection}
            onCreatePage={createPage}
            onRenamePage={renamePage}
            onSwitchPage={switchPage}
            onSelectNode={selectNode}
            onRenameNode={renameNode}
            onToggleNodeLock={toggleNodeLock}
            onToggleNodeHidden={toggleNodeHidden}
            onReorderNode={(nodeId, direction) => editorStore.execute({ type: "node/reorder", nodeId, direction })}
          />
          <PropertiesPanel
            frames={editorState.frames}
            nodes={editorState.nodes}
            selection={editorState.selection}
            bridgeTargets={bridgeTargets}
            onUpdateFrame={updateFrameFromPanel}
            onMoveFrame={moveFrameFromPanel}
            onEditNodeStyle={editNodeStyle}
            onEditNodePosition={editNodePosition}
          />
        </>
      ) : null}

      <div className="canvas-help" aria-hidden="true">
        <span><kbd>Space</kbd> drag to pan</span>
        <span>Pinch to zoom</span>
        <span><kbd>0</kbd> fit all</span>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {frames.length} frames, {liveFrameIds.length} live, {Math.round(camera.zoom * 100)}% zoom
      </div>
    </main>
  );
}
