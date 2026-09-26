import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type {
  BridgeElementTarget,
  BridgeInspection,
  BridgeRect,
  SafeInlineStyleProperty,
} from "../bridge/protocol";
import type { IframeBridgeController } from "../bridge/transport";
import { screenToWorld } from "../canvas/camera";
import type { Camera, Point, Rect } from "../canvas/types";
import type { EditorCommand } from "../editor/commands";
import type { FrameEntity, SelectionState } from "../editor/model";
import {
  buildMoveChanges,
  buildResizeChanges,
  buildRotationChanges,
  toInlineStyleCommands,
  type OverlayStyleChange,
  type OverlayStyleSnapshot,
} from "./commands";
import {
  changeFootprint,
  computeFreeformFit,
  freeformBodyShiftFromValue,
  freeformBodyShiftValue,
  freeformFrameCommands,
  isFreeformContentNode,
} from "./freeform-fit";
import {
  rotationAngle,
  snapTranslation,
  unionRects,
  type ResizeHandle,
} from "./geometry";
import {
  createGestureOverlayStore,
  type GestureOverlayStore,
  type NodeGestureStart,
  type OverlayNodeTarget,
} from "./NodeOverlayLayer";

export interface OverlayBridgeTargetState {
  frameId: string;
  target: BridgeElementTarget;
  inspection: BridgeInspection | null;
}

export type NodeInteractionMode =
  | "idle"
  | "creating"
  | "panning"
  | "moving-frame"
  | "moving-node"
  | "resizing-node"
  | "rotating-node"
  | "zooming";

interface NodeGestureOperation {
  kind: NodeGestureStart["kind"];
  handle?: ResizeHandle;
  pointerId: number;
  started: boolean;
  targetIds: string[];
  startWorld: Point;
  startAngle: Point;
  surfaceRect: DOMRect;
  snapshots: OverlayStyleSnapshot[];
  groupBounds: Rect;
  queue: Promise<void>;
  changes: OverlayStyleChange[];
  capturedPrevious: Map<string, string | null>;
  /**
   * One canonical synthesized <body> change per re-anchored freeform frame,
   * kept for the life of the gesture. `previous` is the pre-gesture body
   * transform (so undo fully clears the re-anchor even when the last
   * pointermove fitted nothing new), `next` tracks the latest shift.
   */
  freeformBodyChanges: Map<string, OverlayStyleChange>;
  fittedFrameIds: Set<string>;
  suspendedNotifications: boolean;
  cancelled: boolean;
  /** Ownership token for the transaction this gesture opened, if it opened one. */
  txToken?: symbol;
}

interface UseNodeOverlayGesturesOptions {
  surfaceRef: RefObject<HTMLDivElement | null>;
  cameraRef: MutableRefObject<Camera>;
  editorStore: {
    beginTransaction: (label: string) => symbol;
    commitTransaction: (
      effect?: { undo: () => void; redo: () => void },
      token?: symbol,
    ) => boolean;
    rollbackTransaction: (token?: symbol) => boolean;
    hasActiveTransaction: () => boolean;
    getState: () => { frames: Record<string, FrameEntity> };
    execute: (command: EditorCommand) => boolean;
    suspendNotifications?: () => void;
    resumeNotifications?: () => void;
  };
  bridgeTargets: Record<string, OverlayBridgeTargetState>;
  bridgeControllersRef: MutableRefObject<Map<string, IframeBridgeController>>;
  refreshSnapshot: (frameId: string) => Promise<void>;
  refreshTarget: (frameId: string, targetId: string) => Promise<BridgeInspection | null>;
  selection: SelectionState;
  toOverlayTarget: (entry: OverlayBridgeTargetState) => OverlayNodeTarget | null;
  setInteractionMode: (mode: NodeInteractionMode) => void;
  /**
   * Cumulative doc-space re-anchor shift applied to each freeform frame's
   * <body>, keyed by frameId. Shared with the surface so non-gesture fits
   * (e.g. snapshot-driven growth) stay consistent with undo/redo.
   */
  freeformShiftRef?: MutableRefObject<Map<string, Point>>;
}

function targetStateKey(frameId: string, nodeId: string): string {
  return `${frameId}:${nodeId}`;
}

