import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BridgeInspection } from "../bridge/protocol";
import type { OverlayBridgeTargetState } from "../overlay/useNodeOverlayGestures";
import type { CanvasShaderElement } from "../shaders";
import type { TokenStoreState } from "../tokens";
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
        attributes: { ...inspection.attributes, "data-design-tool-fill": "#e5484d" },
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

  it("binds the stroke for stroke-only shapes and routes border edits to it", () => {
    const lineEntry: OverlayBridgeTargetState = {
      frameId: "frame-1",
      target: { ...inspection.target, elementId: "line-1", tagName: "svg", name: "Line" },
      inspection: {
        target: { ...inspection.target, elementId: "line-1", tagName: "svg", name: "Line" },
        text: "",
        attributes: {
          "data-design-tool-kind": "line",
          "data-design-tool-fill": "#d9d9d9",
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "2",
        },
        inlineStyle: {},
        computedStyle: { "border-color": "rgb(34, 34, 34)", "border-width": "0px" },
      },
    };
    const onEditNodeStyle = vi.fn();
    render(
      <PropertiesPanel
        {...baseProps}
        selection={{ frameIds: ["frame-1"], nodeIds: ["line-1"], primaryFrameId: "frame-1", primaryNodeId: "line-1" }}
        bridgeTargets={{ "frame-1:line-1": lineEntry }}
        onEditNodeStyle={onEditNodeStyle}
      />,
    );
    const strokeInput = screen.getByLabelText("Stroke") as HTMLInputElement;
    expect(strokeInput.value).toBe("#222222");
    expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("2px");
    // A stroke-only shape's outline IS its stroke — the redundant Border and
    // Radius rows stay hidden.
    expect(screen.queryByLabelText("Border")).toBeNull();
    expect(screen.queryByLabelText("Radius")).toBeNull();
    fireEvent.click(screen.getByTestId("color-swatch-Stroke"));
    fireEvent.click(screen.getByTestId("color-option-#e5484d"));
    expect(onEditNodeStyle).toHaveBeenCalledWith("background-color", "#e5484d");
  });

  it("binds the Border field to the vector stroke attribute", () => {
    const onEditNodeStyle = vi.fn();
    const stroked: OverlayBridgeTargetState = {
      ...entry,
      inspection: {
        ...inspection,
        attributes: {
          ...inspection.attributes,
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "3",
        },
      },
    };
    render(
      <PropertiesPanel
        {...baseProps}
        bridgeTargets={{ "frame-1:rect-1": stroked }}
        onEditNodeStyle={onEditNodeStyle}
      />,
    );
    const border = screen.getByLabelText("Border") as HTMLInputElement;
    expect(border.value).toBe("#222222");
    expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("3px");
    fireEvent.change(border, { target: { value: "#e5484d" } });
    fireEvent.blur(border, { relatedTarget: document.body });
    expect(onEditNodeStyle).toHaveBeenCalledWith("border-color", "#e5484d");
  });

  it("applies the glass effect from the palette's Glass swatch instead of a fill", () => {
    const onApplyGlassEffect = vi.fn();
    const onEditNodeStyle = vi.fn();
    render(<PropertiesPanel {...baseProps} onEditNodeStyle={onEditNodeStyle} onApplyGlassEffect={onApplyGlassEffect} />);
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    fireEvent.click(screen.getByTestId("color-option-glass"));
    expect(onApplyGlassEffect).toHaveBeenCalledWith(60);
    expect(onEditNodeStyle).not.toHaveBeenCalled();
    expect(screen.queryByTestId("color-popover-Fill")).toBeNull();
  });

  it("marks the Glass swatch active when the fill is already glassed", () => {
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
      />,
    );
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    expect((screen.getByTestId("color-option-glass") as HTMLButtonElement).className).toContain("is-active");
  });
});

const textInspection: BridgeInspection = {
  target: {
    elementId: "text-1",
    tagName: "p",
    path: "html/body/p[1]",
    name: "Text",
    role: null,
    bounds: { x: 20, y: 20, width: 200, height: 24 },
    locked: false,
  },
  text: "Heading",
  attributes: {},
  inlineStyle: { "font-family": "Inter, ui-sans-serif, system-ui, sans-serif" },
  computedStyle: { "font-family": "Inter, ui-sans-serif, system-ui, sans-serif", "font-size": "16px" },
};

const textEntry: OverlayBridgeTargetState = {
  frameId: "frame-1",
  target: textInspection.target,
  inspection: textInspection,
};

