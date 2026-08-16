import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type {
  BridgeElementTarget,
  BridgeInspection,
  SafeInlineStyleProperty,
} from "../bridge/protocol";
import type { IframeBridgeController } from "../bridge/transport";
import { screenToWorld } from "../canvas/camera";
import type { Camera, Point, Rect } from "../canvas/types";
import type { SelectionState } from "../editor/model";
import {
  buildMoveChanges,
  buildResizeChanges,
  buildRotationChanges,
  toInlineStyleCommands,
  type OverlayStyleChange,
  type OverlayStyleSnapshot,
} from "./commands";
import {
  rotationAngle,
  snapTranslation,
  unionRects,
  type ResizeHandle,
} from "./geometry";
import type { NodeGestureStart, OverlayNodeTarget } from "./NodeOverlayLayer";

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
  snapshots: OverlayStyleSnapshot[];
  groupBounds: Rect;
  queue: Promise<void>;
  changes: OverlayStyleChange[];
  capturedPrevious: Map<string, string | null>;
  cancelled: boolean;
}

interface UseNodeOverlayGesturesOptions {
  surfaceRef: RefObject<HTMLDivElement | null>;
  cameraRef: MutableRefObject<Camera>;
  editorStore: {
    beginTransaction: (label: string) => void;
    commitTransaction: (effect?: {
      undo: () => void;
      redo: () => void;
    }) => boolean;
    rollbackTransaction: () => boolean;
    hasActiveTransaction: () => boolean;
  };
  bridgeTargets: Record<string, OverlayBridgeTargetState>;
  bridgeControllersRef: MutableRefObject<Map<string, IframeBridgeController>>;
  refreshSnapshot: (frameId: string) => Promise<void>;
  refreshTarget: (frameId: string, targetId: string) => Promise<BridgeInspection | null>;
  selection: SelectionState;
  toOverlayTarget: (entry: OverlayBridgeTargetState) => OverlayNodeTarget | null;
  setInteractionMode: (mode: NodeInteractionMode) => void;
}

function targetStateKey(frameId: string, nodeId: string): string {
  return `${frameId}:${nodeId}`;
}

