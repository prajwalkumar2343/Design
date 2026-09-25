import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeElementTarget, BridgeInspection } from "../bridge/protocol";
import type { IframeBridgeController } from "../bridge/transport";
import type { Camera } from "../canvas/types";
import type { SelectionState } from "../editor/model";
import type { NodeGestureStart, OverlayNodeTarget } from "./NodeOverlayLayer";
import {
  useNodeOverlayGestures,
  type OverlayBridgeTargetState,
} from "./useNodeOverlayGestures";

const TARGET_BOUNDS = { x: 10, y: 20, width: 100, height: 50 };

function overlayTarget(overrides: Partial<OverlayNodeTarget> = {}): OverlayNodeTarget {
  return {
    frameId: "frame-1",
    nodeId: "node-1",
    tagName: "div",
    name: "Box",
    bounds: TARGET_BOUNDS,
    ...overrides,
  };
}

function bridgeEntry(elementId: string, bounds = TARGET_BOUNDS): OverlayBridgeTargetState {
  const target: BridgeElementTarget = {
    elementId,
    tagName: "div",
    path: "",
    name: elementId,
    role: null,
    bounds,
  };
  const inspection: BridgeInspection = {
    target,
    text: "",
    attributes: {},
    inlineStyle: {},
    computedStyle: {},
  };
  return { frameId: "frame-1", target, inspection };
}

const pointer = (x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ pointerId: 1, clientX: x, clientY: y, button: 0, ...extra }) as unknown as ReactPointerEvent<HTMLElement>;

const pressAt = (x: number, y: number) =>
  pointer(x, y, { currentTarget: { setPointerCapture: vi.fn() } });

function gesture(overrides: Partial<NodeGestureStart> = {}): NodeGestureStart {
  return {
    kind: "move",
    targetIds: ["frame-1:node-1"],
    targets: [overlayTarget()],
    pointerId: 1,
    client: { x: 0, y: 0 },
    ...overrides,
  };
}

function createHarness({ extraTargets = {}, withFrameDom = true } = {}) {
  const surface = document.createElement("div");
  if (withFrameDom) {
    const frame = document.createElement("div");
    frame.setAttribute("data-frame-id", "frame-1");
    frame.appendChild(document.createElement("iframe"));
    surface.appendChild(frame);
  }
  document.body.appendChild(surface);
  const surfaceRef = { current: surface as HTMLDivElement };
  const cameraRef = { current: { x: 0, y: 0, zoom: 1 } as Camera };

  let txActive = false;
  const effectRef: { current: { undo: () => void; redo: () => void } | null } = {
    current: null,
  };
  const editorStore = {
    beginTransaction: vi.fn((_label: string) => {
      txActive = true;
      return Symbol("tx");
    }),
    commitTransaction: vi.fn((effect?: { undo: () => void; redo: () => void }, _token?: symbol) => {
      effectRef.current = effect ?? null;
      txActive = false;
      return true;
    }),
    rollbackTransaction: vi.fn(() => {
      txActive = false;
      return true;
    }),
    hasActiveTransaction: vi.fn(() => txActive),
    getState: () => ({ frames: {} }),
    execute: vi.fn(() => true),
    suspendNotifications: vi.fn(),
    resumeNotifications: vi.fn(),
  };

  const setInlineStyle = vi.fn(async (command: { targetId: string; property: string }) => ({
    command: "set-inline-style",
    targetId: command.targetId,
    property: command.property,
    previousValue: null,
    bounds: undefined,
  }));
  const pickElement = vi.fn(async () => ({}));
  const bridgeControllersRef = {
    current: new Map<string, IframeBridgeController>([
      ["frame-1", { setInlineStyle, pickElement } as unknown as IframeBridgeController],
    ]),
  };

  const bridgeTargets: Record<string, OverlayBridgeTargetState> = {
    "frame-1:node-1": bridgeEntry("node-1"),
    ...extraTargets,
  };
  const selection: SelectionState = {
    frameIds: ["frame-1"],
    nodeIds: ["node-1"],
    primaryFrameId: "frame-1",
    primaryNodeId: "node-1",
  };
  const toOverlayTarget = (entry: OverlayBridgeTargetState): OverlayNodeTarget => ({
    frameId: entry.frameId,
    nodeId: entry.target.elementId,
    tagName: entry.target.tagName,
    name: entry.target.name,
    bounds: entry.target.bounds,
    locked: entry.target.locked,
  });
  const refreshSnapshot = vi.fn(async () => {});
  const refreshTarget = vi.fn(async () => null);
  const setInteractionMode = vi.fn();

  const view = renderHook(() =>
    useNodeOverlayGestures({
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
    }),
  );

  const cleanup = () => {
    view.unmount();
    surface.remove();
  };

  return {
    view,
    cleanup,
    editorStore,
    effectRef,
    setInlineStyle,
    pickElement,
    refreshSnapshot,
    refreshTarget,
    setInteractionMode,
    setTxActive: () => {
      txActive = true;
    },
  };
}