const textProps = {
  ...baseProps,
  selection: { ...baseProps.selection, nodeIds: ["text-1"], primaryNodeId: "text-1" },
  bridgeTargets: { "frame-1:text-1": textEntry },
};

describe("PropertiesPanel shape width/radius tokens", () => {
  const tokens: TokenStoreState = {
    sets: {
      "set-1": {
        id: "set-1",
        name: "Core",
        tokens: {
          "stroke-md": { id: "stroke-md", name: "stroke.md", type: "spacing", value: "2px" },
          "radius-md": { id: "radius-md", name: "radius.md", type: "radius", value: "8px" },
        },
      },
    },
    themes: { "theme-1": { id: "theme-1", name: "Default", setIds: ["set-1"] } },
    activeThemeId: "theme-1",
    revision: 1,
  };

  it("hides the Width and Radius token controls on created vectors", () => {
    // A var() pick parses to NaN in the shape-command path and falls through
    // to a wrapper style that never paints the geometry — offering the
    // control promises a link that silently does nothing.
    render(<PropertiesPanel {...baseProps} tokens={tokens} />);
    expect(screen.getByLabelText("Width")).toBeTruthy();
    expect(screen.getByLabelText("Radius")).toBeTruthy();
    for (const testId of [
      "token-picker-border-width",
      "token-offsystem-border-width",
      "token-hint-border-width",
      "token-picker-border-radius",
      "token-offsystem-border-radius",
      "token-hint-border-radius",
    ]) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  });

  it("keeps the Width and Radius token controls on plain elements", () => {
    const divEntry: OverlayBridgeTargetState = {
      frameId: "frame-1",
      target: { ...inspection.target, elementId: "box-1", tagName: "div", name: "Box" },
      inspection: {
        target: { ...inspection.target, elementId: "box-1", tagName: "div", name: "Box" },
        text: "",
        attributes: {},
        inlineStyle: {},
        computedStyle: { "border-width": "2px", "border-radius": "8px" },
      },
    };
    render(
      <PropertiesPanel
        {...baseProps}
        selection={{ frameIds: ["frame-1"], nodeIds: ["box-1"], primaryFrameId: "frame-1", primaryNodeId: "box-1" }}
        bridgeTargets={{ "frame-1:box-1": divEntry }}
        tokens={tokens}
      />,
    );
    // The controls exist on plain elements (unmatched raw values render
    // the picker button).
    expect(screen.getByTestId("token-picker-border-width")).toBeTruthy();
    expect(screen.getByTestId("token-picker-border-radius")).toBeTruthy();
  });
});

