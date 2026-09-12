import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BridgeInspection } from "../bridge/protocol";
import type { OverlayBridgeTargetState } from "../overlay/useNodeOverlayGestures";
import { createSeedTokenStore } from "../tokens";
import { PropertiesPanel } from "./PropertiesPanel";

function inspectionWithFill(fill: string): BridgeInspection {
  return {
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
    attributes: { "data-design-tool-kind": "rectangle", "data-design-tool-fill": fill },
    inlineStyle: {},
    computedStyle: { "background-color": fill },
  };
}

function renderPanel(fill: string) {
  const inspection = inspectionWithFill(fill);
  const entry: OverlayBridgeTargetState = { frameId: "frame-1", target: inspection.target, inspection };
  const onEditNodeStyle = vi.fn();
  render(
    <PropertiesPanel
      frames={{}}
      nodes={{}}
      selection={{ frameIds: ["frame-1"], nodeIds: ["rect-1"], primaryFrameId: "frame-1", primaryNodeId: "rect-1" }}
      bridgeTargets={{ "frame-1:rect-1": entry }}
      tokens={createSeedTokenStore()}
      onUpdateFrame={vi.fn()}
      onMoveFrame={vi.fn()}
      onEditNodeStyle={onEditNodeStyle}
      onEditNodePosition={vi.fn()}
      onApplyGlassEffect={vi.fn()}
      shapeRadius={0}
      shapeRadiusVisible={false}
      onShapeRadiusChange={vi.fn()}
      onShapeRadiusCommit={vi.fn()}
    />,
  );
  return { onEditNodeStyle };
}

describe("PropertiesPanel token references", () => {
  it("marks the link affordance when a raw value matches a token", () => {
    renderPanel("#3b74c2");
    const button = screen.getByTestId("token-picker-background-color");
    expect(button.className).toContain("has-match");
    expect(button.title).toContain("color.accent.primary");
  });

  it("flags off-system raw values", () => {
    renderPanel("#123456");
    const button = screen.getByTestId("token-offsystem-background-color");
    expect(button.className).toContain("is-off");
    expect(button.title).toContain("No matching variable");
  });

  it("shows nothing token-related without a token store", () => {
    const inspection = inspectionWithFill("#3b74c2");
    const entry: OverlayBridgeTargetState = { frameId: "frame-1", target: inspection.target, inspection };
    const { container } = render(
      <PropertiesPanel
        frames={{}}
        nodes={{}}
        selection={{ frameIds: ["frame-1"], nodeIds: ["rect-1"], primaryFrameId: "frame-1", primaryNodeId: "rect-1" }}
        bridgeTargets={{ "frame-1:rect-1": entry }}
        onUpdateFrame={vi.fn()}
        onMoveFrame={vi.fn()}
        onEditNodeStyle={vi.fn()}
        onEditNodePosition={vi.fn()}
        onApplyGlassEffect={vi.fn()}
        shapeRadius={0}
        shapeRadiusVisible={false}
        onShapeRadiusChange={vi.fn()}
        onShapeRadiusCommit={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-testid^='token-']")).toBeNull();
  });

  it("renders a var() link as the field's variable chip", () => {
    renderPanel("var(--color-accent-primary)");
    const chip = screen.getByTestId("token-hint-background-color");
    expect(chip.className).toContain("token-field-chip");
    expect(chip.textContent).toContain("color.accent.primary");
  });

  it("flags a var() that resolves to no token in the active theme", () => {
    renderPanel("var(--color-does-not-exist)");
    expect(screen.getByTestId("token-unresolved-background-color").textContent).toContain("Broken reference");
  });

  it("applies a token as a var() link through the picker", () => {
    const { onEditNodeStyle } = renderPanel("#123456");
    fireEvent.click(screen.getByTestId("token-offsystem-background-color"));
    fireEvent.click(screen.getByTestId("token-option-background-color-color.accent.primary"));
    expect(onEditNodeStyle).toHaveBeenCalledWith("background-color", "var(--color-accent-primary)");
  });

  it("detaches a link back to the resolved raw value", () => {
    const { onEditNodeStyle } = renderPanel("var(--color-accent-primary)");
    fireEvent.click(screen.getByTestId("token-hint-background-color"));
    fireEvent.click(screen.getByTestId("token-detach-background-color"));
    expect(onEditNodeStyle).toHaveBeenCalledWith("background-color", "#3b74c2");
  });
});
