import { memo, useEffect, useRef, useState, type ComponentType } from "react";
import { collectShaderCanvases, releaseShaderContexts } from "../shaders/webgl-release";

interface SafeShaderMountProps {
  component: ComponentType<{ width?: string; height?: string }>;
  className: string;
  /** Extra props for the shader component (e.g. a filter's sample image). */
  componentProps?: Record<string, unknown>;
}

/** Remounts after context loss are capped so an eviction storm can't ping-pong. */
const CONTEXT_REMOUNT_LIMIT = 4;
/** Grace period for the browser to auto-restore a lost context before remounting. */
const CONTEXT_RESTORE_GRACE_MS = 2000;

/**
 * Mounts a Paper Shader and guarantees its WebGL contexts are force-released
 * when the mount goes away, so the browser's per-page context budget is never
 * exhausted by preview churn (see webgl-release.ts).
 *
 * Browsers also evict live contexts once the budget is exceeded — the oldest
 * shader on the canvas silently freezes. Each tracked canvas carries
 * webglcontextlost/restored listeners: a lost context opts into restore
 * (preventDefault), and the shader remounts on a fresh canvas once the
 * context comes back — or after a grace period when it never will.
 */
export const SafeShaderMount = memo(function SafeShaderMount({ component: Component, className, componentProps }: SafeShaderMountProps) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasesRef = useRef<Set<HTMLCanvasElement>>(new Set());
  const listenersRef = useRef(new Map<HTMLCanvasElement, { lost: (event: Event) => void; restored: () => void }>());
  const remountTimerRef = useRef(0);
  const remountsRef = useRef(0);
  const disposedRef = useRef(false);
  const [remountKey, setRemountKey] = useState(0);

  const scheduleRemount = (delay: number) => {
    if (disposedRef.current) return;
    window.clearTimeout(remountTimerRef.current);
    remountTimerRef.current = window.setTimeout(() => {
      if (disposedRef.current || remountsRef.current >= CONTEXT_REMOUNT_LIMIT) return;
      remountsRef.current += 1;
      setRemountKey((key) => key + 1);
    }, delay);
  };

  // Track after every commit (no dep array): the shader canvas is created
  // asynchronously by the library, which also re-renders once initialized.
  useEffect(() => {
    collectShaderCanvases(holderRef.current, canvasesRef.current);
    for (const canvas of canvasesRef.current) {
      if (canvas.isConnected) continue;
      const listeners = listenersRef.current.get(canvas);
      if (listeners) {
        canvas.removeEventListener("webglcontextlost", listeners.lost);
        canvas.removeEventListener("webglcontextrestored", listeners.restored);
        listenersRef.current.delete(canvas);
      }
      canvasesRef.current.delete(canvas);
      releaseShaderContexts([canvas]);
    }
    for (const canvas of canvasesRef.current) {
      if (listenersRef.current.has(canvas)) continue;
      const lost = (event: Event) => {
        event.preventDefault();
        scheduleRemount(CONTEXT_RESTORE_GRACE_MS);
      };
      const restored = () => scheduleRemount(0);
      canvas.addEventListener("webglcontextlost", lost);
      canvas.addEventListener("webglcontextrestored", restored);
      listenersRef.current.set(canvas, { lost, restored });
    }
  });

  // A different shader component gets a fresh remount budget.
  useEffect(() => {
    remountsRef.current = 0;
  }, [Component]);

  useEffect(() => {
    const canvases = canvasesRef.current;
    const listeners = listenersRef.current;
    return () => {
      disposedRef.current = true;
      window.clearTimeout(remountTimerRef.current);
      for (const [canvas, pair] of listeners) {
        canvas.removeEventListener("webglcontextlost", pair.lost);
        canvas.removeEventListener("webglcontextrestored", pair.restored);
      }
      listeners.clear();
      releaseShaderContexts(canvases);
    };
  }, []);

  return (
    <div aria-hidden="true" className={className} ref={holderRef}>
      <Component key={remountKey} width="100%" height="100%" {...componentProps} />
    </div>
  );
});
