import { memo, useEffect, useRef, type ComponentType } from "react";
import { collectShaderCanvases, releaseShaderContexts } from "../shaders/webgl-release";

interface SafeShaderMountProps {
  component: ComponentType<{ width?: string; height?: string }>;
  className: string;
}

/**
 * Mounts a Paper Shader and guarantees its WebGL contexts are force-released
 * when the mount goes away, so the browser's per-page context budget is never
 * exhausted by preview churn (see webgl-release.ts).
 */
export const SafeShaderMount = memo(function SafeShaderMount({ component: Component, className }: SafeShaderMountProps) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasesRef = useRef<Set<HTMLCanvasElement>>(new Set());

  // Track after every commit (no dep array): the shader canvas is created
  // asynchronously by the library, which also re-renders once initialized.
  useEffect(() => {
    collectShaderCanvases(holderRef.current, canvasesRef.current);
  });

  useEffect(() => {
    const canvases = canvasesRef.current;
    return () => releaseShaderContexts(canvases);
  }, []);

  return (
    <div className={className} ref={holderRef}>
      <Component width="100%" height="100%" />
    </div>
  );
});
