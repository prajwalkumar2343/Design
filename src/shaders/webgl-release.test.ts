import { describe, expect, it, vi } from "vitest";
import { collectShaderCanvases, releaseShaderContexts } from "./webgl-release";

function fakeCanvas(withContext: unknown) {
  return {
    getContext: vi.fn(() => withContext),
  } as unknown as HTMLCanvasElement;
}

describe("shader webgl context release", () => {
  it("force-loses webgl2 contexts via WEBGL_lose_context", () => {
    const loseContext = vi.fn();
    const gl = { getExtension: vi.fn(() => ({ loseContext })) };
    const canvas = fakeCanvas(gl);

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

  it("tolerates canvases without any GL context or extension", () => {
    const plain = fakeCanvas(null);
    const noExtension = fakeCanvas({ getExtension: () => null });
    const throwing = {
      getContext: () => {
        throw new Error("not implemented");
      },
    } as unknown as HTMLCanvasElement;

    expect(() => releaseShaderContexts([plain, noExtension, throwing])).not.toThrow();
  });

  it("collects canvases nested under a root node", () => {
    const first = fakeCanvas(null);
    const second = fakeCanvas(null);
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
