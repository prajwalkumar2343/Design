import { useCallback, useEffect, useState } from "react";
import {
  UnsupportedPaperShaderError,
  detectPaperShaderSupport,
  isPaperShaderId,
  loadPaperShader,
  type LoadedCustomShader,
  type LoadedPaperShader,
  type ShaderId,
} from "../shaders";

export type LoadedShader = LoadedPaperShader | LoadedCustomShader;

export type ShaderFailureKind = "unsupported" | "unknown" | "load-error";

export interface LoadedShaderState {
  /** Resolved module payload once the shader module has loaded. */
  shader: LoadedShader | null;
  /** Why the shader can't mount; null while loading or once ready. */
  failure: ShaderFailureKind | null;
  /** Re-runs the probe/load cycle — e.g. after a transient chunk failure. */
  retry: () => void;
  /** Number of load cycles started; lets callers reset crash boundaries. */
  attempt: number;
}

export interface UseLoadedShaderOptions {
  /**
   * Paper shaders gate on the WebGL2 probe before their chunk is fetched.
   * Consumers that never mount GL (the params editor only reads preset
   * metadata) pass false so controls stay usable on unsupported browsers.
   */
  checkSupport?: boolean;
}

/**
 * Shared loader for every shader surface (canvas element, menu preview,
 * thumbnail capture, params editor). Paper shaders gate on the WebGL2 probe
 * before the chunk is fetched so unsupported browsers skip the download;
 * custom shaders own their fallback. Failures are classified so the UI can
 * tell a stale chunk (retryable) from an unknown id (permanent).
 */
export function useLoadedShader(
  shaderId: ShaderId,
  options: UseLoadedShaderOptions = {},
): LoadedShaderState {
  const { checkSupport = true } = options;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    shader: LoadedShader | null;
    failure: ShaderFailureKind | null;
  }>({ shader: null, failure: null });

  useEffect(() => {
    let alive = true;
    setState({ shader: null, failure: null });

    if (checkSupport && isPaperShaderId(shaderId) && !detectPaperShaderSupport().supported) {
      setState({ shader: null, failure: "unsupported" });
      return () => {
        alive = false;
      };
    }

    loadPaperShader(shaderId)
      .then((loaded) => {
        if (alive) setState({ shader: loaded, failure: null });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        console.warn(`Shader "${shaderId}" failed to load`, error);
        setState({
          shader: null,
          failure:
            error instanceof UnsupportedPaperShaderError ? "unknown" : "load-error",
        });
      });

    return () => {
      alive = false;
    };
  }, [shaderId, attempt, checkSupport]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { ...state, retry, attempt };
}
