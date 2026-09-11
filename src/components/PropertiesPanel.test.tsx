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
  attributes: { "data-design-tool-kind": "rectangle", "data-design-tool-fill": "#d9d9d9" },
  inlineStyle: {},
  computedStyle: { "background-color": "rgb(217, 217, 217)" },
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
  onApplyGlassEffect: vi.fn(),
  shapeRadius: 0,
  shapeRadiusVisible: false,
  onShapeRadiusChange: vi.fn(),
  onShapeRadiusCommit: vi.fn(),
};

describe("PropertiesPanel glass effect", () => {
  it("shows the glass control for shapes and starts at Off", () => {
    render(<PropertiesPanel {...baseProps} />);
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

  it("restores the slider from an applied glass effect", () => {
    const glassy: OverlayBridgeTargetState = {
      ...entry,
      inspection: {
        ...inspection,
        attributes: { ...inspection.attributes, "data-design-tool-glass": "50" },
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

describe("PropertiesPanel color field", () => {
  it("applies a palette swatch to the shape fill with one gesture", () => {
    const onEditNodeStyle = vi.fn();
    render(<PropertiesPanel {...baseProps} onEditNodeStyle={onEditNodeStyle} />);
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    expect(screen.getByTestId("color-popover-Fill")).toBeTruthy();
    fireEvent.click(screen.getByTestId("color-option-#e5484d"));
    expect(onEditNodeStyle).toHaveBeenCalledWith("background-color", "#e5484d");
    expect(screen.queryByTestId("color-popover-Fill")).toBeNull();
  });

  it("lets the swatch win over a half-typed draft in the text input", () => {
    const onEditNodeStyle = vi.fn();
    render(<PropertiesPanel {...baseProps} onEditNodeStyle={onEditNodeStyle} />);
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    const input = screen.getByLabelText("Fill");
    fireEvent.change(input, { target: { value: "#123456" } });

    // Real browsers blur the input on swatch mousedown; committing the draft
    // there unmounts the popover and the swatch click is lost.
    const swatch = screen.getByTestId("color-option-#e5484d");
    fireEvent.blur(input, { relatedTarget: swatch });
    fireEvent.click(swatch);

    expect(onEditNodeStyle).toHaveBeenCalledTimes(1);
    expect(onEditNodeStyle).toHaveBeenCalledWith("background-color", "#e5484d");
  });

  it("still commits the typed value when focus leaves the field", () => {
    const onEditNodeStyle = vi.fn();
    render(<PropertiesPanel {...baseProps} onEditNodeStyle={onEditNodeStyle} />);
    const input = screen.getByLabelText("Fill");
    fireEvent.change(input, { target: { value: "#123456" } });
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(onEditNodeStyle).toHaveBeenCalledWith("background-color", "#123456");
  });

  it("marks the active swatch when the fill matches", () => {
    const filled: OverlayBridgeTargetState = {
      ...entry,
      inspection: {
        ...inspection,
        inlineStyle: {},
        computedStyle: { "background-color": "rgb(229, 72, 77)" },
      },
    };
    render(
      <PropertiesPanel
        {...baseProps}
        bridgeTargets={{ "frame-1:rect-1": filled }}
      />,
    );
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    expect((screen.getByTestId("color-option-#e5484d") as HTMLButtonElement).className).toContain("is-active");
  });
});