beforeEach(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.hasPointerCapture = () => false;
  }
  if (typeof globalThis.CSS === "undefined") {
    (globalThis as Record<string, unknown>).CSS = { escape: (value: string) => value };
  }
});

describe("useNodeOverlayGestures selection mapping", () => {
  it("exposes overlay targets for the current node selection", () => {
    const h = createHarness({
      extraTargets: { "frame-1:node-2": bridgeEntry("node-2", { x: 500, y: 0, width: 40, height: 40 }) },
    });
    try {
      expect(h.view.result.current.selectedOverlayTargets).toHaveLength(1);
      expect(h.view.result.current.selectedOverlayTargets[0]).toMatchObject({
        frameId: "frame-1",
        nodeId: "node-1",
        bounds: TARGET_BOUNDS,
      });
      expect(h.view.result.current.isNodeGestureActive()).toBe(false);
    } finally {
      h.cleanup();
    }
  });
});

describe("useNodeOverlayGestures move", () => {
  it("moves the node through the bridge and commits the transaction", async () => {
    const h = createHarness();
    try {
      act(() => h.view.result.current.beginNodeGesture(gesture(), pressAt(20, 30)));
      act(() => h.view.result.current.moveNodeGesture(pointer(65, 60)));

      expect(h.setInteractionMode).toHaveBeenCalledWith("moving-node");
      expect(h.editorStore.beginTransaction).toHaveBeenCalledWith("Move selection");
      expect(h.setInlineStyle).toHaveBeenCalledWith({
        command: "set-inline-style",
        targetId: "node-1",
        property: "transform",
        value: "translate(45px, 30px)",
      });
      expect(h.editorStore.suspendNotifications).toHaveBeenCalledTimes(1);
      expect(h.view.result.current.gestureOverlayStore.getSnapshot().targets?.[0]?.bounds).toEqual({
        x: 55, y: 50, width: 100, height: 50,
      });

      await act(async () => {
        h.view.result.current.endNodeGesture(pointer(65, 60));
      });
      expect(h.editorStore.commitTransaction).toHaveBeenCalledTimes(1);
      expect(h.editorStore.rollbackTransaction).not.toHaveBeenCalled();
      expect(h.editorStore.resumeNotifications).toHaveBeenCalledTimes(1);
      expect(h.setInteractionMode).toHaveBeenLastCalledWith("idle");
      expect(h.refreshSnapshot).toHaveBeenCalledWith("frame-1");
      expect(h.refreshTarget).toHaveBeenCalledWith("frame-1", "node-1");
      expect(h.view.result.current.selectedOverlayTargets[0]!.bounds).toEqual(TARGET_BOUNDS);
      expect(h.view.result.current.isNodeGestureActive()).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it("undo replays the captured previous style and restores the chrome", async () => {
    const h = createHarness();
    try {
      act(() => h.view.result.current.beginNodeGesture(gesture(), pressAt(20, 30)));
      act(() => h.view.result.current.moveNodeGesture(pointer(65, 60)));
      await act(async () => {
        h.view.result.current.endNodeGesture(pointer(65, 60));
      });
      expect(h.effectRef.current).not.toBeNull();

      h.setInlineStyle.mockClear();
      await act(async () => {
        await h.effectRef.current?.undo();
      });
      expect(h.setInlineStyle).toHaveBeenCalledWith({
        command: "set-inline-style",
        targetId: "node-1",
        property: "transform",
        value: null,
      });
    } finally {
      h.cleanup();
    }
  });

  it("snaps the drag to a nearby sibling edge and shows the guide", async () => {
    const h = createHarness({
      extraTargets: { "frame-1:node-2": bridgeEntry("node-2", { x: 150, y: 200, width: 40, height: 40 }) },
    });
    try {
      act(() => h.view.result.current.beginNodeGesture(gesture(), pressAt(20, 30)));
      act(() => h.view.result.current.moveNodeGesture(pointer(157, 30)));

      expect(h.view.result.current.gestureOverlayStore.getSnapshot().guides).toEqual([{ axis: "x", value: 150 }]);
      expect(h.view.result.current.gestureOverlayStore.getSnapshot().targets?.[0]?.bounds.x).toBe(150);
      await act(async () => {
        h.view.result.current.endNodeGesture(pointer(157, 30));
      });
      expect(h.view.result.current.gestureOverlayStore.getSnapshot().guides).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it("re-dispatches a settled click through to the frame for selection", async () => {
    const h = createHarness();
    try {
      act(() => h.view.result.current.beginNodeGesture(gesture(), pressAt(100, 100)));
      act(() => h.view.result.current.moveNodeGesture(pointer(101, 101)));
      await act(async () => {
        h.view.result.current.endNodeGesture(pointer(101, 101));
      });

      expect(h.editorStore.beginTransaction).not.toHaveBeenCalled();
      expect(h.setInlineStyle).not.toHaveBeenCalled();
      expect(h.pickElement).toHaveBeenCalledWith({
        command: "pick-element",
        point: { x: 101, y: 101 },
        shiftKey: false,
      });
    } finally {
      h.cleanup();
    }
  });

  it("does not start the gesture while a foreign transaction is open", async () => {
    const h = createHarness();
    try {
      act(() => h.view.result.current.beginNodeGesture(gesture(), pressAt(20, 30)));
      h.setTxActive();
      act(() => h.view.result.current.moveNodeGesture(pointer(200, 200)));
      expect(h.editorStore.beginTransaction).not.toHaveBeenCalled();
      expect(h.setInlineStyle).not.toHaveBeenCalled();

      await act(async () => {
        h.view.result.current.endNodeGesture(pointer(200, 200));
      });
      expect(h.editorStore.rollbackTransaction).not.toHaveBeenCalled();
      expect(h.pickElement).toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });
});

describe("useNodeOverlayGestures resize and rotate", () => {
  it("resizes from a handle and writes the new width", async () => {
    const h = createHarness();
    try {
      act(() =>
        h.view.result.current.beginNodeGesture(
          gesture({ kind: "resize", handle: "e" }),
          pressAt(110, 45),
        ),
      );
      act(() => h.view.result.current.moveNodeGesture(pointer(140, 45)));

      expect(h.setInteractionMode).toHaveBeenCalledWith("resizing-node");
      expect(h.editorStore.beginTransaction).toHaveBeenCalledWith("Resize selection");
      const calls = h.setInlineStyle.mock.calls.map((call) => call[0]);
      expect(calls).toContainEqual({
        command: "set-inline-style",
        targetId: "node-1",
        property: "width",
        value: "130px",
      });
      await act(async () => {
        h.view.result.current.endNodeGesture(pointer(140, 45));
      });
    } finally {
      h.cleanup();
    }
  });

  it("rotates around the group center and writes a rotate() transform", async () => {
    const h = createHarness();
    try {
      act(() =>
        h.view.result.current.beginNodeGesture(gesture({ kind: "rotate" }), pressAt(110, 45)),
      );
      act(() => h.view.result.current.moveNodeGesture(pointer(60, 95)));

      expect(h.setInteractionMode).toHaveBeenCalledWith("rotating-node");
      expect(h.editorStore.beginTransaction).toHaveBeenCalledWith("Rotate selection");
      expect(h.setInlineStyle).toHaveBeenCalledWith({
        command: "set-inline-style",
        targetId: "node-1",
        property: "transform",
        value: "rotate(90deg)",
      });
      await act(async () => {
        h.view.result.current.endNodeGesture(pointer(60, 95));
      });
    } finally {
      h.cleanup();
    }
  });

  it("a settled rotate click does not dispatch a pick", async () => {
    const h = createHarness();
    try {
      act(() =>
        h.view.result.current.beginNodeGesture(gesture({ kind: "rotate" }), pressAt(110, 45)),
      );
      await act(async () => {
        h.view.result.current.endNodeGesture(pointer(110, 45));
      });
      expect(h.pickElement).not.toHaveBeenCalled();
      expect(h.editorStore.beginTransaction).not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });
});

describe("useNodeOverlayGestures cancel", () => {
  it("rolls back its own transaction and replays previous styles", async () => {
    const h = createHarness();
    try {
      act(() => h.view.result.current.beginNodeGesture(gesture(), pressAt(20, 30)));
      act(() => h.view.result.current.moveNodeGesture(pointer(65, 60)));
      expect(h.view.result.current.isNodeGestureActive()).toBe(true);

      h.setInlineStyle.mockClear();
      let cancelled = false;
      await act(async () => {
        cancelled = h.view.result.current.cancelNodeGesture();
      });
      expect(cancelled).toBe(true);
      expect(h.editorStore.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(h.editorStore.commitTransaction).not.toHaveBeenCalled();
      expect(h.setInteractionMode).toHaveBeenLastCalledWith("idle");
      await act(async () => {});
      expect(h.setInlineStyle).toHaveBeenCalledWith({
        command: "set-inline-style",
        targetId: "node-1",
        property: "transform",
        value: null,
      });
      expect(h.view.result.current.isNodeGestureActive()).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it("returns false when no gesture is armed", () => {
    const h = createHarness();
    try {
      expect(h.view.result.current.cancelNodeGesture()).toBe(false);
      expect(h.editorStore.rollbackTransaction).not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });
});