describe("PropertiesPanel font family picker", () => {
  it("lists the bundled catalog and commits a font stack", () => {
    const onEditNodeStyle = vi.fn();
    render(<PropertiesPanel {...textProps} onEditNodeStyle={onEditNodeStyle} />);
    fireEvent.click(screen.getByTestId("font-family-toggle"));
    expect(screen.getByTestId("font-popover")).toBeTruthy();
    expect(screen.getByTestId("font-option-sora")).toBeTruthy();
    fireEvent.click(screen.getByTestId("font-option-sora"));
    expect(onEditNodeStyle).toHaveBeenCalledWith("font-family", '"Sora", ui-sans-serif, system-ui, sans-serif');
    expect(screen.queryByTestId("font-popover")).toBeNull();
  });

  it("filters the catalog while typing in the field", () => {
    render(<PropertiesPanel {...textProps} />);
    const input = screen.getByTestId("font-family-input");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "fraun" } });
    expect(screen.getByTestId("font-option-fraunces")).toBeTruthy();
    expect(screen.queryByTestId("font-option-sora")).toBeNull();
    expect(screen.queryByTestId("font-option-geist-mono")).toBeNull();
  });

  it("still commits a typed off-catalog family on blur", () => {
    const onEditNodeStyle = vi.fn();
    render(<PropertiesPanel {...textProps} onEditNodeStyle={onEditNodeStyle} />);
    const input = screen.getByTestId("font-family-input");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Comic Sans MS, cursive" } });
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(onEditNodeStyle).toHaveBeenCalledWith("font-family", "Comic Sans MS, cursive");
  });

  it("marks the active option for a catalog stack", () => {
    const soraEntry: OverlayBridgeTargetState = {
      ...textEntry,
      inspection: {
        ...textInspection,
        inlineStyle: { "font-family": '"Sora", ui-sans-serif, system-ui, sans-serif' },
      },
    };
    render(
      <PropertiesPanel
        {...textProps}
        bridgeTargets={{ "frame-1:text-1": soraEntry }}
      />,
    );
    fireEvent.click(screen.getByTestId("font-family-toggle"));
    expect((screen.getByTestId("font-option-sora") as HTMLButtonElement).className).toContain("is-active");
  });

  function entryFor(target: Partial<BridgeInspection["target"]>, attributes: Record<string, string> = {}): OverlayBridgeTargetState {
    const inspection: BridgeInspection = {
      target: { ...textInspection.target, ...target },
      text: "",
      attributes,
      inlineStyle: {},
      computedStyle: {},
    };
    return { frameId: "frame-1", target: inspection.target, inspection };
  }

  it("shows the family field for a created text layer (div with kind=text)", () => {
    const created = entryFor({ elementId: "div-text", tagName: "div" }, { "data-design-tool-kind": "text" });
    render(
      <PropertiesPanel
        {...baseProps}
        selection={{ ...baseProps.selection, nodeIds: ["div-text"], primaryNodeId: "div-text" }}
        bridgeTargets={{ "frame-1:div-text": created }}
      />,
    );
    expect(screen.getByTestId("font-family-input")).toBeTruthy();
  });

  it("shows the family field for buttons", () => {
    const button = entryFor({ elementId: "btn-1", tagName: "button", name: "Button" });
    render(
      <PropertiesPanel
        {...baseProps}
        selection={{ ...baseProps.selection, nodeIds: ["btn-1"], primaryNodeId: "btn-1" }}
        bridgeTargets={{ "frame-1:btn-1": button }}
      />,
    );
    expect(screen.getByTestId("font-family-input")).toBeTruthy();
  });

  it("shows the family field for generic containers whose text inherits", () => {
    const container = entryFor({ elementId: "div-1", tagName: "div", name: "Group" });
    render(
      <PropertiesPanel
        {...baseProps}
        selection={{ ...baseProps.selection, nodeIds: ["div-1"], primaryNodeId: "div-1" }}
        bridgeTargets={{ "frame-1:div-1": container }}
      />,
    );
    expect(screen.getByTestId("font-family-input")).toBeTruthy();
  });
});

describe("PropertiesPanel profile coverage", () => {
  function entryFor(target: Partial<BridgeInspection["target"]>, attributes: Record<string, string> = {}): OverlayBridgeTargetState {
    const inspection: BridgeInspection = {
      target: { ...textInspection.target, ...target },
      text: "",
      attributes,
      inlineStyle: {},
      computedStyle: {},
    };
    return { frameId: "frame-1", target: inspection.target, inspection };
  }

  function renderTarget(elementId: string, target: Partial<BridgeInspection["target"]>, attributes: Record<string, string> = {}) {
    return render(
      <PropertiesPanel
        {...baseProps}
        selection={{ ...baseProps.selection, nodeIds: [elementId], primaryNodeId: elementId }}
        bridgeTargets={{ [`frame-1:${elementId}`]: entryFor(target, attributes) }}
      />,
    );
  }

  // Regression: the "text" profile branch once rendered no glass section, so a
  // created text layer could not receive or report a glass level (QA D2).
  it("offers the glass control on a created text layer", () => {
    renderTarget("div-text", { elementId: "div-text", tagName: "div" }, { "data-design-tool-kind": "text" });
    expect(screen.getByTestId("glass-level-slider")).toBeTruthy();
    expect(screen.getByTestId("glass-level-value").textContent).toBe("Off");
  });

  it("offers the glass control on buttons and generic containers too", () => {
    const { unmount } = renderTarget("btn-1", { elementId: "btn-1", tagName: "button", name: "Button" });
    expect(screen.getByTestId("glass-level-slider")).toBeTruthy();
    unmount();
    renderTarget("div-1", { elementId: "div-1", tagName: "div", name: "Group" });
    expect(screen.getByTestId("glass-level-slider")).toBeTruthy();
  });

  it("offers the Glass swatch on a button's background fill", () => {
    renderTarget("btn-1", { elementId: "btn-1", tagName: "button", name: "Button" });
    fireEvent.click(screen.getByTestId("color-swatch-Background"));
    expect(screen.getByTestId("color-option-glass")).toBeTruthy();
  });

  it("offers the Glass swatch on a text layer's fill", () => {
    renderTarget("div-text", { elementId: "div-text", tagName: "div" }, { "data-design-tool-kind": "text" });
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    expect(screen.getByTestId("color-option-glass")).toBeTruthy();
  });
});

const shaderElement: CanvasShaderElement = {
  id: "shader-el-1",
  shaderId: "mesh-gradient",
  x: 120,
  y: 80,
  width: 340,
  height: 240,
};

