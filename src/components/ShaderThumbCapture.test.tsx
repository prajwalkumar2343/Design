import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SHADER_IDS } from "../shaders";
import { ShaderThumbCapture } from "./ShaderThumbCapture";

describe("ShaderThumbCapture", () => {
  it("lists every registered shader id for the index route", () => {
    render(<ShaderThumbCapture id="" />);
    const items = screen.getByTestId("shader-thumb-index").querySelectorAll("li");
    expect(items).toHaveLength(SHADER_IDS.length);
    expect(screen.getByTestId("shader-thumb-index").querySelector('[data-shader-id="ferro-tide"]')).toBeTruthy();
    expect(screen.getByTestId("shader-thumb-index").querySelector('[data-shader-id="mesh-gradient"]')).toBeTruthy();
  });

  it("treats 'index' the same as an empty id", () => {
    render(<ShaderThumbCapture id="index" />);
    expect(screen.getByTestId("shader-thumb-index").querySelectorAll("li")).toHaveLength(SHADER_IDS.length);
  });

  it("reports unknown shader ids instead of mounting a stage", () => {
    render(<ShaderThumbCapture id="nonsense" />);
    expect(screen.getByTestId("shader-thumb-unknown").textContent).toBe("Unknown shader: nonsense");
    expect(screen.queryByTestId("shader-thumb-target")).toBeNull();
  });

  it("mounts the named shader in a fixed-size stage", async () => {
    render(<ShaderThumbCapture id="ferro-tide" />);
    const stage = screen.getByTestId("shader-thumb-target") as HTMLElement;
    expect(stage.getAttribute("data-shader-id")).toBe("ferro-tide");
    expect(stage.style.width).toBe("384px");
    expect(stage.style.height).toBe("240px");
    expect(stage.style.overflow).toBe("hidden");

    // The shader module loads async; in jsdom (no WebGL2) Ferro Tide mounts
    // through SafeShaderMount and degrades to its own fallback surface.
    const mount = await screen.findByTestId("ferro-tide-fallback");
    expect(mount.closest(".shader-thumb-stage")).not.toBeNull();
  });
});
