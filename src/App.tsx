import { CanvasSurface } from "./canvas/CanvasSurface";
import { ShaderThumbCapture } from "./components/ShaderThumbCapture";
import { initialFrames } from "./demo/documents";

export function App() {
  const params = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : null;
  const shaderThumb = params?.get("shader-thumb");
  if (shaderThumb != null) {
    return <ShaderThumbCapture id={shaderThumb} />;
  }
  const demoMode = params?.get("demo") === "1";
  return <CanvasSurface frames={demoMode ? initialFrames : undefined} />;
}
