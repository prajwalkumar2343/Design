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
import { TokensPanel } from "../components/TokensPanel";
import { ShaderElementView } from "../components/ShaderElementView";
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
  BridgeUndoCommand,
  SafeInlineStyleProperty,
} from "../bridge/protocol";
import type { IframeBridgeController } from "../bridge/transport";
import {
  createFrameCommand,
  createPageCommand,
  moveBriefFrameCommand,
  moveFrameCommand,
  removeFrameCommand,
  removeTokenCommand,
  removeTokenSetCommand,
  removeTokenThemeCommand,
  renamePageCommand,
  renameTokenCommand,
  selectBriefFrameCommand,
  setSelectionCommand,
  switchPageCommand,
  switchTokenThemeCommand,
  updateBriefFieldCommand,
  upsertTokenCommand,
  upsertTokenSetCommand,
  upsertTokenThemeCommand,
} from "../editor/commands";
import {
  createEditorStateFromFrameSeeds,
  createEmptyEditorState,
  createFrameRenderModelSelector,
  type NodeEntity,
  type PageEntity,
} from "../editor/model";
import {
  clampGlassLevel,
  clampShapeRadius,
  glassFallbackBackdropFilter,
  glassLevelFromAttribute,
  glassLiquidShadow,
  glassTintBackground,
} from "../editor/effects";
import {
  isSpaceShortcut,
  normalizeActiveTool,
  resolveEditorShortcut,
  type EditorShortcutAction,
} from "../editor";
import { setActiveToolCommand } from "../editor/commands";
import type { ShapeVariantId, ToolId } from "../editor/tools";
import {
  createEditorStore,
  type EditorStore,
} from "../editor/store";
import { prependTranslationTransform } from "../editor/position";
import { startAgentBridge } from "../agent-bridge";
import { buildCodeExportPayload } from "../export/code-export";
import { buildReactExportPayload } from "../export/react/react-export";
import { buildDTCGExportFile, buildTokenCssExportFile } from "../export/tokens-export";
import { fontFacesCssForFamilyValue } from "../fonts";
import { BriefFrameView } from "../frame/BriefFrameView";
import { FrameView } from "../frame/FrameView";
import { createFrameFromPreset, type FramePreset } from "../frame/presets";
import {
  bridgeNodeIdForElement,
  buildFreeformDocument,
  buildFreeformImageMarkup,
  buildFreeformShapeMarkup,
  buildFreeformTextMarkup,
  FREEFORM_FRAME_PAD,
  FREEFORM_TEXT_HEADROOM,
  FREEFORM_TEXT_MIN_HEIGHT,
} from "../frame/freeform";
import { normalizedBounds, shapeDragPoints, shapeLabel, ShapePreview } from "../frame/shape-geometry";
import { useBrainstormSessionController } from "./brainstorm-session-controller";
import { ProjectLake } from "./ProjectLake";
import {
  looksLikeHtml,
  PASTED_FRAME_DEFAULT_HEIGHT,
  PASTED_FRAME_DEFAULT_WIDTH,
  pasteHtmlIntoStore,
  preparePastedHtml,
  resolvePastedFrameSize,
} from "../clipboard/paste-html";
import {
  importHtmlFileIntoStore,
  prepareHtmlFileImport,
} from "../import-html/html-file-import";
import {
  BrowserPersistenceAdapter,
  FIGMA_FILE_MIME_TYPE,
  FIGMA_FILE_NAME,
  importWireCanvasProject,
  readFileBytes,
  serializeFigmaProject,
  serializeWireCanvasProject,
  serializeWireCanvasProjectCompact,
  WIRECANVAS_FILE_MIME_TYPE,
  WIRECANVAS_FILE_NAME,
  WireCanvasCodecError,
  type BrowserDownloadAdapter,
  type PersistenceAdapter,
} from "../persistence";
import { applyPendingDocumentWrites } from "../persistence/live-documents";
import {
  importFigmaFileIntoStore,
} from "../import-figma/figma-file-import";
import {
  CANVAS_AGENT_FILES,
  CANVAS_CATEGORIES,
  createProjectId,
  deleteLocalProject,
  deriveProjectName,
  duplicateLocalProject,
  getActiveProjectId,
  getBriefPresetForKind,
  getCanvasCategoryForKind,
  getLocalProjectSummaries,
  hasLocalProject,
  hydrateInitialState,
  loadEditorStateForProjectDetailed,
  loadProjectIndex,
  renameLocalProject,
  saveProjectIndex,
  setActiveProjectId,
  PROJECT_KINDS,
  type CanvasCategory,
  type LocalProjectSummary,
  type ProjectKind,
} from "../persistence/local-projects";
import { parseWireCanvasProject } from "../persistence/wirecanvas";
import {
  buildImportedTokenSet,
  buildThemeCssVariables,
  parseDTCGTokens,
  type DesignToken,
  type TokenSet,
  type TokenTheme,
} from "../tokens";
import {
  createCanvasShaderElement,
  detectPaperShaderSupport,
  isPaperShaderId,
  maxShaderElementRadius,
  SHADER_ELEMENT_DEFAULT_RADIUS,
  type CanvasShaderElement,
  type ShaderId,
  type ShaderParams,
} from "../shaders";
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
import { cssPixelValue, parseTransform } from "../overlay/commands";
import {
  computeFreeformFit,
  freeformBodyShiftFromValue,
  freeformBodyShiftValue,
  freeformFrameCommands,
  isFreeformContentNode,
} from "../overlay/freeform-fit";
import {
  useNodeOverlayGestures,
  type NodeInteractionMode,
  type OverlayBridgeTargetState,
} from "../overlay/useNodeOverlayGestures";
import {
  cameraTransform,
  fitRect,
  panCamera,
  revealCamera,
  screenToWorld,
  worldToScreen,
  zoomCameraAtPoint,
} from "./camera";
import { MAX_INFLIGHT_MOUNTS, MAX_MOUNTED_FRAMES, MOUNT_READY_TIMEOUT_MS } from "./constants";
import { getVisibleWorldRect, mountEvictionCandidates, rectsIntersect } from "./virtualization";
import type { Camera, CanvasFrame, Point, Rect, Size } from "./types";

const CAMERA_FIT_PADDING = 148;
const CAMERA_SETTLE_MS = 140;

function cameraFitPadding(viewport: Size): number {
  return viewport.width < 760 ? 18 : CAMERA_FIT_PADDING;
}

/** Chrome-free screen box the opening camera may use (sidebars, header, dock). */
interface FitInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function fitInsets(viewport: Size): FitInsets {
  if (viewport.width < 760) {
    return { left: 18, right: 18, top: 18, bottom: 18 };
  }
  // Left sidebar (12 + 324), properties panel (12 + 304), header (12 + 48),
  // dock (~18 + 62). Fitting inside this box keeps every frame's handles and
  // body clear of the floating chrome so gestures start on the canvas. The
  // top/bottom allowances also cover frame-label handles that protrude
  // ~37px above their frame's top edge.
  return { left: 340, right: 320, top: 108, bottom: 100 };
}

