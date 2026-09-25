import { describe, expect, it, vi } from "vitest";
import { collectShaderCanvases, releaseShaderContexts } from "./webgl-release";

function glCanvas(withContext: unknown) {
  return {
    getContext: vi.fn((type: string) => (type === "2d" ? null : withContext)),
  } as unknown as HTMLCanvasElement;
}

describe("shader webgl context release", () => {
  it("force-loses webgl2 contexts via WEBGL_lose_context", () => {
    const loseContext = vi.fn();
    const gl = { getExtension: vi.fn(() => ({ loseContext })) };
    const canvas = glCanvas(gl);

    releaseShaderContexts([canvas]);

    expect(canvas.getContext).toHaveBeenCalledWith("webgl2");
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("falls back to webgl1 when webgl2 is unavailable", () => {
    const loseContext = vi.fn();
    const gl = { getExtension: vi.fn(() => ({ loseContext })) };
    const canvas = {
      getContext: vi.fn((type: string) => (type === "webgl" ? gl : null)),
    } as unknown as HTMLCanvasElement;

    releaseShaderContexts([canvas]);

    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("never creates a GL context on canvases that never had one", () => {
    const canvas = {
      getContext: vi.fn((type: string) => (type === "2d" ? {} : null)),
    } as unknown as HTMLCanvasElement;

    releaseShaderContexts([canvas]);

    expect(canvas.getContext).toHaveBeenCalledTimes(1);
    expect(canvas.getContext).not.toHaveBeenCalledWith("webgl2");
    expect(canvas.getContext).not.toHaveBeenCalledWith("webgl");
  });

  it("tolerates canvases without any GL context or extension", () => {
    const plain = glCanvas(null);
    const noExtension = glCanvas({ getExtension: () => null });
    const throwing = {
      getContext: () => {
        throw new Error("not implemented");
      },
    } as unknown as HTMLCanvasElement;

    expect(() => releaseShaderContexts([plain, noExtension, throwing])).not.toThrow();
  });

  it("collects canvases nested under a root node", () => {
    const first = glCanvas(null);
    const second = glCanvas(null);
    const root = {
      querySelectorAll: () => [first, second],
    } as unknown as ParentNode;

    const collected = new Set<HTMLCanvasElement>();
    collectShaderCanvases(root, collected);
    collectShaderCanvases(root, collected);
    collectShaderCanvases(null, collected);

    expect(collected.size).toBe(2);
  });
});
