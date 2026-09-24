import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CanvasShaderElement } from "../shaders";
import { ShadersPanel } from "./ShadersPanel";

const ELEMENT: CanvasShaderElement = {
  id: "shader-el-1",
  shaderId: "mesh-gradient",
  x: 0,
  y: 0,
  width: 340,
  height: 240,
};

function renderPanel(overrides: Partial<Parameters<typeof ShadersPanel>[0]> = {}) {
  const props: Parameters<typeof ShadersPanel>[0] = {
    shaderElements: [ELEMENT],
    selectedShaderElementId: null,
    onSelectShaderElement: vi.fn(),
    onUpdateShaderParams: vi.fn(),
    onDeleteShaderElement: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ShadersPanel {...props} />) };
}

async function expandEditor(utils: ReturnType<typeof renderPanel>) {
  fireEvent.click(utils.getByRole("button", { name: /Expand Mesh Gradient controls/ }));
  return screen.findByTestId("shader-editor-shader-el-1");
}

describe("ShadersPanel", () => {
  it("shows an empty state when no shaders are placed", () => {
    const { getByText } = renderPanel({ shaderElements: [] });
    expect(getByText("No shaders yet")).toBeTruthy();
  });

  it("lists placed shader elements and selects them", () => {
    const { props, getByRole } = renderPanel();
    fireEvent.click(getByRole("button", { name: /Mesh Gradient controls/ }));
    expect(props.onSelectShaderElement).toHaveBeenCalledWith("shader-el-1");
  });

  it("exposes every shader param once the editor loads", async () => {
    const utils = renderPanel();
    await expandEditor(utils);
    // Colors array, scalar numbers, motion, and sizing params are all editable.
    expect(screen.getByTestId("shader-param-colors")).toBeTruthy();
    expect(screen.getByTestId("shader-param-distortion")).toBeTruthy();
    expect(screen.getByTestId("shader-param-speed")).toBeTruthy();
    expect(screen.getByTestId("shader-param-fit")).toBeTruthy();
    expect(screen.getByTestId("shader-param-scale")).toBeTruthy();
    expect(screen.getByLabelText("Shader preset")).toBeTruthy();
  });

  it("commits a param edit merged over the default preset", async () => {
    const utils = renderPanel();
    await expandEditor(utils);
    fireEvent.change(screen.getByLabelText("Distortion slider"), { target: { value: "0.4" } });
    expect(utils.props.onUpdateShaderParams).toHaveBeenCalledWith(
      "shader-el-1",
      expect.objectContaining({ distortion: 0.4, fit: "contain", speed: 1 }),
    );
  });

  it("applies a preset as a complete params object", async () => {
    const utils = renderPanel();
    await expandEditor(utils);
    fireEvent.change(screen.getByLabelText("Shader preset"), { target: { value: "Ink" } });
    expect(utils.props.onUpdateShaderParams).toHaveBeenCalledWith(
      "shader-el-1",
      expect.objectContaining({ rotation: 90, swirl: 0.2 }),
    );
  });

  it("keeps user-edited values instead of falling back to defaults", async () => {
    const utils = renderPanel({
      shaderElements: [{ ...ELEMENT, params: { distortion: 0.33, speed: 0.2 } }],
    });
    await expandEditor(utils);
    expect((screen.getByLabelText("Distortion slider") as HTMLInputElement).value).toBe("0.33");
  });

  it("deletes an element from the row", () => {
    const utils = renderPanel();
    fireEvent.click(utils.getByRole("button", { name: "Delete Mesh Gradient" }));
    expect(utils.props.onDeleteShaderElement).toHaveBeenCalledWith("shader-el-1");
  });

  it("keeps a collapsed selection collapsed when the element array is replaced", () => {
    const utils = renderPanel({ selectedShaderElementId: "shader-el-1" });
    const toggle = () => utils.getByRole("button", { name: /Mesh Gradient controls/ });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    // A param edit upstream hands the panel a fresh array of the same elements.
    utils.rerender(<ShadersPanel {...utils.props} shaderElements={[{ ...ELEMENT }]} />);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });
});
