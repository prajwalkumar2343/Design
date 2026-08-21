import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
  updateBriefFieldCommand,
} from "../editor/commands";
import {
  createEditorStateFromFrameSeeds,
  createEmptyEditorState,
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
import { normalizedBounds, shapeDragPoints, shapeLabel } from "../frame/shape-geometry";
import { useBrainstormSessionController } from "./brainstorm-session-controller";
import { ProjectLake } from "./ProjectLake";
import {
  looksLikeHtml,
  pasteHtmlIntoStore,
  preparePastedHtml,
  resolvePastedFrameSize,
} from "../clipboard/paste-html";
import {
  BrowserPersistenceAdapter,
  FIGMA_FILE_MIME_TYPE,
  FIGMA_FILE_NAME,
  importWireCanvasProject,
  serializeFigmaProject,
  serializeWireCanvasProject,
  WIRECANVAS_FILE_MIME_TYPE,
  WIRECANVAS_FILE_NAME,
  WireCanvasCodecError,
  type BrowserDownloadAdapter,
  type PersistenceAdapter,
} from "../persistence";
import {
  createProjectId,
  deleteLocalProject,
  deriveProjectName,
  duplicateLocalProject,
  getActiveProjectId,
  getBriefPresetForKind,
  getLocalProjectSummaries,
  hydrateInitialState,
  loadProjectIndex,
  renameLocalProject,
  saveProjectIndex,
  setActiveProjectId,
  PROJECT_KINDS,
  type LocalProjectSummary,
  type ProjectKind,
} from "../persistence/local-projects";
import { parseWireCanvasProject } from "../persistence/wirecanvas";
import {
  buildProjectUrl,
  getProjectIdFromUrl,
  navigateToHome,
  navigateToProject,
} from "../routing";
import {
  NodeOverlayLayer,
  type OverlayNodeTarget,
} from "../overlay/NodeOverlayLayer";
import { parseTransform } from "../overlay/commands";
import {
  useNodeOverlayGestures,
  type NodeInteractionMode,
  type OverlayBridgeTargetState,
} from "../overlay/useNodeOverlayGestures";
import {
  cameraAtZoomProgress,
  cameraTransform,
  fitRect,
  panCamera,
  revealCamera,
  screenToWorld,
  worldToScreen,
  zoomCameraAtPoint,
  ZOOM_SMOOTH_STEPS,
} from "./camera";
import type { Camera, CanvasFrame, Point, Rect, Size } from "./types";

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
};

type PointerOperation =
  | { type: "pan"; pointerId: number; last: Point }
  | { type: "move-frame"; pointerId: number; last: Point; frameId: string; start: Point; frameStart: Point }
  | { type: "move-brief-frame"; pointerId: number; last: Point; briefFrameId: string; start: Point; briefStart: Point };

type CreationOperation =
  | { type: "box"; tool: "rectangle" | "text" | "image"; frameId: string; pointerId: number; start: Point; last: Point };

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

function isCreationTool(tool: ToolId): boolean {
  return tool === "rectangle" || tool === "text" || tool === "image" || tool === "comment";
}

function creationToolLabel(tool: ToolId, shape: ShapeVariantId): string {
  if (tool === "rectangle") return shapeLabel(shape);
  return tool[0].toUpperCase() + tool.slice(1);
}

/**
 * A text drag that never moved produces the shared 16px minimum box. Give
 * click-created text a real wrapping width so it reads horizontally instead of
 * collapsing into a single-character column.
 */
