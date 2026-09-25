import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasShaderElement } from "../shaders";
import { ShaderParamsEditor } from "./ShaderEditor";

function element(overrides: Partial<CanvasShaderElement> = {}): CanvasShaderElement {
  return {
    id: "shader-el-1",
    shaderId: "ferro-tide",
    x: 0,
    y: 0,
    width: 340,
    height: 240,
    ...overrides,
  };
}

function renderEditor(overrides: Partial<Parameters<typeof ShaderParamsEditor>[0]> = {}) {
  const props: Parameters<typeof ShaderParamsEditor>[0] = {
    element: element(),
    onUpdateParams: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ShaderParamsEditor {...props} />) };
}

describe("ShaderParamsEditor ferro-tide", () => {
  it("shows a loading state until the shader module resolves, then renders its fields", async () => {
    renderEditor();
    expect(screen.getByLabelText("Loading shader controls")).toBeTruthy();
    expect(await screen.findByTestId("shader-editor-shader-el-1")).toBeTruthy();
    expect((screen.getByLabelText("Mood") as HTMLSelectElement).value).toBe("Abyss");
    expect((screen.getByRole("switch", { name: "Interactive" }) as HTMLInputElement).checked).toBe(true);
  });

  it("applies a preset as a complete params object", async () => {
    const { props } = renderEditor();
    const preset = (await screen.findByTestId("shader-preset-select")) as HTMLSelectElement;
    expect(preset.value).toBe("Abyss");

    fireEvent.change(preset, { target: { value: "Magma" } });
    expect(props.onUpdateParams).toHaveBeenCalledWith("shader-el-1", { mood: "Magma", interactive: true });
  });

  it("merges a field commit over the default preset", async () => {
    const { props } = renderEditor({ element: element({ params: { mood: "Kelp" } }) });
    await screen.findByTestId("shader-editor-shader-el-1");
    expect((screen.getByLabelText("Mood") as HTMLSelectElement).value).toBe("Kelp");

    fireEvent.click(screen.getByRole("switch", { name: "Interactive" }));
    expect(props.onUpdateParams).toHaveBeenCalledWith("shader-el-1", { mood: "Kelp", interactive: false });
  });

  it("shows a Custom preset option when no preset matches the params", async () => {
    renderEditor({ element: element({ params: { mood: "NotAMood" } }) });
    const preset = (await screen.findByTestId("shader-preset-select")) as HTMLSelectElement;
    expect(preset.value).toBe("");
    expect(preset.querySelector("option[value='']")?.textContent).toBe("Custom");
  });

  it("resets to the default preset", async () => {
    const { props } = renderEditor({ element: element({ params: { mood: "Magma", interactive: false } }) });
    await screen.findByTestId("shader-editor-shader-el-1");
    fireEvent.click(screen.getByRole("button", { name: /Reset to defaults/ }));
    expect(props.onUpdateParams).toHaveBeenCalledWith("shader-el-1", { mood: "Abyss", interactive: true });
  });
});

describe("ShaderParamsEditor mesh-gradient", () => {
  const mesh = (params?: CanvasShaderElement["params"]) =>
    element({ shaderId: "mesh-gradient", params });

  it("commits a slider change as a number merged over preset defaults", async () => {
    const onUpdateParams = vi.fn();
    renderEditor({ element: mesh(), onUpdateParams });
    fireEvent.change(await screen.findByLabelText("Distortion slider"), { target: { value: "0.4" } });
    expect(onUpdateParams).toHaveBeenCalledWith(
      "shader-el-1",
      expect.objectContaining({ distortion: 0.4 }),
    );
  });

  it("preserves hex alpha when re-picking a palette color", async () => {
    const onUpdateParams = vi.fn();
    renderEditor({ element: mesh({ colors: ["#11223344", "#55667788"] }), onUpdateParams });
    await screen.findByTestId("shader-param-colors");

    fireEvent.click(screen.getByLabelText("Colors 1"));
    fireEvent.click(screen.getByTestId("color-option-#e5484d"));

    expect(onUpdateParams).toHaveBeenCalledWith(
      "shader-el-1",
      expect.objectContaining({ colors: ["#e5484d44", "#55667788"] }),
    );
  });

  it("removes and adds color stops, never below one", async () => {
    const onUpdateParams = vi.fn();
    renderEditor({ element: mesh({ colors: ["#111111", "#222222"] }), onUpdateParams });
    await screen.findByTestId("shader-param-colors");

    fireEvent.click(screen.getByLabelText("Remove Colors 2"));
    expect(onUpdateParams).toHaveBeenCalledWith(
      "shader-el-1",
      expect.objectContaining({ colors: ["#111111"] }),
    );

    onUpdateParams.mockClear();
    fireEvent.click(screen.getByLabelText("Add Colors"));
    expect(onUpdateParams).toHaveBeenCalledWith(
      "shader-el-1",
      expect.objectContaining({ colors: ["#111111", "#222222", "#222222"] }),
    );
  });

  it("keeps a single-stop palette free of remove buttons", async () => {
    renderEditor({ element: mesh({ colors: ["#111111"] }) });
    await screen.findByTestId("shader-param-colors");
    expect(screen.queryByLabelText("Remove Colors 1")).toBeNull();
  });
});

describe("ShaderParamsEditor image param", () => {
  it("drops the image key when the field is cleared", async () => {
    const onUpdateParams = vi.fn();
    renderEditor({
      element: element({ shaderId: "water", params: { image: "data:image/png;base64,xx" } }),
      onUpdateParams,
    });
    const input = (await screen.findByLabelText("Image")) as HTMLInputElement;
    expect(input.value).toBe("data:image/png;base64,xx");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onUpdateParams).toHaveBeenCalledTimes(1);
    const params = onUpdateParams.mock.calls[0]![1] as Record<string, unknown>;
    expect("image" in params).toBe(false);
  });
});