function fitRectWithInsets(rect: Rect, viewport: Size, insets: FitInsets): Camera {
  const availWidth = Math.max(0, viewport.width - insets.left - insets.right);
  const availHeight = Math.max(0, viewport.height - insets.top - insets.bottom);
  const widthZoom = rect.width > 0 ? availWidth / rect.width : 4;
  const heightZoom = rect.height > 0 ? availHeight / rect.height : 4;
  const zoom = Math.max(0.05, Math.min(4, Math.min(widthZoom, heightZoom)));
  const boxCenterX = insets.left + availWidth / 2;
  const boxCenterY = insets.top + availHeight / 2;
  return {
    x: rect.x + rect.width / 2 - boxCenterX / zoom,
    y: rect.y + rect.height / 2 - boxCenterY / zoom,
    zoom,
  };
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
  | { type: "move-frame"; pointerId: number; last: Point; frameId: string; start: Point; frameStart: Point; txToken: symbol }
  | { type: "move-brief-frame"; pointerId: number; last: Point; briefFrameId: string; start: Point; briefStart: Point; txToken: symbol }
  // A creation-tool drag on empty canvas. `start`/`last` are world-space
  // points; on release it mints a chromeless freeform frame holding the shape.
  | { type: "canvas-create"; pointerId: number; tool: "rectangle" | "text" | "image"; start: Point; last: Point };

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

/** Creation tools that can mint a freeform frame when dragged on empty canvas. */
function isCanvasCreationTool(tool: ToolId): tool is "rectangle" | "text" | "image" {
  return tool === "rectangle" || tool === "text" || tool === "image";
}

/**
 * Minimum pointer travel (design-space px) for a shape drag to count as a
 * draw. Anything shorter is a click and creates nothing — it would otherwise
 * mint an invisible, min-clamped shape into the document.
 */
const MIN_SHAPE_DRAG = 6;
const FRAME_CONTENT_INSET = 1;

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

const GLASS_VECTOR_KINDS = new Set(["rectangle", "ellipse", "line", "arrow", "polygon", "star", "path"]);

const GLASS_STYLE_PROPERTIES = ["backdrop-filter", "background", "box-shadow"] as const;

type GlassSurfaceStyles = Record<(typeof GLASS_STYLE_PROPERTIES)[number], string | null>;

/** The three inline styles a foreign (non-created) surface carries as glass. */
function surfaceGlassStyles(fillBase: string | null, level: number): GlassSurfaceStyles {
  return level > 0
    ? {
        "backdrop-filter": glassFallbackBackdropFilter(level),
        background: glassTintBackground(fillBase, level),
        "box-shadow": glassLiquidShadow(level),
      }
    : { "backdrop-filter": null, background: null, "box-shadow": null };
}

function glassStylesEqual(a: GlassSurfaceStyles, b: GlassSurfaceStyles): boolean {
  return GLASS_STYLE_PROPERTIES.every((property) => a[property] === b[property]);
}

/** Created SVG shapes paint through their geometry child, not CSS backgrounds. */
function isCreatedVector(entry: { target: BridgeElementTarget; inspection: BridgeInspection | null }): boolean {
  const kind = entry.inspection?.attributes["data-design-tool-kind"];
  return kind !== undefined && GLASS_VECTOR_KINDS.has(kind);
}

/** Editor-created layers take the dedicated shape commands; foreign content cannot. */
function isCreatedTarget(entry: { target: BridgeElementTarget; inspection: BridgeInspection | null }): boolean {
  return entry.inspection?.attributes["data-design-tool-created"] === "true";
}

function isActivatableControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("button, a, select, summary, [role='button'], [role='switch'], [role='tab']") !== null
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
  // Render models are referentially stable for untouched frames (entities
  // keep identity across unrelated dispatches), so memoized FrameViews skip
  // every render that did not change them — the difference between an O(1)
  // and an O(frames) commit.
  const renderModelSelectorRef = useRef<ReturnType<typeof createFrameRenderModelSelector> | null>(null);
  if (renderModelSelectorRef.current === null) {
    renderModelSelectorRef.current = createFrameRenderModelSelector();
  }
  const { all: allFrames, active: frames } = renderModelSelectorRef.current(editorState);
  const briefFrame = editorState.session.briefFrame;
  const renderRects = useMemo(
    () => briefFrame ? [...frames, briefFrame] : frames,
    [briefFrame, frames],
  );
  const frameById = useMemo(
    () => new Map(renderRects.map((frame) => [frame.id, frame])),
    [renderRects],
  );
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
  const pendingCanvasImageRef = useRef<Rect | null>(null);
  // A text element baked into a fresh freeform frame gets its caret once the
  // frame's bridge reports its first snapshot.
  const pendingFreeformTextRef = useRef<{ frameId: string; targetId: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Set while the file picker is open so its dismissal can drop the pending
  // placement — pendingImageRef can also hold a pre-pick in-frame drag, which
  // must not be cleared by an unrelated window refocus.
  const imagePickerOpenRef = useRef(false);
  const clipboardTargetRef = useRef<{ frameId: string; nodeId: string } | null>(null);
  const frameTextEditRef = useRef<Set<string>>(new Set());
  const spacePressedRef = useRef(false);
  const cameraInitializedRef = useRef(false);
  const motionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Cumulative <body> re-anchor shift per freeform frame — shared with the
  // node-gesture hook so every fit path and undo replay stays consistent.
  const freeformShiftRef = useRef(new Map<string, Point>());
  // Last seen document revision per freeform frame — a bump means the iframe
  // reloaded and its <body> re-anchor transform is gone (see effect below).
  const frameDocRevisionsRef = useRef(new Map<string, number>());
  const snapshotQueuesRef = useRef(new Map<string, Promise<void>>());
  const snapshotSequenceRef = useRef(new Map<string, number>());
  const refreshSnapshotRef = useRef<(frameId: string) => Promise<void>>(async () => undefined);
  const createLiveElementRef = useRef<(frameId: string, command: Extract<BridgeCommand, { command: "create-element" }>, label: string) => Promise<boolean>>(async () => false);
  const addCommentRef = useRef<(frameId: string, point: Point) => void>(() => undefined);
  const deleteSelectedNodesRef = useRef<() => Promise<void>>(async () => undefined);
  const runEditorShortcutRef = useRef<(action: EditorShortcutAction) => void>(() => undefined);

  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  // Mount-order callbacks read viewport through a ref so a surface resize
  // doesn't churn their identity — a changing onBridgeEvent prop re-runs
  // FrameView's bridge effect and its teardown would detach live iframes.
  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  const [bridgeTargets, setBridgeTargets] = useState<Record<string, OverlayBridgeTargetState>>({});
  const [bridgeHierarchies, setBridgeHierarchies] = useState<Record<string, BridgeHierarchySnapshot>>({});
  // Snapshot replies stream in one task each; merging their two setStates per
  // reply cost a full CanvasSurface render per snapshot (~150 renders for a
  // mount wave). They enqueue here and merge once per animation frame.
  const pendingSnapshotUiRef = useRef<{
    hierarchies: Record<string, BridgeHierarchySnapshot>;
    targets: Record<string, OverlayBridgeTargetState>;
    raf: number | null;
  }>({ hierarchies: {}, targets: {}, raf: null });
  const [hoveredOverlayTarget, setHoveredOverlayTarget] = useState<OverlayNodeTarget | null>(null);
  const [textEditingNode, setTextEditingNode] = useState<{ frameId: string; nodeId: string } | null>(null);
  const [sidebarHoveredNode, setSidebarHoveredNode] = useState<{ frameId: string; nodeId: string } | null>(null);
  const selectedFrameId = editorState.selection.primaryFrameId;
  const selectedBriefFrameId = editorState.session.selection.type === "brief-frame"
    ? editorState.session.selection.briefFrameId
    : null;
  const [interactionMode, setInteractionMode] = useState<NodeInteractionMode>("idle");
  const interactionModeRef = useRef<NodeInteractionMode>(interactionMode);
  useEffect(() => { interactionModeRef.current = interactionMode; }, [interactionMode]);
  const hoverRafRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<{
    frameId: string;
    target: BridgeElementTarget | null;
    iframe: HTMLIFrameElement;
    point: Point;
  } | null | undefined>(undefined);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isFrameMenuOpen, setIsFrameMenuOpen] = useState(false);
  const [isShaderMenuOpen, setIsShaderMenuOpen] = useState(false);
  const [shaderElements, setShaderElements] = useState<CanvasShaderElement[]>([]);
  const [selectedShaderElementId, setSelectedShaderElementId] = useState<string | null>(null);
  // A canvas holding only shader elements still counts as non-empty — its
  // chrome (sidebar/dock) is how those shaders get edited.
  const isEmptyState = frames.length === 0
    && briefFrame === null
    && shaderElements.length === 0
    && Object.keys(editorState.documents).length === 0
    && Object.keys(editorState.pages).length === 0;
  const showDesignChrome = !isEmptyState;
  const selectedShaderElementIdRef = useRef<string | null>(null);
  selectedShaderElementIdRef.current = selectedShaderElementId;
  const [activeShape, setActiveShape] = useState<ShapeVariantId>("rectangle");
  const [shapeRadius, setShapeRadius] = useState(0);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [canvasCreationPreview, setCanvasCreationPreview] = useState<{ start: Point; end: Point } | null>(null);
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
  const persistenceFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPersistenceFeedback = useCallback(
    (feedback: { kind: "success" | "error"; message: string }) => {
      if (persistenceFeedbackTimerRef.current !== null) {
        clearTimeout(persistenceFeedbackTimerRef.current);
        persistenceFeedbackTimerRef.current = null;
      }
      setPersistenceFeedback(feedback);
      persistenceFeedbackTimerRef.current = setTimeout(() => {
        setPersistenceFeedback(null);
        persistenceFeedbackTimerRef.current = null;
      }, feedback.kind === "error" ? 5000 : 3600);
    },
    [],
  );

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
    return !hasLocalProject(id);
  });
  const isHomeRoute = shouldUseLocalMemory && routeProjectId === null && !routeNotFound;
  const isProjectRoute = shouldUseLocalMemory && routeProjectId !== null && !routeNotFound;
  const pendingKindRef = useRef<ProjectKind | null>(null);
  const [pendingCanvasCategory, setPendingCanvasCategory] = useState<CanvasCategory | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSerializedRef = useRef<string | null>(null);
  // Tracks whether the quota-full warning is already showing so a failing
  // autosave does not re-trigger (and re-time) the same toast on every edit.
  const autosaveQuotaWarnedRef = useRef(false);
  const {
    comments,
    selectedCommentId,
    feedback: commentFeedback,
    addComment,
    selectComment,
    updateComment,
    toggleCommentResolved,
    deleteComment,
    clearComments,
  } = useComments();
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const activeTool = normalizeActiveTool(editorState.activeTool);
  const activeToolRef = useRef<ToolId>(activeTool);
  const activeShapeRef = useRef<ShapeVariantId>(activeShape);
  const shapeRadiusRef = useRef(shapeRadius);
  activeToolRef.current = activeTool;
  activeShapeRef.current = activeShape;
  shapeRadiusRef.current = shapeRadius;
  const creationMode = isCreationTool(activeTool);

  // Frame mounting is keep-alive for interacted frames: an iframe mounts the
  // first time its frame enters the viewport (plus overscan), and frames the
  // user selects, draws in, or drags are pinned so live DOM edits and bridge
  // state are never lost to an unload. Purely visibility-driven mounts stay
  // unpinned — they hold no edits, so past MAX_MOUNTED_FRAMES the farthest
  // ones are evicted back to placeholders. Never-mounted frames render a
  // lightweight placeholder — this is what lets a canvas with hundreds of
  // frames open instantly, while content-visibility keeps already-mounted
  // off-screen frames nearly free to composite.
  const mountedFrameIdsRef = useRef(new Set<string>());
  // Frames mounted by an interaction (selection, creation, drag) are pinned —
  // they may hold live DOM edits and are never evicted. Visibility-scan mounts
  // are unpinned and evict farthest-off-screen first past MAX_MOUNTED_FRAMES.
  const pinnedFrameIdsRef = useRef(new Set<string>());
  // Frames holding DOM edits that exist only inside the iframe — evicting one
  // would destroy work the srcDoc doesn't contain. Mutating bridge commands
  // mark their frame via markFrameDirty; a dirty frame keeps its mount pin
  // until its document unloads.
  const dirtyFrameIdsRef = useRef(new Set<string>());
  // Latest live-document harvest per document, keyed by documentId. Written by
  // the debounced read-back below and overlaid onto serialized payloads, so
  // iframe-only edits persist without a revision bump (which would reload the
  // iframe and wipe the live DOM it just captured).
  const pendingDocWritesRef = useRef(new Map<string, { html: string; revision: number }>());
  const docSyncTimersRef = useRef(new Map<string, number>());
  // The autosave effect publishes its scheduler here so a completed live-doc
  // harvest can trigger a save — it mutates no store state on its own.
  const scheduleAutosaveRef = useRef<(() => void) | null>(null);
  const [liveFrameIds, setLiveFrameIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingMountIdsRef = useRef<string[]>([]);
  const queuedMountIdsRef = useRef(new Set<string>());
  // Mounts that have been granted a slot but haven't reported their first
  // bridge snapshot yet — bounded by MAX_INFLIGHT_MOUNTS so iframe parse /
  // runtime / font costs serialize instead of stacking into one long freeze.
  // Each entry is a failsafe timer that releases the slot if the frame never
  // reports ready.
  const inFlightMountsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mountPumpRef = useRef<{ kind: "idle" | "timeout"; id: number } | null>(null);
  // Filled after scheduleVisibilityScan is defined — a stale detach (fired
  // from an unmounted FrameView's deferred cleanup) can land after the frame
  // was already re-mounted (delete → undo inside the timer window) and wipes
  // the fresh bookkeeping; the rescan remounts a frame that still exists.
  const rescanAfterDetachRef = useRef<(() => void) | null>(null);

  const cancelMountPump = useCallback(() => {
    const handle = mountPumpRef.current;
    if (handle === null) return;
    mountPumpRef.current = null;
    if (handle.kind === "idle" && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(handle.id);
    } else {
      window.clearTimeout(handle.id);
    }
  }, []);

  // Clears every mount-related ref — used on project switches/replaces where
  // the frame set changes wholesale.
  const resetMountRefs = useCallback(() => {
    cancelMountPump();
    pendingMountIdsRef.current = [];
    queuedMountIdsRef.current.clear();
    for (const timer of inFlightMountsRef.current.values()) window.clearTimeout(timer);
    inFlightMountsRef.current.clear();
    mountedFrameIdsRef.current.clear();
    pinnedFrameIdsRef.current.clear();
    dirtyFrameIdsRef.current.clear();
    // A wholesale frame-set swap kills any in-flight text edit too — the set
    // gates the top-level keyboard handler, so a stale entry would lock
    // canvas shortcuts for the rest of the session.
    frameTextEditRef.current.clear();
    setTextEditingNode(null);
    // Shift/revision trackers are per-mount-session state too — frame ids can
    // recur across projects ("frame-1"), and a stale shift would double-apply
    // to an unrelated frame with the same id.
    freeformShiftRef.current.clear();
    frameDocRevisionsRef.current.clear();
    for (const timer of docSyncTimersRef.current.values()) window.clearTimeout(timer);
    docSyncTimersRef.current.clear();
    pendingDocWritesRef.current.clear();
  }, [cancelMountPump]);

  const scheduleMountPump = useCallback((pump: () => void) => {
    if (mountPumpRef.current !== null) return;
    // Idle-scheduled so mount work always yields to input and rendering.
    if (typeof window.requestIdleCallback === "function") {
      mountPumpRef.current = { kind: "idle", id: window.requestIdleCallback(pump, { timeout: 150 }) };
    } else {
      mountPumpRef.current = { kind: "timeout", id: window.setTimeout(pump, 24) };
    }
  }, []);

  // Distance from a frame's center to the viewport center — the swap/eviction
  // ordering key. Unknown frames sort as infinitely far.
  const frameDistanceSq = useCallback((id: string) => {
    const frame = editorStore.getState().frames[id];
    if (!frame) return Number.POSITIVE_INFINITY;
    const rect = getVisibleWorldRect(cameraRef.current, viewportRef.current, 0);
    const dx = frame.x + frame.width / 2 - (rect.x + rect.width / 2);
    const dy = frame.y + frame.height / 2 - (rect.y + rect.height / 2);
    return dx * dx + dy * dy;
  }, [editorStore]);

  const releaseInFlightMount = useCallback((id: string) => {
    const timer = inFlightMountsRef.current.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    inFlightMountsRef.current.delete(id);
  }, []);

  // Drops the farthest-from-view unpinned mounts when over cap. Returns true
  // when anything changed so callers can flush one setLiveFrameIds.
  const evictOverflowMounts = useCallback(() => {
    const mounted = mountedFrameIdsRef.current;
    if (mounted.size <= MAX_MOUNTED_FRAMES) return false;
    let evicted = false;
    for (const { id } of mountEvictionCandidates(mounted, pinnedFrameIdsRef.current, frameDistanceSq)) {
      if (mounted.size <= MAX_MOUNTED_FRAMES) break;
      mounted.delete(id);
      releaseInFlightMount(id);
      evicted = true;
    }
    return evicted;
  }, [frameDistanceSq, releaseInFlightMount]);

  const grantMount = useCallback((id: string, options?: { force?: boolean }) => {
    const mounted = mountedFrameIdsRef.current;
    if (mounted.has(id)) return true;
    // A queued id can outlive its frame — a delete landing between the scan
    // and the grant must not mint a phantom mount (and its failsafe timer).
    if (!editorStore.getState().frames[id]) return false;
    if (mounted.size >= MAX_MOUNTED_FRAMES) {
      // At cap a scan mount only proceeds by displacing a strictly farther
      // unpinned mount — otherwise the iframe cost is pure churn. Interaction
      // mounts are forced: the user just pointed at this frame, it must load.
      const [farthest] = mountEvictionCandidates(mounted, pinnedFrameIdsRef.current, frameDistanceSq);
      if (farthest && (options?.force || frameDistanceSq(id) < farthest.distanceSq)) {
        mounted.delete(farthest.id);
        releaseInFlightMount(farthest.id);
      } else if (!options?.force) {
        return false;
      }
      // Forced with nothing evictable (all pinned) exceeds the cap — user
      // intent wins over the budget.
    }
    mounted.add(id);
    inFlightMountsRef.current.set(id, setTimeout(() => {
      inFlightMountsRef.current.delete(id);
      scheduleMountPumpRef.current?.();
    }, MOUNT_READY_TIMEOUT_MS));
    return true;
  }, [editorStore, frameDistanceSq, releaseInFlightMount]);

  // Bridge mutations exist only in the iframe's DOM — srcDoc still holds the
  // document as loaded. Debounce a read-back so the fresh document is staged
  // for the next serialize pass without reloading the iframe mid-session.
  const scheduleDocumentSync = useCallback((frameId: string) => {
    const timers = docSyncTimersRef.current;
    const existing = timers.get(frameId);
    if (existing !== undefined) window.clearTimeout(existing);
    timers.set(frameId, window.setTimeout(() => {
      timers.delete(frameId);
      const frame = editorStore.getState().frames[frameId];
      const controller = bridgeControllersRef.current.get(frameId);
      const document = frame ? editorStore.getState().documents[frame.documentId] : undefined;
      if (!frame || !controller || !document) return;
      // Captured before the async read — a project switch mid-flight (e.g.
      // opening a duplicated project, which reuses document ids and
      // revisions) must not let this read stage the old project's HTML.
      const projectId = getActiveProjectId();
      void controller.readDocument().then((html) => {
        if (html.length === 0 || html === document.srcDoc) return;
        const state = editorStore.getState();
        if (
          getActiveProjectId() !== projectId ||
          state.frames[frameId]?.documentId !== document.id ||
          state.documents[document.id]?.revision !== document.revision
        ) return;
        pendingDocWritesRef.current.set(document.id, { html, revision: document.revision });
        // A save may have run between the mutation and this read-back — without
        // re-scheduling, the harvested document can sit unsaved until the next
        // unrelated store change.
        scheduleAutosaveRef.current?.();
      }).catch(() => undefined);
    }, 350));
  }, [editorStore]);

  // A mutating bridge command landed on this frame — its document now carries
  // DOM edits the srcDoc lacks, so it must stay mounted until the read-back
  // can capture them.
  const markFrameDirty = useCallback((frameId: string) => {
    dirtyFrameIdsRef.current.add(frameId);
    pinnedFrameIdsRef.current.add(frameId);
    scheduleDocumentSync(frameId);
  }, [scheduleDocumentSync]);


  // Called when a mounted frame completes bridge init (first snapshot) — frees
  // an in-flight slot so the next queued frame can load.
  const markFrameInitialized = useCallback((id: string) => {
    if (!inFlightMountsRef.current.has(id)) return;
    releaseInFlightMount(id);
    scheduleMountPumpRef.current?.();
  }, [releaseInFlightMount]);

  // Iframe creation + srcDoc parse is the heaviest per-frame cost the canvas
  // has. Mount bursts (a pan sweeping new frames into view) are queued,
  // deduplicated, and drained at most MAX_INFLIGHT_MOUNTS concurrent loads —
  // and ONLY while idle: a mount inside a pan/zoom gesture steals the frame
  // the transform update needs. The queue resumes on settle and on each
  // frame's readiness signal.
  const flushMountQueue = useCallback(() => {
    mountPumpRef.current = null;
    if (interactionModeRef.current !== "idle") return;
    const pending = pendingMountIdsRef.current;
    const queued = queuedMountIdsRef.current;
    const mounted = mountedFrameIdsRef.current;
    let changed = false;
    while (pending.length > 0 && inFlightMountsRef.current.size < MAX_INFLIGHT_MOUNTS) {
      const id = pending.shift()!;
      queued.delete(id);
      if (mounted.has(id)) continue;
      if (grantMount(id)) changed = true;
      // A denied grant (at cap, not closer) just drops — the next scan
      // re-queues it if the camera moves it into range.
    }
    if (evictOverflowMounts()) changed = true;
    if (changed) setLiveFrameIds(new Set(mounted));
    if (pending.length > 0 && inFlightMountsRef.current.size < MAX_INFLIGHT_MOUNTS) {
      scheduleMountPump(flushMountQueue);
    }
    // When the in-flight window is full the pump waits — markFrameInitialized
    // or a failsafe timer restarts it.
  }, [evictOverflowMounts, grantMount, scheduleMountPump]);

  // Ref indirection so the failsafe timers (created before the callbacks they
  // reference) always reach the latest pump.
  const scheduleMountPumpRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    scheduleMountPumpRef.current = () => {
      if (pendingMountIdsRef.current.length === 0) return;
      scheduleMountPump(flushMountQueue);
    };
  }, [scheduleMountPump, flushMountQueue]);

  const ensureFramesLive = useCallback((ids: Iterable<string>, options?: { pin?: boolean }) => {
    const mounted = mountedFrameIdsRef.current;
    const fresh: string[] = [];
    for (const id of ids) {
      if (options?.pin) pinnedFrameIdsRef.current.add(id);
      if (mounted.has(id)) continue;
      if (options?.pin) {
        // A scan-queued frame the user just interacted with is promoted out
        // of the queue — it mounts like a fresh interaction mount instead of
        // waiting its turn behind scan work.
        queuedMountIdsRef.current.delete(id);
        const pendingIndex = pendingMountIdsRef.current.indexOf(id);
        if (pendingIndex !== -1) pendingMountIdsRef.current.splice(pendingIndex, 1);
        fresh.push(id);
      } else if (!queuedMountIdsRef.current.has(id)) {
        fresh.push(id);
      }
    }
    if (fresh.length === 0) return;
    // Interaction mounts (selection, creation, the frame under the pointer)
    // apply right away — callers reach for the bridge immediately after, and
    // they must not queue behind a scan backlog the user never asked for.
    // Visibility-scan mounts ALWAYS queue: an un-gated immediate grant lands
    // an iframe load mid-gesture (wheel pans idle in 150ms gaps, so scan
    // pushes during those gaps were mounting synchronously and hitching the
    // next tick).
    if (options?.pin && fresh.length <= 4) {
      for (const id of fresh) grantMount(id, { force: true });
      evictOverflowMounts();
      setLiveFrameIds(new Set(mounted));
      return;
    }
    // A pinned burst larger than the immediate grant limit still jumps the
    // queue — the user is waiting on it ahead of any scan mount.
    if (options?.pin) pendingMountIdsRef.current.unshift(...fresh);
    else pendingMountIdsRef.current.push(...fresh);
    for (const id of fresh) queuedMountIdsRef.current.add(id);
    if (interactionModeRef.current === "idle") scheduleMountPump(flushMountQueue);
    // Mid-gesture pushes wait for the settle effect below to restart the pump.
  }, [evictOverflowMounts, flushMountQueue, grantMount, scheduleMountPump]);

  // The mount pump pauses while a gesture runs — resume draining shortly after
  // the interaction settles so frames pop in right after the pointer releases.
  // The delay doubles as a quiet period: wheel pans idle briefly between ticks
  // and a mount landing mid-stream is exactly the hitch this avoids.
  useEffect(() => {
    if (interactionMode !== "idle") return;
    if (pendingMountIdsRef.current.length === 0 || mountPumpRef.current !== null) return;
    mountPumpRef.current = { kind: "timeout", id: window.setTimeout(flushMountQueue, 350) };
  }, [interactionMode, flushMountQueue]);

  const setSelectedFrameId = useCallback(
    (frameId: string | null) => {
      if (frameId) ensureFramesLive([frameId], { pin: true });
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
    [editorStore, ensureFramesLive],
  );

  // Selection implies imminent interaction — pin selected frames so they stay
  // mounted, including programmatic selections (agent pushes, paste) that skip
  // setSelectedFrameId. When a frame leaves the selection its pin is released
  // unless it's dirty: without the release every click grows the pin set, and
  // past ~64 unique selections the cap starves scan mounts entirely — visible
  // untouched frames would stay placeholders for the rest of the session.
  useEffect(() => {
    const pinned = pinnedFrameIdsRef.current;
    const dirty = dirtyFrameIdsRef.current;
    const selected = editorState.selection.frameIds;
    for (const frameId of selected) {
      if (editorStore.getState().frames[frameId]) ensureFramesLive([frameId], { pin: true });
    }
    for (const id of [...pinned]) {
      // A frame with an open text-edit session keeps its pin even before the
      // commit marks it dirty — evicting it mid-edit would lose the typing.
      if (!selected.includes(id) && !dirty.has(id) && !frameTextEditRef.current.has(id)) {
        pinned.delete(id);
      }
    }
  }, [editorState.selection, editorStore, ensureFramesLive]);

  // A document revision bump means the srcDoc/mode changed and the iframe
  // reloads (replaceHtml, agent push, token rename rewrite). The fresh
  // document carries none of the old document's live state — no <body>
  // transform, no DOM edits, no text-edit session — so trackers that mirror
  // live state would desync (double-applied shifts, a dirty flag pinning an
  // unloaded edit, a stale text-edit flag locking every canvas shortcut).
  useEffect(() => {
    const seen = frameDocRevisionsRef.current;
    const live = new Set<string>();
    for (const frame of Object.values(editorState.frames)) {
      live.add(frame.id);
      const revision = editorState.documents[frame.documentId]?.revision ?? 0;
      const last = seen.get(frame.id);
      if (last !== undefined && last !== revision) {
        freeformShiftRef.current.delete(frame.id);
        dirtyFrameIdsRef.current.delete(frame.id);
        pendingDocWritesRef.current.delete(frame.documentId);
        frameTextEditRef.current.delete(frame.id);
        setTextEditingNode((current) => (current?.frameId === frame.id ? null : current));
        // The pin mirrored the just-cleared dirty/edit state — release it now
        // unless the selection independently keeps this frame mounted.
        if (!editorState.selection.frameIds.includes(frame.id)) {
          pinnedFrameIdsRef.current.delete(frame.id);
        }
      }
      seen.set(frame.id, revision);
    }
    for (const id of [...seen.keys()]) if (!live.has(id)) seen.delete(id);
  }, [editorState.frames, editorState.documents, editorState.selection.frameIds]);

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
      setPendingCanvasCategory(null);
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

  // Derived canvas category for the active project — drives Dock presets, tool palette, and future agent.md.
  const activeCanvasCategory: CanvasCategory = useMemo(() => {
    if (pendingCanvasCategory) return pendingCanvasCategory;
    if (pendingKindRef.current) return getCanvasCategoryForKind(pendingKindRef.current);
    if (shouldUseLocalMemory) {
      const lookupId = activeProjectId ?? routeProjectId;
      if (lookupId) {
        const rec = localProjects.find((p) => p.id === lookupId) ?? loadProjectIndex().find((p) => p.id === lookupId);
        if (rec) return getCanvasCategoryForKind(rec.kind);
      }
    }
    // Infer from first project kind if available, else website default (covers demo/disabled persistence).
    if (localProjects.length > 0) return getCanvasCategoryForKind(localProjects[0]!.kind);
    return "website";
  }, [pendingCanvasCategory, persistenceVersion, localProjects, activeProjectId, routeProjectId, shouldUseLocalMemory]);

  const handleCreateLakeProject = useCallback(
    (kind: ProjectKind) => {
      pendingKindRef.current = kind;
      setPendingCanvasCategory(getCanvasCategoryForKind(kind));
      let createdId: string | null = null;
      if (shouldUseLocalMemory) {
        const id = createProjectId();
        createdId = id;
        const name = `${PROJECT_KINDS.find((k) => k.id === kind)?.label ?? kind} · ${new Date().toLocaleDateString()}`;
        const blank = createEmptyEditorState();
        const serialized = serializeWireCanvasProjectCompact(blank);
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
          pendingSnapshotUiRef.current.hierarchies = {};
          pendingSnapshotUiRef.current.targets = {};
        } catch {}
      }
      setShowLakeOverlay(false);
      if (shouldUseLocalMemory && createdId) {
        const targetId = createdId;
        setTimeout(() => {
          startBrainstorming(kind);
          setTimeout(() => {
            try {
              const state = applyPendingDocumentWrites(editorStore.getState(), pendingDocWritesRef.current);
              const serialized = serializeWireCanvasProjectCompact(state);
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
        showPersistenceFeedback({ kind: "error", message: "That project could not be found in this browser." });
        refreshLocalProjects();
        return;
      }
      try {
        const loaded = loadEditorStateForProjectDetailed(id);
        if (!loaded) {
          showPersistenceFeedback({
            kind: "error",
            message: `Could not open “${rec.name}” — its saved data is damaged beyond repair.`,
          });
          refreshLocalProjects();
          return;
        }
        const next = loaded.state;
        clearComments();
        setShaderElements([]);
        setSelectedShaderElementId(null);
        resetMountRefs();
        bridgeControllersRef.current.clear();
        snapshotQueuesRef.current.clear();
        snapshotSequenceRef.current.clear();
        setBridgeTargets({});
        setBridgeHierarchies({});
        pendingSnapshotUiRef.current.hierarchies = {};
        pendingSnapshotUiRef.current.targets = {};
        editorStore.replaceState(next, { label: `Open ${rec.name}` });
        setActiveProjectId(id);
        setActiveProjectIdState(id);
        setRouteProjectId(id);
        setRouteNotFound(false);
        navigateToProject(id);
        // Opening is a read, not an edit: leave updatedAt / lake order alone
        // so "Recently viewed" and relative timestamps stay honest.
        refreshLocalProjects();
        setPersistenceVersion((v) => v + 1);
        setShowLakeOverlay(false);
        showPersistenceFeedback(
          loaded.source === "primary"
            ? { kind: "success", message: `Opened “${rec.name}”. Continuing where you left off.` }
            : {
                kind: "success",
                message: `Opened “${rec.name}” — the saved file was damaged and has been repaired automatically.`,
              },
        );
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
              const nextCam = fitRectWithInsets(bounds, vp, fitInsets(vp));
              cameraRef.current = nextCam;
              setCamera(nextCam);
            }
          }
        }, 80);
      } catch (error) {
        showPersistenceFeedback({
          kind: "error",
          message: `Could not open project: ${error instanceof Error ? error.message : "parse failed"}`,
        });
      }
    },
    [clearComments, editorStore, refreshLocalProjects, resetMountRefs],
  );

  const handleDeleteLakeProject = useCallback(
    (id: string) => {
      const isActive = getActiveProjectId() === id || routeProjectId === id;
      const nextIdx = deleteLocalProject(id);
      if (!nextIdx) {
        refreshLocalProjects();
        showPersistenceFeedback({ kind: "error", message: "Could not delete that project — storage is unavailable." });
        return;
      }
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
        pendingSnapshotUiRef.current.hierarchies = {};
        pendingSnapshotUiRef.current.targets = {};
        showPersistenceFeedback({ kind: "success", message: "Project deleted. Returned to home." });
      } else {
        showPersistenceFeedback({ kind: "success", message: "Project deleted." });
      }
    },
    [editorStore, routeProjectId],
  );

  const handleDuplicateLakeProject = useCallback(
    (id: string) => {
      const dup = duplicateLocalProject(id);
      if (!dup) {
        showPersistenceFeedback({ kind: "error", message: "Could not duplicate that project." });
        return;
      }
      refreshLocalProjects();
      showPersistenceFeedback({ kind: "success", message: `Duplicated as “${dup.name}”.` });
    },
    [refreshLocalProjects],
  );

  const handleRenameLakeProject = useCallback(
    (id: string, name: string) => {
      if (!renameLocalProject(id, name)) {
        refreshLocalProjects();
        showPersistenceFeedback({ kind: "error", message: "Could not rename that project." });
        return;
      }
      refreshLocalProjects();
      showPersistenceFeedback({ kind: "success", message: "Project renamed." });
    },
    [refreshLocalProjects],
  );

  const exportProject = useCallback(() => {
    if (editorStore.getState().session.lifecycle === "not-started") {
      showPersistenceFeedback({ kind: "error", message: "Start a brainstorming session before exporting." });
      return;
    }
    try {
      downloadAdapterRef.current?.downloadProjectFile({
        text: serializeWireCanvasProject(applyPendingDocumentWrites(editorStore.getState(), pendingDocWritesRef.current)),
        filename: WIRECANVAS_FILE_NAME,
        mimeType: WIRECANVAS_FILE_MIME_TYPE,
      });
      showPersistenceFeedback({ kind: "success", message: "Project exported as a .wirecanvas.json file." });
    } catch (error) {
      showPersistenceFeedback({
        kind: "error",
        message: `Could not export project: ${error instanceof Error ? error.message : "download failed"}`,
      });
    }
  }, [editorStore]);

  const exportFigmaProject = useCallback(async () => {
    if (editorStore.getState().session.lifecycle === "not-started") {
      showPersistenceFeedback({ kind: "error", message: "Start a brainstorming session before exporting." });
      return;
    }
    try {
      const state = editorStore.getState();
      const orderedPages = Object.values(state.documents)
        .flatMap((document) => document.pageIds)
        .map((id) => state.pages[id])
        .filter((page): page is PageEntity => Boolean(page));
      for (const page of Object.values(state.pages)) {
        if (!orderedPages.includes(page)) orderedPages.push(page);
      }
      const bytes = await serializeFigmaProject({
        frames: Object.values(state.frames),
        nodes: state.nodes,
        bridgeTargets,
        pages: orderedPages,
      });
      downloadAdapterRef.current?.downloadProjectFile({
        text: bytes,
        filename: FIGMA_FILE_NAME,
        mimeType: FIGMA_FILE_MIME_TYPE,
      });
      showPersistenceFeedback({ kind: "success", message: "Project exported as a Figma .fig file." });
    } catch (error) {
      showPersistenceFeedback({
        kind: "error",
        message: `Could not export Figma file: ${error instanceof Error ? error.message : "download failed"}`,
      });
    }
  }, [bridgeTargets, editorStore]);

  const exportCodeProject = useCallback(() => {
    if (editorStore.getState().session.lifecycle === "not-started") {
      showPersistenceFeedback({ kind: "error", message: "Start a brainstorming session before exporting." });
      return;
    }
    try {
      const state = editorStore.getState();
      const activeId = getActiveProjectId();
      const record = shouldUseLocalMemory && activeId
        ? loadProjectIndex().find((p) => p.id === activeId)
        : undefined;
      const projectName = deriveProjectName(state, record?.kind ?? pendingKindRef.current ?? "blank");
      const payload = buildCodeExportPayload(state, projectName);
      if (!payload) {
        showPersistenceFeedback({
          kind: "error",
          message: "There is no page code to export yet — design a frame first.",
        });
        return;
      }
      downloadAdapterRef.current?.downloadProjectFile({
        text: payload.text,
        filename: payload.filename,
        mimeType: payload.mimeType,
      });
      showPersistenceFeedback({
        kind: "success",
        message: payload.fileCount === 1
          ? `Exported your design as ${payload.filename} — open it in any browser.`
          : `Exported ${payload.fileCount} pages of code as ${payload.filename}.`,
      });
    } catch (error) {
      showPersistenceFeedback({
        kind: "error",
        message: `Could not export code: ${error instanceof Error ? error.message : "download failed"}`,
      });
    }
  }, [editorStore, shouldUseLocalMemory]);

  const exportReactProject = useCallback(() => {
    if (editorStore.getState().session.lifecycle === "not-started") {
      showPersistenceFeedback({ kind: "error", message: "Start a brainstorming session before exporting." });
      return;
    }
    try {
      const state = editorStore.getState();
      const activeId = getActiveProjectId();
      const record = shouldUseLocalMemory && activeId
        ? loadProjectIndex().find((p) => p.id === activeId)
        : undefined;
      const projectName = deriveProjectName(state, record?.kind ?? pendingKindRef.current ?? "blank");
      const payload = buildReactExportPayload(state, projectName);
      if (!payload) {
        showPersistenceFeedback({
          kind: "error",
          message: "There is no page code to export yet — design a frame first.",
        });
        return;
      }
      downloadAdapterRef.current?.downloadProjectFile({
        text: payload.text,
        filename: payload.filename,
        mimeType: payload.mimeType,
      });
      const warnings = payload.notes.filter((note) => note.severity === "warning").length;
      showPersistenceFeedback({
        kind: "success",
        message: warnings === 0
          ? `Exported a runnable React project as ${payload.filename} — unzip and run npm install && npm run dev.`
          : `Exported ${payload.filename} — ${warnings} fidelity note${warnings === 1 ? "" : "s"} listed in the bundled README.`,
      });
    } catch (error) {
      showPersistenceFeedback({
        kind: "error",
        message: `Could not export React project: ${error instanceof Error ? error.message : "download failed"}`,
      });
    }
  }, [editorStore, shouldUseLocalMemory]);

  const importProject = useCallback(async (file: File) => {
    try {
      const text = await persistenceAdapterRef.current!.readProjectFile(file);
      const result = importWireCanvasProject(editorStore, text);
      if (result.changed) {
        clearComments();
        setShaderElements([]);
        setSelectedShaderElementId(null);
        bridgeControllersRef.current.clear();
        snapshotQueuesRef.current.clear();
        snapshotSequenceRef.current.clear();
        setBridgeTargets({});
        setBridgeHierarchies({});
        pendingSnapshotUiRef.current.hierarchies = {};
        pendingSnapshotUiRef.current.targets = {};
        setPersistenceVersion((current) => current + 1);
        showPersistenceFeedback({ kind: "success", message: "Project imported successfully." });
        if (shouldUseLocalMemory) {
          const state = applyPendingDocumentWrites(editorStore.getState(), pendingDocWritesRef.current);
          const serialized = serializeWireCanvasProjectCompact(state);
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
        showPersistenceFeedback({ kind: "success", message: "This project already matches the current canvas." });
      }
    } catch (error) {
      const message = error instanceof WireCanvasCodecError
        ? error.message
        : error instanceof Error
          ? error.message
          : "The project could not be imported.";
      showPersistenceFeedback({ kind: "error", message: `Could not import project: ${message}` });
    }
  }, [clearComments, editorStore, shouldUseLocalMemory, refreshLocalProjects]);


  // Continuous memory autosave — every meaningful editor change is persisted to this device
  useEffect(() => {
    if (!shouldUseLocalMemory) return;
    const schedule = () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(() => {
        // Serialization + localStorage write is expensive on large projects —
        // run it at idle time so it can't steal a frame from interactions.
        const run = () => {
        try {
          const state = applyPendingDocumentWrites(editorStore.getState(), pendingDocWritesRef.current);
          const isEmpty =
            state.session.lifecycle === "not-started" &&
            Object.keys(state.documents).length === 0 &&
            Object.keys(state.frames).length === 0 &&
            Object.keys(state.pages).length === 0;
          if (isEmpty) return;
          const serialized = serializeWireCanvasProjectCompact(state);
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
            if (!saveProjectIndex(idx)) {
              if (!autosaveQuotaWarnedRef.current) {
                autosaveQuotaWarnedRef.current = true;
                showPersistenceFeedback({ kind: "error", message: "Browser storage is full — new changes are not being saved. Export or delete a project to free space." });
              }
              return;
            }
            autosaveQuotaWarnedRef.current = false;
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
          if (!saveProjectIndex(without)) {
            if (!autosaveQuotaWarnedRef.current) {
              autosaveQuotaWarnedRef.current = true;
              showPersistenceFeedback({ kind: "error", message: "Browser storage is full — new changes are not being saved. Export or delete a project to free space." });
            }
            return;
          }
          autosaveQuotaWarnedRef.current = false;
          setLocalProjects(without.map(({ data: _d, ...rest }) => rest));
        } catch {}
        };
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(run, { timeout: 2000 });
        } else {
          run();
        }
      }, 650);
    };
    const unsub = editorStore.subscribe(schedule);
    scheduleAutosaveRef.current = schedule;
    // initial schedule in case hydrated state is already non-empty
    schedule();
    return () => {
      scheduleAutosaveRef.current = null;
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      unsub();
    };
  }, [editorStore, shouldUseLocalMemory]);

  // Agent bridge: the Vite plugin (vite-plugin-canvas-agent.ts) exposes a
  // loopback inbox that local Claude/Codex sessions push HTML/CSS into. Runs
  // on dev servers automatically; ?agent=1 opts in on preview builds.
  useEffect(() => {
    const enabled =
      import.meta.env.DEV ||
      new URLSearchParams(window.location.search).has("agent");
    if (!enabled) return;
    return startAgentBridge(editorStore);
  }, [editorStore]);

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
        const rec = loadProjectIndex().find((p) => p.id === nextId);
        const loaded = loadEditorStateForProjectDetailed(nextId);
        if (rec && loaded) {
          setRouteNotFound(false);
          try {
            const next = loaded.state;
            clearComments();
            setShaderElements([]);
            setSelectedShaderElementId(null);
            bridgeControllersRef.current.clear();
            snapshotQueuesRef.current.clear();
            snapshotSequenceRef.current.clear();
            setBridgeTargets({});
            setBridgeHierarchies({});
            pendingSnapshotUiRef.current.hierarchies = {};
            pendingSnapshotUiRef.current.targets = {};
            editorStore.replaceState(next, { label: `Navigate to ${rec.name}` });
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
                  const nextCam = fitRectWithInsets(bounds, vp, fitInsets(vp));
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

  // Bridge-reported bounds are measured inside the (possibly shifted) <body>:
  // rendered = canonical - shift. Stored targets are normalized into the
  // body's unshifted coordinate space (+shift on intake) so toOverlayTarget
  // only ever subtracts the live shift and reports true world bounds.
  const shiftBridgeTarget = useCallback(
    (frameId: string, target: BridgeElementTarget): BridgeElementTarget => {
      const shift = freeformShiftRef.current.get(frameId);
      if (!shift || (shift.x === 0 && shift.y === 0)) return target;
      if (!editorStore.getState().frames[frameId]?.freeform) return target;
      return {
        ...target,
        bounds: {
          ...target.bounds,
          x: target.bounds.x + shift.x,
          y: target.bounds.y + shift.y,
        },
      };
    },
    [editorStore],
  );

  const toOverlayTarget = useCallback(
    (entry: OverlayBridgeTargetState): OverlayNodeTarget | null => {
      const frame = editorStore.getState().frames[entry.frameId];
      if (!frame) return null;
      const shift = frame.freeform
        ? freeformShiftRef.current.get(entry.frameId)
        : undefined;
      const transform = entry.inspection?.inlineStyle.transform ?? entry.inspection?.computedStyle.transform;
      const parsedRotation = transform ? parseTransform(transform)?.rotation ?? 0 : 0;
      const bounds = {
        x: frame.x + FRAME_CONTENT_INSET + entry.target.bounds.x - (shift?.x ?? 0),
        y: frame.y + FRAME_CONTENT_INSET + entry.target.bounds.y - (shift?.y ?? 0),
        width: entry.target.bounds.width,
        height: entry.target.bounds.height,
      };
      // The measured AABB rotated by `rotation` would double-apply the angle —
      // reconstruct the unrotated rect (same center, laid-out size) so the
      // overlay can paint the element's real box.
      let canonicalBounds: Rect | undefined;
      if (Math.abs(parsedRotation) > 0.01) {
        const width = cssPixelValue(
          entry.inspection?.inlineStyle.width ?? entry.inspection?.computedStyle.width,
        );
        const height = cssPixelValue(
          entry.inspection?.inlineStyle.height ?? entry.inspection?.computedStyle.height,
        );
        if (width !== null && height !== null && width > 0 && height > 0) {
          canonicalBounds = {
            x: bounds.x + bounds.width / 2 - width / 2,
            y: bounds.y + bounds.height / 2 - height / 2,
            width,
            height,
          };
        }
      }
      return {
        frameId: entry.frameId,
        nodeId: entry.target.elementId,
        tagName: entry.target.tagName,
        name: entry.target.name,
        bounds,
        locked: editorStore.getState().nodes[entry.target.elementId]?.locked ?? entry.target.locked,
        rotation: parsedRotation || undefined,
        canonicalBounds,
      };
    },
    [editorStore],
  );

  const openImagePicker = useCallback(() => {
    const selectedFrameId = editorStore.getState().selection.primaryFrameId;
    if (!pendingImageRef.current && !pendingCanvasImageRef.current) {
      if (selectedFrameId) {
        pendingImageRef.current = {
          frameId: selectedFrameId,
          bounds: { x: 48, y: 48, width: 160, height: 120 },
        };
      } else {
        // No frame needed: the image lands as a freeform element at the
        // current viewport center.
        const center = screenToWorld(
          { x: viewport.width / 2, y: viewport.height / 2 },
          cameraRef.current,
        );
        pendingCanvasImageRef.current = {
          x: center.x - 80,
          y: center.y - 60,
          width: 160,
          height: 120,
        };
      }
    }
    if (!pendingImageRef.current && !pendingCanvasImageRef.current) {
      setCreationError("Select a live frame before choosing an image.");
      return;
    }
    const input = imageInputRef.current;
    if (!input) {
      setCreationError("The image picker is unavailable. Try selecting the Image tool again.");
      return;
    }
    setCreationError(null);
    imagePickerOpenRef.current = true;
    input.click();
  }, [editorStore, viewport]);

  const beginCreationPointer = useCallback((frameId: string, point: Point, pointerId: number) => {
    const tool = activeToolRef.current;
    if (!isCreationTool(tool)) return;
    ensureFramesLive([frameId], { pin: true });
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
  }, [ensureFramesLive]);

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
    // The committed bounds use the same 1px floor as the drag preview so the
    // created shape lands exactly where the preview left it — no snap.
    const bounds = normalizedBounds(operation.start, point, 1);
    // A sub-threshold "drag" is a click — it must not mint a degenerate shape.
    const dragDistance = Math.max(Math.abs(point.x - operation.start.x), Math.abs(point.y - operation.start.y));
    if (operation.tool === "image") {
      pendingImageRef.current = {
        frameId,
        bounds: dragDistance < MIN_SHAPE_DRAG ? { x: operation.start.x, y: operation.start.y, width: 160, height: 120 } : bounds,
      };
      openImagePicker();
      return;
    }
    if (operation.tool !== "text" && dragDistance < MIN_SHAPE_DRAG) return;
    const shape = activeShapeRef.current;
    const kind: BridgeCreationKind = operation.tool === "text" ? "text" : shape;
    // Returned to the caller so the drag preview can stay up until the bridge
    // acks the new element — releasing the pointer then swaps preview for the
    // real shape with no blank frame in between.
    return createLiveElementRef.current(frameId, {
      command: "create-element",
      elementId: createElementId(kind),
      kind,
      bounds: kind === "text" ? textPlacementBounds(bounds) : bounds,
      ...(kind === "text" ? { text: "Type to edit", editable: true } : { points: shapeDragPoints(shape, operation.start, point) }),
      fill: kind === "text" ? "#171717" : "#d9d9d9",
      stroke: kind === "text" ? "#171717" : "#222222",
      strokeWidth: kind === "line" || kind === "arrow" ? 2 : 0,
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

  const buildBridgeEventContext = useCallback((iframeEl: HTMLIFrameElement, surfaceEl: HTMLElement) => {
    const surfaceRect = surfaceRectRef.current ?? surfaceEl.getBoundingClientRect();
    const iframeRect = iframeEl.getBoundingClientRect();
    return {
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
  }, []);

  const handleBridgeEvent = useCallback(
    (frameId: string, message: BridgeEventMessage, iframe: HTMLIFrameElement) => {
      const surface = surfaceRef.current;
      const frame = editorStore.getState().frames[frameId];
      if (!surface || !frame) return;

      if (message.event === "text-edit-start") {
        frameTextEditRef.current.add(frameId);
        // An open edit session is in-flight user work — keep the frame
        // mounted until it commits or cancels (the commit marks it dirty).
        pinnedFrameIdsRef.current.add(frameId);
        setTextEditingNode({ frameId, nodeId: message.target?.elementId ?? "" });
      } else if (message.event === "text-commit" || message.event === "text-cancel") {
        frameTextEditRef.current.delete(frameId);
        setTextEditingNode((current) => (current?.frameId === frameId ? null : current));
      }

      const currentTool = activeToolRef.current;
      const currentShape = activeShapeRef.current;
      const isCreationToolActive = isCreationTool(currentTool);
      if (message.event === "pointerdown" && isCreationToolActive) {
        // The creation layer normally intercepts this press, but wherever it
        // reaches the iframe the same rule holds: creation edits live DOM, so
        // the frame must be pinned against eviction like beginCreationPointer.
        ensureFramesLive([frameId], { pin: true });
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
        const bounds = normalizedBounds(operation.start, message.point, 1);
        // A sub-threshold "drag" is a click — it must not mint a degenerate shape.
        const dragDistance = Math.max(Math.abs(message.point.x - operation.start.x), Math.abs(message.point.y - operation.start.y));
        if (operation.tool === "image") {
          if (dragDistance >= MIN_SHAPE_DRAG) pendingImageRef.current = { frameId, bounds };
        } else if (operation.tool === "text" || dragDistance >= MIN_SHAPE_DRAG) {
          const kind: BridgeCreationKind = operation.tool === "text" ? "text" : currentShape;
          const command = {
            command: "create-element" as const,
            elementId: createElementId(kind),
            kind,
            bounds: kind === "text" ? textPlacementBounds(bounds) : bounds,
            ...(kind === "text" ? { text: "Type to edit", editable: true } : { points: shapeDragPoints(currentShape, operation.start, message.point) }),
            fill: kind === "text" ? "#171717" : "#d9d9d9",
            stroke: kind === "text" ? "#171717" : "#222222",
            strokeWidth: kind === "line" || kind === "arrow" ? 2 : 0,
            radius: shapeRadiusRef.current,
          };
          void createLiveElementRef.current(frameId, command, kind === "text" ? "Create text" : `Create ${currentShape}`);
        }
        return;
      }
      if (message.event === "keydown") {
        // While the frame's text editor is open, keys edit text — the bridge
        // runtime already handles Escape/Enter locally; nothing else runs.
        if (frameTextEditRef.current.has(frameId)) return;
        // Clicking inside a frame moves keyboard focus into the iframe, so the
        // top-level keydown listener never sees these keys. Forward the full
        // shortcut surface so tool keys, fit-all and Escape still work.
        const action = resolveEditorShortcut({
          key: message.key ?? "",
          metaKey: message.metaKey,
          ctrlKey: message.ctrlKey,
          shiftKey: message.shiftKey,
          altKey: message.altKey,
        });
        if (action) runEditorShortcutRef.current(action);
        return;
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

      // Hover is the highest-frequency bridge event — stash it and do the
      // layout reads (getBoundingClientRect) inside one rAF batch instead of
      // forcing sync layout on every message.
      if (message.event === "hover") {
        pendingHoverRef.current = { frameId, target: message.target, iframe, point: message.point };
        if (hoverRafRef.current === null) {
          hoverRafRef.current = requestAnimationFrame(() => {
            hoverRafRef.current = null;
            const pending = pendingHoverRef.current;
            pendingHoverRef.current = undefined;
            if (pending == null) return;
            const pendingTarget = pending.target;
            if (!pendingTarget) {
              lastBridgeTargetRef.current = null;
              setHoveredOverlayTarget(null);
              return;
            }
            const context = buildBridgeEventContext(pending.iframe, surface);
            const mappedPoint = mapIframePointToCanvas(pending.point, context);
            lastBridgeTargetRef.current = {
              frameId: pending.frameId,
              elementId: pendingTarget.elementId,
              screen: mappedPoint.screen,
              world: mappedPoint.world,
              bounds: mapIframeRectToCanvas(pendingTarget.bounds, context),
            };
            const shifted = shiftBridgeTarget(pending.frameId, pendingTarget);
            setHoveredOverlayTarget(
              toOverlayTarget({ frameId: pending.frameId, target: shifted, inspection: null }),
            );
            setBridgeTargets((current) => {
              const key = targetStateKey(pending.frameId, pendingTarget.elementId);
              return {
                ...current,
                [key]: {
                  frameId: pending.frameId,
                  target: shifted,
                  inspection: current[key]?.inspection ?? null,
                },
              };
            });
          });
        }
        return;
      }

      const context = buildBridgeEventContext(iframe, surface);

      if (message.event !== "pointermove" && message.target) {
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
              target: shiftBridgeTarget(frameId, message.target!),
              inspection: current[key]?.inspection ?? null,
            },
          };
        });
      } else if (message.event !== "pointermove") {
        lastBridgeTargetRef.current = null;
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
    [bridgeControllersRef, buildBridgeEventContext, editorStore, ensureFramesLive, shiftBridgeTarget, toOverlayTarget],
  );

  const handleBridgeInspection = useCallback(
    (frameId: string, inspection: BridgeInspection | null) => {
      if (!inspection) return;
      const normalized: BridgeInspection = {
        ...inspection,
        target: shiftBridgeTarget(frameId, inspection.target),
      };
      setBridgeTargets((current) => {
        const key = targetStateKey(frameId, normalized.target.elementId);
        return {
          ...current,
          [key]: {
            frameId,
            target: normalized.target,
            inspection: normalized,
          },
        };
      });
    },
    [shiftBridgeTarget],
  );

  // Active theme variables for design-mode frames. Wireframe frames ignore
  // this and keep the neutral grayscale theme (see render-document).
  const tokenThemeCss = useMemo(
    () => buildThemeCssVariables(editorState.tokens),
    [editorState.tokens],
  );

  // Theme changes update the live token style block in every rendered frame —
  // rebuilding the srcDoc would reload the iframe and wipe live DOM edits
  // (including the var() links tokens are supposed to drive).
  useEffect(() => {
    for (const controller of bridgeControllersRef.current.values()) {
      void controller.setTokenTheme({ command: "set-token-theme", css: tokenThemeCss }).catch(() => undefined);
    }
  }, [tokenThemeCss]);

  const runTokenMutation = useCallback((label: string, command: Parameters<EditorStore["execute"]>[0]) => {
    try {
      editorStore.execute(command, { label });
    } catch (error) {
      showPersistenceFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Token update failed.",
      });
    }
  }, [editorStore, showPersistenceFeedback]);

  const upsertTokenSet = useCallback((set: TokenSet) => {
    runTokenMutation(`Upsert token set ${set.name}`, upsertTokenSetCommand(set));
  }, [runTokenMutation]);

  const removeTokenSet = useCallback((setId: string) => {
    runTokenMutation("Remove token set", removeTokenSetCommand(setId));
  }, [runTokenMutation]);

  const upsertToken = useCallback((setId: string, token: DesignToken) => {
    runTokenMutation(`Upsert token ${token.name}`, upsertTokenCommand(setId, token));
  }, [runTokenMutation]);

  const removeToken = useCallback((setId: string, tokenId: string) => {
    runTokenMutation("Remove token", removeTokenCommand(setId, tokenId));
  }, [runTokenMutation]);

  const renameToken = useCallback((setId: string, tokenId: string, name: string) => {
    runTokenMutation(`Rename token to ${name}`, renameTokenCommand(setId, tokenId, name));
  }, [runTokenMutation]);

  // Imports a DTCG tokens file as a new collection, then attaches it to the
  // active mode so its values resolve immediately.
  const importTokensFile = useCallback(async (file: File) => {
    try {
      const text = await persistenceAdapterRef.current!.readProjectFile(file);
      const imported = parseDTCGTokens(text, file.name);
      const store = editorStore.getState();
      const set = buildImportedTokenSet(imported, new Set(Object.keys(store.tokens.sets)));
      editorStore.transact(`Import tokens (${set.name})`, () => {
        editorStore.execute(upsertTokenSetCommand(set));
        const active = store.tokens.activeThemeId ? store.tokens.themes[store.tokens.activeThemeId] : undefined;
        if (active && !active.setIds.includes(set.id)) {
          editorStore.execute(upsertTokenThemeCommand({ ...active, setIds: [...active.setIds, set.id] }));
        }
      });
      const warningNote = imported.warnings.length > 0 ? ` ${imported.warnings.length} skipped.` : "";
      showPersistenceFeedback({
        kind: "success",
        message: `Imported ${imported.tokens.length} tokens into "${set.name}" and attached it to the active mode.${warningNote}`,
      });
    } catch (error) {
      showPersistenceFeedback({
        kind: "error",
        message: `Could not import tokens: ${error instanceof Error ? error.message : "the file could not be read"}`,
      });
    }
  }, [editorStore, showPersistenceFeedback]);

  const upsertTokenTheme = useCallback((theme: TokenTheme) => {
    runTokenMutation(`Upsert theme ${theme.name}`, upsertTokenThemeCommand(theme));
  }, [runTokenMutation]);

  const removeTokenTheme = useCallback((themeId: string) => {
    runTokenMutation("Remove theme", removeTokenThemeCommand(themeId));
  }, [runTokenMutation]);

  const switchTokenTheme = useCallback((themeId: string | null) => {
    runTokenMutation("Switch theme", switchTokenThemeCommand(themeId));
  }, [runTokenMutation]);

  const exportDTCGTokens = useCallback(() => {
    try {
      const file = buildDTCGExportFile(editorStore.getState().tokens);
      downloadAdapterRef.current?.downloadProjectFile({
        text: file.text,
        filename: file.filename,
        mimeType: file.mimeType,
      });
      showPersistenceFeedback({ kind: "success", message: `Exported tokens as ${file.filename}.` });
    } catch (error) {
      showPersistenceFeedback({
        kind: "error",
        message: `Could not export tokens: ${error instanceof Error ? error.message : "download failed"}`,
      });
    }
  }, [editorStore, showPersistenceFeedback]);

  const exportTokenCss = useCallback(() => {
    try {
      const file = buildTokenCssExportFile(editorStore.getState().tokens);
      downloadAdapterRef.current?.downloadProjectFile({
        text: file.text,
        filename: file.filename,
        mimeType: file.mimeType,
      });
      showPersistenceFeedback({ kind: "success", message: `Exported tokens as ${file.filename}.` });
    } catch (error) {
      showPersistenceFeedback({
        kind: "error",
        message: `Could not export tokens: ${error instanceof Error ? error.message : "download failed"}`,
      });
    }
  }, [editorStore, showPersistenceFeedback]);


  const handleBridgeSnapshot = useCallback(
    (frameId: string, snapshot: BridgeHierarchySnapshot, requestSequence?: number) => {
      if (requestSequence !== undefined) {
        const previousSequence = snapshotSequenceRef.current.get(frameId) ?? 0;
        if (requestSequence < previousSequence) return;
        snapshotSequenceRef.current.set(frameId, requestSequence);
      }
      markFrameInitialized(frameId);
      const frame = editorStore.getState().frames[frameId];
      if (!frame) return;
      const pendingUi = pendingSnapshotUiRef.current;
      pendingUi.hierarchies[frameId] = snapshot;
      if (pendingUi.raf === null) {
        pendingUi.raf = requestAnimationFrame(() => {
          pendingUi.raf = null;
          const hierarchies = pendingSnapshotUiRef.current.hierarchies;
          const targets = pendingSnapshotUiRef.current.targets;
          pendingSnapshotUiRef.current.hierarchies = {};
          pendingSnapshotUiRef.current.targets = {};
          if (Object.keys(hierarchies).length > 0) {
            setBridgeHierarchies((current) => ({ ...current, ...hierarchies }));
          }
          if (Object.keys(targets).length > 0) {
            setBridgeTargets((current) => {
              const merged = { ...current };
              for (const key of Object.keys(targets)) {
                merged[key] = { ...targets[key], inspection: current[key]?.inspection ?? null };
              }
              return merged;
            });
          }
        });
      }
      // Snapshot bounds were measured inside the shifted <body>. The body's
      // own rect reports the shift live at measure time (its margin is reset
      // to 0, so bounds.x === -shift), which keeps normalization correct even
      // when this snapshot was taken before the latest re-anchor landed —
      // reading shiftRef here would normalize stale bounds with the new
      // shift and feed the fit below a phantom offset.
      const bodyTarget = snapshot.nodes.find(
        (node) => node.tagName.toLowerCase() === "body",
      );
      const measureShift = frame.freeform
        ? bodyTarget
          ? { x: -bodyTarget.bounds.x, y: -bodyTarget.bounds.y }
          : freeformShiftRef.current.get(frameId) ?? { x: 0, y: 0 }
        : { x: 0, y: 0 };
      if (
        frame.freeform
        && !freeformShiftRef.current.has(frameId)
        && (measureShift.x !== 0 || measureShift.y !== 0)
      ) {
        freeformShiftRef.current.set(frameId, measureShift);
      }
      // One store transition + one targets merge per snapshot — previously
      // each node did its own execute (cloning the nodes record) and its own
      // setBridgeTargets (cloning the targets record), an O(nodes²) ingest.
      const existingNodes = editorStore.getState().nodes;
      const upserts: NodeEntity[] = [];
      const targetPatch: Record<string, OverlayBridgeTargetState> = {};
      const shifted = measureShift.x !== 0 || measureShift.y !== 0;
      for (const target of snapshot.nodes) {
        const existingNode = existingNodes[target.elementId];
        upserts.push({
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
        });
        targetPatch[targetStateKey(frameId, target.elementId)] = {
          frameId,
          target: shifted
            ? {
                ...target,
                bounds: {
                  ...target.bounds,
                  x: target.bounds.x + measureShift.x,
                  y: target.bounds.y + measureShift.y,
                },
              }
            : target,
          inspection: null,
        };
      }
      if (upserts.length > 0) {
        editorStore.execute({ type: "nodes/upsert-many", nodes: upserts }, { history: "skip" });
      }
      // Inspection state is merged at flush time so a handleBridgeInspection
      // landing between enqueue and flush isn't overwritten with null.
      Object.assign(pendingUi.targets, targetPatch);
      // Freeform frames hug their content — the iframe viewport clips whatever
      // leaves the frame rect, so growth the gesture path didn't predict (text
      // edits, measured-bounds drift) is fitted here on the freshest bounds.
      // Content world position is anchor + canonical bounds, where anchor =
      // frame.x - cumShift stays constant across re-anchors and canonical =
      // raw + measureShift. That makes the fit invariant to when this
      // snapshot measured relative to the last body-shift command — a stale
      // measurement lands on the same union instead of re-applying the delta.
      if (frame.freeform && !editorStore.hasActiveTransaction()) {
        const cum = freeformShiftRef.current.get(frameId) ?? { x: 0, y: 0 };
        const anchor = { x: frame.x - cum.x, y: frame.y - cum.y };
        const content: Rect[] = [];
        for (const node of snapshot.nodes) {
          if (!isFreeformContentNode(node)) continue;
          content.push({
            x: anchor.x + node.bounds.x + measureShift.x + FRAME_CONTENT_INSET,
            y: anchor.y + node.bounds.y + measureShift.y + FRAME_CONTENT_INSET,
            width: node.bounds.width,
            height: node.bounds.height,
          });
        }
        const fit = computeFreeformFit(frame, content);
        if (fit) {
          for (const command of freeformFrameCommands(frame, fit.rect)) {
            editorStore.execute(command, { history: "skip" });
          }
          if (Math.abs(fit.originDelta.x) >= 0.01 || Math.abs(fit.originDelta.y) >= 0.01) {
            const controller = bridgeControllersRef.current.get(frameId);
            if (bodyTarget && controller) {
              const next = { x: cum.x + fit.originDelta.x, y: cum.y + fit.originDelta.y };
              freeformShiftRef.current.set(frameId, next);
              void controller.setInlineStyle({
                command: "set-inline-style",
                targetId: bodyTarget.elementId,
                property: "transform",
                value: freeformBodyShiftValue({ x: -next.x, y: -next.y }),
              }).catch(() => {
                // The DOM never received the shift — roll the tracker back so
                // the next fit doesn't double-apply the delta. Skip if a later
                // fit already moved past this value.
                if (freeformShiftRef.current.get(frameId) === next) {
                  freeformShiftRef.current.set(frameId, cum);
                }
              });
            }
          }
        }
      }
      // A text element baked into a fresh freeform frame enters editing as
      // soon as the bridge can see it — same as a bridge-created text layer.
      const pendingText = pendingFreeformTextRef.current;
      if (pendingText && pendingText.frameId === frameId
        && snapshot.nodes.some((node) => node.elementId === pendingText.targetId)) {
        pendingFreeformTextRef.current = null;
        void bridgeControllersRef.current.get(frameId)
          ?.startTextEdit(pendingText.targetId)
          .catch(() => undefined);
      }
    },
    [editorStore, markFrameInitialized, snapshotSequenceRef],
  );

  // Drops a truly-unloaded frame's mount bookkeeping so detached frames (page
  // switch, unmount, isLive flip) don't ghost-count against the cap. Pins and
  // dirty flags die with the document: whatever they protected is unloaded.
  const handleBridgeDetach = useCallback((frameId: string) => {
    // Every caller only reports a detach after the iframe really unloaded,
    // so the tracked <body> re-anchor shift is gone regardless of who owns
    // the mount bookkeeping — clear it even on a stale report. Same for the
    // text-edit flag: the edit lived in the document that just unloaded, and
    // a stale flag would permanently lock the top-level keyboard handler.
    freeformShiftRef.current.delete(frameId);
    frameTextEditRef.current.delete(frameId);
    setTextEditingNode((current) => (current?.frameId === frameId ? null : current));
    // Deferred unmount reports fire a task late — a frame deleted and restored
    // inside that window (undo, remount) has already attached a fresh bridge
    // session. A registered controller means a newer mount owns this frame;
    // the report is stale and must not wipe bookkeeping it no longer owns.
    // Legit teardown unregisters its controller before reporting detach.
    if (bridgeControllersRef.current.has(frameId)) return;
    mountedFrameIdsRef.current.delete(frameId);
    pinnedFrameIdsRef.current.delete(frameId);
    dirtyFrameIdsRef.current.delete(frameId);
    releaseInFlightMount(frameId);
    setLiveFrameIds((live) => {
      if (!live.has(frameId)) return live;
      const next = new Set(live);
      next.delete(frameId);
      return next;
    });
    // A slot freed without a ready signal would otherwise wait on the
    // failsafe — restart the pump so queued mounts don't stall.
    scheduleMountPumpRef.current?.();
    // Snapshot merges queued for a just-detached frame must not re-add
    // its targets after the cleanup below.
    delete pendingSnapshotUiRef.current.hierarchies[frameId];
    for (const key of Object.keys(pendingSnapshotUiRef.current.targets)) {
      if (key.startsWith(`${frameId}:`)) delete pendingSnapshotUiRef.current.targets[key];
    }
    snapshotSequenceRef.current.delete(frameId);
    setBridgeTargets((current) => {
      if (!Object.keys(current).some((key) => key.startsWith(`${frameId}:`))) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${frameId}:`)),
      );
    });
    setBridgeHierarchies((current) => {
      if (!(frameId in current)) return current;
      const next = { ...current };
      delete next[frameId];
      return next;
    });
    // If the frame still exists, rescan so a mount lost to any ordering the
    // ownership check couldn't catch (e.g. a report that fired before the
    // fresh session registered) is rebuilt — otherwise the frame would sit
    // on a dead placeholder until the next camera or frame-set change.
    if (editorStore.getState().frames[frameId]) rescanAfterDetachRef.current?.();
  }, [editorStore, releaseInFlightMount, snapshotSequenceRef]);

  // Transport-level only: FrameView's bridge effect calls this from its
  // cleanup on every dependency change, not just when the iframe unloads —
  // mount bookkeeping lives in handleBridgeDetach, which FrameView invokes
  // only when its document is actually going away (isLive off / unmount).
  const handleBridgeController = useCallback(
    (frameId: string, controller: IframeBridgeController | null) => {
      if (controller) bridgeControllersRef.current.set(frameId, controller);
      else bridgeControllersRef.current.delete(frameId);
    },
    [],
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
      // A fresh text layer enters editing immediately: focus lands in the
      // frame's contenteditable so typing goes to the text, not shortcuts.
      if (command.kind === "text" && command.editable !== false) {
        void controller.startTextEdit(target.elementId).catch(() => undefined);
      }
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

  const freeformName = useCallback((base: string): string => {
    const names = new Set(
      Object.values(editorStore.getState().frames).map((frame) => frame.name),
    );
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }, [editorStore]);

  /**
   * Drawing on empty canvas mints a chromeless freeform frame whose document
   * already carries the element markup — identical to a bridge-created
   * element, minus the wait for a live iframe. The node is upserted and
   * selected eagerly so layers/selection are correct before the frame's first
   * snapshot lands (the snapshot then re-parents it under body and attaches
   * the live bridge target).
   */
  const createFreeformElement = useCallback((options: {
    name: string;
    markup: string;
    frameRect: Rect;
    elementId: string;
    nodeKind: NodeEntity["kind"];
    nodeName: string;
    tagName: string;
    kindAttr: string;
  }): { frameId: string; nodeId: string } => {
    const frameId = createElementId("draw");
    const documentId = `${frameId}-doc`;
    const nodeId = bridgeNodeIdForElement(frameId, options.elementId);
    const seed = {
      id: frameId,
      name: options.name,
      documentId,
      documentName: options.name,
      pageId: editorStore.getState().activePageId ?? "page-1",
      x: Math.round(options.frameRect.x),
      y: Math.round(options.frameRect.y),
      width: Math.max(1, Math.round(options.frameRect.width)),
      height: Math.max(1, Math.round(options.frameRect.height)),
      srcDoc: buildFreeformDocument(options.markup, options.name),
      background: "transparent",
      freeform: true,
    };
    if (editorStore.hasActiveTransaction()) {
      // The create can't join a foreign transaction — its ops would roll back
      // with an unrelated edit's undo.
      throw new Error("another edit is still settling — draw again in a moment");
    }
    const txToken = editorStore.beginTransaction(`Create ${options.name}`);
    try {
      editorStore.execute(selectBriefFrameCommand(null), { history: "skip" });
      editorStore.execute(createFrameCommand(seed), { history: "skip" });
      editorStore.execute({
        type: "node/upsert",
        node: {
          id: nodeId,
          documentId,
          parentId: null,
          kind: options.nodeKind,
          name: options.nodeName,
          tagName: options.tagName,
          attributes: {
            "data-design-tool-created": "true",
            "data-design-tool-kind": options.kindAttr,
          },
          childIds: [],
          frameId,
        },
      }, { history: "skip" });
      editorStore.execute(setSelectionCommand({
        frameIds: [frameId],
        nodeIds: [nodeId],
        primaryFrameId: frameId,
        primaryNodeId: nodeId,
      }), { history: "skip" });
      editorStore.commitTransaction(undefined, txToken);
    } catch (error) {
      if (editorStore.hasActiveTransaction()) editorStore.rollbackTransaction(txToken);
      throw error;
    }
    setCreationError(null);
    // The fresh frame must mount now — the text flow awaits its first bridge
    // snapshot, which only exists once the iframe is live.
    ensureFramesLive([frameId], { pin: true });
    return { frameId, nodeId };
  }, [editorStore, ensureFramesLive]);

  const finishCanvasCreation = useCallback(
    (operation: Extract<PointerOperation, { type: "canvas-create" }>) => {
      const { tool, start, last } = operation;
      // Thresholds are measured in screen px so a click stays a click at any
      // zoom — the minted element still gets its true world-space size.
      const dragDistance = Math.max(Math.abs(last.x - start.x), Math.abs(last.y - start.y))
        * cameraRef.current.zoom;
      const pad = FREEFORM_FRAME_PAD;

      if (tool === "image") {
        pendingCanvasImageRef.current = dragDistance >= MIN_SHAPE_DRAG
          ? normalizedBounds(start, last, 1)
          : { x: start.x, y: start.y, width: 160, height: 120 };
        setCreationError(null);
        imagePickerOpenRef.current = true;
        imageInputRef.current?.click();
        return;
      }

      if (tool === "text") {
        const bounds = textPlacementBounds(normalizedBounds(start, last, 1));
        const elementHeight = Math.max(bounds.height, FREEFORM_TEXT_MIN_HEIGHT);
        const elementId = createElementId("text");
        const markup = buildFreeformTextMarkup({
          elementId,
          bounds: { x: pad - FRAME_CONTENT_INSET, y: pad - FRAME_CONTENT_INSET, width: bounds.width, height: elementHeight },
          text: "Type to edit",
        });
        const created = createFreeformElement({
          name: freeformName("Text"),
          markup,
          frameRect: {
            x: bounds.x - pad,
            y: bounds.y - pad,
            width: bounds.width + pad * 2,
            height: elementHeight + pad * 2 + FREEFORM_TEXT_HEADROOM,
          },
          elementId,
          nodeKind: "text",
          nodeName: "Type to edit",
          tagName: "div",
          kindAttr: "text",
        });
        pendingFreeformTextRef.current = { frameId: created.frameId, targetId: created.nodeId };
        return;
      }

      // A sub-threshold "drag" is a click — it must not mint a shape.
      if (dragDistance < MIN_SHAPE_DRAG) return;
      const shape = activeShapeRef.current;
      const bounds = normalizedBounds(start, last, 1);
      const frameRect = {
        x: bounds.x - pad,
        y: bounds.y - pad,
        width: bounds.width + pad * 2,
        height: bounds.height + pad * 2,
      };
      const elementId = createElementId("shape");
      const markup = buildFreeformShapeMarkup({
        elementId,
        kind: shape,
        bounds: { x: pad - FRAME_CONTENT_INSET, y: pad - FRAME_CONTENT_INSET, width: bounds.width, height: bounds.height },
        points: shapeDragPoints(
          shape,
          { x: start.x - frameRect.x - FRAME_CONTENT_INSET, y: start.y - frameRect.y - FRAME_CONTENT_INSET },
          { x: last.x - frameRect.x - FRAME_CONTENT_INSET, y: last.y - frameRect.y - FRAME_CONTENT_INSET },
        ),
        fill: "#d9d9d9",
        stroke: "#222222",
        strokeWidth: shape === "line" || shape === "arrow" ? 2 : 0,
        radius: shapeRadiusRef.current,
      });
      createFreeformElement({
        name: freeformName(shapeLabel(shape)),
        markup,
        frameRect,
        elementId,
        nodeKind: "element",
        nodeName: shape,
        tagName: "svg",
        kindAttr: shape,
      });
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
    },
    [createFreeformElement, editorStore, freeformName],
  );

  const placeCanvasImage = useCallback(
    (rect: Rect, src: string, fileName: string) => {
      const pad = FREEFORM_FRAME_PAD;
      const elementId = createElementId("image");
      const alt = fileName.replace(/\.[^.]+$/, "").slice(0, 120);
      const markup = buildFreeformImageMarkup({
        elementId,
        bounds: { x: pad - FRAME_CONTENT_INSET, y: pad - FRAME_CONTENT_INSET, width: rect.width, height: rect.height },
        src,
        alt,
      });
      createFreeformElement({
        name: freeformName(alt || "Image"),
        markup,
        frameRect: {
          x: rect.x - pad,
          y: rect.y - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        },
        elementId,
        nodeKind: "element",
        nodeName: alt || "Image",
        tagName: "img",
        kindAttr: "image",
      });
      setCreationError(null);
      setInteractionMode("idle");
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
    },
    [createFreeformElement, editorStore, freeformName],
  );

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
  // Live radius edits are rAF-coalesced so a fast drag sends at most one
  // bridge command per frame, and the ack no longer round-trips into React
  // state — the committed value syncs once at commit instead.
  const radiusSendRef = useRef<{ pending: number | null; raf: number | null; sent: number | null }>({
    pending: null,
    raf: null,
    sent: null,
  });
  const [radiusDragging, setRadiusDragging] = useState(false);

  const flushRadiusSend = useCallback(() => {
    const send = radiusSendRef.current;
    if (send.raf !== null) {
      cancelAnimationFrame(send.raf);
      send.raf = null;
    }
    const next = send.pending;
    send.pending = null;
    const drag = radiusDragRef.current;
    if (next === null || next === send.sent || !drag) return;
    const controller = bridgeControllersRef.current.get(drag.frameId);
    if (!controller) return;
    send.sent = next;
    void controller.setShapeRadius({ command: "set-shape-radius", targetId: drag.targetId, radius: next })
      .catch(() => undefined);
  }, [bridgeControllersRef]);

  const changeShapeRadius = useCallback((next: number) => {
    const radius = clampShapeRadius(next);
    setShapeRadius(radius);
    const selection = radiusSelectionRef.current;
    if (!selection) return;
    if (!radiusDragRef.current) {
      radiusDragRef.current = { ...selection, previousRadius: selection.radius, lastRadius: selection.radius };
      setRadiusDragging(true);
      // A new drag always re-sends: `sent` may refer to a different element
      // or a pre-undo value, so it cannot dedupe across drags.
      radiusSendRef.current.sent = null;
    }
    radiusDragRef.current.lastRadius = radius;
    const send = radiusSendRef.current;
    send.pending = radius;
    if (send.raf !== null) return;
    send.raf = requestAnimationFrame(() => {
      send.raf = null;
      flushRadiusSend();
    });
  }, [flushRadiusSend]);

  const commitShapeRadius = useCallback(() => {
    const drag = radiusDragRef.current;
    const send = radiusSendRef.current;
    if (drag) {
      // Flush the latest slider position before bookkeeping so the released
      // value is what the shape lands on.
      send.pending = drag.lastRadius;
      flushRadiusSend();
    } else {
      send.pending = null;
      if (send.raf !== null) {
        cancelAnimationFrame(send.raf);
        send.raf = null;
      }
    }
    setRadiusDragging(false);
    radiusDragRef.current = null;
    if (!drag || drag.lastRadius === drag.previousRadius) return;
    const controller = bridgeControllersRef.current.get(drag.frameId);
    if (!controller) return;
    const key = targetStateKey(drag.frameId, drag.targetId);
    setBridgeTargets((current) => {
      const entry = current[key];
      if (!entry?.inspection) return current;
      return {
        ...current,
        [key]: {
          ...entry,
          inspection: {
            ...entry.inspection,
            attributes: { ...entry.inspection.attributes, "data-design-tool-radius": String(drag.lastRadius) },
          },
        },
      };
    });
    // Rounding a frosted shape leaves the lens displacement map stamped with
    // the old corner; one quiet re-apply rebuilds it against the new radius.
    const glassLevel = Number(bridgeTargets[key]?.inspection?.attributes["data-design-tool-glass"] ?? 0);
    if (Number.isFinite(glassLevel) && glassLevel > 0) {
      void controller.setShapeGlass({ command: "set-shape-glass", targetId: drag.targetId, level: glassLevel })
        .catch(() => undefined);
    }
    const apply = (radius: number) => {
      void controller.setShapeRadius({ command: "set-shape-radius", targetId: drag.targetId, radius })
        .then(() => refreshSnapshotRef.current(drag.frameId))
        .catch(() => undefined);
    };
    // A foreign transaction already open means the drag's undo step can't
    // anchor cleanly — the previews already painted, so skipping just drops
    // the history entry rather than throwing mid-commit.
    if (editorStore.hasActiveTransaction()) return;
    const txToken = editorStore.beginTransaction("Adjust corner radius");
    const committed = editorStore.commitTransaction({
      undo: () => apply(drag.previousRadius),
      redo: () => apply(drag.lastRadius),
    }, txToken);
    if (!committed && editorStore.hasActiveTransaction()) editorStore.rollbackTransaction(txToken);
  }, [bridgeControllersRef, bridgeTargets, editorStore, flushRadiusSend]);

  addCommentRef.current = useCallback(
    (frameId: string, point: Point) => {
      ensureFramesLive([frameId], { pin: true });
      addComment(frameId, point);
    },
    [addComment, ensureFramesLive],
  );

  const handleImageFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const pendingPlacement = pendingImageRef.current;
    const pendingCanvasPlacement = pendingCanvasImageRef.current;
    pendingImageRef.current = null;
    pendingCanvasImageRef.current = null;
    imagePickerOpenRef.current = false;
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
    if (!placement && !pendingCanvasPlacement) {
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
      if (pendingCanvasPlacement) {
        placeCanvasImage(pendingCanvasPlacement, reader.result, file.name);
        return;
      }
      if (!placement) return;
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
  }, [editorStore, placeCanvasImage]);

  // Closing the picker without a file abandons the pending placement, so a
  // later "Choose image" re-derives its target instead of reusing the stale
  // drag bounds. `cancel` covers modern browsers; the focus fallback covers
  // the rest — change runs before focus returns, so an empty files list there
  // means the picker was dismissed.
  useEffect(() => {
    const input = imageInputRef.current;
    if (!input) return;
    const onPickerDismissed = () => {
      imagePickerOpenRef.current = false;
      pendingImageRef.current = null;
      pendingCanvasImageRef.current = null;
    };
    const onWindowFocus = () => {
      if (!imagePickerOpenRef.current || input.files?.length) return;
      onPickerDismissed();
    };
    input.addEventListener("cancel", onPickerDismissed);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      input.removeEventListener("cancel", onPickerDismissed);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);

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

  const deleteSelectedFrames = useCallback(() => {
    const state = editorStore.getState();
    const frameIds = state.selection.frameIds.filter((frameId) => state.frames[frameId]);
    if (frameIds.length === 0 || editorStore.hasActiveTransaction()) return;
    // Stray text-edit flags for a removed frame would keep the top-level
    // keydown guard tripped forever.
    for (const frameId of frameIds) frameTextEditRef.current.delete(frameId);
    editorStore.transact(
      frameIds.length === 1
        ? `Delete ${state.frames[frameIds[0]].name ?? "frame"}`
        : `Delete ${frameIds.length} frames`,
      () => {
        for (const frameId of frameIds) {
          editorStore.execute(removeFrameCommand(frameId));
        }
      },
    );
  }, [editorStore]);

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
      mutateState?: () => unknown,
    ) => {
      const applicable = changes.filter(({ frameId }) => bridgeControllersRef.current.has(frameId));
      if (applicable.length === 0) return;
      // Skip edits that would not change anything so blur/commit on untouched
      // fields never pushes no-op entries onto the undo stack. A clear
      // (value === null) is only skippable when an inspection proves the
      // property is unset — uninspected targets can carry the property in the
      // live DOM (the freeform <body> re-anchor transform is never inspected),
      // and dropping the clear desyncs the DOM from the shift tracker.
      const meaningful = applicable.filter(({ frameId, targetId, property, value }) => {
        const entry = bridgeTargets[targetStateKey(frameId, targetId)];
        const current = entry?.inspection?.inlineStyle[property];
        if (value === null) {
          // No inspection (or no snapshot at all) means the live DOM may still
          // carry the property — the clear must be sent to know.
          if (entry == null || entry.inspection == null) return true;
          return current !== undefined && current !== "";
        }
        return value !== current;
      });
      if (meaningful.length === 0) return;
      // A second edit while a transaction awaits its bridge acks would throw —
      // the batch is dropped rather than half-applied into someone else's undo.
      if (editorStore.hasActiveTransaction()) return;
      const txToken = editorStore.beginTransaction(label);
      // mutateState may touch refs outside the store (freeformShiftRef); when
      // it returns a function, that callback restores them if the bridge
      // edits below fail.
      const mutated = mutateState?.();
      const revertState = typeof mutated === "function" ? (mutated as () => void) : undefined;
      const applied: Array<{ frameId: string; command: Extract<import("../bridge/protocol").BridgeCommand, { command: "set-inline-style" }>; undo: Extract<import("../bridge/protocol").BridgeUndoCommand, { command: "set-inline-style" }> }> = [];
      try {
        for (const change of meaningful) {
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
        revertState?.();
        if (editorStore.hasActiveTransaction()) editorStore.rollbackTransaction(txToken);
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
          if (next.property === "transform"
            && editorStore.getState().frames[frameId]?.freeform
            && bridgeTargets[targetStateKey(frameId, next.targetId)]?.target.tagName.toLowerCase() === "body") {
            freeformShiftRef.current.set(frameId, freeformBodyShiftFromValue(next.value));
          }
          return bridgeControllersRef.current.get(frameId)?.setInlineStyle(next);
        });
        void Promise.all(requests)
          .then(() => Promise.all(affectedFrameIds.map((frameId) => refreshBridgeSnapshot(frameId).catch(() => undefined))))
          .catch(() => undefined);
      };
      if (editorStore.hasActiveTransaction()) {
        editorStore.commitTransaction({ undo: () => replay("undo"), redo: () => replay("redo") }, txToken);
      }
      void refreshAffectedFrames();
    },
    [applyLocalBridgeStyle, bridgeControllersRef, bridgeTargets, editorStore, refreshBridgeSnapshot],
  );

  type ShapeEffectAction =
    | { frameId: string; targetId: string; kind: "glass"; level: number | null }
    | { frameId: string; targetId: string; kind: "fill"; color: string | null };

  // Shape effects target the SVG geometry itself, so they run as dedicated
  // bridge commands with their own undoable transaction.
  const runBridgeShapeEdits = useCallback(
    async (actions: readonly ShapeEffectAction[], label: string) => {
      const applicable = actions.filter((action) => bridgeControllersRef.current.has(action.frameId));
      if (applicable.length === 0) return;
      // Same contention rule as runBridgeStyleEdit — a transaction awaiting
      // bridge acks can't host a second batch.
      if (editorStore.hasActiveTransaction()) return;
      const txToken = editorStore.beginTransaction(label);
      const applied: Array<{ frameId: string; undo: BridgeUndoCommand; redo: BridgeCommand }> = [];
      try {
        for (const action of applicable) {
          const controller = bridgeControllersRef.current.get(action.frameId);
          if (!controller) continue;
          const ack = action.kind === "glass"
            ? await controller.setShapeGlass({ command: "set-shape-glass", targetId: action.targetId, level: action.level })
            : await controller.setShapeFill({ command: "set-shape-fill", targetId: action.targetId, color: action.color });
          if (!("undo" in ack)) throw new Error("shape acknowledgement invalid");
          applied.push({ frameId: action.frameId, undo: ack.undo, redo: action.kind === "glass"
            ? { command: "set-shape-glass", targetId: action.targetId, level: action.level }
            : { command: "set-shape-fill", targetId: action.targetId, color: action.color } });
        }
      } catch {
        for (const appliedAction of [...applied].reverse()) {
          const controller = bridgeControllersRef.current.get(appliedAction.frameId);
          const undo = appliedAction.undo;
          if (!controller) continue;
          if (undo.command === "set-shape-glass") await controller.setShapeGlass(undo).catch(() => undefined);
          else if (undo.command === "set-shape-fill") await controller.setShapeFill(undo).catch(() => undefined);
        }
        if (editorStore.hasActiveTransaction()) editorStore.rollbackTransaction(txToken);
        return;
      }
      const affectedFrameIds = Array.from(new Set(applied.map(({ frameId }) => frameId)));
      const refreshAffectedFrames = () => Promise.all(
        affectedFrameIds.map((frameId) => refreshBridgeSnapshot(frameId).catch(() => undefined)),
      );
      const replay = (direction: "undo" | "redo") => {
        const requests = applied.map(({ frameId, undo, redo }) => {
          const controller = bridgeControllersRef.current.get(frameId);
          if (!controller) return undefined;
          const next = direction === "undo" ? undo : redo;
          if (next.command === "set-shape-glass") return controller.setShapeGlass(next);
          if (next.command === "set-shape-fill") return controller.setShapeFill(next);
          return undefined;
        });
        void Promise.all(requests)
          .then(() => Promise.all(affectedFrameIds.map((frameId) => refreshBridgeSnapshot(frameId).catch(() => undefined))))
          .catch(() => undefined);
      };
      if (editorStore.hasActiveTransaction()) {
        editorStore.commitTransaction({ undo: () => replay("undo"), redo: () => replay("redo") }, txToken);
      }
      void refreshAffectedFrames();
    },
    [bridgeControllersRef, editorStore, refreshBridgeSnapshot],
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
    const entries = Object.values(bridgeTargets)
      .filter((entry) => state.selection.nodeIds.includes(entry.target.elementId) && (state.selection.frameIds.length === 0 || state.selection.frameIds.includes(entry.frameId)));

    // SVG shapes paint through their geometry child, so fills route to the
    // dedicated shape command instead of an invisible background style.
    if (property === "background-color" || property === "background") {
      const vectors = entries.filter((entry) => isCreatedVector(entry));
      if (vectors.length > 0) {
        void runBridgeShapeEdits(
          vectors.map((entry) => ({ frameId: entry.frameId, targetId: entry.target.elementId, kind: "fill" as const, color: value })),
          "Change shape fill",
        );
      }
      const others = entries.filter((entry) => !isCreatedVector(entry));
      if (others.length > 0) {
        const changes = others.map((entry) => ({ frameId: entry.frameId, targetId: entry.target.elementId, property, value }));
        void runBridgeStyleEdit(changes, `Change ${property}`);
      }
      return;
    }
    const changes = entries.map((entry) => ({ frameId: entry.frameId, targetId: entry.target.elementId, property, value }));
    void runBridgeStyleEdit(changes, `Change ${property}`);
    // A newly-picked family needs its @font-face pushed into the already-
    // rendered frame document — srcDoc injection only covers fonts the
    // document declared when it was built.
    if (property === "font-family" && value) {
      const css = fontFacesCssForFamilyValue(value);
      if (css) {
        for (const frameId of new Set(entries.map((entry) => entry.frameId))) {
          void bridgeControllersRef.current
            .get(frameId)
            ?.injectFontFaces({ command: "inject-font-faces", css })
            .catch(() => undefined);
        }
      }
    }
  }, [bridgeTargets, editorStore, runBridgeShapeEdits, runBridgeStyleEdit]);

  // Glass effect asset: the element's own surface becomes the glass slab.
  // Slider drags post preview commands straight to the frame — rAF-coalesced,
  // no transaction, no React state churn — so the pane frosts under the
  // pointer in one fluid motion. Releasing (applyGlassEffect) wraps the whole
  // drag into a single undoable step anchored on the pre-drag state, matching
  // the corner-radius drag model.
  const glassDragRef = useRef<{
    entries: {
      frameId: string;
      targetId: string;
      created: boolean;
      previousLevel: number | null;
      previousStyles: GlassSurfaceStyles;
      fillBase: string | null;
    }[];
    lastLevel: number;
  } | null>(null);
  const glassSendRef = useRef<{ pending: number | null; raf: number | null; sent: number | null }>({
    pending: null,
    raf: null,
    sent: null,
  });

  const flushGlassSend = useCallback(() => {
    const send = glassSendRef.current;
    if (send.raf !== null) {
      cancelAnimationFrame(send.raf);
      send.raf = null;
    }
    const next = send.pending;
    send.pending = null;
    const drag = glassDragRef.current;
    if (next === null || next === send.sent || !drag) return;
    send.sent = next;
    for (const entry of drag.entries) {
      const controller = bridgeControllersRef.current.get(entry.frameId);
      if (!controller) continue;
      if (entry.created) {
        void controller.setShapeGlass({ command: "set-shape-glass", targetId: entry.targetId, level: next > 0 ? next : null })
          .catch(() => undefined);
        continue;
      }
      const styles = surfaceGlassStyles(entry.fillBase, next);
      for (const property of GLASS_STYLE_PROPERTIES) {
        void controller.setInlineStyle({ command: "set-inline-style", targetId: entry.targetId, property, value: styles[property] })
          .catch(() => undefined);
      }
    }
  }, [bridgeControllersRef]);

  const previewGlassEffect = useCallback((level: number) => {
    const clamped = clampGlassLevel(level);
    let drag = glassDragRef.current;
    if (!drag) {
      const state = editorStore.getState();
      const selected = Object.values(bridgeTargets)
        .filter((entry) => state.selection.nodeIds.includes(entry.target.elementId) && (state.selection.frameIds.length === 0 || state.selection.frameIds.includes(entry.frameId)));
      if (selected.length === 0) return;
      drag = {
        entries: selected.map((entry) => {
          const created = isCreatedTarget(entry);
          const inline = entry.inspection?.inlineStyle ?? {};
          return {
            frameId: entry.frameId,
            targetId: entry.target.elementId,
            created,
            previousLevel: created ? glassLevelFromAttribute(entry.inspection?.attributes["data-design-tool-glass"]) : null,
            previousStyles: {
              "backdrop-filter": inline["backdrop-filter"] ?? null,
              background: inline["background"] ?? null,
              "box-shadow": inline["box-shadow"] ?? null,
            },
            fillBase: inline["background-color"] ?? entry.inspection?.computedStyle["background-color"] ?? null,
          };
        }),
        lastLevel: clamped,
      };
      glassDragRef.current = drag;
      // A new drag always re-sends: `sent` may refer to a different element or
      // a pre-undo value, so it cannot dedupe across drags.
      glassSendRef.current.sent = null;
    }
    drag.lastLevel = clamped;
    const send = glassSendRef.current;
    send.pending = clamped;
    if (send.raf !== null) return;
    send.raf = requestAnimationFrame(() => {
      send.raf = null;
      flushGlassSend();
    });
  }, [bridgeTargets, editorStore, flushGlassSend]);

  const applyGlassEffect = useCallback((level: number) => {
    const clamped = clampGlassLevel(level);
    const drag = glassDragRef.current;
    glassDragRef.current = null;
    if (drag) {
      // Make sure the released level is what the frame actually shows.
      glassSendRef.current.pending = clamped;
      flushGlassSend();
    } else {
      const send = glassSendRef.current;
      send.pending = null;
      if (send.raf !== null) {
        cancelAnimationFrame(send.raf);
        send.raf = null;
      }
    }

    if (!drag) {
      // One-shot apply (step buttons / field commits): one transaction, and
      // the runtime's motion styles animate the swap in place.
      const state = editorStore.getState();
      const selected = Object.values(bridgeTargets)
        .filter((entry) => state.selection.nodeIds.includes(entry.target.elementId) && (state.selection.frameIds.length === 0 || state.selection.frameIds.includes(entry.frameId)));
      if (selected.length === 0) return;
      const label = clamped > 0 ? `Apply glass ${clamped}%` : "Remove glass";
      const glassLevel = clamped > 0 ? clamped : null;
      const createdEntries = selected.filter((entry) => isCreatedTarget(entry));
      if (createdEntries.length > 0) {
        void runBridgeShapeEdits(
          createdEntries.map((entry) => ({ frameId: entry.frameId, targetId: entry.target.elementId, kind: "glass" as const, level: glassLevel })),
          label,
        );
      }
      const surfaceEntries = selected.filter((entry) => !isCreatedTarget(entry));
      if (surfaceEntries.length > 0) {
        const changes = surfaceEntries.flatMap((entry) => {
          const styles = surfaceGlassStyles(
            entry.inspection?.inlineStyle["background-color"] ?? entry.inspection?.computedStyle["background-color"] ?? null,
            clamped,
          );
          return GLASS_STYLE_PROPERTIES.map((property) => ({
            frameId: entry.frameId,
            targetId: entry.target.elementId,
            property,
            value: styles[property],
          }));
        });
        void runBridgeStyleEdit(changes, label);
      }
      return;
    }

    // Drag commit: previews already landed in the frame, so the transaction
    // records the pre-drag → final jump and undo replays it as one step.
    const label = clamped > 0 ? `Apply glass ${clamped}%` : "Remove glass";
    const finalLevel = clamped > 0 ? clamped : null;
    const anyChanged = drag.entries.some((entry) =>
      entry.created
        ? (entry.previousLevel ?? 0) !== clamped
        : !glassStylesEqual(entry.previousStyles, surfaceGlassStyles(entry.fillBase, clamped)));
    if (!anyChanged) return;
    const affectedFrameIds = Array.from(new Set(drag.entries.map((entry) => entry.frameId)));
    const replay = (direction: "undo" | "redo") => {
      const requests = drag.entries.map((entry) => {
        const controller = bridgeControllersRef.current.get(entry.frameId);
        if (!controller) return undefined;
        if (entry.created) {
          return controller.setShapeGlass({
            command: "set-shape-glass",
            targetId: entry.targetId,
            level: direction === "undo" ? entry.previousLevel : finalLevel,
          });
        }
        const styles = direction === "undo" ? entry.previousStyles : surfaceGlassStyles(entry.fillBase, clamped);
        return Promise.all(GLASS_STYLE_PROPERTIES.map((property) =>
          controller.setInlineStyle({ command: "set-inline-style", targetId: entry.targetId, property, value: styles[property] })));
      });
      void Promise.all(requests)
        .then(() => Promise.all(affectedFrameIds.map((frameId) => refreshSnapshotRef.current(frameId).catch(() => undefined))))
        .catch(() => undefined);
    };
    if (editorStore.hasActiveTransaction()) return;
    const txToken = editorStore.beginTransaction(label);
    const committed = editorStore.commitTransaction({ undo: () => replay("undo"), redo: () => replay("redo") }, txToken);
    if (!committed) {
      if (editorStore.hasActiveTransaction()) editorStore.rollbackTransaction(txToken);
      return;
    }
    // Sync the inspected state once so the panel shows the landed level
    // instead of snapping back to the pre-drag value until the next snapshot.
    setBridgeTargets((current) => {
      let touched = false;
      const next = { ...current };
      for (const entry of drag.entries) {
        const key = targetStateKey(entry.frameId, entry.targetId);
        const existing = next[key];
        if (!existing?.inspection) continue;
        touched = true;
        if (entry.created) {
          const attributes = { ...existing.inspection.attributes };
          if (finalLevel === null) delete attributes["data-design-tool-glass"];
          else attributes["data-design-tool-glass"] = String(clamped);
          next[key] = { ...existing, inspection: { ...existing.inspection, attributes } };
        } else {
          const styles = surfaceGlassStyles(entry.fillBase, clamped);
          const inlineStyle = { ...existing.inspection.inlineStyle };
          for (const property of GLASS_STYLE_PROPERTIES) {
            const value = styles[property];
            if (value === null) delete inlineStyle[property];
            else inlineStyle[property] = value;
          }
          next[key] = { ...existing, inspection: { ...existing.inspection, inlineStyle } };
        }
      }
      return touched ? next : current;
    });
    void Promise.all(affectedFrameIds.map((frameId) => refreshSnapshotRef.current(frameId).catch(() => undefined)));
  }, [bridgeControllersRef, bridgeTargets, editorStore, flushGlassSend, runBridgeShapeEdits, runBridgeStyleEdit]);

  const editNodePosition = useCallback((frameId: string, nodeId: string, position: { x: number; y: number }) => {
    const entry = bridgeTargets[targetStateKey(frameId, nodeId)];
    const controller = bridgeControllersRef.current.get(frameId);
    if (!entry || !controller) return;
    void controller.inspect(nodeId).then((inspection) => {
      if (!inspection) return;
      handleBridgeInspection(frameId, inspection);
      const frame = editorStore.getState().frames[frameId];
      const shift = frame?.freeform
        ? freeformShiftRef.current.get(frameId) ?? { x: 0, y: 0 }
        : { x: 0, y: 0 };
      const currentTransform = inspection.inlineStyle.transform ?? inspection.computedStyle.transform;
      // The committed position lives in canonical doc space (the same space
      // the X/Y fields display); the live inspection bounds are measured in
      // the shifted body — the translate delta bridges the two.
      const value = prependTranslationTransform(currentTransform, {
        x: position.x - shift.x - inspection.target.bounds.x,
        y: position.y - shift.y - inspection.target.bounds.y,
      });
      const changes: { frameId: string; targetId: string; property: SafeInlineStyleProperty; value: string | null }[] = [
        { frameId, targetId: nodeId, property: "transform", value },
      ];
      let mutateState: (() => unknown) | undefined;
      if (frame?.freeform) {
        const content: Rect[] = [];
        for (const other of Object.values(bridgeTargets)) {
          if (other.frameId !== frameId || !isFreeformContentNode(other.target)) continue;
          if (other.target.elementId === nodeId) {
            content.push({
              x: frame.x + FRAME_CONTENT_INSET + position.x - shift.x,
              y: frame.y + FRAME_CONTENT_INSET + position.y - shift.y,
              width: inspection.target.bounds.width,
              height: inspection.target.bounds.height,
            });
          } else {
            const overlay = toOverlayTarget(other);
            if (overlay) content.push(overlay.bounds);
          }
        }
        const fit = computeFreeformFit(frame, content);
        if (fit) {
          const delta = fit.originDelta;
          const previous = freeformShiftRef.current.get(frameId) ?? { x: 0, y: 0 };
          const body = Object.values(bridgeTargets).find(
            (candidate) => candidate.frameId === frameId && candidate.target.tagName.toLowerCase() === "body",
          );
          // The shift tracker must only advance when the compensating body
          // transform was actually queued — otherwise the tracker claims a
          // shift the live DOM never received and every later fit/overlay on
          // this frame desyncs by that delta.
          const shiftQueued = Boolean(body) && (Math.abs(delta.x) >= 0.01 || Math.abs(delta.y) >= 0.01);
          if (body && shiftQueued) {
            changes.push({
              frameId,
              targetId: body.target.elementId,
              property: "transform",
              value: freeformBodyShiftValue({ x: -(previous.x + delta.x), y: -(previous.y + delta.y) }),
            });
          }
          mutateState = () => {
            for (const command of freeformFrameCommands(frame, fit.rect)) {
              editorStore.execute(command);
            }
            if (shiftQueued) {
              freeformShiftRef.current.set(frameId, { x: previous.x + delta.x, y: previous.y + delta.y });
            }
            // The store rollback restores the frame rect, but the shift
            // tracker lives outside it — restore it too or the next fit and
            // every overlay bound on this frame desyncs by the failed delta.
            return () => {
              freeformShiftRef.current.set(frameId, previous);
            };
          };
        }
      }
      void runBridgeStyleEdit(changes, "Move layer", mutateState);
    }).catch(() => undefined);
  }, [bridgeControllersRef, bridgeTargets, editorStore, handleBridgeInspection, runBridgeStyleEdit, toOverlayTarget]);

  const updateFrameFromPanel = useCallback((frameId: string, patch: { width?: number; height?: number; background?: string; name?: string }) => {
    editorStore.execute({ type: "frame/update", frameId, patch });
  }, [editorStore]);

  const moveFrameFromPanel = useCallback((frameId: string, position: { x: number; y: number }) => {
    editorStore.execute(moveFrameCommand({ frameId, position }));
  }, [editorStore]);

  const {
    beginNodeGesture,
    cancelNodeGesture,
    endNodeGesture,
    gestureOverlayStore,
    isNodeGestureActive,
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
    freeformShiftRef,
  });

  const sidebarHoveredOverlayTarget = useMemo(() => {
    if (!sidebarHoveredNode) return null;
    const entry = bridgeTargets[targetStateKey(sidebarHoveredNode.frameId, sidebarHoveredNode.nodeId)];
    return entry ? toOverlayTarget(entry) : null;
  }, [bridgeTargets, editorState.frames, sidebarHoveredNode, toOverlayTarget]);

  // Stable callbacks/objects so memoized LayerRows skip unrelated renders —
  // inline closures here would change identity on every surface render.
  const handleSidebarHoverNode = useCallback((frameId: string, nodeId: string) => {
    setSidebarHoveredNode({ frameId, nodeId });
  }, []);
  const handleSidebarHoverNodeEnd = useCallback(() => {
    setSidebarHoveredNode(null);
  }, []);
  const hoveredLayerNode = useMemo(
    () => hoveredOverlayTarget
      ? { frameId: hoveredOverlayTarget.frameId, nodeId: hoveredOverlayTarget.nodeId }
      : null,
    [hoveredOverlayTarget],
  );

  // While a text layer is being edited inline, its box chrome disappears —
  // Figma-style, only the caret shows until the edit commits.
  const isEditingOverlayTarget = useCallback(
    (target: OverlayNodeTarget | null) =>
      textEditingNode !== null &&
      target !== null &&
      target.frameId === textEditingNode.frameId &&
      target.nodeId === textEditingNode.nodeId,
    [textEditingNode],
  );
  const overlayHoveredTarget = isEditingOverlayTarget(sidebarHoveredOverlayTarget ?? hoveredOverlayTarget)
    ? null
    : (sidebarHoveredOverlayTarget ?? hoveredOverlayTarget);
  const overlaySelectedTargets = useMemo(
    () => selectedOverlayTargets.filter((target) => !isEditingOverlayTarget(target)),
    [isEditingOverlayTarget, selectedOverlayTargets],
  );

  const setActiveTool = useCallback(
    (tool: ToolId, options?: { force?: boolean }) => {
      const current = normalizeActiveTool(editorStore.getState().activeTool);
      const nextTool =
        options?.force || current !== tool || tool === "select"
          ? tool
          : "select";
      creationRef.current = null;
      pendingImageRef.current = null;
      pendingCanvasImageRef.current = null;
      pendingFreeformTextRef.current = null;
      if (pointerRef.current?.type === "canvas-create") {
        pointerRef.current = null;
        setCanvasCreationPreview(null);
      }
      setCreationError(null);
      setInteractionMode("idle");
      editorStore.execute(setActiveToolCommand(nextTool), { history: "skip" });
      setIsFrameMenuOpen(nextTool === "frame");
      setIsShaderMenuOpen(nextTool === "shader");
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

  const toggleShaderMenu = useCallback(() => {
    creationRef.current = null;
    pendingImageRef.current = null;
    setCreationError(null);
    const current = normalizeActiveTool(editorStore.getState().activeTool);
    if (current === "shader" && isShaderMenuOpen) {
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
      setIsShaderMenuOpen(false);
      return;
    }
    editorStore.execute(setActiveToolCommand("shader"), { history: "skip" });
    setIsShaderMenuOpen(true);
  }, [editorStore, isShaderMenuOpen]);

  const closeShaderMenu = useCallback(() => {
    setIsShaderMenuOpen(false);
    if (normalizeActiveTool(editorStore.getState().activeTool) === "shader") {
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
    }
  }, [editorStore]);

  // Shader elements live outside the editor selection model — selecting one
  // clears any node/frame selection so the inspector shows a single subject.
  const selectShaderElement = useCallback(
    (elementId: string | null) => {
      setSelectedShaderElementId(elementId);
      if (!elementId) return;
      const selection = editorStore.getState().selection;
      if (selection.nodeIds.length > 0 || selection.frameIds.length > 0) {
        editorStore.execute(
          setSelectionCommand({ frameIds: [], nodeIds: [], primaryFrameId: null, primaryNodeId: null }),
          { history: "skip" },
        );
      }
    },
    [editorStore],
  );

  const addShaderElement = useCallback(
    (shaderId: ShaderId) => {
      if (isPaperShaderId(shaderId) && !detectPaperShaderSupport().supported) {
        setCreationError("This browser cannot render shaders. WebGL2 is required.");
        return;
      }
      const worldCenter = screenToWorld(
        { x: viewport.width / 2, y: viewport.height / 2 },
        cameraRef.current,
      );
      const element = createCanvasShaderElement(shaderId, worldCenter);
      if (!element) return;
      setShaderElements((current) => [...current, element]);
      selectShaderElement(element.id);
      setIsShaderMenuOpen(false);
      setCreationError(null);
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
    },
    [editorStore, selectShaderElement, viewport],
  );

  const updateShaderElement = useCallback((elementId: string, patch: Partial<Pick<CanvasShaderElement, "x" | "y" | "width" | "height" | "radius" | "params">>) => {
    setShaderElements((current) =>
      current.map((entry) => {
        if (entry.id !== elementId) return entry;
        const next = { ...entry, ...patch };
        const stored = next.radius ?? SHADER_ELEMENT_DEFAULT_RADIUS;
        const max = maxShaderElementRadius(next);
        return stored > max ? { ...next, radius: max } : next;
      }),
    );
  }, []);

  const updateShaderElementParams = useCallback((elementId: string, params: ShaderParams) => {
    setShaderElements((current) =>
      current.map((entry) => (entry.id === elementId ? { ...entry, params } : entry)),
    );
  }, []);

  const deleteShaderElement = useCallback((elementId: string) => {
    setShaderElements((current) => current.filter((entry) => entry.id !== elementId));
    setSelectedShaderElementId((current) => (current === elementId ? null : current));
  }, []);

  const scanVisibleFrames = useCallback((cam: Camera) => {
    const state = editorStore.getState();
    const mounted = mountedFrameIdsRef.current;
    let pruned = false;
    for (const id of mounted) {
      if (!state.frames[id]) {
        mounted.delete(id);
        pruned = true;
      }
    }
    for (const id of pinnedFrameIdsRef.current) {
      if (!state.frames[id]) pinnedFrameIdsRef.current.delete(id);
    }
    for (const id of dirtyFrameIdsRef.current) {
      if (!state.frames[id]) dirtyFrameIdsRef.current.delete(id);
    }
    const ids: string[] = [];
    if (viewport.width > 0 && viewport.height > 0) {
      const visible = getVisibleWorldRect(cam, viewport);
      const center = { x: visible.x + visible.width / 2, y: visible.y + visible.height / 2 };
      for (const frame of Object.values(state.frames)) {
        if (state.activePageId !== null && frame.pageId !== state.activePageId) continue;
        if (mounted.has(frame.id)) continue;
        if (rectsIntersect(frame, visible)) ids.push(frame.id);
      }
      // Nearest-to-centre first — the frames the user is looking at mount
      // before the overscan edge does.
      const rank = (id: string) => {
        const frame = state.frames[id];
        const dx = frame.x + frame.width / 2 - center.x;
        const dy = frame.y + frame.height / 2 - center.y;
        return dx * dx + dy * dy;
      };
      ids.sort((a, b) => rank(a) - rank(b));
      const primary = state.selection.primaryFrameId;
      if (primary && !mounted.has(primary) && state.frames[primary]) ids.unshift(primary);
    }
    // Drop stale queued mounts — deleted frames, and unpinned scan mounts
    // that have since left the view — so the pump always works on what the
    // camera is looking at instead of draining a backlog a pan left behind.
    // Only prune by view when the viewport is measurable: with a zero-size
    // viewport `ids` is empty for lack of data, not because nothing is in
    // view, and pruning there would kill legit queued mounts.
    const measurable = viewport.width > 0 && viewport.height > 0;
    const hits = new Set(ids);
    const pending = pendingMountIdsRef.current;
    const queued = queuedMountIdsRef.current;
    const pinned = pinnedFrameIdsRef.current;
    let write = 0;
    for (const id of pending) {
      if (state.frames[id] && (!measurable || hits.has(id) || pinned.has(id))) pending[write++] = id;
      else queued.delete(id);
    }
    pending.length = write;
    if (ids.length > 0) ensureFramesLive(ids);
    else if (pruned) setLiveFrameIds(new Set(mounted));
  }, [editorStore, ensureFramesLive, viewport]);

  // rAF-throttled visibility scan used while panning/zooming — the committed
  // camera state lags the imperative transform for the whole gesture, so
  // without this frames entering view would stay placeholders until release.
  // The rAF callback must run the LATEST scanVisibleFrames: a closure captured
  // at schedule time can carry a stale viewport (e.g. 0 before the first
  // measure), which computes an empty id set and prunes legit queued mounts.
  const scanVisibleFramesRef = useRef(scanVisibleFrames);
  scanVisibleFramesRef.current = scanVisibleFrames;
  const visibilityScanRafRef = useRef<number | null>(null);
  const scheduleVisibilityScan = useCallback(() => {
    if (visibilityScanRafRef.current !== null) return;
    visibilityScanRafRef.current = requestAnimationFrame(() => {
      visibilityScanRafRef.current = null;
      scanVisibleFramesRef.current(cameraRef.current);
    });
  }, []);
  // Back-reference for handleBridgeDetach (declared above this callback):
  // lets a stale detach re-scan frames that were remounted before it fired.
  rescanAfterDetachRef.current = scheduleVisibilityScan;

  // Rescan when the camera, the frame set, or the active page changes —
  // frames created while the camera is still (agent pushes, paste, undo,
  // page switches) must mount without waiting for the next pan.
  useEffect(() => {
    scanVisibleFrames(camera);
  }, [camera, editorState.frames, editorState.activePageId, scanVisibleFrames]);

  // A project switch remounts the world (persistenceVersion keys every frame)
  // — drop mounts belonging to the previous project, then mount what is
  // actually in view instead of eagerly loading every frame in the file.
  // Gated on the version changing: scanVisibleFrames is recreated whenever the
  // viewport resizes, and resetting on that churn would unload every live
  // iframe — destroying DOM edits the srcDoc doesn't contain.
  const appliedPersistenceRef = useRef(persistenceVersion);
  useEffect(() => {
    if (appliedPersistenceRef.current === persistenceVersion) return;
    appliedPersistenceRef.current = persistenceVersion;
    resetMountRefs();
    setLiveFrameIds(new Set());
    scanVisibleFrames(cameraRef.current);
  }, [persistenceVersion, scanVisibleFrames, resetMountRefs]);

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

  const selectNode = useCallback((frameId: string, nodeId: string, shiftKey: boolean) => {
    setSelectedShaderElementId(null);
    ensureFramesLive([frameId], { pin: true });
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
          ? getFramesBounds([frameRect, { x: frame.x + FRAME_CONTENT_INSET + bounds.x, y: frame.y + FRAME_CONTENT_INSET + bounds.y, width: bounds.width, height: bounds.height }])
          : frameRect;
        const nextCamera = revealCamera(cameraRef.current, viewport, focusRect, cameraFitPadding(viewport));
        if (nextCamera) {
          updateCamera(nextCamera);
        }
      }
    }
    const controller = bridgeControllersRef.current.get(frameId);
    if (controller) void controller.inspect(nodeId).then((inspection) => { if (inspection) handleBridgeInspection(frameId, inspection); }).catch(() => undefined);
  }, [bridgeControllersRef, bridgeHierarchies, editorStore, ensureFramesLive, handleBridgeInspection, updateCamera, viewport]);

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
    // Open showing every frame inside the chrome-free box — fitting only the
    // first frame parks the rest beneath the floating panels, and fitting
    // without insets tucks frames (and their handles) under the sidebars.
    updateCamera(fitRectWithInsets(getFramesBounds(renderRects), viewport, fitInsets(viewport)));
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
      // Creating inside a foreign open transaction would fuse the frame add
      // with an unrelated undo step — drop the click instead of corrupting
      // history boundaries.
      if (editorStore.hasActiveTransaction()) return;
      const txToken = editorStore.beginTransaction("Add frame");
      editorStore.execute(createFrameCommand(frame), { history: "skip" });
      setSelectedFrameId(frame.id);
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
      editorStore.commitTransaction(undefined, txToken);
      setIsFrameMenuOpen(false);
      updateCamera(fitRect(frame, usableViewport, cameraFitPadding(usableViewport)));
    },
    [editorState.activePageId, editorStore, renderRects, setSelectedFrameId, updateCamera, viewport],
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
        const { srcDoc, metadata, removedExecutables } = preparePastedHtml(candidate);
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
        updateCamera(fitRect(result.rect, usableViewport, cameraFitPadding(usableViewport)));
        showPasteFeedback(
          "success",
          removedExecutables
            ? `"${result.name}" pasted onto the canvas. Scripts and event handlers were removed.`
            : `"${result.name}" pasted onto the canvas.`,
        );
      } catch (error) {
        showPasteFeedback(
          "error",
          error instanceof Error ? error.message : "Could not paste the copied HTML.",
        );
      }
    },
    [editorStore, renderRects, showPasteFeedback, updateCamera, viewport],
  );

  const importHtmlFile = useCallback(async (file: File) => {
    try {
      // File bytes cross the same PersistenceAdapter file-like boundary as
      // project import; the editor never touches the filesystem directly.
      const text = await persistenceAdapterRef.current!.readProjectFile(file);
      const prepared = prepareHtmlFileImport(text, file.name);
      const measuredViewport = surfaceRef.current ? getViewportSize(surfaceRef.current) : viewport;
      const usableViewport = measuredViewport.width > 0 && measuredViewport.height > 0
        ? measuredViewport
        : { width: Math.max(viewport.width, 1), height: Math.max(viewport.height, 1) };
      const size = { width: PASTED_FRAME_DEFAULT_WIDTH, height: PASTED_FRAME_DEFAULT_HEIGHT };
      const center = computeFramePlacement(renderRects, usableViewport, cameraRef.current, size);
      const result = importHtmlFileIntoStore(editorStore, prepared.srcDoc, prepared.name, {
        x: center.x - size.width / 2,
        y: center.y - size.height / 2,
      });
      updateCamera(fitRect(result.rect, usableViewport, cameraFitPadding(usableViewport)));
      showPersistenceFeedback({
        kind: "success",
        message: prepared.removedExecutables
          ? `Imported "${result.name}" as a new frame. Scripts and event handlers were removed for safety.`
          : `Imported "${result.name}" as a new frame.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The file could not be imported.";
      showPersistenceFeedback({ kind: "error", message: `Could not import HTML: ${message}` });
    }
  }, [editorStore, renderRects, showPersistenceFeedback, updateCamera, viewport]);

  const importFigmaFile = useCallback(async (file: File) => {
    try {
      // .fig is a binary zip; it crosses the same file-like adapter boundary
      // as text project files.
      const adapter = persistenceAdapterRef.current!;
      const bytes = adapter.readProjectFileBytes
        ? await adapter.readProjectFileBytes(file)
        : new Uint8Array(await readFileBytes(file));
      const summary = importFigmaFileIntoStore(editorStore, bytes);
      const state = editorStore.getState();
      const rects = summary.frameIds
        .map((id) => state.frames[id])
        .filter((frame) => frame !== undefined)
        .map((frame) => ({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }));
      const measuredViewport = surfaceRef.current ? getViewportSize(surfaceRef.current) : viewport;
      const usableViewport = measuredViewport.width > 0 && measuredViewport.height > 0
        ? measuredViewport
        : { width: Math.max(viewport.width, 1), height: Math.max(viewport.height, 1) };
      if (rects.length > 0) {
        updateCamera(fitRect(getFramesBounds(rects), usableViewport, cameraFitPadding(usableViewport)));
      }
      showPersistenceFeedback({
        kind: "success",
        message: `Imported ${summary.frameIds.length === 1 ? "1 frame" : `${summary.frameIds.length} frames`} from the Figma file.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Figma file could not be imported.";
      showPersistenceFeedback({ kind: "error", message: `Could not import Figma file: ${message}` });
    }
  }, [editorStore, showPersistenceFeedback, updateCamera, viewport]);

  const importProjectFile = useCallback(async (file: File) => {
    // Dispatch by extension, falling back to the ZIP magic so a renamed .fig
    // (or a download artifact) still routes to the Figma importer.
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    if (/\.fig$/i.test(file.name ?? "") || isZip) {
      await importFigmaFile(file);
    } else {
      await importProject(file);
    }
  }, [importFigmaFile, importProject]);

  const beginFramePointer = useCallback(
    (frameId: string, event: ReactPointerEvent<HTMLElement>) => {
      const surface = surfaceRef.current;
      if (!surface || event.button !== 0) {
        return;
      }
      const currentTool = normalizeActiveTool(editorStore.getState().activeTool);
      const panning = spacePressedRef.current || currentTool === "hand";
      // Non-select tools don't start a frame move — the press falls through
      // to the frame's own layers (the creation layer once live). A cold
      // frame must still mount here — creation gestures inside it need the
      // live bridge, and this pointerdown is the trigger that wakes it.
      if (!panning && currentTool !== "select") {
        ensureFramesLive([frameId], { pin: true });
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      surface.focus({ preventScroll: true });
      surface.setPointerCapture(event.pointerId);
      if (panning) {
        pointerRef.current = {
          type: "pan",
          pointerId: event.pointerId,
          last: getCachedPointerPosition(event),
        };
        setInteractionMode("panning");
        return;
      }
      const start = getCachedPointerPosition(event);
      const frame = editorStore.getState().frames[frameId];
      setSelectedFrameId(frameId);
      // An open transaction (e.g. a bridge edit awaiting acks) can't take a
      // second gesture — beginning one throws mid-pointerdown and strands the
      // half-started drag. The click still selects; the drag just no-ops.
      if (editorStore.hasActiveTransaction()) return;
      const txToken = editorStore.beginTransaction(`Move ${frameId}`);
      pointerRef.current = {
        type: "move-frame",
        pointerId: event.pointerId,
        last: start,
        frameId,
        start,
        frameStart: frame ? { x: frame.x, y: frame.y } : { x: 0, y: 0 },
        txToken,
      };
      setInteractionMode("moving-frame");
    },
    [editorStore, setSelectedFrameId, getCachedPointerPosition, ensureFramesLive],
  );

  const beginBriefFramePointer = useCallback(
    (briefFrameId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      const surface = surfaceRef.current;
      if (!surface || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      surface.focus({ preventScroll: true });
      surface.setPointerCapture(event.pointerId);
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
      if (editorStore.hasActiveTransaction()) return;
      const txToken = editorStore.beginTransaction(`Move ${briefFrameId}`);
      pointerRef.current = {
        type: "move-brief-frame",
        pointerId: event.pointerId,
        last: start,
        briefFrameId,
        start,
        briefStart: currentBriefFrame ? { x: currentBriefFrame.x, y: currentBriefFrame.y } : { x: 0, y: 0 },
        txToken,
      };
      setInteractionMode("moving-frame");
    },
    [editorStore, selectBriefFrame, getCachedPointerPosition, updateSurfaceRect],
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
      updateSurfaceRect();
      pointerRef.current = {
        type: "pan",
        pointerId: event.pointerId,
        last: getCachedPointerPosition(event),
      };
      setInteractionMode("panning");
    },
    [getCachedPointerPosition, updateSurfaceRect],
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
    // Creation tools draw on empty canvas too — the drag mints a freeform
    // frame holding the element on pointer-up. The home/not-found routes show
    // their own screens instead of the world, so drawing is disabled there.
    if (!spacePressedRef.current && isCanvasCreationTool(activeTool) && !isHomeRoute && !routeNotFound && !showLakeOverlay) {
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      updateSurfaceRect();
      const start = screenToWorld(getCachedPointerPosition(event), cameraRef.current);
      pointerRef.current = {
        type: "canvas-create",
        pointerId: event.pointerId,
        tool: activeTool,
        start,
        last: start,
      };
      setCanvasCreationPreview({ start, end: start });
      setCreationError(null);
      setInteractionMode("creating");
      return;
    }

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

    if (operation.type === "canvas-create") {
      const world = screenToWorld(getCachedPointerPosition(event), cameraRef.current);
      if (world.x === operation.last.x && world.y === operation.last.y) return;
      operation.last = world;
      setCanvasCreationPreview({ start: operation.start, end: world });
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
      scheduleVisibilityScan();
      return;
    }

    applyFrameDragTransform(operation);
  };

  const endPointerOperation = (event: ReactPointerEvent<HTMLDivElement>) => {
    endNodeGesture(event);
    const operation = pointerRef.current;
    pointerRef.current = null;
    // The release event carries the pointer's final position — the last
    // pointermove can lag a fast drag and leave `last` short of it.
    if (operation) {
      operation.last = operation.type === "canvas-create"
        ? screenToWorld(getCachedPointerPosition(event), cameraRef.current)
        : getCachedPointerPosition(event);
    }
    if ((operation?.type === "move-frame" || operation?.type === "move-brief-frame") && editorStore.hasActiveTransaction()) {
      finalizeFrameDrag(operation);
      editorStore.commitTransaction(undefined, operation.txToken);
    }
    if (operation?.type === "canvas-create") {
      setCanvasCreationPreview(null);
      try {
        finishCanvasCreation(operation);
      } catch (error) {
        setCreationError(
          `Could not create the element: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (operation?.type === "pan") {
      updateCamera(cameraRef.current);
    }
    setInteractionMode("idle");
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A cancelled canvas draw aborts instead of minting a half-dragged shape.
    if (pointerRef.current?.type === "canvas-create") {
      pointerRef.current = null;
      setCanvasCreationPreview(null);
      setInteractionMode("idle");
      return;
    }
    endPointerOperation(event);
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
    // A wheel/pinch during a pointer or node drag would mutate cameraRef under
    // the gesture's fixed startWorld — the element jumps and the corrupted
    // position commits. The active gesture owns the camera until it ends.
    if (pointerRef.current !== null || isNodeGestureActive()) {
      event.preventDefault();
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
        worldRef.current.style.setProperty("--canvas-zoom", String(nextCamera.zoom));
      }
      setInteractionMode(prev => prev === "zooming" ? prev : "zooming");
    } else {
      const nextCamera = panCamera(cameraRef.current, { x: -deltaX, y: -deltaY });
      cameraRef.current = nextCamera;
      if (worldRef.current) {
        worldRef.current.style.transform = cameraTransform(nextCamera);
      }
      setInteractionMode(prev => prev === "panning" ? prev : "panning");
    }

    // The world transform is applied imperatively above; the React camera
    // commit only needs to happen once the gesture actually pauses. Committing
    // per wheel tick rendered the whole frame tree mid-gesture — at 1k frames
    // that's the difference between a smooth pan and a stutter. The delay is
    // just past CAMERA_SETTLE_MS so the commit lands as interaction goes idle.
    if (wheelCommitTimeoutRef.current) clearTimeout(wheelCommitTimeoutRef.current);
    wheelCommitTimeoutRef.current = setTimeout(() => {
      setCamera(cameraRef.current);
      wheelCommitTimeoutRef.current = null;
    }, CAMERA_SETTLE_MS + 20);

    scheduleVisibilityScan();
    settleInteraction();
  }, [settleInteraction, getCachedPointerPosition, isNodeGestureActive, scheduleVisibilityScan]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      surface.removeEventListener("wheel", handleWheel);
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
        editorStore.rollbackTransaction(operation.txToken);
      }
    }
    frameDragRef.current = null;
    setCanvasCreationPreview(null);
    setInteractionMode("idle");
  }, [cancelNodeGesture, editorStore]);

  const handleEscape = useCallback(() => {
    cancelSelectedTextEdit();
    cancelInteraction();
    creationRef.current = null;
    pendingImageRef.current = null;
    pendingCanvasImageRef.current = null;
    pendingFreeformTextRef.current = null;
    setCreationError(null);
    setIsFrameMenuOpen(false);
    setIsShaderMenuOpen(false);
    setSelectedShaderElementId(null);
    if (activeTool !== "select") {
      editorStore.execute(setActiveToolCommand("select"), { history: "skip" });
    }
  }, [activeTool, cancelInteraction, cancelSelectedTextEdit, editorStore]);

  // Shared executor so keys forwarded from a focused iframe behave exactly
  // like the top-level keydown handler. `event` is absent for bridge input.
  const runEditorShortcut = useCallback((action: EditorShortcutAction, event?: KeyboardEvent) => {
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
          event?.preventDefault();
          const clipboard = clipboardTargetRef.current;
          editorStore.execute(setSelectionCommand({ frameIds: [clipboard.frameId], nodeIds: [clipboard.nodeId], primaryFrameId: clipboard.frameId, primaryNodeId: clipboard.nodeId }), { history: "skip" });
          void duplicateSelectedNode();
        }
        break;
      case "duplicate-selection":
        void duplicateSelectedNode();
        break;
      case "delete-selection":
        // Shader elements live outside the editor store's node selection,
        // so a selected shader must be deleted through its own path.
        if (selectedShaderElementIdRef.current) {
          deleteShaderElement(selectedShaderElementIdRef.current);
        } else if (editorStore.getState().selection.nodeIds.length > 0) {
          // A freeform frame is packaging for what was drawn into it — when
          // every drawn element it holds is selected, delete the frame itself
          // so no invisible empty shell is left behind.
          {
            const state = editorStore.getState();
            const selectedNodeIds = new Set(state.selection.nodeIds);
            const absorbedFrameIds = new Set<string>();
            let covered = true;
            for (const nodeId of selectedNodeIds) {
              const node = state.nodes[nodeId];
              const frame = node?.frameId ? state.frames[node.frameId] : undefined;
              if (!node || !frame?.freeform) { covered = false; break; }
              absorbedFrameIds.add(frame.id);
            }
            for (const frameId of absorbedFrameIds) {
              if (!covered) break;
              for (const node of Object.values(state.nodes)) {
                if (
                  node.frameId === frameId
                  && node.attributes["data-design-tool-created"] === "true"
                  && !selectedNodeIds.has(node.id)
                ) {
                  covered = false;
                  break;
                }
              }
            }
            if (covered && absorbedFrameIds.size > 0) {
              editorStore.execute(setSelectionCommand({
                frameIds: [...absorbedFrameIds],
                nodeIds: [],
                primaryFrameId: [...absorbedFrameIds][0] ?? null,
                primaryNodeId: null,
              }), { history: "skip" });
              deleteSelectedFrames();
            } else {
              void deleteSelectedNodes();
            }
          }
        } else {
          deleteSelectedFrames();
        }
        break;
      case "escape":
        handleEscape();
        break;
      case "fit-all":
        fitAllFrames();
        break;
    }
  }, [deleteSelectedFrames, deleteSelectedNodes, deleteShaderElement, duplicateSelectedNode, editorStore, fitAllFrames, handleEscape, setActiveTool]);
  runEditorShortcutRef.current = runEditorShortcut;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      // An in-frame text editor owns the keyboard while it is open; tool
      // shortcuts, delete, and undo must not fire from stray keystrokes.
      if (frameTextEditRef.current.size > 0) {
        return;
      }
      // Space/Enter activate the focused control; only hijack them for canvas use otherwise.
      const activatableControl = isActivatableControlTarget(event.target);
      if (isSpaceShortcut(event.key)) {
        if (activatableControl) {
          return;
        }
        if (!event.repeat) {
          event.preventDefault();
          spacePressedRef.current = true;
          setSpacePressed(true);
        }
        return;
      }

      if (event.key === "Enter" && activeTool === "select" && editorStore.getState().selection.nodeIds.length > 0) {
        if (activatableControl) {
          return;
        }
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
      runEditorShortcut(action, event);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isSpaceShortcut(event.key)) {
        return;
      }
      if (!isActivatableControlTarget(event.target)) {
        event.preventDefault();
      }
      spacePressedRef.current = false;
      setSpacePressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [activeTool, editorStore, runEditorShortcut, startSelectedTextEdit]);

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
    if (persistenceFeedbackTimerRef.current !== null) {
      clearTimeout(persistenceFeedbackTimerRef.current);
      persistenceFeedbackTimerRef.current = null;
    }
    if (hoverRafRef.current !== null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    pendingHoverRef.current = undefined;
    cancelMountPump();
    for (const timer of inFlightMountsRef.current.values()) window.clearTimeout(timer);
    inFlightMountsRef.current.clear();
    if (visibilityScanRafRef.current !== null) {
      cancelAnimationFrame(visibilityScanRafRef.current);
      visibilityScanRafRef.current = null;
    }
    if (pendingSnapshotUiRef.current.raf !== null) {
      cancelAnimationFrame(pendingSnapshotUiRef.current.raf);
      pendingSnapshotUiRef.current.raf = null;
    }
  }, []);

  const guardIframes = (interactionMode !== "idle" && interactionMode !== "creating") || spacePressed;

  const selectedComment = selectedCommentId
    ? comments.find((entry) => entry.id === selectedCommentId) ?? null
    : null;
  const selectedCommentAnchor = selectedComment
    ? (() => {
        const frame = frameById.get(selectedComment.frameId);
        if (!frame) return null;
        return worldToScreen(
          { x: frame.x + FRAME_CONTENT_INSET + selectedComment.point.x, y: frame.y + FRAME_CONTENT_INSET + selectedComment.point.y },
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
        const frame = frameById.get(hoveredComment.frameId);
        if (!frame) return null;
        return worldToScreen(
          { x: frame.x + FRAME_CONTENT_INSET + hoveredComment.point.x, y: frame.y + FRAME_CONTENT_INSET + hoveredComment.point.y },
          camera,
        );
      })()
    : null;

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
      onPointerCancel={handlePointerCancel}
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
          style={{ ...worldStyle, transform: cameraTransform(camera), ["--canvas-zoom" as string]: String(camera.zoom) } as CSSProperties}
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
            isLive={liveFrameIds.has(frame.id)}
            isSelected={frame.id === selectedFrameId}
            isPanTool={activeTool === "hand" || spacePressed}
            onSelect={setSelectedFrameId}
            onStartMove={beginFramePointer}
            onStartPan={beginCanvasPan}
            onBridgeEvent={handleBridgeEvent}
            onBridgeInspection={handleBridgeInspection}
            onBridgeSnapshot={handleBridgeSnapshot}
            onBridgeController={handleBridgeController}
            onBridgeDetach={handleBridgeDetach}
            onBridgeMutation={markFrameDirty}
            isCreationMode={creationMode}
            creationShape={activeTool === "rectangle" ? activeShape : null}
            creationRadius={activeTool === "rectangle" ? shapeRadius : 0}
            onCreationPointerDown={beginCreationPointer}
            onCreationPointerMove={moveCreationPointer}
            onCreationPointerUp={finishCreationPointer}
            onCreationPointerCancel={cancelCreationPointer}
            tokenCss={tokenThemeCss}
          />
        ))}
        {shaderElements.map((element) => (
          <ShaderElementView
            camera={camera}
            isSelected={element.id === selectedShaderElementId}
            key={element.id}
            element={element}
            onChange={updateShaderElement}
            onDelete={deleteShaderElement}
            onSelect={selectShaderElement}
          />
        ))}
        {canvasCreationPreview ? (
          activeTool === "rectangle" ? (
            <ShapePreview
              end={canvasCreationPreview.end}
              radius={shapeRadius}
              shape={activeShape}
              start={canvasCreationPreview.start}
            />
          ) : (
            <div
              aria-hidden="true"
              className="canvas-creation-outline"
              data-testid="canvas-creation-outline"
              style={(() => {
                const bounds = normalizedBounds(canvasCreationPreview.start, canvasCreationPreview.end, 1);
                return {
                  left: bounds.x,
                  top: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                };
              })()}
            />
          )
        ) : null}
        <NodeOverlayLayer
          zoom={camera.zoom}
          hoveredTarget={overlayHoveredTarget}
          selectedTargets={overlaySelectedTargets}
          interactive={!creationMode}
          gestureStore={gestureOverlayStore}
          excludeTarget={isEditingOverlayTarget}
          onGestureStart={beginNodeGesture}
          onGestureMove={moveNodeGesture}
          onGestureEnd={endNodeGesture}
          onTextEditStart={startTextEdit}
        />
        {comments.map((comment) => {
          const frame = frameById.get(comment.frameId);
          if (!frame) return null;
          return (
            <button
              key={comment.id}
              aria-label={comment.body ? `Canvas comment: ${comment.body}` : "Canvas comment: Add a note"}
              className="canvas-comment-marker"
              data-canvas-control
              data-comment-status={comment.status}
              aria-expanded={selectedCommentId === comment.id}
              aria-haspopup="dialog"
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
              style={{ left: frame.x + FRAME_CONTENT_INSET + comment.point.x, top: frame.y + FRAME_CONTENT_INSET + comment.point.y, scale: 1 / camera.zoom, transformOrigin: "0 0" }}
              type="button"
            >
              {comment.status === "resolved" ? (
                <svg aria-hidden="true" fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M3.5 8.6l3 3 6-6.8"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.2"
                  />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z"
                    fill="currentColor"
                  />
                </svg>
              )}
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
          onToggleResolved={toggleCommentResolved}
          style={{ left: selectedCommentAnchor.x + 18, top: selectedCommentAnchor.y + 18 }}
        />
      ) : null}

      {hoveredComment && hoveredCommentAnchor ? (
        <div
          aria-hidden="true"
          className="canvas-comment-preview"
          data-testid="comment-hover-preview"
          style={(() => {
            const surfaceEl = surfaceRef.current;
            const inspector = surfaceEl?.querySelector(".right-properties-panel")?.getBoundingClientRect();
            const surfaceRect = surfaceRectRef.current;
            const freeRight = inspector && surfaceRect
              ? inspector.left - surfaceRect.left - 8
              : (surfaceRect?.width ?? 1440) - 12;
            return {
              left: Math.max(12, Math.min(hoveredCommentAnchor.x + 18, freeRight - 280)),
              top: Math.max(12, hoveredCommentAnchor.y + 18),
            };
          })()}
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
            {(() => {
              const stale = routeProjectId ? localProjects.find((p) => p.id === routeProjectId) : undefined;
              if (stale) {
                return (
                  <>
                    <h2>Could not open “{stale.name}”</h2>
                    <p>
                      This file exists in your lake but its saved data could not be read
                      (<code>{routeProjectId}</code>). It may have been written by a newer
                      version or damaged by a storage failure. Your other files are unaffected.
                    </p>
                  </>
                );
              }
              return (
                <>
                  <h2>Project not found</h2>
                  <p>
                    No local project matches <code>{routeProjectId}</code>. It may have been deleted on this device or the link is incorrect.
                  </p>
                </>
              );
            })()}
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
              {routeProjectId && localProjects.some((p) => p.id === routeProjectId) ? (
                <button
                  onClick={() => {
                    handleDeleteLakeProject(routeProjectId);
                  }}
                  type="button"
                  className="is-secondary is-danger"
                >
                  Delete damaged file
                </button>
              ) : null}
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
        projectMeta={(() => {
          const canvasDef = CANVAS_CATEGORIES.find((c) => c.id === activeCanvasCategory)!;
          const agentFile = CANVAS_AGENT_FILES[activeCanvasCategory];
          if (briefFrame) return `${frames.length} frames · ${canvasDef.label} · ${agentFile} · Brainstorming`;
          if (routeProjectId) return `${canvasDef.label} · ${agentFile} · ${routeProjectId.slice(0, 12)}…`;
          if (isEmptyState) return undefined;
          return `${canvasDef.label} · ${agentFile}`;
        })()}
        projectName={
          shouldUseLocalMemory
            ? routeProjectId
              ? (localProjects.find((p) => p.id === routeProjectId)?.name
                ?? deriveProjectName(editorState, "blank"))
              : "Home"
            : isEmptyState
              ? "Untitled canvas"
              : briefFrame
                ? "Project brief"
                : undefined
        }
        canvasCategory={shouldUseLocalMemory && routeProjectId ? activeCanvasCategory : undefined}
        canvasLabel={shouldUseLocalMemory && routeProjectId ? CANVAS_CATEGORIES.find((c) => c.id === activeCanvasCategory)?.label : undefined}
        canExport={editorState.session.lifecycle !== "not-started"}
        onImportFile={importProjectFile}
        onImportHtmlFile={importHtmlFile}
        onExport={exportProject}
        onExportFigma={exportFigmaProject}
        onExportCode={exportCodeProject}
        onExportReact={exportReactProject}
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
          activeTool={activeTool}
          temporaryHand={spacePressed}
          isFrameMenuOpen={isFrameMenuOpen}
          isShaderMenuOpen={isShaderMenuOpen}
          onAddFrame={addFrame}
          onAddShader={addShaderElement}
          canvasCategory={activeCanvasCategory}
          onSelectTool={setActiveTool}
          activeShape={activeShape}
          onSelectShape={(shape) => { setActiveShape(shape); setActiveTool("rectangle", { force: true }); }}
          onToggleFrameMenu={toggleFrameMenu}
          onCloseFrameMenu={() => setIsFrameMenuOpen(false)}
          onToggleShaderMenu={toggleShaderMenu}
          onCloseShaderMenu={closeShaderMenu}
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
          <span>{creationError ?? (activeTool === "comment"
            ? "Click a frame to place a comment."
            : activeTool === "image"
              ? "Drag on the canvas or inside a frame, then choose a local image."
              : "Drag on the canvas, or inside a frame to draw there.")}</span>
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
            onHoverNode={handleSidebarHoverNode}
            onHoverNodeEnd={handleSidebarHoverNodeEnd}
            hoveredLayerNode={hoveredLayerNode}
            shaderElements={shaderElements}
            selectedShaderElementId={selectedShaderElementId}
            onSelectShaderElement={selectShaderElement}
            onUpdateShaderParams={updateShaderElementParams}
            onDeleteShaderElement={deleteShaderElement}
            tokensPanel={
              <TokensPanel
                tokens={editorState.tokens}
                onUpsertSet={upsertTokenSet}
                onRemoveSet={removeTokenSet}
                onUpsertToken={upsertToken}
                onRemoveToken={removeToken}
                onRenameToken={renameToken}
                onUpsertTheme={upsertTokenTheme}
                onRemoveTheme={removeTokenTheme}
                onSwitchTheme={switchTokenTheme}
                onExportDTCG={exportDTCGTokens}
                onExportCss={exportTokenCss}
                onImportTokensFile={importTokensFile}
              />
            }
          />
          <PropertiesPanel
            frames={editorState.frames}
            nodes={editorState.nodes}
            selection={editorState.selection}
            bridgeTargets={bridgeTargets}
            tokens={editorState.tokens}
            onUpdateFrame={updateFrameFromPanel}
            onMoveFrame={moveFrameFromPanel}
            onEditNodeStyle={editNodeStyle}
            onEditNodePosition={editNodePosition}
            onApplyGlassEffect={applyGlassEffect}
            onPreviewGlassEffect={previewGlassEffect}
            shapeRadius={radiusDragging ? shapeRadius : (radiusSelection?.radius ?? shapeRadius)}
            shapeRadiusVisible={activeTool === "rectangle" || radiusSelection !== null}
            onShapeRadiusChange={changeShapeRadius}
            onShapeRadiusCommit={commitShapeRadius}
            shaderElements={shaderElements}
            selectedShaderElementId={selectedShaderElementId}
            onUpdateShaderElement={updateShaderElement}
            onUpdateShaderParams={updateShaderElementParams}
            onDeleteShaderElement={deleteShaderElement}
          />
        </>
      ) : null}

      <div className="canvas-help" aria-hidden="true">
        <span><kbd>Space</kbd> drag to pan</span>
        <span>Pinch to zoom</span>
        <span><kbd>0</kbd> fit all</span>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {frames.length} frames, {liveFrameIds.size} live, {Math.round(camera.zoom * 100)}% zoom
      </div>
    </main>
  );
}
