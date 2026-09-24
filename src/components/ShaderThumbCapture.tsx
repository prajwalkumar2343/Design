import { useEffect, useState, type ComponentType } from "react";
import { SafeShaderMount } from "./SafeShaderMount";
import { SHADER_IDS, getShaderMountProps, isShaderId, loadPaperShader, type ShaderId } from "../shaders";

/** Matches the gallery card aspect (16:10) at 2x density for retina displays. */
const THUMB_SIZE = { width: 384, height: 240 } as const;

/**
 * Capture surface for scripts/capture-shader-thumbs.mjs. `?shader-thumb=index`
 * lists every registered shader id; `?shader-thumb=<id>` mounts just that
 * shader in a fixed-size box so Playwright can screenshot a real render — one
 * WebGL context per page, so the browser's budget is never stressed.
 */
export function ShaderThumbCapture({ id }: { id: string }) {
  if (id === "" || id === "index") {
    return (
      <ul data-testid="shader-thumb-index">
        {SHADER_IDS.map((shaderId) => (
          <li data-shader-id={shaderId} key={shaderId} />
        ))}
      </ul>
    );
  }
  if (!isShaderId(id)) {
    return <p data-testid="shader-thumb-unknown">Unknown shader: {id}</p>;
  }
  return <ShaderThumbStage shaderId={id} />;
}

function ShaderThumbStage({ shaderId }: { shaderId: ShaderId }) {
  const [Component, setComponent] = useState<ComponentType<{ width?: string; height?: string }> | null>(null);

  useEffect(() => {
    let alive = true;
    loadPaperShader(shaderId)
      .then((loaded) => {
        if (alive) {
          setComponent(() => loaded.Component as ComponentType<{ width?: string; height?: string }>);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [shaderId]);

  return (
    <div
      data-shader-id={shaderId}
      data-testid="shader-thumb-target"
      style={{
        width: THUMB_SIZE.width,
        height: THUMB_SIZE.height,
        position: "relative",
        overflow: "hidden",
        background: "#000",
      }}
    >
      {Component ? (
        <SafeShaderMount
          className="shader-thumb-stage"
          component={Component}
          componentProps={getShaderMountProps(shaderId)}
        />
      ) : null}
    </div>
  );
}
