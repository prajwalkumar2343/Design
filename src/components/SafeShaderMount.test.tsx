import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { SafeShaderMount } from "./SafeShaderMount";

function fakeCanvas(label: string): HTMLCanvasElement {
  const loseContext = vi.fn();
  const canvas = document.createElement("canvas");
  canvas.dataset.probe = label;
  canvas.getContext = vi.fn((type: string) =>
    type === "2d" ? null : { getExtension: vi.fn(() => ({ loseContext })) },
  ) as unknown as HTMLCanvasElement["getContext"];
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

  it("remounts the shader once a lost context is restored", async () => {
    const canvas = fakeCanvas("lost-then-restored");
    let mounts = 0;
    function CountedShader() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <ShaderStub canvases={[canvas]} />;
    }
    render(<SafeShaderMount className="mount" component={CountedShader} />);
    expect(mounts).toBe(1);

    const lost = new Event("webglcontextlost", { cancelable: true });
    await act(async () => {
      canvas.dispatchEvent(lost);
    });
    expect(lost.defaultPrevented).toBe(true);
    await act(async () => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });

    await waitFor(() => expect(mounts).toBe(2));
  });

  it("remounts after a grace period when a lost context is never restored", async () => {
    vi.useFakeTimers();
    try {
      const canvas = fakeCanvas("lost-forever");
      let mounts = 0;
      function CountedShader() {
        useEffect(() => {
          mounts += 1;
        }, []);
        return <ShaderStub canvases={[canvas]} />;
      }
      render(<SafeShaderMount className="mount" component={CountedShader} />);
      expect(mounts).toBe(1);

      await act(async () => {
        canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      });
      expect(mounts).toBe(1);

      await act(async () => {
        vi.advanceTimersByTime(2500);
      });
      expect(mounts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