/**
 * Changes the freeform fit synthesizes against a frame's <body> rather than
 * a gesture target. Marked so undo/redo replays can resync the cumulative
 * shift tracker, and so they never paint selection chrome.
 */
const synthesizedBodyChanges = new WeakSet<OverlayStyleChange>();

function getSurfacePoint(
  event: { clientX: number; clientY: number },
  surface: HTMLElement,
): Point {
  const bounds = surface.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

/**
 * A click on the selection box of a large container must reach the element
 * underneath so nested layers stay selectable. The overlay intercepts pointer
 * events, so a settled click is re-dispatched into the frame document through
 * the bridge, where the runtime reports it as a normal selection event.
 */
function dispatchClickThrough(
  event: { clientX: number; clientY: number; shiftKey?: boolean },
  surface: HTMLElement | null,
  frameId: string,
  zoom: number,
  controller: { pickElement: (command: { command: "pick-element"; point: { x: number; y: number }; shiftKey: boolean }) => Promise<unknown> },
): void {
  const frame = surface?.querySelector(`[data-frame-id="${CSS.escape(frameId)}"]`);
  const iframe = frame?.querySelector("iframe");
  const rect = iframe?.getBoundingClientRect();
  if (!rect) return;
  void controller.pickElement({
    command: "pick-element",
    point: {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    },
    shiftKey: Boolean(event.shiftKey),
  }).catch(() => undefined);
}

/**
 * Moves/rescales a canonical rect alongside the AABB-space box the gesture
 * computed — the canonical center rides the AABB's center delta and scales
 * by the same ratios, so a rotated element's painted box tracks the change.
 */
function mapCanonicalBounds(canonical: Rect, before: Rect, after: Rect): Rect {
  const sx = before.width > 0 ? after.width / before.width : 1;
  const sy = before.height > 0 ? after.height / before.height : 1;
  const cx = (canonical.x + canonical.width / 2 - (before.x + before.width / 2)) * sx;
  const cy = (canonical.y + canonical.height / 2 - (before.y + before.height / 2)) * sy;
  const width = canonical.width * sx;
  const height = canonical.height * sy;
  return {
    x: after.x + after.width / 2 + cx - width / 2,
    y: after.y + after.height / 2 + cy - height / 2,
    width,
    height,
  };
}

/**
 * The rect + rotation the gesture chrome should paint for a change. Canonical
 * changes already carry the unrotated rect — painting them with the change's
 * rotation reproduces the element's real box. AABB-space changes keep the
 * measured box unless a canonical rect can ride along with it; painting a
 * bare AABB with rotate() would double-apply the element's own angle.
 */
function gestureOverlayBox(
  change: OverlayStyleChange,
  measured: Rect | undefined,
): Pick<OverlayNodeTarget, "bounds" | "rotation"> {
  if (change.canonical && !measured) {
    return { bounds: change.nextBounds, rotation: change.rotation };
  }
  const bounds = measured ?? change.nextBounds;
  if (change.target.canonicalBounds) {
    return {
      bounds: mapCanonicalBounds(change.target.canonicalBounds, change.target.bounds, bounds),
      rotation: change.rotation,
    };
  }
  return { bounds, rotation: 0 };
}

function hasOverlayStyleChanges(changes: readonly OverlayStyleChange[]): boolean {
  return changes.some((change) => {
    const properties = new Set([
      ...Object.keys(change.previous),
      ...Object.keys(change.next),
    ]);
    return Array.from(properties).some(
      (property) =>
        change.previous[property as keyof typeof change.previous] !==
        change.next[property as keyof typeof change.next],
    );
  });
}

export function useNodeOverlayGestures({
  surfaceRef,
  cameraRef,
  editorStore,
  bridgeTargets,
  bridgeControllersRef,
  refreshSnapshot,
  refreshTarget,
  selection,
  toOverlayTarget,
  setInteractionMode,
  freeformShiftRef,
}: UseNodeOverlayGesturesOptions) {
  const nodeGestureRef = useRef<NodeGestureOperation | null>(null);
  const ownShiftRef = useRef(new Map<string, Point>());
  const shiftRef = freeformShiftRef ?? ownShiftRef;
  const gestureStylesRef = useRef(new Map<string, Partial<Record<SafeInlineStyleProperty, string | null>>>());
  const measuredBoundsRef = useRef(new Map<string, Rect>());
  const gestureOverlayStoreRef = useRef<GestureOverlayStore | null>(null);
  if (gestureOverlayStoreRef.current === null) {
    gestureOverlayStoreRef.current = createGestureOverlayStore();
  }
  const gestureOverlayStore = gestureOverlayStoreRef.current;
  const liveSettledRef = useRef<Promise<void>>(Promise.resolve());

  /**
   * Predicted gesture bounds assume a top/left-anchored edit, but layout is
   * free to land the element elsewhere — a flex/grid-aligned or
   * min/max-clamped element grows around a different anchor, so the selection
   * box drifts off the painted element mid-drag. Command acks carry the
   * element's real post-edit rect; glue the overlay to it until the
   * post-gesture snapshot refresh re-syncs everything.
   */
  const applyMeasuredBounds = useCallback(
    (change: OverlayStyleChange, bounds: BridgeRect, bodyOrigin?: { x: number; y: number }) => {
      if (!nodeGestureRef.current) return;
      // The measured rect is a post-transform AABB — wrong shape for rotated
      // elements, whose overlay box stays the pre-rotation rect.
      if (Math.abs(change.rotation) > 0.01) return;
      // Ack bounds are measured inside the shifted body — normalize into the
      // canonical space stored targets use, since toOverlayTarget subtracts
      // the live shift back out. Only freeform frames re-anchor <body>; on a
      // regular document bodyOrigin reports the body margin/scroll offset,
      // which the ack bounds already share with the stored targets.
      const frame = editorStore.getState().frames[change.target.frameId];
      const shift = frame?.freeform
        ? bodyOrigin
          ? { x: -bodyOrigin.x, y: -bodyOrigin.y }
          : shiftRef.current.get(change.target.frameId) ?? { x: 0, y: 0 }
        : { x: 0, y: 0 };
      const overlay = toOverlayTarget({
        frameId: change.target.frameId,
        target: {
          elementId: change.target.nodeId,
          tagName: change.target.tagName,
          path: "",
          name: change.target.name,
          role: null,
          bounds: {
            x: bounds.x + shift.x,
            y: bounds.y + shift.y,
            width: bounds.width,
            height: bounds.height,
          },
        },
        inspection: null,
      });
      if (!overlay) return;
      const key = targetStateKey(change.target.frameId, change.target.nodeId);
      measuredBoundsRef.current.set(key, overlay.bounds);
      gestureOverlayStore.patchTargets((current) => {
        if (!current) return current;
        let changed = false;
        const next = current.map((target) => {
          if (targetStateKey(target.frameId, target.nodeId) !== key) return target;
          const b = target.bounds;
          const measured = overlay.bounds;
          if (
            Math.abs(b.x - measured.x) < 0.05 &&
            Math.abs(b.y - measured.y) < 0.05 &&
            Math.abs(b.width - measured.width) < 0.05 &&
            Math.abs(b.height - measured.height) < 0.05
          ) {
            return target;
          }
          changed = true;
          return { ...target, bounds: measured };
        });
        return changed ? next : current;
      });
    },
    [editorStore, gestureOverlayStore, shiftRef, toOverlayTarget],
  );

  /**
   * Live edits post to the frame iframe from inside the pointermove dispatch.
   * Deferring to rAF would queue the postMessage at the end of the frame, so
   * the sandboxed document would always paint the dragged element one frame
   * behind the parent-document overlay.
   */
  const flushLiveApply = useCallback((changes: OverlayStyleChange[]) => {
    const operation = nodeGestureRef.current;
    if (changes.length === 0 || !operation) return;
    const entries = changes.flatMap((change) =>
      toInlineStyleCommands([change], "next").map((command) => ({
        frameId: change.target.frameId,
        command,
        change,
      })),
    );
    const captures: Promise<void>[] = [];
    for (const { frameId, command, change } of entries) {
      const controller = bridgeControllersRef.current.get(frameId);
      if (!controller) continue;
      const key = `${frameId}:${command.targetId}:${command.property}`;
      const captured = operation.capturedPrevious;
      captures.push(
        controller.setInlineStyle(command).then((ack) => {
          if (ack?.command !== "set-inline-style") return;
          if (!captured.has(key)) {
            captured.set(key, ack.previousValue);
            change.previous[command.property] = ack.previousValue;
          }
          if (ack.bounds) applyMeasuredBounds(change, ack.bounds, ack.bodyOrigin);
        }).catch(() => undefined),
      );
    }
    if (captures.length === 0) return;
    const settle = Promise.all(captures).then(() => undefined).catch(() => undefined);
    liveSettledRef.current = liveSettledRef.current.then(() => settle);
  }, [applyMeasuredBounds, bridgeControllersRef]);

  const selectedOverlayTargets = useMemo(() => {
    const selectedNodeIds = new Set(selection.nodeIds);
    const selectedFrameIds = new Set(selection.frameIds);
    return Object.values(bridgeTargets)
      .filter(
        (entry) =>
          selectedNodeIds.has(entry.target.elementId) &&
          (selectedFrameIds.size === 0 || selectedFrameIds.has(entry.frameId)),
      )
      .map(toOverlayTarget)
      .filter((target): target is OverlayNodeTarget => target !== null);
  }, [bridgeTargets, selection, toOverlayTarget]);

  useEffect(() => {
    if (!nodeGestureRef.current) gestureOverlayStore.clear();
  }, [gestureOverlayStore, selection]);

  const applyStyleChanges = useCallback(
    async (
      changes: readonly OverlayStyleChange[],
      direction: "previous" | "next",
      capturedPrevious?: Map<string, string | null>,
    ) => {
      const commands = changes.flatMap((change) =>
        toInlineStyleCommands([change], direction).map((command) => ({
          frameId: change.target.frameId,
          command,
          change,
        })),
      );
      await Promise.all(
        commands.map(async ({ frameId, command, change }) => {
          const ack = await bridgeControllersRef.current.get(frameId)?.setInlineStyle(command);
          if (
            direction === "next" &&
            capturedPrevious &&
            ack?.command === "set-inline-style"
          ) {
            const key = `${frameId}:${command.targetId}:${command.property}`;
            if (!capturedPrevious.has(key)) {
              capturedPrevious.set(key, ack.previousValue);
              change.previous[command.property] = ack.previousValue;
            }
          }
        }),
      );
      // Undo/redo/cancel replays move the freeform <body> re-anchor with
      // them — keep the cumulative tracker on the value that just landed.
      for (const change of changes) {
        if (!synthesizedBodyChanges.has(change)) continue;
        const value = (direction === "previous" ? change.previous : change.next).transform;
        shiftRef.current.set(
          change.target.frameId,
          freeformBodyShiftFromValue(value),
        );
      }
    },
    [bridgeControllersRef, shiftRef],
  );

  const beginNodeGesture = useCallback(
    (gesture: NodeGestureStart, event: ReactPointerEvent<HTMLElement>) => {
      if (nodeGestureRef.current || event.button !== 0) return;
      const surface = surfaceRef.current;
      if (!surface) return;
      surface.focus({ preventScroll: true });

      const snapshots = gesture.targets
        .filter((target) => !target.locked)
        .map((target) => {
          const entry = bridgeTargets[targetStateKey(target.frameId, target.nodeId)];
          const transientStyles = gestureOverlayStore.getSnapshot().targets
            ? gestureStylesRef.current.get(targetStateKey(target.frameId, target.nodeId))
            : undefined;
          const inlineStyle = transientStyles
            ? Object.fromEntries(
                Object.entries({
                  ...entry?.inspection?.inlineStyle,
                  ...transientStyles,
                }).filter(([, value]) => value !== null),
              ) as Partial<Record<SafeInlineStyleProperty, string>>
            : entry?.inspection?.inlineStyle ?? {};
          return {
            target,
            inlineStyle,
            computedStyle: entry?.inspection?.computedStyle ?? {},
          } satisfies OverlayStyleSnapshot;
        });
      const groupBounds = unionRects(snapshots.map((snapshot) => snapshot.target.bounds));
      if (!groupBounds || snapshots.length === 0) return;

      const startWorld = screenToWorld(
        getSurfacePoint(event, surface),
        cameraRef.current,
      );
      const operation: NodeGestureOperation = {
        kind: gesture.kind,
        handle: gesture.handle,
        pointerId: gesture.pointerId,
        started: false,
        targetIds: gesture.targetIds,
        startWorld,
        startAngle: startWorld,
        surfaceRect: surface.getBoundingClientRect(),
        snapshots,
        groupBounds,
        queue: Promise.resolve(),
        changes: [],
        capturedPrevious: new Map(),
        freeformBodyChanges: new Map(),
        fittedFrameIds: new Set(),
        suspendedNotifications: false,
        cancelled: false,
      };
      measuredBoundsRef.current.clear();
      nodeGestureRef.current = operation;
      // Keep the initial click on the pressed control so native click/double-click
      // dispatch remains intact; moveNodeGesture transfers capture to the surface
      // once the pointer crosses the drag threshold.
      event.currentTarget.setPointerCapture(gesture.pointerId);
    },
    [bridgeTargets, editorStore, gestureOverlayStore, setInteractionMode, surfaceRef, cameraRef],
  );

  /**
   * Freeform frames must hug their content — the iframe clips whatever
   * leaves the frame rect, so an element dragged past the edge slides under
   * an invisible boundary. Fit grows (and shrinks) the frame to the union of
   * its content plus pad; when the frame origin moves, a matching <body>
   * translate re-anchors every fixed-position element (the transform makes
   * body their containing block), so nothing visually jumps. The body edit
   * rides inside the same change list, keeping live-apply, undo, and redo
   * coherent.
   */
  const fitFreeformFrames = useCallback(
    (changes: OverlayStyleChange[]): OverlayStyleChange[] => {
      const state = editorStore.getState();
      const changeByKey = new Map(
        changes.map((change) => [
          targetStateKey(change.target.frameId, change.target.nodeId),
          change,
        ]),
      );
      const extras: OverlayStyleChange[] = [];
      for (const frameId of new Set(changes.map((change) => change.target.frameId))) {
        const frame = state.frames[frameId];
        if (!frame?.freeform) continue;
        const content: Rect[] = [];
        for (const entry of Object.values(bridgeTargets)) {
          if (entry.frameId !== frameId) continue;
          if (!isFreeformContentNode(entry.target)) continue;
          const change = changeByKey.get(
            targetStateKey(frameId, entry.target.elementId),
          );
          const bounds = change
            ? changeFootprint(change)
            : toOverlayTarget(entry)?.bounds;
          if (bounds) content.push(bounds);
        }
        // A change target might not have a bridge entry yet — count it anyway.
        // Synthesized <body> changes describe the frame itself, not content:
        // feeding the fit rect back into the union would pin the frame at its
        // largest size instead of letting it shrink on reverse drags.
        for (const change of changes) {
          if (change.target.frameId === frameId && !synthesizedBodyChanges.has(change)) {
            content.push(changeFootprint(change));
          }
        }
        const fit = computeFreeformFit(frame, content);
        if (!fit) continue;
        for (const command of freeformFrameCommands(frame, fit.rect)) {
          editorStore.execute(command);
        }
        nodeGestureRef.current?.fittedFrameIds.add(frameId);
        const frameElement = surfaceRef.current?.querySelector<HTMLElement>(
          `[data-frame-id="${frameId}"]`,
        );
        if (frameElement) {
          frameElement.style.transform = `translate3d(${fit.rect.x}px, ${fit.rect.y}px, 0)`;
          frameElement.style.width = `${fit.rect.width}px`;
          frameElement.style.height = `${fit.rect.height}px`;
        }
        if (Math.abs(fit.originDelta.x) < 0.01 && Math.abs(fit.originDelta.y) < 0.01) {
          continue;
        }
        const body = Object.values(bridgeTargets).find(
          (entry) =>
            entry.frameId === frameId && entry.target.tagName.toLowerCase() === "body",
        );
        if (!body) continue;
        const previous = shiftRef.current.get(frameId) ?? { x: 0, y: 0 };
        const next = {
          x: previous.x + fit.originDelta.x,
          y: previous.y + fit.originDelta.y,
        };
        shiftRef.current.set(frameId, next);
        const change: OverlayStyleChange = {
          target: {
            frameId,
            nodeId: body.target.elementId,
            tagName: "body",
            name: "body",
            bounds: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          },
          nextBounds: fit.rect,
          rotation: 0,
          previous: {
            transform: freeformBodyShiftValue({ x: -previous.x, y: -previous.y }),
          },
          next: {
            transform: freeformBodyShiftValue({ x: -next.x, y: -next.y }),
          },
        };
        synthesizedBodyChanges.add(change);
        extras.push(change);
      }
      return extras.length > 0 ? [...changes, ...extras] : changes;
    },
    [bridgeTargets, editorStore, shiftRef, surfaceRef, toOverlayTarget],
  );

  const restoreFittedFrames = useCallback(
    (operation: NodeGestureOperation) => {
      if (operation.fittedFrameIds.size === 0) return;
      const surface = surfaceRef.current;
      const frames = editorStore.getState().frames;
      for (const frameId of operation.fittedFrameIds) {
        const frame = frames[frameId];
        const element = surface?.querySelector<HTMLElement>(`[data-frame-id="${frameId}"]`);
        if (!frame || !element) continue;
        element.style.transform = `translate3d(${frame.x}px, ${frame.y}px, 0)`;
        element.style.width = `${frame.width}px`;
        element.style.height = `${frame.height}px`;
      }
      operation.fittedFrameIds.clear();
    },
    [editorStore, surfaceRef],
  );

  const resumeNotifications = useCallback(
    (operation: NodeGestureOperation) => {
      if (!operation.suspendedNotifications) return;
      operation.suspendedNotifications = false;
      editorStore.resumeNotifications?.();
    },
    [editorStore],
  );

  const moveNodeGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const operation = nodeGestureRef.current;
      const surface = surfaceRef.current;
      if (!operation || operation.pointerId !== event.pointerId || !surface) return false;

      // The rect is cached at gesture start: the surface cannot move mid-drag,
      // and re-querying it here would force a synchronous layout on every move
      // because the overlay re-rendered since the last event.
      const point = {
        x: event.clientX - operation.surfaceRect.left,
        y: event.clientY - operation.surfaceRect.top,
      };
      const currentWorld = screenToWorld(point, cameraRef.current);
      const rawDelta = {
        x: currentWorld.x - operation.startWorld.x,
        y: currentWorld.y - operation.startWorld.y,
      };
      if (!operation.started && Math.hypot(rawDelta.x * cameraRef.current.zoom, rawDelta.y * cameraRef.current.zoom) < 3) {
        return true;
      }
      if (!operation.started) {
        // A transaction open from another path (a bridge edit awaiting acks)
        // can't host this gesture — beginning one throws here, leaving the
        // pointer captured and the gesture half-live. Keep the operation
        // armed but unstarted; the pointer simply can't move the node this
        // round.
        if (editorStore.hasActiveTransaction()) return true;
        operation.started = true;
        surface.setPointerCapture(operation.pointerId);
        gestureOverlayStore.set({
          targets: operation.snapshots.map((snapshot) => snapshot.target),
          guides: [],
        });
        operation.txToken = editorStore.beginTransaction(
          operation.kind === "move"
            ? "Move selection"
            : operation.kind === "resize"
              ? "Resize selection"
              : "Rotate selection",
        );
        if (editorStore.suspendNotifications) {
          editorStore.suspendNotifications();
          operation.suspendedNotifications = true;
        }
        setInteractionMode(
          operation.kind === "move"
            ? "moving-node"
            : operation.kind === "resize"
              ? "resizing-node"
              : "rotating-node",
        );
      }
      let changes: OverlayStyleChange[];
      let guides: { axis: "x" | "y"; value: number }[] = [];
      if (operation.kind === "move") {
        const selectedKeys = new Set(operation.targetIds);
        const snapTargets = Object.values(bridgeTargets)
          .filter((entry) => !selectedKeys.has(targetStateKey(entry.frameId, entry.target.elementId)))
          .map(toOverlayTarget)
          .filter((target): target is OverlayNodeTarget => target !== null)
          .map((target) => target.bounds);
        const snap = snapTranslation(operation.groupBounds, rawDelta, snapTargets);
        guides = snap.guides.map(({ axis, value }) => ({ axis, value }));
        changes = buildMoveChanges(operation.snapshots, snap.delta);
      } else if (operation.kind === "resize" && operation.handle) {
        changes = buildResizeChanges(
          operation.snapshots,
          operation.groupBounds,
          operation.handle,
          rawDelta,
        );
      } else {
        changes = buildRotationChanges(
          operation.snapshots,
          rotationAngle(
            {
              x: operation.groupBounds.x + operation.groupBounds.width / 2,
              y: operation.groupBounds.y + operation.groupBounds.height / 2,
            },
            operation.startAngle,
            currentWorld,
          ),
        );
      }

      changes = fitFreeformFrames(changes);
      // Fold this move's synthesized body changes into the per-operation
      // record, then re-emit them: undo must replay the pre-gesture body
      // transform even when this particular move fitted nothing new.
      for (const change of changes) {
        if (!synthesizedBodyChanges.has(change)) continue;
        const key = targetStateKey(change.target.frameId, change.target.nodeId);
        const recorded = operation.freeformBodyChanges.get(key);
        if (recorded) {
          recorded.next = change.next;
          recorded.nextBounds = change.nextBounds;
        } else {
          operation.freeformBodyChanges.set(key, change);
        }
      }
      if (operation.freeformBodyChanges.size > 0) {
        changes = [
          ...changes.filter((change) => !synthesizedBodyChanges.has(change)),
          ...operation.freeformBodyChanges.values(),
        ];
      }

      for (const change of changes) {
        for (const property of Object.keys(change.next) as Array<keyof typeof change.next>) {
          const key = targetStateKey(change.target.frameId, change.target.nodeId) + `:${property}`;
          if (operation.capturedPrevious.has(key)) {
            change.previous[property] = operation.capturedPrevious.get(key) ?? null;
          }
        }
        const currentStyles = gestureStylesRef.current.get(
          targetStateKey(change.target.frameId, change.target.nodeId),
        ) ?? {};
        gestureStylesRef.current.set(
          targetStateKey(change.target.frameId, change.target.nodeId),
          {
            ...currentStyles,
            ...change.next,
          },
        );
      }
      operation.changes = changes;
      gestureOverlayStore.set({
        targets: changes
          // Synthesized freeform <body> changes ride along for apply/undo —
          // they must not paint selection chrome.
          .filter((change) => !synthesizedBodyChanges.has(change))
          .map((change) => ({
            ...change.target,
            // Once the bridge has reported where the element actually landed,
            // keep the chrome on the measured rect rather than the prediction.
            ...gestureOverlayBox(
              change,
              measuredBoundsRef.current.get(
                targetStateKey(change.target.frameId, change.target.nodeId),
              ),
            ),
          })),
        guides,
      });
      flushLiveApply(changes);
      return true;
    },
    [applyStyleChanges, bridgeTargets, cameraRef, editorStore, fitFreeformFrames, flushLiveApply, gestureOverlayStore, setInteractionMode, surfaceRef, toOverlayTarget],
  );

  const endNodeGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const operation = nodeGestureRef.current;
      if (!operation || operation.pointerId !== event.pointerId) return;
      nodeGestureRef.current = null;
      setInteractionMode("idle");

      if (operation.cancelled || !hasOverlayStyleChanges(operation.changes)) {
        // Only the gesture's own transaction may be rolled back — an
        // unstarted gesture (blocked on a foreign transaction) must not
        // revert that other edit.
        if (operation.txToken !== undefined && editorStore.hasActiveTransaction()) {
          editorStore.rollbackTransaction(operation.txToken);
        }
        restoreFittedFrames(operation);
        resumeNotifications(operation);
        gestureOverlayStore.clear();
        if (!operation.cancelled && !operation.started && operation.kind === "move") {
          const frameId = operation.snapshots[0]?.target.frameId;
          const controller = frameId ? bridgeControllersRef.current.get(frameId) : undefined;
          if (controller) dispatchClickThrough(event, surfaceRef.current, frameId, cameraRef.current.zoom, controller);
        }
        return;
      }

      const affectedFrameIds = Array.from(new Set(operation.changes.map((change) => change.target.frameId)));
      const affectedTargets = Array.from(new Map(
        operation.changes.map((change) => [
          targetStateKey(change.target.frameId, change.target.nodeId),
          { frameId: change.target.frameId, targetId: change.target.nodeId },
        ]),
      ).values());
      const refreshLiveState = () => Promise.all(affectedFrameIds.map((frameId) => refreshSnapshot(frameId)))
        .then(() => Promise.all(affectedTargets.map(({ frameId, targetId }) => refreshTarget(frameId, targetId))));
      const refreshAfterQueue = () => {
        const queued = operation.queue;
        void queued
          .then(refreshLiveState)
          .then(() => {
            for (const { frameId, targetId } of affectedTargets) {
              gestureStylesRef.current.delete(targetStateKey(frameId, targetId));
            }
            if (!nodeGestureRef.current) gestureOverlayStore.clear();
          })
          .catch(() => undefined);
      };

      const settled = liveSettledRef.current;
      const schedule = (direction: "previous" | "next") => {
        const run = operation.queue
          .then(() => settled)
          .then(() => applyStyleChanges(operation.changes, direction, operation.capturedPrevious))
          .catch(() => undefined);
        operation.queue = run;
        gestureOverlayStore.set({
          targets:
            direction === "previous"
              ? operation.snapshots.map((snapshot) => snapshot.target)
              : operation.changes
                  .filter((change) => !synthesizedBodyChanges.has(change))
                  .map((change) => ({
                    ...change.target,
                    ...gestureOverlayBox(change, undefined),
                  })),
          guides: [],
        });
        refreshAfterQueue();
        return run.then(() => undefined);
      };
      const effect = { undo: () => schedule("previous"), redo: () => schedule("next") };
      if (operation.txToken !== undefined && editorStore.hasActiveTransaction()) {
        editorStore.commitTransaction(effect, operation.txToken);
      }
      resumeNotifications(operation);
      operation.fittedFrameIds.clear();
      refreshAfterQueue();
    },
    [applyStyleChanges, bridgeControllersRef, editorStore, gestureOverlayStore, refreshSnapshot, refreshTarget, restoreFittedFrames, resumeNotifications, setInteractionMode, surfaceRef],
  );

  // When a frame's document reloads (new srcDoc, remount) its <body>
  // transform is gone — the tracked re-anchor shift would double-apply on
  // the next fit, so drop it as soon as the body target disappears.
  useEffect(() => {
    if (shiftRef.current.size === 0) return;
    const presentFrameIds = new Set(
      Object.values(bridgeTargets)
        .filter((entry) => entry.target.tagName.toLowerCase() === "body")
        .map((entry) => entry.frameId),
    );
    for (const frameId of [...shiftRef.current.keys()]) {
      if (!presentFrameIds.has(frameId)) shiftRef.current.delete(frameId);
    }
  }, [bridgeTargets, shiftRef]);

  const cancelNodeGesture = useCallback(() => {
    const operation = nodeGestureRef.current;
    if (!operation) return false;
    operation.cancelled = true;
    nodeGestureRef.current = null;
    gestureOverlayStore.set({
      targets: operation.snapshots.map((snapshot) => snapshot.target),
      guides: [],
    });
    const settled = liveSettledRef.current;
    operation.queue = operation.queue
      .then(() => settled)
      .then(() => applyStyleChanges(operation.changes, "previous"))
      .catch(() => undefined);
    const affectedFrameIds = Array.from(new Set(operation.changes.map((change) => change.target.frameId)));
    const affectedTargets = Array.from(new Map(
      operation.changes.map((change) => [
        targetStateKey(change.target.frameId, change.target.nodeId),
        { frameId: change.target.frameId, targetId: change.target.nodeId },
      ]),
    ).values());
    void operation.queue
      .then(() => Promise.all(affectedFrameIds.map((frameId) => refreshSnapshot(frameId))))
      .then(() => Promise.all(affectedTargets.map(({ frameId, targetId }) => refreshTarget(frameId, targetId))))
      .then(() => {
        for (const { frameId, targetId } of affectedTargets) {
          gestureStylesRef.current.delete(targetStateKey(frameId, targetId));
        }
        gestureOverlayStore.clear();
      })
      .catch(() => undefined);
    if (operation.txToken !== undefined && editorStore.hasActiveTransaction()) {
      editorStore.rollbackTransaction(operation.txToken);
    }
    restoreFittedFrames(operation);
    resumeNotifications(operation);
    setInteractionMode("idle");
    return true;
  }, [applyStyleChanges, editorStore, gestureOverlayStore, refreshSnapshot, refreshTarget, restoreFittedFrames, resumeNotifications, setInteractionMode]);

  const isNodeGestureActive = useCallback(() => nodeGestureRef.current !== null, []);

  return {
    beginNodeGesture,
    cancelNodeGesture,
    endNodeGesture,
    gestureOverlayStore,
    isNodeGestureActive,
    moveNodeGesture,
    selectedOverlayTargets,
  };
}