const shaderProps = {
  ...baseProps,
  selection: { frameIds: [], nodeIds: [], primaryFrameId: null, primaryNodeId: null },
  bridgeTargets: {},
  shaderElements: [shaderElement],
  selectedShaderElementId: "shader-el-1",
  onUpdateShaderElement: vi.fn(),
  onUpdateShaderParams: vi.fn(),
  onDeleteShaderElement: vi.fn(),
};

describe("PropertiesPanel shader inspector", () => {
  it("shows geometry, corner radius, and the live param editor for a selected shader", async () => {
    render(<PropertiesPanel {...shaderProps} />);
    expect(screen.getByTestId("property-shader-x")).toBeTruthy();
    expect(screen.getByTestId("property-shader-width")).toBeTruthy();
    expect(screen.getByTestId("shape-radius-slider")).toBeTruthy();
    // The shared param editor loads the shader's preset table async.
    expect(await screen.findByTestId("shader-editor-shader-el-1")).toBeTruthy();
    expect(await screen.findByTestId("shader-param-colors")).toBeTruthy();
  });

  it("commits geometry edits through onUpdateShaderElement", () => {
    const onUpdateShaderElement = vi.fn();
    render(<PropertiesPanel {...shaderProps} onUpdateShaderElement={onUpdateShaderElement} />);
    const x = screen.getByTestId("property-shader-x");
    fireEvent.change(x, { target: { value: "200" } });
    fireEvent.blur(x);
    expect(onUpdateShaderElement).toHaveBeenCalledWith("shader-el-1", { x: 200 });
  });

  it("clamps width edits at the shader element minimum", () => {
    const onUpdateShaderElement = vi.fn();
    render(<PropertiesPanel {...shaderProps} onUpdateShaderElement={onUpdateShaderElement} />);
    const w = screen.getByTestId("property-shader-width");
    fireEvent.change(w, { target: { value: "10" } });
    fireEvent.blur(w);
    expect(onUpdateShaderElement).toHaveBeenCalledWith("shader-el-1", { width: 96 });
  });

  it("clamps the stored radius when a size edit shrinks below it", () => {
    const onUpdateShaderElement = vi.fn();
    render(
      <PropertiesPanel
        {...shaderProps}
        shaderElements={[{ ...shaderElement, radius: 60 }]}
        onUpdateShaderElement={onUpdateShaderElement}
      />,
    );
    const w = screen.getByTestId("property-shader-width");
    fireEvent.change(w, { target: { value: "100" } });
    fireEvent.blur(w);
    expect(onUpdateShaderElement).toHaveBeenCalledWith("shader-el-1", { width: 100, radius: 50 });
  });

  it("rounds corners through the radius slider", () => {
    const onUpdateShaderElement = vi.fn();
    render(<PropertiesPanel {...shaderProps} onUpdateShaderElement={onUpdateShaderElement} />);
    fireEvent.change(screen.getByTestId("shape-radius-slider"), { target: { value: "60" } });
    expect(onUpdateShaderElement).toHaveBeenCalledWith("shader-el-1", { radius: 60 });
  });

  it("routes param edits to onUpdateShaderParams and deletes via the header button", async () => {
    const onUpdateShaderParams = vi.fn();
    const onDeleteShaderElement = vi.fn();
    render(
      <PropertiesPanel
        {...shaderProps}
        onUpdateShaderParams={onUpdateShaderParams}
        onDeleteShaderElement={onDeleteShaderElement}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Distortion slider"), { target: { value: "0.4" } });
    expect(onUpdateShaderParams).toHaveBeenCalledWith(
      "shader-el-1",
      expect.objectContaining({ distortion: 0.4 }),
    );
    fireEvent.click(screen.getByTestId("shader-panel-delete"));
    expect(onDeleteShaderElement).toHaveBeenCalledWith("shader-el-1");
  });

  it("falls back to the empty state when no shader is selected", () => {
    render(<PropertiesPanel {...shaderProps} selectedShaderElementId={null} />);
    expect(screen.getByText("Nothing selected")).toBeTruthy();
    expect(screen.queryByTestId("shader-panel-delete")).toBeNull();
  });

  it("shows the shader's real captured thumbnail in the summary mark", () => {
    const { container } = render(<PropertiesPanel {...shaderProps} />);
    const thumb = container.querySelector(".selection-summary-thumb");
    expect(thumb).toBeTruthy();
    expect(thumb?.getAttribute("src")).toMatch(/shader-thumbs\/mesh-gradient\.webp/);
  });
});