function getSurfacePoint(
  event: { clientX: number; clientY: number },
  surface: HTMLElement,
): Point {
  const bounds = surface.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
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
}: UseNodeOverlayGesturesOptions) {
  const nodeGestureRef = useRef<NodeGestureOperation | null>(null);
  const gestureStylesRef = useRef(new Map<string, Partial<Record<SafeInlineStyleProperty, string | null>>>());
  const [gestureOverlayTargets, setGestureOverlayTargets] = useState<OverlayNodeTarget[] | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<{ axis: "x" | "y"; value: number }[]>([]);
  const liveFrameRef = useRef<number | null>(null);
  const pendingLiveChangesRef = useRef<OverlayStyleChange[]>([]);
  const liveSettledRef = useRef<Promise<void>>(Promise.resolve());

  const flushLiveApply = useCallback(() => {
    liveFrameRef.current = null;
    const changes = pendingLiveChangesRef.current;
    pendingLiveChangesRef.current = [];
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
        }).catch(() => undefined),
      );
    }
    if (captures.length === 0) return;
    const settle = Promise.all(captures).then(() => undefined).catch(() => undefined);
    liveSettledRef.current = liveSettledRef.current.then(() => settle);
  }, [bridgeControllersRef]);

  const scheduleLiveApply = useCallback((changes: OverlayStyleChange[]) => {
    pendingLiveChangesRef.current = changes;
    if (liveFrameRef.current === null) {
      liveFrameRef.current = requestAnimationFrame(() => {
        flushLiveApply();
      });
    }
  }, [flushLiveApply]);

  const cancelPendingLiveApply = useCallback(() => {
    if (liveFrameRef.current !== null) {
      cancelAnimationFrame(liveFrameRef.current);
      liveFrameRef.current = null;
    }
    pendingLiveChangesRef.current = [];
  }, []);

  const selectedOverlayTargets = useMemo(() => {
    if (gestureOverlayTargets) return gestureOverlayTargets;
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
  }, [bridgeTargets, gestureOverlayTargets, selection, toOverlayTarget]);

  useEffect(() => {
    return () => {
      if (liveFrameRef.current !== null) cancelAnimationFrame(liveFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!nodeGestureRef.current) setGestureOverlayTargets(null);
  }, [selection]);

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
    },
    [bridgeControllersRef],
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
          const transientStyles = gestureOverlayTargets
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
        snapshots,
        groupBounds,
        queue: Promise.resolve(),
        changes: [],
        capturedPrevious: new Map(),
        cancelled: false,
      };
      nodeGestureRef.current = operation;
      // Keep the initial click on the pressed control so native click/double-click
      // dispatch remains intact; moveNodeGesture transfers capture to the surface
      // once the pointer crosses the drag threshold.
      event.currentTarget.setPointerCapture(gesture.pointerId);
    },
    [bridgeTargets, editorStore, gestureOverlayTargets, setInteractionMode, surfaceRef, cameraRef],
  );

  const moveNodeGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const operation = nodeGestureRef.current;
      const surface = surfaceRef.current;
      if (!operation || operation.pointerId !== event.pointerId || !surface) return false;

      const point = getSurfacePoint(event, surface);
      const currentWorld = screenToWorld(point, cameraRef.current);
      const rawDelta = {
        x: currentWorld.x - operation.startWorld.x,
        y: currentWorld.y - operation.startWorld.y,
      };
      if (!operation.started && Math.hypot(rawDelta.x * cameraRef.current.zoom, rawDelta.y * cameraRef.current.zoom) < 3) {
        return true;
      }
      if (!operation.started) {
        operation.started = true;
        surface.setPointerCapture(operation.pointerId);
        setGestureOverlayTargets(operation.snapshots.map((snapshot) => snapshot.target));
        editorStore.beginTransaction(
          operation.kind === "move"
            ? "Move selection"
            : operation.kind === "resize"
              ? "Resize selection"
              : "Rotate selection",
        );
        setInteractionMode(
          operation.kind === "move"
            ? "moving-node"
            : operation.kind === "resize"
              ? "resizing-node"
              : "rotating-node",
        );
      }
      let changes: OverlayStyleChange[];
      if (operation.kind === "move") {
        const selectedKeys = new Set(operation.targetIds);
        const snapTargets = Object.values(bridgeTargets)
          .filter((entry) => !selectedKeys.has(targetStateKey(entry.frameId, entry.target.elementId)))
          .map(toOverlayTarget)
          .filter((target): target is OverlayNodeTarget => target !== null)
          .map((target) => target.bounds);
        const snap = snapTranslation(operation.groupBounds, rawDelta, snapTargets);
        setAlignmentGuides(snap.guides.map(({ axis, value }) => ({ axis, value })));
        changes = buildMoveChanges(operation.snapshots, snap.delta);
      } else if (operation.kind === "resize" && operation.handle) {
        setAlignmentGuides([]);
        changes = buildResizeChanges(
          operation.snapshots,
          operation.groupBounds,
          operation.handle,
          rawDelta,
        );
      } else {
        setAlignmentGuides([]);
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
      setGestureOverlayTargets(
        changes.map((change) => ({
          ...change.target,
          bounds: change.nextBounds,
          rotation: change.rotation,
        })),
      );
      scheduleLiveApply(changes);
      return true;
    },
    [applyStyleChanges, bridgeTargets, cameraRef, editorStore, scheduleLiveApply, setInteractionMode, surfaceRef, toOverlayTarget],
  );

  const endNodeGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const operation = nodeGestureRef.current;
      if (!operation || operation.pointerId !== event.pointerId) return;
      nodeGestureRef.current = null;
      cancelPendingLiveApply();
      setAlignmentGuides([]);
      setInteractionMode("idle");

      if (operation.cancelled || !hasOverlayStyleChanges(operation.changes)) {
        if (editorStore.hasActiveTransaction()) editorStore.rollbackTransaction();
        setGestureOverlayTargets(null);
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
            if (!nodeGestureRef.current) setGestureOverlayTargets(null);
          })
          .catch(() => undefined);
      };

      const settled = liveSettledRef.current;
      const schedule = (direction: "previous" | "next") => {
        operation.queue = operation.queue
          .then(() => settled)
          .then(() => applyStyleChanges(operation.changes, direction, operation.capturedPrevious))
          .catch(() => undefined);
        setGestureOverlayTargets(
          direction === "previous"
            ? operation.snapshots.map((snapshot) => snapshot.target)
            : operation.changes.map((change) => ({
                ...change.target,
                bounds: change.nextBounds,
                rotation: change.rotation,
              })),
        );
        refreshAfterQueue();
      };
      const effect = { undo: () => schedule("previous"), redo: () => schedule("next") };
      if (editorStore.hasActiveTransaction()) editorStore.commitTransaction(effect);
      refreshAfterQueue();
    },
    [applyStyleChanges, cancelPendingLiveApply, editorStore, refreshSnapshot, refreshTarget, setInteractionMode],
  );

  const cancelNodeGesture = useCallback(() => {
    const operation = nodeGestureRef.current;
    if (!operation) return false;
    operation.cancelled = true;
    nodeGestureRef.current = null;
    cancelPendingLiveApply();
    setAlignmentGuides([]);
    setGestureOverlayTargets(operation.snapshots.map((snapshot) => snapshot.target));
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
        setGestureOverlayTargets(null);
      })
      .catch(() => undefined);
    if (editorStore.hasActiveTransaction()) editorStore.rollbackTransaction();
    setInteractionMode("idle");
    return true;
  }, [applyStyleChanges, editorStore, refreshSnapshot, refreshTarget, setInteractionMode]);

  return {
    alignmentGuides,
    beginNodeGesture,
    cancelNodeGesture,
    endNodeGesture,
    moveNodeGesture,
    selectedOverlayTargets,
  };
}