function textPlacementBounds(bounds: Rect): Rect {
  if (bounds.width <= 16) return { ...bounds, width: 240 };
  return bounds;
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

/**
 * Center point for a new frame: the viewport center on an empty canvas,
 * otherwise to the right of the existing frames.
 */
function computeFramePlacement(
  frames: readonly Rect[],
  viewport: Size,
  camera: Camera,
  size: Size,
): Point {
  const viewportCenter = screenToWorld(
    { x: viewport.width / 2, y: viewport.height / 2 },
    camera,
  );
  if (frames.length === 0) {
    return viewportCenter;
  }
  return {
    x: Math.max(...frames.map((frame) => frame.x + frame.width)) + 140 + size.width / 2,
    y: Math.min(...frames.map((frame) => frame.y)) + size.height / 2,
  };
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
  disableLocalPersistence?: boolean;
}

export function CanvasSurface({
  frames: suppliedFrames = [],
  persistenceAdapter,
  downloadAdapter,
  disableLocalPersistence = false,
}: CanvasSurfaceProps) {
  const isDemoMode =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";
  const shouldUseLocalMemory = !disableLocalPersistence && !isDemoMode;

  const surfaceRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const editorStoreRef = useRef<EditorStore | null>(null);
  const initialHydrationRef = useRef<ReturnType<typeof hydrateInitialState> | null>(null);
  if (editorStoreRef.current === null) {
    let initialState;
    if (suppliedFrames.length > 0) {
      initialState = createEditorStateFromFrameSeeds(suppliedFrames);
    } else if (shouldUseLocalMemory) {
      const hydrated = hydrateInitialState(suppliedFrames, { disablePersistence: false });
      initialState = hydrated.state;
      initialHydrationRef.current = hydrated;
    } else {
      initialState = createEditorStateFromFrameSeeds(suppliedFrames);
    }
    editorStoreRef.current = createEditorStore(initialState);
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
  const surfaceRectRef = useRef<DOMRect | null>(null);
  const updateSurfaceRect = useCallback(() => {
    const surface = surfaceRef.current;
    if (surface) surfaceRectRef.current = surface.getBoundingClientRect();
  }, []);
  const getCachedPointerPosition = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = surfaceRectRef.current;
    if (rect) return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const surface = surfaceRef.current;
    if (!surface) return { x: event.clientX, y: event.clientY };
    const bounds = surface.getBoundingClientRect();
    surfaceRectRef.current = bounds;
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }, []);
  const pointerRef = useRef<PointerOperation | null>(null);
  const creationRef = useRef<CreationOperation | null>(null);
  const pendingImageRef = useRef<PendingImagePlacement | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const clipboardTargetRef = useRef<{ frameId: string; nodeId: string } | null>(null);
  const frameTextEditRef = useRef<Set<string>>(new Set());
  const spacePressedRef = useRef(false);
  const cameraInitializedRef = useRef(false);
  const motionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelRafRef = useRef<number | null>(null);
  const nextFrameSequenceRef = useRef(suppliedFrames.length + 1);
  const frameDragRef = useRef<{ elementKey: string; transform: string } | null>(null);
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
  const [sidebarHoveredNode, setSidebarHoveredNode] = useState<{ frameId: string; nodeId: string } | null>(null);
  const selectedFrameId = editorState.selection.primaryFrameId;
  const selectedBriefFrameId = editorState.session.selection.type === "brief-frame"
    ? editorState.session.selection.briefFrameId
    : null;
  const [interactionMode, setInteractionMode] = useState<NodeInteractionMode>("idle");
  const interactionModeRef = useRef<NodeInteractionMode>(interactionMode);
  useEffect(() => { interactionModeRef.current = interactionMode; }, [interactionMode]);
  const hoverRafRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<OverlayNodeTarget | null | undefined>(undefined);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isFrameMenuOpen, setIsFrameMenuOpen] = useState(false);
  const [activeShape, setActiveShape] = useState<ShapeVariantId>("rectangle");
  const [shapeRadius, setShapeRadius] = useState(0);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const pasteFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [persistenceVersion, setPersistenceVersion] = useState(0);
  const [persistenceFeedback, setPersistenceFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [localProjects, setLocalProjects] = useState<LocalProjectSummary[]>(() =>
    shouldUseLocalMemory ? getLocalProjectSummaries() : [],
  );
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(() =>
    shouldUseLocalMemory ? getActiveProjectId() : null,
  );
  const [showLakeOverlay, setShowLakeOverlay] = useState(false);
  const [routeProjectId, setRouteProjectId] = useState<string | null>(() => {
    if (!shouldUseLocalMemory) return null;
    if (initialHydrationRef.current) return initialHydrationRef.current.urlProjectId;
    return getProjectIdFromUrl();
  });
  const [routeNotFound, setRouteNotFound] = useState<boolean>(() => {
    if (!shouldUseLocalMemory) return false;
    if (initialHydrationRef.current) return initialHydrationRef.current.notFound;
    const id = getProjectIdFromUrl();
    if (!id) return false;
    return !loadProjectIndex().some((p) => p.id === id);
  });
  const pendingKindRef = useRef<ProjectKind | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSerializedRef = useRef<string | null>(null);
  const {
    comments,
    selectedCommentId,
    feedback: commentFeedback,
    addComment,
    selectComment,
    updateComment,
    deleteComment,
    clearComments,
  } = useComments(editorStore);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const activeTool = normalizeActiveTool(editorState.activeTool);
  const activeToolRef = useRef<ToolId>(activeTool);
  const activeShapeRef = useRef<ShapeVariantId>(activeShape);
  const shapeRadiusRef = useRef(shapeRadius);
  activeToolRef.current = activeTool;
  activeShapeRef.current = activeShape;
  shapeRadiusRef.current = shapeRadius;
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
    startBrainstorming: startBrainstormingBase,
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

  const refreshLocalProjects = useCallback(() => {
    if (!shouldUseLocalMemory) return;
    setLocalProjects(getLocalProjectSummaries());
    setActiveProjectIdState(getActiveProjectId());
  }, [shouldUseLocalMemory]);

  const startBrainstorming = useCallback(
    (kindOverride?: ProjectKind) => {
      const kind = kindOverride ?? pendingKindRef.current ?? "blank";
      pendingKindRef.current = null;
      if (kind !== "blank") {
        const preset = getBriefPresetForKind(kind);
        startBrainstormingBase();
        try {
          if (preset.projectDescription) {
            editorStore.execute(updateBriefFieldCommand({ field: "projectDescription", value: preset.projectDescription }, editorStore.getState().session.revision), { label: "Apply preset: projectDescription" });
          }
          if (preset.audience) {
            editorStore.execute(updateBriefFieldCommand({ field: "audience", value: preset.audience }, editorStore.getState().session.revision), { label: "Apply preset: audience" });
          }
          if (preset.goals) {
            editorStore.execute(updateBriefFieldCommand({ field: "goals", value: preset.goals }, editorStore.getState().session.revision), { label: "Apply preset: goals" });
          }
          if (preset.visualDirection) {
            editorStore.execute(updateBriefFieldCommand({ field: "visualDirection", value: preset.visualDirection }, editorStore.getState().session.revision), { label: "Apply preset: visualDirection" });
          }
        } catch {}
        if (shouldUseLocalMemory) {
          const idx = loadProjectIndex();
          const active = getActiveProjectId();
          const rec = active ? idx.find((p) => p.id === active) : undefined;
          if (rec && rec.kind !== kind) {
            rec.kind = kind;
            saveProjectIndex(idx);
            refreshLocalProjects();
          }
        }
        return;
      }
      startBrainstormingBase();
    },
    [shouldUseLocalMemory, startBrainstormingBase, refreshLocalProjects, editorStore],
  );

  const handleCreateLakeProject = useCallback(
    (kind: ProjectKind) => {
      pendingKindRef.current = kind;
      let createdId: string | null = null;
      if (shouldUseLocalMemory) {
        const id = createProjectId();
        createdId = id;
        const name = `${PROJECT_KINDS.find((k) => k.id === kind)?.label ?? kind} · ${new Date().toLocaleDateString()}`;
        const blank = createEmptyEditorState();
        const serialized = serializeWireCanvasProject(blank);
        const record = {
          id,
          name: name.slice(0, 80),
          kind,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          frameCount: 0,
          lifecycle: "not-started" as const,
          data: serialized,
        };
        const idx = loadProjectIndex();
        idx.unshift(record);
        saveProjectIndex(idx);
        setActiveProjectId(id);
        setActiveProjectIdState(id);
        setRouteProjectId(id);
        setRouteNotFound(false);
        navigateToProject(id);
        refreshLocalProjects();
        try {
          const next = parseWireCanvasProject(serialized);
          editorStore.replaceState(next, { label: "New project" });
          setPersistenceVersion((v) => v + 1);
          bridgeControllersRef.current.clear();
          snapshotQueuesRef.current.clear();
          snapshotSequenceRef.current.clear();
          setBridgeTargets({});
          setBridgeHierarchies({});
        } catch {}
      }
      setShowLakeOverlay(false);
      if (shouldUseLocalMemory && createdId) {
        const targetId = createdId;
        setTimeout(() => {
          startBrainstorming(kind);
          setTimeout(() => {
            try {
              const state = editorStore.getState();
              const serialized = serializeWireCanvasProject(state);
              const idxNow = loadProjectIndex();
              const recNow = idxNow.find((p) => p.id === targetId);
              if (recNow) {
                recNow.data = serialized;
                recNow.updatedAt = Date.now();
                recNow.frameCount = Object.keys(state.frames).length;
                recNow.lifecycle = state.session.lifecycle;
                saveProjectIndex([recNow, ...idxNow.filter((p) => p.id !== recNow.id)]);
                refreshLocalProjects();
              }
            } catch {}
          }, 80);
        }, 30);
      } else {
        setTimeout(() => startBrainstorming(kind), 30);
      }
    },
    [shouldUseLocalMemory, editorStore, refreshLocalProjects, startBrainstorming],
  );

  const handleOpenLakeProject = useCallback(
    (id: string) => {
      const idx = loadProjectIndex();
      const rec = idx.find((p) => p.id === id);
      if (!rec) {
        setPersistenceFeedback({ kind: "error", message: "That project could not be found in this browser." });
        refreshLocalProjects();
        return;
      }
      try {
        const next = parseWireCanvasProject(rec.data);
        clearComments();
        bridgeControllersRef.current.clear();
        snapshotQueuesRef.current.clear();
        snapshotSequenceRef.current.clear();
        setBridgeTargets({});
        setBridgeHierarchies({});
        editorStore.replaceState(next, { label: `Open ${rec.name}` });
        setActiveProjectId(id);
        setActiveProjectIdState(id);
        setRouteProjectId(id);
        setRouteNotFound(false);
        navigateToProject(id);
        const filtered = idx.filter((p) => p.id !== id);
        filtered.unshift({ ...rec, updatedAt: Date.now() });
        saveProjectIndex(filtered);
        refreshLocalProjects();
        setPersistenceVersion((v) => v + 1);
        setShowLakeOverlay(false);
        setPersistenceFeedback({ kind: "success", message: `Opened “${rec.name}”. Continuing where you left off.` });
        setTimeout(() => {
          const state = editorStore.getState();
          const rects: Array<{ x: number; y: number; width: number; height: number }> = [
            ...Object.values(state.frames).map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
          ];
          if (state.session.briefFrame) rects.push(state.session.briefFrame);
          if (rects.length > 0 && surfaceRef.current) {
            const vp = { width: surfaceRef.current.clientWidth, height: surfaceRef.current.clientHeight };
            if (vp.width > 0 && vp.height > 0) {
              const left = Math.min(...rects.map((r) => r.x));
              const top = Math.min(...rects.map((r) => r.y));
              const right = Math.max(...rects.map((r) => r.x + r.width));
              const bottom = Math.max(...rects.map((r) => r.y + r.height));
              const bounds = { x: left, y: top, width: right - left, height: bottom - top };
              const nextCam = fitRect(bounds, vp, vp.width < 760 ? 18 : 148);
              cameraRef.current = nextCam;
              setCamera(nextCam);
            }
          }
        }, 80);
      } catch (error) {
        setPersistenceFeedback({
          kind: "error",
          message: `Could not open project: ${error instanceof Error ? error.message : "parse failed"}`,
        });
      }
    },
    [clearComments, editorStore, refreshLocalProjects],
  );

  const handleDeleteLakeProject = useCallback(
    (id: string) => {
      const isActive = getActiveProjectId() === id || routeProjectId === id;
      const nextIdx = deleteLocalProject(id);
      setLocalProjects(nextIdx.map(({ data: _d, ...rest }) => rest));
      if (isActive) {
        const nextActive = getActiveProjectId();
        setActiveProjectIdState(nextActive);
        setRouteProjectId(null);
        setRouteNotFound(false);
        navigateToHome();
        editorStore.replaceState(createEmptyEditorState(), { label: "Delete active project" });
        setPersistenceVersion((v) => v + 1);
        bridgeControllersRef.current.clear();
        setBridgeTargets({});
        setBridgeHierarchies({});
        setPersistenceFeedback({ kind: "success", message: "Project deleted. Returned to home." });
      } else {
        setPersistenceFeedback({ kind: "success", message: "Project deleted." });
      }
    },
    [editorStore, routeProjectId],
  );

  const handleDuplicateLakeProject = useCallback(
    (id: string) => {
      const dup = duplicateLocalProject(id);
      if (!dup) {
        setPersistenceFeedback({ kind: "error", message: "Could not duplicate that project." });
        return;
      }
      refreshLocalProjects();
      setPersistenceFeedback({ kind: "success", message: `Duplicated as “${dup.name}”.` });
    },
    [refreshLocalProjects],
  );

  const handleRenameLakeProject = useCallback(
    (id: string, name: string) => {
      renameLocalProject(id, name);
      refreshLocalProjects();
      setPersistenceFeedback({ kind: "success", message: "Project renamed." });
    },
    [refreshLocalProjects],
  );

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

  const exportFigmaProject = useCallback(async () => {
    if (editorStore.getState().session.lifecycle === "not-started") {
      setPersistenceFeedback({ kind: "error", message: "Start a brainstorming session before exporting." });
      return;
    }
    try {
      const state = editorStore.getState();
      const bytes = await serializeFigmaProject({
        frames: Object.values(state.frames),
        nodes: state.nodes,
        bridgeTargets,
      });
      downloadAdapterRef.current?.downloadProjectFile({
        text: bytes,
        filename: FIGMA_FILE_NAME,
        mimeType: FIGMA_FILE_MIME_TYPE,
      });
      setPersistenceFeedback({ kind: "success", message: "Project exported as a Figma .fig file." });
    } catch (error) {
      setPersistenceFeedback({
        kind: "error",
        message: `Could not export Figma file: ${error instanceof Error ? error.message : "download failed"}`,
      });
    }
  }, [bridgeTargets, editorStore]);

  const importProject = useCallback(async (file: File) => {
    try {
      const text = await persistenceAdapterRef.current!.readProjectFile(file);
      const result = importWireCanvasProject(editorStore, text);
      if (result.changed) {
        clearComments();
        bridgeControllersRef.current.clear();
        snapshotQueuesRef.current.clear();
        snapshotSequenceRef.current.clear();
        setBridgeTargets({});
        setBridgeHierarchies({});
        setPersistenceVersion((current) => current + 1);
        setPersistenceFeedback({ kind: "success", message: "Project imported successfully." });
        if (shouldUseLocalMemory) {
          const state = editorStore.getState();
          const serialized = serializeWireCanvasProject(state);
          const active = getActiveProjectId();
          const idx = loadProjectIndex();
          const existing = active ? idx.find((p) => p.id === active) : undefined;
          if (existing) {
            existing.data = serialized;
            existing.updatedAt = Date.now();
            existing.frameCount = Object.keys(state.frames).length;
            existing.lifecycle = state.session.lifecycle;
            saveProjectIndex([existing, ...idx.filter((p) => p.id !== existing.id)]);
            // keep current route if already on a project, otherwise navigate to it
            if (!getProjectIdFromUrl()) {
              setRouteProjectId(existing.id);
              setRouteNotFound(false);
              navigateToProject(existing.id);
            }
          } else {
            const id = createProjectId();
            const kind: ProjectKind = "blank";
            const name = deriveProjectName(state, kind);
            const rec = {
              id,
              name: name.slice(0, 80),
              kind,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              frameCount: Object.keys(state.frames).length,
              lifecycle: state.session.lifecycle,
              data: serialized,
            };
            idx.unshift(rec);
            saveProjectIndex(idx);
            setActiveProjectId(id);
            setActiveProjectIdState(id);
            setRouteProjectId(id);
            setRouteNotFound(false);
            navigateToProject(id);
          }
          refreshLocalProjects();
        }
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
  }, [clearComments, editorStore, shouldUseLocalMemory, refreshLocalProjects]);

  // Continuous memory autosave — every meaningful editor change is persisted to this device
  useEffect(() => {
    if (!shouldUseLocalMemory) return;
    const schedule = () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(() => {
        try {
          const state = editorStore.getState();
          const isEmpty =
            state.session.lifecycle === "not-started" &&
            Object.keys(state.documents).length === 0 &&
            Object.keys(state.frames).length === 0 &&
            Object.keys(state.pages).length === 0;
          if (isEmpty) return;
          const serialized = serializeWireCanvasProject(state);
          if (serialized === lastSerializedRef.current) return;
          lastSerializedRef.current = serialized;
          const active = getActiveProjectId();
          const idx = loadProjectIndex();
          let rec = active ? idx.find((p) => p.id === active) : undefined;
          if (!rec) {
            const fallbackKind: ProjectKind = pendingKindRef.current ?? "blank";
            const name = deriveProjectName(state, fallbackKind);
            const newId = createProjectId();
            const newRec = {
              id: newId,
              name: name.slice(0, 80) || "Untitled project",
              kind: fallbackKind,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              frameCount: Object.keys(state.frames).length,
              lifecycle: state.session.lifecycle,
              data: serialized,
            };
            idx.unshift(newRec);
            saveProjectIndex(idx);
            setActiveProjectId(newId);
            setActiveProjectIdState(newId);
            setRouteProjectId(newId);
            setRouteNotFound(false);
            navigateToProject(newId);
            setLocalProjects(idx.map(({ data: _d, ...rest }) => rest));
            return;
          }
          rec.data = serialized;
          rec.updatedAt = Date.now();
          rec.frameCount = Object.keys(state.frames).length;
          rec.lifecycle = state.session.lifecycle;
          const without = idx.filter((p) => p.id !== rec!.id);
          without.unshift(rec);
          saveProjectIndex(without);
          setLocalProjects(without.map(({ data: _d, ...rest }) => rest));
        } catch {}
      }, 650);
    };
    const unsub = editorStore.subscribe(schedule);
    // initial schedule in case hydrated state is already non-empty
    schedule();
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      unsub();
    };
  }, [editorStore, shouldUseLocalMemory]);

  // Keep lake index in sync when storage changes in another tab
  useEffect(() => {
    if (!shouldUseLocalMemory) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("wirecanvas:")) refreshLocalProjects();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [shouldUseLocalMemory, refreshLocalProjects]);

  // Project URL routing — keep route in sync with browser history
  useEffect(() => {
    if (!shouldUseLocalMemory) return;
    const onPopState = () => {
      const nextId = getProjectIdFromUrl();
      setRouteProjectId(nextId);
      if (nextId) {
        const state = loadProjectIndex().find((p) => p.id === nextId);
        if (state) {
          setRouteNotFound(false);
          try {
            const next = parseWireCanvasProject(state.data);
            clearComments();
            bridgeControllersRef.current.clear();
            snapshotQueuesRef.current.clear();
            snapshotSequenceRef.current.clear();
            setBridgeTargets({});
            setBridgeHierarchies({});
            editorStore.replaceState(next, { label: `Navigate to ${state.name}` });
            setActiveProjectId(nextId);
            setActiveProjectIdState(nextId);
            setPersistenceVersion((v) => v + 1);
            // Fit camera after navigation
            setTimeout(() => {
              const s = editorStore.getState();
              const rects: Array<{ x: number; y: number; width: number; height: number }> = [
                ...Object.values(s.frames).map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })),
              ];
              if (s.session.briefFrame) rects.push(s.session.briefFrame);
              if (rects.length > 0 && surfaceRef.current) {
                const vp = { width: surfaceRef.current.clientWidth, height: surfaceRef.current.clientHeight };
                if (vp.width > 0 && vp.height > 0) {
                  const left = Math.min(...rects.map((r) => r.x));
                  const top = Math.min(...rects.map((r) => r.y));
                  const right = Math.max(...rects.map((r) => r.x + r.width));
                  const bottom = Math.max(...rects.map((r) => r.y + r.height));
                  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
                  const nextCam = fitRect(bounds, vp, vp.width < 760 ? 18 : 148);
                  cameraRef.current = nextCam;
                  setCamera(nextCam);
                }
              }
            }, 80);
          } catch {
            setRouteNotFound(true);
          }
        } else {
          setRouteNotFound(true);
        }
      } else {
        setRouteNotFound(false);
      }
      refreshLocalProjects();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [shouldUseLocalMemory, editorStore, clearComments, refreshLocalProjects]);

  const toOverlayTarget = useCallback(
    (entry: OverlayBridgeTargetState): OverlayNodeTarget | null => {
      const frame = editorStore.getState().frames[entry.frameId];
      if (!frame) return null;
      const transform = entry.inspection?.inlineStyle.transform ?? entry.inspection?.computedStyle.transform;
      const parsedRotation = transform ? parseTransform(transform)?.rotation ?? 0 : 0;
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
        rotation: parsedRotation || undefined,
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
      bounds: kind === "text" ? textPlacementBounds(bounds) : bounds,
      ...(kind === "text" ? { text: "Type to edit", editable: true } : { points: shapeDragPoints(shape, operation.start, point) }),
      fill: kind === "text" ? "#171717" : "#d9d9d9",
      stroke: kind === "text" ? "#171717" : "#222222",
      strokeWidth: 2,
      radius: shapeRadiusRef.current,
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

      if (message.event === "text-edit-start") frameTextEditRef.current.add(frameId);
      else if (message.event === "text-commit" || message.event === "text-cancel") frameTextEditRef.current.delete(frameId);

      const currentTool = activeToolRef.current;
      const currentShape = activeShapeRef.current;
      const isCreationToolActive = isCreationTool(currentTool);
      if (message.event === "pointerdown" && isCreationToolActive) {
        if (currentTool === "comment") {
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
            bounds: kind === "text" ? textPlacementBounds(bounds) : bounds,
            ...(kind === "text" ? { text: "Type to edit", editable: true } : { points: shapeDragPoints(currentShape, operation.start, message.point) }),
            fill: kind === "text" ? "#171717" : "#d9d9d9",
            stroke: kind === "text" ? "#171717" : "#222222",
            strokeWidth: 2,
            radius: shapeRadiusRef.current,
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
        if (!frameTextEditRef.current.has(frameId) && (message.metaKey || message.ctrlKey)) {
          const action = resolveEditorShortcut({
            key: message.key ?? "",
            metaKey: message.metaKey,
            ctrlKey: message.ctrlKey,
            shiftKey: message.shiftKey,
            altKey: message.altKey,
          });
          if (action?.type === "undo" || action?.type === "redo") {
            if (!editorStore.hasActiveTransaction()) {
              if (action.type === "undo") editorStore.undo();
              else editorStore.redo();
            }
            return;
          }
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
          const hadActiveTransaction = editorStore.hasActiveTransaction();
          if (!hadActiveTransaction) editorStore.beginTransaction("Edit text");
          if (node) {
            editorStore.execute({
              type: "node/update",
              nodeId: message.target!.elementId,
              patch: { name: nextText.slice(0, 80) || "Text" },
            }, { history: "skip" });
          }
          if (hadActiveTransaction) return refreshSnapshotRef.current(frameId);
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
      if (message.event === "select" && currentTool !== "select") return;

      // Suppress hover during pan/zoom for smoothness — Figma does this
      if (message.event === "hover" && interactionModeRef.current !== "idle" && interactionModeRef.current !== "creating") {
        return;
      }

      const surfaceRect = surfaceRectRef.current ?? surface.getBoundingClientRect();
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

      if (message.event !== "pointermove" && message.target) {
        const mappedPoint = mapIframePointToCanvas(message.point, context);
        lastBridgeTargetRef.current = {
          frameId,
          elementId: message.target.elementId,
          screen: mappedPoint.screen,
          world: mappedPoint.world,
          bounds: mapIframeRectToCanvas(message.target.bounds, context),
        };
        // Batch bridge target updates — hover is high frequency, avoid React thrash
        if (message.event === "hover") {
          const nextHover = toOverlayTarget({ frameId, target: message.target, inspection: null });
          pendingHoverRef.current = nextHover;
          if (hoverRafRef.current === null) {
            hoverRafRef.current = requestAnimationFrame(() => {
              hoverRafRef.current = null;
              const pending = pendingHoverRef.current;
              pendingHoverRef.current = undefined;
              if (pending !== undefined) {
                setHoveredOverlayTarget(pending);
                // Also update bridgeTargets for hover, but throttled
                if (pending) {
                  setBridgeTargets((current) => {
                    const key = targetStateKey(frameId, pending.frameId === frameId ? pending.nodeId : message.target!.elementId);
                    // Use message.target for key to avoid mismatch
                    const k = targetStateKey(frameId, message.target!.elementId);
                    return {
                      ...current,
                      [k]: {
                        frameId,
                        target: message.target!,
                        inspection: current[k]?.inspection ?? null,
                      },
                    };
                  });
                }
              }
            });
          }
          return;
        }
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
      } else if (message.event !== "pointermove") {
        lastBridgeTargetRef.current = null;
        if (message.event === "hover") {
          pendingHoverRef.current = null;
          if (hoverRafRef.current === null) {
            hoverRafRef.current = requestAnimationFrame(() => {
              hoverRafRef.current = null;
              setHoveredOverlayTarget(null);
            });
          } else {
            pendingHoverRef.current = null;
          }
        }
      }

      if (message.event !== "select" || !message.target) return;

      const existingNode = editorStore.getState().nodes[message.target.elementId];
      const node: NodeEntity = {
        id: message.target.elementId,
        documentId: frame.documentId,
        parentId: existingNode?.parentId ?? null,
        kind: "element",
        name: existingNode?.name ?? message.target.name,
        tagName: message.target.tagName,
        attributes: existingNode?.attributes ?? (message.target.role ? { role: message.target.role } : {}),
        childIds: existingNode?.childIds ?? [],
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
        setBridgeTargets((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([key]) => !key.startsWith(`${frameId}:`)),
          ),
        );
        setBridgeHierarchies((current) => {
          const next = { ...current };
          delete next[frameId];
          return next;
        });
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
    let hadActiveTransaction = false;
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
      hadActiveTransaction = editorStore.hasActiveTransaction();
      if (!hadActiveTransaction) editorStore.beginTransaction(label);
      editorStore.execute({ type: "node/upsert", node }, { history: "skip" });
      editorStore.execute(setSelectionCommand({
        frameIds: [frameId],
        nodeIds: [target.elementId],
        primaryFrameId: frameId,
        primaryNodeId: target.elementId,
      }), { history: "skip" });
      const replay = ack.replay;
      if (!hadActiveTransaction) {
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
      }
      await refreshBridgeSnapshot(frameId);
      setCreationError(null);
      if (command.kind !== "text" && command.kind !== "image" && command.kind !== "path") {
        editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
      }
      return true;
    } catch (error) {
      if (!hadActiveTransaction && editorStore.hasActiveTransaction()) editorStore.rollbackTransaction();
      const detail = error instanceof Error ? error.message : "the bridge rejected the request";
      setCreationError(`Could not ${label.toLowerCase()}: ${detail}`);
      return false;
    }
  }, [bridgeControllersRef, editorStore, refreshBridgeSnapshot]);
  createLiveElementRef.current = createLiveElement;

  const radiusSelection = useMemo(() => {
    const nodeId = editorState.selection.primaryNodeId ?? editorState.selection.nodeIds[0];
    const frameId = editorState.selection.primaryFrameId;
    if (!nodeId || !frameId) return null;
    const entry = bridgeTargets[targetStateKey(frameId, nodeId)];
    if (entry?.inspection?.attributes["data-design-tool-kind"] !== "rectangle") return null;
    return {
      frameId,
      targetId: nodeId,
      radius: Number(entry.inspection.attributes["data-design-tool-radius"] ?? 0),
    };
  }, [bridgeTargets, editorState.selection]);

  const radiusSelectionRef = useRef(radiusSelection);
  radiusSelectionRef.current = radiusSelection;
  const radiusDragRef = useRef<{
    frameId: string;
    targetId: string;
    previousRadius: number;
    lastRadius: number;
  } | null>(null);

  const changeShapeRadius = useCallback((next: number) => {
    const radius = Math.max(0, Math.min(48, Math.round(next)));
    setShapeRadius(radius);
    const selection = radiusSelectionRef.current;
    if (!selection) return;
    if (!radiusDragRef.current) {
      radiusDragRef.current = { ...selection, previousRadius: selection.radius, lastRadius: selection.radius };
    }
    radiusDragRef.current.lastRadius = radius;
    const controller = bridgeControllersRef.current.get(selection.frameId);
    if (!controller) return;
    void controller.setShapeRadius({ command: "set-shape-radius", targetId: selection.targetId, radius })
      .then((ack) => {
        if (ack.command !== "set-shape-radius") return;
        setBridgeTargets((current) => {
          const key = targetStateKey(selection.frameId, selection.targetId);
          const entry = current[key];
          if (!entry?.inspection) return current;
          return {
            ...current,
            [key]: {
              ...entry,
              inspection: {
                ...entry.inspection,
                attributes: { ...entry.inspection.attributes, "data-design-tool-radius": String(ack.radius) },
              },
            },
          };
        });
      })
      .catch(() => undefined);
  }, [bridgeControllersRef, setBridgeTargets]);

  const commitShapeRadius = useCallback(() => {
    const drag = radiusDragRef.current;
    radiusDragRef.current = null;
    if (!drag || drag.lastRadius === drag.previousRadius) return;
    const controller = bridgeControllersRef.current.get(drag.frameId);
    if (!controller) return;
    const apply = (radius: number) => {
      void controller.setShapeRadius({ command: "set-shape-radius", targetId: drag.targetId, radius })
        .then(() => refreshSnapshotRef.current(drag.frameId))
        .catch(() => undefined);
    };
    editorStore.beginTransaction("Adjust corner radius");
    const committed = editorStore.commitTransaction({
      undo: () => apply(drag.previousRadius),
      redo: () => apply(drag.lastRadius),
    });
    if (!committed) editorStore.rollbackTransaction();
  }, [bridgeControllersRef, editorStore]);

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
        editable: false,
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
    let hadActiveTransaction = false;
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
      hadActiveTransaction = editorStore.hasActiveTransaction();
      if (!hadActiveTransaction) editorStore.beginTransaction("Duplicate layer");
      editorStore.execute({ type: "node/upsert", node }, { history: "skip" });
      editorStore.execute(setSelectionCommand({ frameIds: [frameId], nodeIds: [target.elementId], primaryFrameId: frameId, primaryNodeId: target.elementId }), { history: "skip" });
      if (!hadActiveTransaction) {
        editorStore.commitTransaction({
          undo: () => {
            if (ack.undo.command === "delete-element") void controller.deleteElement(ack.undo).then(() => refreshSnapshotRef.current(frameId)).catch(() => undefined);
          },
          redo: () => {
            if (ack.replay.command === "create-element") void controller.createElement(ack.replay).then(() => refreshSnapshotRef.current(frameId)).catch(() => undefined);
          },
        });
      }
      await refreshBridgeSnapshot(frameId);
    } catch {
      if (!hadActiveTransaction && editorStore.hasActiveTransaction()) editorStore.rollbackTransaction();
    }
  }, [bridgeControllersRef, editorStore, refreshBridgeSnapshot]);

  const deleteSelectedNodes = useCallback(async () => {
    const state = editorStore.getState();
    const selected = state.selection.nodeIds
      .map((nodeId) => state.nodes[nodeId])
      .filter((node): node is NodeEntity => Boolean(node && node.frameId && node.attributes["data-design-tool-created"] === "true"));
    if (selected.length === 0) return;
    const applied: Array<{ frameId: string; ack: Extract<import("../bridge/protocol").BridgeCommandAck, { command: "delete-element" }> }> = [];
    let hadActiveTransaction = false;
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
    hadActiveTransaction = editorStore.hasActiveTransaction();
    if (!hadActiveTransaction) editorStore.beginTransaction("Delete layers");
    for (const node of selected) editorStore.execute({ type: "node/remove", nodeId: node.id }, { history: "skip" });
    editorStore.execute(setSelectionCommand({ frameIds: [], nodeIds: [], primaryFrameId: null, primaryNodeId: null }), { history: "skip" });
    if (hadActiveTransaction) {
      for (const { frameId } of applied) await refreshBridgeSnapshot(frameId);
      return;
    }
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

  const sidebarHoveredOverlayTarget = useMemo(() => {
    if (!sidebarHoveredNode) return null;
    const entry = bridgeTargets[targetStateKey(sidebarHoveredNode.frameId, sidebarHoveredNode.nodeId)];
    return entry ? toOverlayTarget(entry) : null;
  }, [bridgeTargets, editorState.frames, sidebarHoveredNode, toOverlayTarget]);

  const setActiveTool = useCallback(
    (tool: ToolId, options?: { force?: boolean }) => {
      const current = normalizeActiveTool(editorStore.getState().activeTool);
      const nextTool =
        options?.force || current !== tool || tool === "select"
          ? tool
          : "select";
      creationRef.current = null;
      pendingImageRef.current = null;
      setCreationError(null);
      setInteractionMode("idle");
      editorStore.execute(setActiveToolCommand(nextTool), { history: "skip" });
      setIsFrameMenuOpen(nextTool === "frame");
    },
    [editorStore],
  );

  const toggleFrameMenu = useCallback(() => {
    creationRef.current = null;
    pendingImageRef.current = null;
    setCreationError(null);
    const current = normalizeActiveTool(editorStore.getState().activeTool);
    if (current === "frame" && isFrameMenuOpen) {
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
      setIsFrameMenuOpen(false);
      return;
    }
    editorStore.execute(setActiveToolCommand("frame"), { history: "skip" });
    setIsFrameMenuOpen(true);
  }, [editorStore, isFrameMenuOpen]);

  // User request: frames must stay loaded even when dragged out of camera view
  // Previously only ~12 nearest frames were live (virtualization) — off-screen frames showed placeholder and reloaded text on return
  // Now keep all frames live so text/elements never unload
  const liveFrameIdSet = useMemo(() => new Set(frames.map((f) => f.id)), [frames]);

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
    updateSurfaceRect();
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
      updateSurfaceRect();
    });
    observer.observe(surface);
    const onWindowResize = () => updateSurfaceRect();
    window.addEventListener("resize", onWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [updateSurfaceRect]);

  const updateCamera = useCallback((nextCamera: Camera) => {
    cameraRef.current = nextCamera;
    setCamera(nextCamera);
  }, []);

  const zoomFrameRef = useRef<number | null>(null);

  const cancelZoomAnimation = useCallback(() => {
    if (zoomFrameRef.current !== null) {
      cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = null;
    }
  }, []);

  const animateZoomTo = useCallback(
    (target: Camera, anchor: Point) => {
      cancelZoomAnimation();
      const from = cameraRef.current;
      if (Math.abs(target.zoom - from.zoom) < 0.0001) {
        updateCamera(target);
        return;
      }
      let step = 0;
      const frame = () => {
        step += 1;
        const progress = step / ZOOM_SMOOTH_STEPS;
        if (step >= ZOOM_SMOOTH_STEPS) {
          zoomFrameRef.current = null;
          updateCamera(target);
          return;
        }
        updateCamera(cameraAtZoomProgress(from, target, anchor, progress));
        zoomFrameRef.current = requestAnimationFrame(frame);
      };
      zoomFrameRef.current = requestAnimationFrame(frame);
    },
    [cancelZoomAnimation, cameraRef, updateCamera],
  );

  const switchPage = useCallback((pageId: string) => {
    editorStore.execute(switchPageCommand(pageId), { history: "skip" });
    const nextState = editorStore.getState();
    const pageFrameIds = nextState.pages[pageId]?.frameIds ?? [];
    const pageFrames = pageFrameIds
      .map((frameId) => nextState.frames[frameId])
      .filter((frame): frame is NonNullable<typeof frame> => Boolean(frame));
    if (pageFrames.length > 0 && viewport.width > 0 && viewport.height > 0) {
      cancelZoomAnimation();
      updateCamera(fitRect(getFramesBounds(pageFrames), viewport, cameraFitPadding(viewport)));
    }
  }, [cancelZoomAnimation, editorStore, updateCamera, viewport]);

  const fitAllFrames = useCallback(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }
    cancelZoomAnimation();
    updateCamera(fitRect(getFramesBounds(renderRects), viewport, cameraFitPadding(viewport)));
  }, [cancelZoomAnimation, renderRects, updateCamera, viewport]);

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
    // Selecting a layer from the sidebar must reveal it: if the element sits in
    // a frame that is not fully in view, focus the camera on that frame.
    if (nodeIds.includes(nodeId) && viewport.width > 0 && viewport.height > 0) {
      const frame = editorStore.getState().frames[frameId];
      if (frame) {
        const frameRect: Rect = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
        const bounds = bridgeHierarchies[frameId]?.nodes.find((node) => node.elementId === nodeId)?.bounds;
        const focusRect = bounds
          ? getFramesBounds([frameRect, { x: frame.x + bounds.x, y: frame.y + bounds.y, width: bounds.width, height: bounds.height }])
          : frameRect;
        const nextCamera = revealCamera(cameraRef.current, viewport, focusRect, cameraFitPadding(viewport));
        if (nextCamera) {
          cancelZoomAnimation();
          updateCamera(nextCamera);
        }
      }
    }
    const controller = bridgeControllersRef.current.get(frameId);
    if (controller) void controller.inspect(nodeId).then((inspection) => { if (inspection) handleBridgeInspection(frameId, inspection); }).catch(() => undefined);
  }, [bridgeControllersRef, bridgeHierarchies, cancelZoomAnimation, editorStore, handleBridgeInspection, updateCamera, viewport]);

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
      if (zoomFrameRef.current !== null) {
        cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
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
      const target = zoomCameraAtPoint(
        cameraRef.current,
        cameraRef.current.zoom * factor,
        center,
      );
      animateZoomTo(target, center);
      setInteractionMode("zooming");
      settleInteraction();
    },
    [animateZoomTo, cameraRef, settleInteraction, viewport],
  );

  const addFrame = useCallback(
    (preset: FramePreset) => {
      const measuredViewport = surfaceRef.current ? getViewportSize(surfaceRef.current) : viewport;
      const usableViewport = measuredViewport.width > 0 && measuredViewport.height > 0
        ? measuredViewport
        : { width: Math.max(viewport.width, 1), height: Math.max(viewport.height, 1) };
      const position = computeFramePlacement(
        renderRects,
        usableViewport,
        cameraRef.current,
        { width: preset.width, height: preset.height },
      );
      const existingIds = editorStore.getState().frames;
      const idPattern = new RegExp(`^${preset.id}-(\\d+)$`);
      let highestSequence = 0;
      for (const frameId of Object.keys(existingIds)) {
        const match = idPattern.exec(frameId);
        if (match) highestSequence = Math.max(highestSequence, Number(match[1]));
      }
      const sequence = Math.max(nextFrameSequenceRef.current, highestSequence + 1);
      nextFrameSequenceRef.current = sequence + 1;
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
      cancelZoomAnimation();
      updateCamera(fitRect(frame, usableViewport, cameraFitPadding(usableViewport)));
    },
    [cancelZoomAnimation, editorState.activePageId, editorStore, renderRects, setSelectedFrameId, updateCamera, viewport],
  );

  const showPasteFeedback = useCallback(
    (kind: "success" | "error", message: string) => {
      if (pasteFeedbackTimerRef.current !== null) {
        clearTimeout(pasteFeedbackTimerRef.current);
        pasteFeedbackTimerRef.current = null;
      }
      setPasteFeedback({ kind, message });
      pasteFeedbackTimerRef.current = setTimeout(() => {
        setPasteFeedback(null);
        pasteFeedbackTimerRef.current = null;
      }, kind === "error" ? 5000 : 3600);
    },
    [],
  );

  const handlePasteClipboard = useCallback(
    async (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      if (clipboardTargetRef.current) {
        return;
      }
      const transfer = event.clipboardData;
      if (!transfer) {
        return;
      }
      const html = transfer.getData("text/html");
      const plain = transfer.getData("text/plain");
      const candidate = html.trim().length > 0
        ? html
        : looksLikeHtml(plain)
          ? plain
          : null;
      if (candidate === null) {
        return;
      }
      event.preventDefault();
      try {
        const { srcDoc, metadata } = preparePastedHtml(candidate);
        const measuredViewport = surfaceRef.current ? getViewportSize(surfaceRef.current) : viewport;
        const usableViewport = measuredViewport.width > 0 && measuredViewport.height > 0
          ? measuredViewport
          : { width: Math.max(viewport.width, 1), height: Math.max(viewport.height, 1) };
        const size = resolvePastedFrameSize(metadata);
        const center = computeFramePlacement(renderRects, usableViewport, cameraRef.current, size);
        const result = pasteHtmlIntoStore(editorStore, srcDoc, metadata, {
          x: center.x - size.width / 2,
          y: center.y - size.height / 2,
        });
        cancelZoomAnimation();
        updateCamera(fitRect(result.rect, usableViewport, cameraFitPadding(usableViewport)));
        showPasteFeedback("success", `"${result.name}" pasted onto the canvas.`);
      } catch (error) {
        showPasteFeedback(
          "error",
          error instanceof Error ? error.message : "Could not paste the copied HTML.",
        );
      }
    },
    [cancelZoomAnimation, editorStore, renderRects, showPasteFeedback, updateCamera, viewport],
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
      cancelZoomAnimation();
      const currentTool = normalizeActiveTool(editorStore.getState().activeTool);
      if (spacePressedRef.current || currentTool === "hand") {
        pointerRef.current = {
          type: "pan",
          pointerId: event.pointerId,
          last: getCachedPointerPosition(event),
        };
        setInteractionMode("panning");
        return;
      }
      if (currentTool !== "select") {
        return;
      }
      const start = getCachedPointerPosition(event);
      const frame = editorStore.getState().frames[frameId];
      setSelectedFrameId(frameId);
      editorStore.beginTransaction(`Move ${frameId}`);
      pointerRef.current = {
        type: "move-frame",
        pointerId: event.pointerId,
        last: start,
        frameId,
        start,
        frameStart: frame ? { x: frame.x, y: frame.y } : { x: 0, y: 0 },
      };
      setInteractionMode("moving-frame");
    },
    [editorStore, setSelectedFrameId, cancelZoomAnimation, getCachedPointerPosition],
  );

  const beginBriefFramePointer = useCallback(
    (briefFrameId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      const surface = surfaceRef.current;
      if (!surface || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      surface.focus({ preventScroll: true });
      surface.setPointerCapture(event.pointerId);
      cancelZoomAnimation();
      updateSurfaceRect();
      const currentTool = normalizeActiveTool(editorStore.getState().activeTool);
      if (spacePressedRef.current || currentTool === "hand") {
        pointerRef.current = {
          type: "pan",
          pointerId: event.pointerId,
          last: getCachedPointerPosition(event),
        };
        setInteractionMode("panning");
        return;
      }
      if (currentTool !== "select") return;
      const start = getCachedPointerPosition(event);
      const currentBriefFrame = editorStore.getState().session.briefFrame;
      selectBriefFrame(briefFrameId);
      editorStore.beginTransaction(`Move ${briefFrameId}`);
      pointerRef.current = {
        type: "move-brief-frame",
        pointerId: event.pointerId,
        last: start,
        briefFrameId,
        start,
        briefStart: currentBriefFrame ? { x: currentBriefFrame.x, y: currentBriefFrame.y } : { x: 0, y: 0 },
      };
      setInteractionMode("moving-frame");
    },
    [editorStore, selectBriefFrame, cancelZoomAnimation, getCachedPointerPosition, updateSurfaceRect],
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
      cancelZoomAnimation();
      updateSurfaceRect();
      pointerRef.current = {
        type: "pan",
        pointerId: event.pointerId,
        last: getCachedPointerPosition(event),
      };
      setInteractionMode("panning");
    },
    [cancelZoomAnimation, getCachedPointerPosition, updateSurfaceRect],
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

    cancelZoomAnimation();
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSurfaceRect();
    pointerRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      last: getCachedPointerPosition(event),
    };
    if (!spacePressedRef.current) {
      setSelectedFrameId(null);
    }
    setInteractionMode("panning");
  };

  const applyFrameDragTransform = (operation: PointerOperation) => {
    if (operation.type !== "move-frame" && operation.type !== "move-brief-frame") return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const elementKey = operation.type === "move-frame"
      ? `frame:${operation.frameId}`
      : `brief:${operation.briefFrameId}`;
    const element = operation.type === "move-frame"
      ? surface.querySelector<HTMLElement>(`[data-frame-id="${operation.frameId}"]`)
      : surface.querySelector<HTMLElement>(`[data-testid="brief-frame"]`);
    if (!element) return;
    const worldDelta = {
      x: (operation.last.x - operation.start.x) / cameraRef.current.zoom,
      y: (operation.last.y - operation.start.y) / cameraRef.current.zoom,
    };
    const position = operation.type === "move-frame"
      ? { x: operation.frameStart.x + worldDelta.x, y: operation.frameStart.y + worldDelta.y }
      : { x: operation.briefStart.x + worldDelta.x, y: operation.briefStart.y + worldDelta.y };
    const transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    element.style.transform = transform;
    frameDragRef.current = { elementKey, transform };
  };

  const finalizeFrameDrag = (operation: PointerOperation) => {
    frameDragRef.current = null;
    if (operation.type !== "move-frame" && operation.type !== "move-brief-frame") return;
    const worldDelta = {
      x: (operation.last.x - operation.start.x) / cameraRef.current.zoom,
      y: (operation.last.y - operation.start.y) / cameraRef.current.zoom,
    };
    if (operation.type === "move-frame") {
      editorStore.execute(
        moveFrameCommand({
          frameId: operation.frameId,
          position: {
            x: operation.frameStart.x + worldDelta.x,
            y: operation.frameStart.y + worldDelta.y,
          },
        }),
      );
    } else {
      editorStore.execute(
        moveBriefFrameCommand({
          position: {
            x: operation.briefStart.x + worldDelta.x,
            y: operation.briefStart.y + worldDelta.y,
          },
        }),
        { history: "skip" },
      );
    }
  };

  useLayoutEffect(() => {
    const drag = frameDragRef.current;
    if (!drag) return;
    const surface = surfaceRef.current;
    const element = drag.elementKey.startsWith("frame:")
      ? surface?.querySelector<HTMLElement>(`[data-frame-id="${drag.elementKey.slice(6)}"]`)
      : surface?.querySelector<HTMLElement>(`[data-testid="brief-frame"]`);
    if (element) element.style.transform = drag.transform;
  });

  // While panning, the world transform is driven imperatively (see the pan
  // branch in handlePointerMove) so the canvas glides without re-rendering
  // every frame. Any React re-render during the gesture would otherwise
  // overwrite that transform with the stale committed camera and make the
  // content snap back to its origin, so re-assert the live transform here.
  useLayoutEffect(() => {
    const operation = pointerRef.current;
    if (operation?.type === "pan" && worldRef.current) {
      worldRef.current.style.transform = cameraTransform(cameraRef.current);
    }
  });

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (moveNodeGesture(event)) {
      return;
    }
    const operation = pointerRef.current;
    if (!operation || operation.pointerId !== event.pointerId) {
      return;
    }

    const next = getCachedPointerPosition(event);
    const delta = { x: next.x - operation.last.x, y: next.y - operation.last.y };
    operation.last = next;
    if (delta.x === 0 && delta.y === 0) {
      return;
    }

    if (operation.type === "pan") {
      if (worldRef.current) {
        const nextCamera = panCamera(cameraRef.current, delta);
        cameraRef.current = nextCamera;
        worldRef.current.style.transform = cameraTransform(nextCamera);
      }
      return;
    }

    applyFrameDragTransform(operation);
  };

  const endPointerOperation = (event: ReactPointerEvent<HTMLDivElement>) => {
    endNodeGesture(event);
    const operation = pointerRef.current;
    pointerRef.current = null;
    if ((operation?.type === "move-frame" || operation?.type === "move-brief-frame") && editorStore.hasActiveTransaction()) {
      finalizeFrameDrag(operation);
      editorStore.commitTransaction();
    }
    if (operation?.type === "pan") {
      updateCamera(cameraRef.current);
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

  const handleWheel = useCallback((event: WheelEvent) => {
    if (isCanvasControlTarget(event.target)) {
      return;
    }
    const targetEl = event.target as Element | null;
    if (targetEl && !event.ctrlKey && !event.metaKey) {
      const scrollable = targetEl.closest(".sidebar-panel-content, .properties-scroll, .figma-lake-body, .figma-lake, .project-lake") as HTMLElement | null;
      if (scrollable && scrollable.scrollHeight > scrollable.clientHeight + 1) {
        const deltaAbsY = Math.abs(event.deltaY);
        const deltaAbsX = Math.abs(event.deltaX);
        const atTop = scrollable.scrollTop <= 0;
        const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;
        const atLeft = scrollable.scrollLeft <= 0;
        const atRight = scrollable.scrollLeft + scrollable.clientWidth >= scrollable.scrollWidth - 1;
        const scrollingVertically = deltaAbsY > deltaAbsX;
        if (scrollingVertically && !(atTop && event.deltaY < 0) && !(atBottom && event.deltaY > 0)) return;
        if (!scrollingVertically && !(atLeft && event.deltaX < 0) && !(atRight && event.deltaX > 0) && scrollable.scrollWidth > scrollable.clientWidth) return;
      }
    }
    event.preventDefault();
    const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    const deltaX = event.deltaX * multiplier;
    const deltaY = event.deltaY * multiplier;

    const isPinchZoom = event.ctrlKey || event.metaKey;

    if (isPinchZoom) {
      const pointer = getCachedPointerPosition(event);
      const zoomFactor = Math.exp(-deltaY * 0.008);
      const nextZoom = cameraRef.current.zoom * zoomFactor;
      const nextCamera = zoomCameraAtPoint(cameraRef.current, nextZoom, pointer);
      cameraRef.current = nextCamera;
      if (worldRef.current) {
        worldRef.current.style.transform = cameraTransform(nextCamera);
      }
      if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
      });
      setInteractionMode(prev => prev === "zooming" ? prev : "zooming");
    } else {
      const nextCamera = panCamera(cameraRef.current, { x: -deltaX, y: -deltaY });
      cameraRef.current = nextCamera;
      if (worldRef.current) {
        worldRef.current.style.transform = cameraTransform(nextCamera);
      }
      setInteractionMode(prev => prev === "panning" ? prev : "panning");
    }

    if (wheelCommitTimeoutRef.current) clearTimeout(wheelCommitTimeoutRef.current);
    wheelCommitTimeoutRef.current = setTimeout(() => {
      setCamera(cameraRef.current);
      wheelCommitTimeoutRef.current = null;
    }, 40);

    settleInteraction();
  }, [settleInteraction, getCachedPointerPosition]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      surface.removeEventListener("wheel", handleWheel);
      if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current);
      if (wheelCommitTimeoutRef.current) {
        clearTimeout(wheelCommitTimeoutRef.current);
        wheelCommitTimeoutRef.current = null;
      }
    };
  }, [handleWheel]);

  const cancelInteraction = useCallback(() => {
    cancelNodeGesture();
    const operation = pointerRef.current;
    pointerRef.current = null;
    if (operation?.type === "move-frame" || operation?.type === "move-brief-frame") {
      const surface = surfaceRef.current;
      const element = operation.type === "move-frame"
        ? surface?.querySelector<HTMLElement>(`[data-frame-id="${operation.frameId}"]`)
        : surface?.querySelector<HTMLElement>(`[data-testid="brief-frame"]`);
      if (element) {
        const position = operation.type === "move-frame" ? operation.frameStart : operation.briefStart;
        element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
      }
      if (editorStore.hasActiveTransaction()) {
        editorStore.rollbackTransaction();
      }
    }
    frameDragRef.current = null;
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
      if (action.type !== "paste-selection") {
        event.preventDefault();
      }
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
            event.preventDefault();
            const clipboard = clipboardTargetRef.current;
            editorStore.execute(setSelectionCommand({ frameIds: [clipboard.frameId], nodeIds: [clipboard.nodeId], primaryFrameId: clipboard.frameId, primaryNodeId: clipboard.nodeId }), { history: "skip" });
            void duplicateSelectedNode();
          }
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
  }, [activeTool, deleteSelectedNodes, duplicateSelectedNode, editorStore, fitAllFrames, handleEscape, setActiveTool, startSelectedTextEdit]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      void handlePasteClipboard(event);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePasteClipboard]);

  useEffect(() => () => {
    if (pasteFeedbackTimerRef.current !== null) {
      clearTimeout(pasteFeedbackTimerRef.current);
      pasteFeedbackTimerRef.current = null;
    }
  }, []);

  const guardIframes = (interactionMode !== "idle" && interactionMode !== "creating") || spacePressed;

  const selectedComment = selectedCommentId
    ? comments.find((entry) => entry.id === selectedCommentId) ?? null
    : null;
  const selectedCommentAnchor = selectedComment
    ? (() => {
        const frame = frames.find((entry) => entry.id === selectedComment.frameId);
        if (!frame) return null;
        return worldToScreen(
          { x: frame.x + selectedComment.point.x, y: frame.y + selectedComment.point.y },
          camera,
        );
      })()
    : null;
  const hoveredComment =
    hoveredCommentId !== null && hoveredCommentId !== selectedCommentId
      ? comments.find((entry) => entry.id === hoveredCommentId) ?? null
      : null;
  const hoveredCommentAnchor = hoveredComment
    ? (() => {
        const frame = frames.find((entry) => entry.id === hoveredComment.frameId);
        if (!frame) return null;
        return worldToScreen(
          { x: frame.x + hoveredComment.point.x, y: frame.y + hoveredComment.point.y },
          camera,
        );
      })()
    : null;

  const isHomeRoute = shouldUseLocalMemory && routeProjectId === null && !routeNotFound;
  const isProjectRoute = shouldUseLocalMemory && routeProjectId !== null && !routeNotFound;

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
      onBlur={() => {
        spacePressedRef.current = false;
        setSpacePressed(false);
      }}
    >
      {!isHomeRoute ? (
        <div
          ref={worldRef}
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
            key={`${frame.id}-${persistenceVersion}`}
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
            creationShape={activeTool === "rectangle" ? activeShape : null}
            creationRadius={activeTool === "rectangle" ? shapeRadius : 0}
            onCreationPointerDown={beginCreationPointer}
            onCreationPointerMove={moveCreationPointer}
            onCreationPointerUp={finishCreationPointer}
            onCreationPointerCancel={cancelCreationPointer}
          />
        ))}
        <NodeOverlayLayer
          zoom={camera.zoom}
          hoveredTarget={sidebarHoveredOverlayTarget ?? hoveredOverlayTarget}
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
            <button
              key={comment.id}
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
              onPointerEnter={() => setHoveredCommentId(comment.id)}
              onPointerLeave={() =>
                setHoveredCommentId((current) => (current === comment.id ? null : current))
              }
              style={{ left: frame.x + comment.point.x, top: frame.y + comment.point.y }}
              type="button"
            >
              <span>{comment.status === "resolved" ? "✓" : "•"}</span>
            </button>
          );
        })}
      </div>
      ) : null}

      {selectedComment && selectedCommentAnchor ? (
        <CommentPopover
          key={selectedComment.id}
          comment={selectedComment}
          feedback={commentFeedback}
          onClose={() => selectComment(null)}
          onDelete={deleteComment}
          onSave={updateComment}
          style={{ left: selectedCommentAnchor.x + 18, top: selectedCommentAnchor.y + 18 }}
        />
      ) : null}

      {hoveredComment && hoveredCommentAnchor ? (
        <div
          aria-hidden="true"
          className="canvas-comment-preview"
          data-testid="comment-hover-preview"
          style={{ left: hoveredCommentAnchor.x + 18, top: hoveredCommentAnchor.y + 18 }}
        >
          {hoveredComment.body || "Add a note"}
        </div>
      ) : null}

      {guardIframes ? (
        <div
          className="canvas-input-shield"
          data-testid="canvas-camera-overlay"
          aria-hidden="true"
        />
      ) : null}

      {shouldUseLocalMemory && routeNotFound ? (
        <div className="project-not-found" data-testid="project-not-found" data-canvas-control>
          <div className="project-not-found-card">
            <h2>Project not found</h2>
            <p>
              No local project matches <code>{routeProjectId}</code>. It may have been deleted on this device or the link is incorrect.
            </p>
            <div className="project-not-found-actions">
              <button
                onClick={() => {
                  setRouteNotFound(false);
                  setRouteProjectId(null);
                  navigateToHome();
                }}
                type="button"
              >
                Go to home
              </button>
              <button
                onClick={() => {
                  if (routeProjectId) {
                    // Offer to create a new project with that id? For now just go home
                    setRouteNotFound(false);
                    setRouteProjectId(null);
                    navigateToHome();
                  }
                }}
                type="button"
                className="is-secondary"
              >
                Browse lake
              </button>
            </div>
          </div>
        </div>
      ) : shouldUseLocalMemory && routeProjectId === null ? (
        <ProjectLake
          projects={localProjects}
          activeProjectId={activeProjectId}
          onOpen={handleOpenLakeProject}
          onCreate={handleCreateLakeProject}
          onDelete={handleDeleteLakeProject}
          onDuplicate={handleDuplicateLakeProject}
          onRename={handleRenameLakeProject}
          onStartBlank={() => startBrainstorming("blank")}
        />
      ) : shouldUseLocalMemory && routeProjectId !== null && !routeNotFound ? null : isEmptyState ? (
        <EmptyCanvasState onStartBrainstorming={() => startBrainstorming()} />
      ) : null}

      {shouldUseLocalMemory && showLakeOverlay && routeProjectId !== null && !routeNotFound ? (
        <ProjectLake
          projects={localProjects}
          activeProjectId={activeProjectId}
          onOpen={handleOpenLakeProject}
          onCreate={handleCreateLakeProject}
          onDelete={handleDeleteLakeProject}
          onDuplicate={handleDuplicateLakeProject}
          onRename={handleRenameLakeProject}
          showAsOverlay
          onCloseLake={() => setShowLakeOverlay(false)}
        />
      ) : null}

      <WorkspaceHeader
        frameCount={frames.length}
        projectMeta={briefFrame ? `${frames.length} frames · Brainstorming` : routeProjectId ? `Project · ${routeProjectId.slice(0, 12)}…` : undefined}
        projectName={
          shouldUseLocalMemory
            ? routeProjectId
              ? deriveProjectName(editorState, localProjects.find((p) => p.id === routeProjectId)?.kind ?? "blank")
              : "Home"
            : isEmptyState
              ? "Untitled canvas"
              : briefFrame
                ? "Project brief"
                : undefined
        }
        canExport={editorState.session.lifecycle !== "not-started"}
        onImportFile={importProject}
        onExport={exportProject}
        onExportFigma={exportFigmaProject}
        persistenceFeedback={persistenceFeedback}
        onShowLake={
          shouldUseLocalMemory
            ? () => {
                if (routeProjectId === null) {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                } else {
                  setRouteProjectId(null);
                  setRouteNotFound(false);
                  setShowLakeOverlay(false);
                  navigateToHome();
                  // Clear world transform side effects if any
                  refreshLocalProjects();
                }
              }
            : undefined
        }
        lakeCount={shouldUseLocalMemory ? localProjects.length : undefined}
        isLakeOpen={shouldUseLocalMemory ? routeProjectId === null : showLakeOverlay}
      />
      {showDesignChrome && !isHomeRoute ? (
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
          onSelectShape={(shape) => { setActiveShape(shape); setActiveTool("rectangle", { force: true }); }}
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
      {commentFeedback && selectedCommentId === null ? (
        <div className="comment-feedback-toast" data-testid="comment-feedback" data-canvas-control role="status">
          {commentFeedback}
        </div>
      ) : null}

      {pasteFeedback ? (
        <div
          className={`paste-feedback-toast${pasteFeedback.kind === "error" ? " is-error" : ""}`}
          data-canvas-control
          data-testid="paste-feedback"
          role={pasteFeedback.kind === "error" ? "alert" : "status"}
        >
          {pasteFeedback.message}
        </div>
      ) : null}

      {showDesignChrome && !isHomeRoute ? (
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
            onHoverNode={(frameId, nodeId) => setSidebarHoveredNode({ frameId, nodeId })}
            onHoverNodeEnd={() => setSidebarHoveredNode(null)}
            hoveredLayerNode={hoveredOverlayTarget ? { frameId: hoveredOverlayTarget.frameId, nodeId: hoveredOverlayTarget.nodeId } : null}
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
            shapeRadius={radiusSelection?.radius ?? shapeRadius}
            shapeRadiusVisible={activeTool === "rectangle" || radiusSelection !== null}
            onShapeRadiusChange={changeShapeRadius}
            onShapeRadiusCommit={commitShapeRadius}
          />
        </>
      ) : null}

      <div className="canvas-help" aria-hidden="true">
        <span><kbd>Space</kbd> drag to pan</span>
        <span>Pinch to zoom</span>
        <span><kbd>0</kbd> fit all</span>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {frames.length} frames, {liveFrameIdSet.size} live, {Math.round(camera.zoom * 100)}% zoom
      </div>
    </main>
  );
}
