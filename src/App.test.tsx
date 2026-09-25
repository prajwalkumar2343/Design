import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { canvasSpy, thumbSpy } = vi.hoisted(() => ({
  canvasSpy: vi.fn(),
  thumbSpy: vi.fn(),
}));

vi.mock("./canvas/CanvasSurface", () => ({
  CanvasSurface: (props: { frames?: unknown }) => {
    canvasSpy(props);
    return <div data-testid="canvas-surface" />;
  },
}));

vi.mock("./components/ShaderThumbCapture", () => ({
  ShaderThumbCapture: (props: { id: string }) => {
    thumbSpy(props);
    return <div data-testid="shader-thumb" />;
  },
}));

vi.mock("./demo/documents", () => ({
  initialFrames: [{ id: "demo-frame", name: "Demo" }],
}));

import { App } from "./App";
import { initialFrames } from "./demo/documents";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  canvasSpy.mockClear();
  thumbSpy.mockClear();
});

describe("App", () => {
  it("renders the canvas surface without demo frames by default", () => {
    window.history.replaceState(null, "", "/");
    render(<App />);

    expect(screen.getByTestId("canvas-surface")).toBeTruthy();
    expect(canvasSpy).toHaveBeenCalledTimes(1);
    expect(canvasSpy.mock.calls[0][0].frames).toBeUndefined();
    expect(thumbSpy).not.toHaveBeenCalled();
  });

  it("passes the demo frame seeds only when ?demo=1", () => {
    window.history.replaceState(null, "", "/?demo=1");
    render(<App />);

    expect(canvasSpy.mock.calls[0][0].frames).toBe(initialFrames);
  });

  it("ignores other demo values", () => {
    window.history.replaceState(null, "", "/?demo=0");
    render(<App />);

    expect(canvasSpy.mock.calls[0][0].frames).toBeUndefined();
  });

  it("renders the shader thumbnail capture with the requested id", () => {
    window.history.replaceState(null, "", "/?shader-thumb=ferro-tide");
    render(<App />);

    expect(screen.getByTestId("shader-thumb")).toBeTruthy();
    expect(thumbSpy).toHaveBeenCalledWith({ id: "ferro-tide" });
    expect(canvasSpy).not.toHaveBeenCalled();
  });

  it("treats a bare ?shader-thumb param as a present id and wins over demo", () => {
    window.history.replaceState(null, "", "/?demo=1&shader-thumb");
    render(<App />);

    expect(thumbSpy).toHaveBeenCalledWith({ id: "" });
    expect(canvasSpy).not.toHaveBeenCalled();
  });
});
