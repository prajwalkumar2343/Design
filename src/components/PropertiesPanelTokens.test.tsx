import { render, screen } from "@testing-library/react";
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
  render(
    <PropertiesPanel
      frames={{}}
      nodes={{}}
      selection={{ frameIds: ["frame-1"], nodeIds: ["rect-1"], primaryFrameId: "frame-1", primaryNodeId: "rect-1" }}
      bridgeTargets={{ "frame-1:rect-1": entry }}
      tokens={createSeedTokenStore()}
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
}

describe("PropertiesPanel token references", () => {
  it("shows the token reference when a value matches the active theme", () => {
    renderPanel("#3b74c2");
    const hint = screen.getByTestId("token-hint-background-color");
    expect(hint.textContent).toContain("color.accent.primary");
  });

  it("flags off-system raw values", () => {
    renderPanel("#123456");
    expect(screen.getByTestId("token-offsystem-background-color").textContent).toContain("Off-system");
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
});
