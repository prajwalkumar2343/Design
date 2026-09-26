import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShaderElementView } from "./ShaderElementView";
import { detectPaperShaderSupport, loadPaperShader } from "../shaders";
import type { CanvasShaderElement } from "../shaders/canvas-model";

vi.mock("../shaders", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shaders")>();
  return {
    ...mod,
    loadPaperShader: vi.fn(mod.loadPaperShader),
    detectPaperShaderSupport: vi.fn(mod.detectPaperShaderSupport),
  };
});

const element: CanvasShaderElement = {
  id: "shader-el-1",
  shaderId: "ferro-tide",
  x: 100,
  y: 50,
  width: 340,
  height: 240,
};

const camera = { x: 0, y: 0, zoom: 1 };

function renderElement(overrides: Partial<Parameters<typeof ShaderElementView>[0]> = {}) {
  const props: Parameters<typeof ShaderElementView>[0] = {
    element,
    camera,
    isSelected: false,
    onSelect: vi.fn(),
    onChange: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ShaderElementView {...props} />) };
}

beforeEach(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.hasPointerCapture = () => false;
  }
});

describe("ShaderElementView", () => {
  it("positions the element in world space at the camera scale", () => {
    renderElement();
    const el = screen.getByTestId("shader-element") as HTMLElement;
    expect(el.style.transform).toBe("translate3d(100px, 50px, 0)");
    expect(el.style.width).toBe("340px");
  });

  it("selects on pointerdown and moves by screen delta divided by zoom", () => {
    const { props } = renderElement({ camera: { ...camera, zoom: 2 } });
    const el = screen.getByTestId("shader-element");
    fireEvent.pointerDown(el, { button: 0, isPrimary: true, pointerId: 1, clientX: 200, clientY: 200 });
    expect(props.onSelect).toHaveBeenCalledWith("shader-el-1");
    fireEvent.pointerMove(el, { isPrimary: true, pointerId: 1, clientX: 240, clientY: 180 });
    // 40px right / -20px up on screen → 20/-10 world units at 2x zoom.
    expect(props.onChange).toHaveBeenCalledWith("shader-el-1", { x: 120, y: 40 });
  });

  it("ignores non-primary and secondary-button drags", () => {
    const { props } = renderElement();
    const el = screen.getByTestId("shader-element");
    fireEvent.pointerDown(el, { button: 2, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerDown(el, { button: 0, isPrimary: false, pointerId: 9, clientX: 0, clientY: 0 });
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("resizes through the handle and clamps at the minimum size", () => {
    const { props } = renderElement({ isSelected: true });
    const handle = screen.getByTestId("shader-element-resize");
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { isPrimary: true, pointerId: 1, clientX: -500, clientY: -500 });
    // 340-500 / 240-500 → clamped to the 96x72 floor, not a negative size.
    expect(props.onChange).toHaveBeenCalledWith("shader-el-1", { width: 96, height: 72 });
  });

  it("deletes via the affordance and deselects on outside pointerdown", () => {
    const { props } = renderElement({ isSelected: true });
    fireEvent.click(screen.getByTestId("shader-element-delete"));
    expect(props.onDelete).toHaveBeenCalledWith("shader-el-1");
    fireEvent.pointerDown(document.body);
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it("does not deselect on outside pointerdown when not selected", () => {
    const { props } = renderElement({ isSelected: false });
    fireEvent.pointerDown(document.body);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("stays selected when the pointerdown lands on canvas chrome", () => {
    const { props } = renderElement({ isSelected: true });
    const control = document.createElement("div");
    control.setAttribute("data-canvas-control", "");
    document.body.appendChild(control);
    try {
      fireEvent.pointerDown(control);
      expect(props.onSelect).not.toHaveBeenCalled();
    } finally {
      control.remove();
    }
  });

  it("applies corner radius to the frame and the clipped stage", () => {
    renderElement({ element: { ...element, radius: 40 } });
    const el = screen.getByTestId("shader-element") as HTMLElement;
    expect(el.style.borderRadius).toBe("40px");
    const stage = el.querySelector<HTMLElement>(".shader-element-stage");
    expect(stage?.style.borderRadius).toBe("37px");
  });

  it("reports a module load failure honestly instead of blaming WebGL2", async () => {
    vi.mocked(loadPaperShader).mockRejectedValueOnce(new Error("chunk 404"));
    renderElement();
    await waitFor(() =>
      expect(screen.getByText("Shader failed to load")).toBeTruthy(),
    );
    expect(screen.queryByText("WebGL2 unavailable")).toBeNull();
  });

  it("recovers from a transient load failure when retry is clicked", async () => {
    vi.mocked(loadPaperShader).mockRejectedValueOnce(new Error("chunk 404"));
    renderElement();
    await waitFor(() =>
      expect(screen.getByText("Shader failed to load")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("shader-element-retry"));
    await waitFor(() =>
      expect(screen.queryByText("Shader failed to load")).toBeNull(),
    );
    // The retry reached the real loader, which resolved Ferro Tide's module.
    expect(vi.mocked(loadPaperShader).mock.calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() =>
      expect(screen.getByTestId("ferro-tide-fallback")).toBeTruthy(),
    );
  });

  it("labels an unrecognized shader id as unknown with no retry", async () => {
    renderElement({
      element: { ...element, shaderId: "gone-shader" as never },
    });
    await waitFor(() =>
      expect(screen.getByText("Unknown shader")).toBeTruthy(),
    );
    expect(screen.queryByTestId("shader-element-retry")).toBeNull();
  });

  it("reserves the WebGL2 message for a Paper shader that truly lacks support", async () => {
    vi.mocked(detectPaperShaderSupport).mockReturnValueOnce({
      supported: false,
      reason: "webgl2-unavailable",
    });
    renderElement({
      element: { ...element, shaderId: "mesh-gradient" },
    });
    await waitFor(() =>
      expect(screen.getByText("WebGL2 unavailable")).toBeTruthy(),
    );
  });

  it("does not gate custom shaders behind the WebGL2 probe", async () => {
    vi.mocked(detectPaperShaderSupport).mockReturnValue({
      supported: false,
      reason: "webgl2-unavailable",
    });
    renderElement();
    await waitFor(() =>
      expect(screen.getByTestId("ferro-tide-fallback")).toBeTruthy(),
    );
    expect(screen.queryByText("WebGL2 unavailable")).toBeNull();
    expect(vi.mocked(loadPaperShader)).toHaveBeenCalledWith("ferro-tide");
  });
});
