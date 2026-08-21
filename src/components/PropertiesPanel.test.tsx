import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BridgeInspection } from "../bridge/protocol";
import type { OverlayBridgeTargetState } from "../overlay/useNodeOverlayGestures";
import { PropertiesPanel } from "./PropertiesPanel";

const inspection: BridgeInspection = {
  target: {
    elementId: "rect-1",
    tagName: "svg",
    path: "html/body/svg[1]",
    name: "Rectangle",
    role: null,
    bounds: { x: 40, y: 40, width: 120, height: 80 },
    locked: false,
  },
  text: "",
  attributes: {},
  inlineStyle: { "background-color": "rgb(217, 217, 217)" },
  computedStyle: { "background-color": "rgb(217, 217, 217)", "backdrop-filter": "none" },
};

const entry: OverlayBridgeTargetState = {
  frameId: "frame-1",
  target: inspection.target,
  inspection,
};

const baseProps = {
  frames: {
    "frame-1": {
      id: "frame-1",
      pageId: "page-1",
      documentId: "document-1",
      name: "Frame",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      background: "#ffffff",
    },
  },
  nodes: {},
  selection: { frameIds: ["frame-1"], nodeIds: ["rect-1"], primaryFrameId: "frame-1", primaryNodeId: "rect-1" },
  bridgeTargets: { "frame-1:rect-1": entry },
  onUpdateFrame: vi.fn(),
  onMoveFrame: vi.fn(),
  onEditNodeStyle: vi.fn(),
  onEditNodePosition: vi.fn(),
  shapeRadius: 0,
  shapeRadiusVisible: false,
  onShapeRadiusChange: vi.fn(),
  onShapeRadiusCommit: vi.fn(),
};

describe("PropertiesPanel glass effect", () => {
  it("shows the glass control for shapes and starts at Off", () => {
    render(<PropertiesPanel {...baseProps} onApplyGlassEffect={vi.fn()} />);
    expect(screen.getByTestId("glass-level-slider")).toBeTruthy();
    expect(screen.getByTestId("glass-level-value").textContent).toBe("Off");
  });

  it("commits the slider level once on release", () => {
    const onApplyGlassEffect = vi.fn();
    render(<PropertiesPanel {...baseProps} onApplyGlassEffect={onApplyGlassEffect} />);
    const slider = screen.getByTestId("glass-level-slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "60" } });
    expect(onApplyGlassEffect).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(onApplyGlassEffect).toHaveBeenCalledWith(60);
    expect(screen.getByTestId("glass-level-value").textContent).toBe("60%");
  });

  it("steps the level in increments and reports zero when cleared", () => {
    const onApplyGlassEffect = vi.fn();
    render(<PropertiesPanel {...baseProps} onApplyGlassEffect={onApplyGlassEffect} />);
    fireEvent.click(screen.getByTestId("glass-level-increment"));
    expect(onApplyGlassEffect).toHaveBeenLastCalledWith(10);
    fireEvent.click(screen.getByTestId("glass-level-decrement"));
    fireEvent.click(screen.getByTestId("glass-level-decrement"));
    expect(onApplyGlassEffect).toHaveBeenLastCalledWith(0);
  });

  it("restores the slider from an existing glass effect", () => {
    const glassy: OverlayBridgeTargetState = {
      ...entry,
      inspection: {
        ...inspection,
        inlineStyle: { ...inspection.inlineStyle, "backdrop-filter": "blur(15px) saturate(160%)" },
      },
    };
    render(
      <PropertiesPanel
        {...baseProps}
        bridgeTargets={{ "frame-1:rect-1": glassy }}
        onApplyGlassEffect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("glass-level-value").textContent).toBe("50%");
  });
});
