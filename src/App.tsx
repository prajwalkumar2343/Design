import { CanvasSurface } from "./canvas/CanvasSurface";
import { initialFrames } from "./demo/documents";

export function App() {
  const demoMode = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("demo") === "1";
  return <CanvasSurface frames={demoMode ? initialFrames : undefined} />;
}
