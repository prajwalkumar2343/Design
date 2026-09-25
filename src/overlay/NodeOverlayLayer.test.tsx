import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESIZE_HANDLES } from "./geometry";
import { NodeOverlayLayer, type NodeGestureStart, type OverlayNodeTarget } from "./NodeOverlayLayer";

function target(overrides: Partial<OverlayNodeTarget> = {}): OverlayNodeTarget {
  return {
    frameId: "frame-1",
    nodeId: "node-1",
    tagName: "div",
    name: "Box",
    bounds: { x: 10, y: 20, width: 100, height: 50 },
    ...overrides,
  };
}

function renderLayer(overrides: Partial<Parameters<typeof NodeOverlayLayer>[0]> = {}) {
  const onGestureStart = vi.fn();
  const onGestureMove = vi.fn();
  const onGestureEnd = vi.fn();
  const props: Parameters<typeof NodeOverlayLayer>[0] = {
    zoom: 1,
    hoveredTarget: null,
    selectedTargets: [],
    onGestureStart,
    onGestureMove,
    onGestureEnd,
    ...overrides,
  };
  return { props, onGestureStart, onGestureMove, onGestureEnd, ...render(<NodeOverlayLayer {...props} />) };
}

beforeEach(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.hasPointerCapture = () => false;
  }
});

describe("NodeOverlayLayer painting", () => {
  it("draws the hover outline only for an unselected hovered target", () => {
    const hovered = target({ nodeId: "hovered", bounds: { x: 5, y: 6, width: 30, height: 12 } });
    const { unmount } = renderLayer({ hoveredTarget: hovered });
    const outline = screen.getByTestId("node-hover-outline") as HTMLElement;
    expect(outline.style.left).toBe("5px");
    expect(outline.style.width).toBe("30px");
    unmount();

    renderLayer({ hoveredTarget: hovered, selectedTargets: [hovered] });
    expect(screen.queryByTestId("node-hover-outline")).toBeNull();
  });

  it("paints one outline per selected target and marks locked ones", () => {
    renderLayer({
      selectedTargets: [
        target({ nodeId: "a", bounds: { x: 0, y: 0, width: 40, height: 40 } }),
        target({ nodeId: "b", bounds: { x: 100, y: 0, width: 40, height: 40 }, locked: true }),
      ],
    });
    expect((screen.getByTestId("node-selection-outline-b") as HTMLElement).className).toContain("is-locked");
    expect((screen.getByTestId("node-selection-outline-a") as HTMLElement).className).not.toContain("is-locked");
  });

  it("frames the selection box around the union of movable targets with every handle", () => {
    renderLayer({
      selectedTargets: [
        target({ nodeId: "a", bounds: { x: 10, y: 20, width: 40, height: 30 } }),
        target({ nodeId: "b", bounds: { x: 80, y: 10, width: 20, height: 50 } }),
      ],
    });
    const box = screen.getByTestId("node-selection-box") as HTMLElement;
    expect(box.style.left).toBe("10px");
    expect(box.style.top).toBe("10px");
    expect(box.style.width).toBe("90px");
    expect(box.style.height).toBe("50px");
    for (const handle of RESIZE_HANDLES) {
      expect(screen.getByTestId(`node-resize-handle-${handle}`)).toBeTruthy();
    }
    expect(screen.getByTestId("node-rotation-handle")).toBeTruthy();
  });

  it("rotates the outline around the canonical rect of a rotated target", () => {
    renderLayer({
      selectedTargets: [
        target({
          rotation: 30,
          bounds: { x: 0, y: 0, width: 99, height: 99 },
          canonicalBounds: { x: -0.5, y: 29.5, width: 100, height: 40 },
        }),
      ],
    });
    const outline = screen.getByTestId("node-selection-outline-node-1") as HTMLElement;
    expect(outline.style.left).toBe("-0.5px");
    expect(outline.style.width).toBe("100px");
    expect(outline.style.transform).toBe("rotate(30deg)");
  });

  it("renders alignment guides at their world positions", () => {
    renderLayer({ guides: [{ axis: "x", value: 128 }, { axis: "y", value: -40 }] });
    expect((screen.getByTestId("alignment-guide-x-0") as HTMLElement).style.left).toBe("128px");
    expect((screen.getByTestId("alignment-guide-y-1") as HTMLElement).style.top).toBe("-40px");
  });

  it("suppresses the interactive box entirely for locked-only selections", () => {
    renderLayer({ selectedTargets: [target({ locked: true })] });
    expect(screen.queryByTestId("node-selection-box")).toBeNull();
    expect(screen.getByTestId("node-selection-outline-node-1")).toBeTruthy();
  });

  it("renders no selection box when not interactive", () => {
    renderLayer({ interactive: false, selectedTargets: [target()] });
    expect(screen.queryByTestId("node-selection-box")).toBeNull();
  });
});

