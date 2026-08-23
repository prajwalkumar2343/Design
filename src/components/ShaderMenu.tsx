import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  PAPER_SHADER_DEFINITIONS,
  detectPaperShaderSupport,
  loadPaperShader,
  type PaperShaderId,
} from "../shaders";

type ShaderEntry = readonly [PaperShaderId, (typeof PAPER_SHADER_DEFINITIONS)[PaperShaderId]];

const SHADER_ENTRIES: readonly ShaderEntry[] =
  Object.entries(PAPER_SHADER_DEFINITIONS) as unknown as readonly ShaderEntry[];

/** Mounts a real Paper Shader only while visible — WebGL contexts are scarce. */
function LiveShaderPreview({ shaderId }: { shaderId: PaperShaderId }) {
  const [Component, setComponent] = useState<ComponentType<{ width?: string; height?: string }> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setComponent(null);
    setFailed(false);
    loadPaperShader(shaderId)
      .then((loaded) => {
        if (!alive) return;
        if (detectPaperShaderSupport().supported) {
          setComponent(loaded.Component as ComponentType<{ width?: string; height?: string }>);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [shaderId]);

  if (failed) return <span className="shader-preview-fallback" aria-hidden="true" />;
  if (!Component) return <span className="shader-preview-loading" aria-hidden="true" />;
  return (
    <div className="shader-preview-mount">
      <Component width="100%" height="100%" />
    </div>
  );
}

/** Defers mounting previews until their card scrolls into the menu viewport. */
function ShaderCardPreview({ shaderId }: { shaderId: PaperShaderId }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = holderRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setIsVisible(entries.some((entry) => entry.isIntersecting)),
      { root: node.closest(".shader-menu"), rootMargin: "80px", threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="shader-card-preview" ref={holderRef} aria-hidden="true">
      {isVisible ? <LiveShaderPreview shaderId={shaderId} /> : null}
    </div>
  );
}

interface ShaderMenuProps {
  onAddShader: (shaderId: PaperShaderId) => void;
}

export function ShaderMenu({ onAddShader }: ShaderMenuProps) {
  return (
    <div className="shader-menu" data-testid="shader-menu" role="menu" aria-label="Shader gallery">
      <div className="frame-menu-heading">
        <div>
          <strong>Add shader</strong>
          <span>{SHADER_ENTRIES.length} animated backgrounds · click to place</span>
        </div>
        <kbd>S</kbd>
      </div>
      <div className="shader-menu-grid">
        {SHADER_ENTRIES.map(([shaderId, definition]) => (
          <button
            className="shader-card"
            data-testid={`shader-card-${shaderId}`}
            key={shaderId}
            onClick={() => onAddShader(shaderId)}
            role="menuitem"
            title={`Add ${definition.label}`}
            type="button"
          >
            <ShaderCardPreview shaderId={shaderId} />
            <span>{definition.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
