/**
 * Paper Shaders disposes its render loop, program, and textures on unmount,
 * but never force-loses the underlying WebGL context. Browsers cap live
 * contexts per page (~16), so rapidly mounting shader previews or deleting
 * shader elements eventually evicts older, still-visible shader canvases
 * ("Too many active WebGL contexts"). Holding references to the mounted
 * canvases and calling `WEBGL_lose_context.loseContext()` on teardown hands
 * those slots back to the browser immediately.
 */

export function collectShaderCanvases(root: ParentNode | null, into: Set<HTMLCanvasElement>): void {
  if (!root) return;
  for (const canvas of Array.from(root.querySelectorAll("canvas"))) {
    into.add(canvas);
  }
}

export function releaseShaderContexts(canvases: Iterable<HTMLCanvasElement>): void {
  for (const canvas of canvases) {
    try {
      if (canvas.getContext("2d") !== null) continue;
      const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) continue;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // Non-GL canvas (or no GL support): nothing to release.
    }
  }
}
