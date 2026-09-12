import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SHAPE_VARIANTS } from "../editor/tools";
import { CanvasDock } from "./CanvasDock";

function renderDock(overrides: Partial<Parameters<typeof CanvasDock>[0]> = {}) {
  const props: Parameters<typeof CanvasDock>[0] = {
    zoom: 1,
    activeTool: "select",
    temporaryHand: false,
    isFrameMenuOpen: false,
    isShaderMenuOpen: false,
    canUndo: false,
    canRedo: false,
    onAddFrame: vi.fn(),
    onAddShader: vi.fn(),
    onFit: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onSelectTool: vi.fn(),
    activeShape: "rectangle",
    onSelectShape: vi.fn(),
    onToggleFrameMenu: vi.fn(),
    onCloseFrameMenu: vi.fn(),
    onToggleShaderMenu: vi.fn(),
    onCloseShaderMenu: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CanvasDock {...props} />) };
}

describe("CanvasDock tools", () => {
  it("renders the core tools and marks the active one", () => {
    renderDock({ activeTool: "text" });
    for (const tool of ["select", "hand", "rectangle", "text", "image", "comment"]) {
      expect(screen.getByTestId(`tool-button-${tool}`)).toBeTruthy();
    }
    expect((screen.getByTestId("tool-button-text") as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByTestId("tool-button-select") as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
  });

  it("routes tool clicks through onSelectTool", () => {
    const { props } = renderDock();
    fireEvent.click(screen.getByTestId("tool-button-comment"));
    expect(props.onSelectTool).toHaveBeenCalledWith("comment");
  });

  it("shows the hand tool active during a temporary pan", () => {
    renderDock({ activeTool: "select", temporaryHand: true });
    expect((screen.getByTestId("tool-button-hand") as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("CanvasDock shape menu", () => {
  it("opens on the shape button and lists every variant", () => {
    renderDock();
    fireEvent.click(screen.getByTestId("shape-menu-button"));
    for (const shape of SHAPE_VARIANTS) {
      expect(screen.getByTestId(`shape-menu-${shape.id}`)).toBeTruthy();
    }
  });

  it("selects a variant and closes the menu", () => {
    const { props } = renderDock();
    fireEvent.click(screen.getByTestId("shape-menu-button"));
    fireEvent.click(screen.getByTestId("shape-menu-star"));
    expect(props.onSelectShape).toHaveBeenCalledWith("star");
    expect(screen.queryByTestId("shape-menu-star")).toBeNull();
  });

  it("marks the active shape variant", () => {
    renderDock({ activeShape: "ellipse" });
    fireEvent.click(screen.getByTestId("shape-menu-button"));
    expect((screen.getByTestId("shape-menu-ellipse") as HTMLButtonElement).className).toContain("is-active");
    expect((screen.getByTestId("shape-menu-rectangle") as HTMLButtonElement).className).not.toContain("is-active");
  });

  it("closes when a pointer lands outside the menu", () => {
    renderDock();
    fireEvent.click(screen.getByTestId("shape-menu-button"));
    expect(screen.getByTestId("shape-menu-rectangle")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("shape-menu-rectangle")).toBeNull();
  });

  it("closes on Escape like the frame and shader menus do", () => {
    renderDock();
    fireEvent.click(screen.getByTestId("shape-menu-button"));
    expect(screen.getByTestId("shape-menu-rectangle")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("shape-menu-rectangle")).toBeNull();
    // A subsequent click on the shape button must re-open, not "toggle closed".
    fireEvent.click(screen.getByTestId("shape-menu-button"));
    expect(screen.getByTestId("shape-menu-rectangle")).toBeTruthy();
  });
});

describe("CanvasDock frame menu", () => {
  it("lists device categories and drills into presets", () => {
    const { props } = renderDock({ isFrameMenuOpen: true });
    expect(screen.getByTestId("frame-category-desktop")).toBeTruthy();
    fireEvent.click(screen.getByTestId("frame-category-desktop"));
    const preset = document.querySelector("[data-testid^='add-'][data-testid$='-frame']") as HTMLButtonElement;
    expect(preset).toBeTruthy();
    fireEvent.click(preset);
    expect(props.onAddFrame).toHaveBeenCalled();
    expect(props.onCloseFrameMenu).toHaveBeenCalled();
  });

  it("hides desktop presets on a mobile canvas", () => {
    renderDock({ isFrameMenuOpen: true, canvasCategory: "mobile" });
    expect(screen.queryByTestId("frame-category-desktop")).toBeNull();
    expect(screen.getByTestId("frame-category-mobile")).toBeTruthy();
  });
});

describe("CanvasDock history and zoom", () => {
  it("disables undo and redo when the stacks are empty", () => {
    renderDock({ canUndo: false, canRedo: false });
    expect((screen.getByTestId("undo-button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("redo-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("invokes undo/redo/zoom callbacks and renders the zoom percentage", () => {
    const { props } = renderDock({ zoom: 1.5, canUndo: true, canRedo: true });
    expect(screen.getByLabelText("Fit all frames", { selector: ".zoom-value" }).textContent).toBe("150%");
    fireEvent.click(screen.getByTestId("undo-button"));
    fireEvent.click(screen.getByTestId("redo-button"));
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(props.onUndo).toHaveBeenCalled();
    expect(props.onRedo).toHaveBeenCalled();
    expect(props.onZoomIn).toHaveBeenCalled();
    expect(props.onZoomOut).toHaveBeenCalled();
  });
});