describe("NodeOverlayLayer gestures", () => {
  it("starts a move gesture from the selection box with ids and pointer data", () => {
    const selected = target();
    const { onGestureStart } = renderLayer({ selectedTargets: [selected] });
    fireEvent.pointerDown(screen.getByTestId("node-selection-box"), {
      button: 0, pointerId: 9, clientX: 33, clientY: 44,
    });
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    const [gesture] = onGestureStart.mock.calls[0] as [NodeGestureStart, unknown];
    expect(gesture.kind).toBe("move");
    expect(gesture.targetIds).toEqual(["frame-1:node-1"]);
    expect(gesture.targets).toEqual([selected]);
    expect(gesture.pointerId).toBe(9);
    expect(gesture.client).toEqual({ x: 33, y: 44 });
  });

  it("starts a resize gesture from an edge handle", () => {
    const { onGestureStart } = renderLayer({ selectedTargets: [target()] });
    fireEvent.pointerDown(screen.getByTestId("node-resize-handle-se"), {
      button: 0, pointerId: 2, clientX: 5, clientY: 5,
    });
    const [gesture] = onGestureStart.mock.calls[0] as [NodeGestureStart, unknown];
    expect(gesture.kind).toBe("resize");
    expect(gesture.handle).toBe("se");
  });

  it("treats a handle press far inside the box as a move, not a resize", () => {
    const { onGestureStart } = renderLayer({ selectedTargets: [target()] });
    const box = screen.getByTestId("node-selection-box") as HTMLElement;
    vi.spyOn(box, "getBoundingClientRect").mockImplementation(
      () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }) as DOMRect,
    );
    fireEvent.pointerDown(screen.getByTestId("node-resize-handle-se"), {
      button: 0, pointerId: 2, clientX: 100, clientY: 50,
    });
    const [gesture] = onGestureStart.mock.calls[0] as [NodeGestureStart, unknown];
    expect(gesture.kind).toBe("move");
    expect(gesture.handle).toBeUndefined();
  });

  it("still resizes when the press is near an edge", () => {
    const { onGestureStart } = renderLayer({ selectedTargets: [target()] });
    const box = screen.getByTestId("node-selection-box") as HTMLElement;
    vi.spyOn(box, "getBoundingClientRect").mockImplementation(
      () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }) as DOMRect,
    );
    fireEvent.pointerDown(screen.getByTestId("node-resize-handle-e"), {
      button: 0, pointerId: 2, clientX: 198, clientY: 50,
    });
    const [gesture] = onGestureStart.mock.calls[0] as [NodeGestureStart, unknown];
    expect(gesture.kind).toBe("resize");
    expect(gesture.handle).toBe("e");
  });

  it("starts a rotate gesture from the rotation handle", () => {
    const { onGestureStart } = renderLayer({ selectedTargets: [target()] });
    fireEvent.pointerDown(screen.getByTestId("node-rotation-handle"), {
      button: 0, pointerId: 4, clientX: 0, clientY: 0,
    });
    const [gesture] = onGestureStart.mock.calls[0] as [NodeGestureStart, unknown];
    expect(gesture.kind).toBe("rotate");
  });

  it("excludes locked targets from the gesture payload", () => {
    const locked = target({ nodeId: "locked-node", locked: true });
    const free = target({ nodeId: "free-node" });
    const { onGestureStart } = renderLayer({ selectedTargets: [locked, free] });
    fireEvent.pointerDown(screen.getByTestId("node-selection-box"), {
      button: 0, pointerId: 1, clientX: 0, clientY: 0,
    });
    const [gesture] = onGestureStart.mock.calls[0] as [NodeGestureStart, unknown];
    expect(gesture.targetIds).toEqual(["frame-1:free-node"]);
    expect(gesture.targets).toEqual([free]);
  });

  it("ignores secondary buttons and multi-click presses", () => {
    const { props } = renderLayer({ selectedTargets: [target()] });
    const box = screen.getByTestId("node-selection-box");
    fireEvent.pointerDown(box, { button: 2, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerDown(box, { button: 0, detail: 2, pointerId: 1, clientX: 0, clientY: 0 });
    expect(props.onGestureStart).not.toHaveBeenCalled();
  });

  it("routes move/up/cancel events through the layer callbacks", () => {
    const { props } = renderLayer({ selectedTargets: [target()] });
    const layer = screen.getByTestId("node-overlay-layer");
    fireEvent.pointerMove(layer, { pointerId: 1, clientX: 1, clientY: 2 });
    expect(props.onGestureMove).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(layer, { pointerId: 1 });
    expect(props.onGestureEnd).toHaveBeenCalledTimes(1);
    fireEvent.pointerCancel(layer, { pointerId: 1 });
    expect(props.onGestureEnd).toHaveBeenCalledTimes(2);
  });

  it("fires text edit on double-click only for a single movable target", () => {
    const onTextEditStart = vi.fn();
    const single = target({ nodeId: "solo" });
    const { props, unmount } = renderLayer({ selectedTargets: [single], onTextEditStart });
    fireEvent.doubleClick(screen.getByTestId("node-selection-box"));
    expect(onTextEditStart).toHaveBeenCalledTimes(1);
    expect(onTextEditStart).toHaveBeenCalledWith(single);
    unmount();

    onTextEditStart.mockClear();
    renderLayer({
      selectedTargets: [target({ nodeId: "one" }), target({ nodeId: "two", bounds: { x: 200, y: 0, width: 10, height: 10 } })],
      onTextEditStart,
    });
    fireEvent.doubleClick(screen.getByTestId("node-selection-box"));
    expect(onTextEditStart).not.toHaveBeenCalled();
    expect(props.onGestureStart).not.toHaveBeenCalled();
  });
});
