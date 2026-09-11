import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeShaderMount } from "./SafeShaderMount";

function fakeCanvas(label: string): HTMLCanvasElement {
  const loseContext = vi.fn();
  const canvas = document.createElement("canvas");
  canvas.dataset.probe = label;
  canvas.getContext = vi.fn(() => ({
    getExtension: vi.fn(() => ({ loseContext })),
  })) as unknown as HTMLCanvasElement["getContext"];
  (canvas as HTMLCanvasElement & { __loseContext: typeof loseContext }).__loseContext = loseContext;
  return canvas;
}

function ShaderStub({ canvases }: { canvases: HTMLCanvasElement[] }) {
  return (
    <>
      {canvases.map((canvas) => {
        const holder = document.createElement("div");
        holder.appendChild(canvas);
        return (
          <div
            key={canvas.dataset.probe}
            ref={(node) => {
              node?.appendChild(canvas);
            }}
          />
        );
      })}
    </>
  );
}

afterEach(cleanup);

describe("SafeShaderMount", () => {
  it("force-loses collected shader contexts when it unmounts", () => {
    const canvas = fakeCanvas("single");
    const { unmount } = render(
      <SafeShaderMount className="mount" component={() => <ShaderStub canvases={[canvas]} />} />,
    );
    expect(document.querySelector('[data-probe="single"]')).toBeTruthy();

    unmount();

    expect((canvas as HTMLCanvasElement & { __loseContext: () => unknown }).__loseContext).toHaveBeenCalledTimes(1);
    expect(canvas.getContext).toHaveBeenCalledWith("webgl2");
  });

  it("re-collects canvases after the shader library re-renders, releasing all of them at once", () => {
    const first = fakeCanvas("first");
    const { rerender, unmount } = render(
      <SafeShaderMount className="mount" component={() => <ShaderStub canvases={[first]} />} />,
    );
    const second = fakeCanvas("second");
    // Paper Shaders creates its canvas asynchronously and re-renders once
    // initialized; the mount must keep tracking without any prop change.
    rerender(<SafeShaderMount className="mount" component={() => <ShaderStub canvases={[first, second]} />} />);

    unmount();

    expect((first as HTMLCanvasElement & { __loseContext: () => unknown }).__loseContext).toHaveBeenCalledTimes(1);
    expect((second as HTMLCanvasElement & { __loseContext: () => unknown }).__loseContext).toHaveBeenCalledTimes(1);
  });
});
