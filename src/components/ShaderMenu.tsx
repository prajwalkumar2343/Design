import { Component, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import { SafeShaderMount } from "./SafeShaderMount";
import {
  CUSTOM_SHADER_DEFINITIONS,
  PAPER_SHADER_DEFINITIONS,
  detectPaperShaderSupport,
  loadPaperShader,
  type ShaderId,
} from "../shaders";

type ShaderEntry = readonly [ShaderId, { readonly label: string }];

const SHADER_ENTRIES: readonly ShaderEntry[] = [
  ...(Object.entries(PAPER_SHADER_DEFINITIONS) as unknown as readonly ShaderEntry[]),
  ...(Object.entries(CUSTOM_SHADER_DEFINITIONS) as unknown as readonly ShaderEntry[]),
];

/** UI-only curation of the flat registry into browsable gallery sections. */
const SHADER_CATEGORIES: readonly { readonly id: string; readonly label: string; readonly shaderIds: readonly ShaderId[] }[] = [
  {
    id: "gradients",
    label: "Gradients",
    shaderIds: ["mesh-gradient", "grain-gradient", "static-mesh-gradient", "static-radial-gradient", "color-panels", "heatmap"],
  },
  {
    id: "noise",
    label: "Noise",
    shaderIds: ["neuro-noise", "simplex-noise", "perlin-noise", "warp", "metaballs"],
  },
  {
    id: "patterns",
    label: "Patterns",
    shaderIds: ["dot-orbit", "dot-grid", "halftone-dots", "halftone-cmyk", "voronoi", "spiral", "swirl", "dithering"],
  },
  {
    id: "motion-light",
    label: "Motion & Light",
    shaderIds: ["smoke-ring", "god-rays", "waves", "water", "pulsing-border", "gem-smoke", "liquid-metal"],
  },
  {
    id: "texture-glass",
    label: "Texture & Glass",
    shaderIds: ["paper-texture", "fluted-glass", "lens-distortion", "image-dithering"],
  },
  {
    id: "custom",
    label: "Custom",
    shaderIds: ["ferro-tide"],
  },
];

interface ShaderSectionModel {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly ShaderEntry[];
}

const ENTRY_BY_ID = new Map<string, ShaderEntry>(SHADER_ENTRIES.map((entry) => [entry[0], entry]));

/** Contains shader runtime failures (e.g. lost WebGL contexts) to one card. */
class ShaderPreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return <span className="shader-preview-fallback" aria-hidden="true" />;
    }
    return this.props.children;
  }
}

/** Mounts a real Paper Shader only while visible — WebGL contexts are scarce. */
function LiveShaderPreview({ shaderId }: { shaderId: ShaderId }) {
  const [ShaderComponent, setShaderComponent] = useState<ComponentType<{ width?: string; height?: string }> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setShaderComponent(null);
    setFailed(false);
    loadPaperShader(shaderId)
      .then((loaded) => {
        if (!alive) return;
        if (detectPaperShaderSupport().supported) {
          setShaderComponent(() => loaded.Component as ComponentType<{ width?: string; height?: string }>);
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
  if (!ShaderComponent) return <span className="shader-preview-loading" aria-hidden="true" />;
  return (
    <ShaderPreviewBoundary>
      <SafeShaderMount className="shader-preview-mount" component={ShaderComponent} />
    </ShaderPreviewBoundary>
  );
}

/** Defers mounting previews until their card scrolls into the menu viewport. */
function ShaderCardPreview({ shaderId }: { shaderId: ShaderId }) {
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
      { root: node.closest(".shader-menu-body"), rootMargin: "120px", threshold: 0.05 },
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

interface ShaderCardProps {
  entry: ShaderEntry;
  onAddShader: (shaderId: ShaderId) => void;
}

function ShaderCard({ entry, onAddShader }: ShaderCardProps) {
  const [shaderId, definition] = entry;
  return (
    <button
      className="shader-card"
      data-testid={`shader-card-${shaderId}`}
      onClick={() => onAddShader(shaderId)}
      role="menuitem"
      title={`Add ${definition.label}`}
      type="button"
    >
      <ShaderCardPreview shaderId={shaderId} />
      <span className="shader-card-caption">
        <span className="shader-card-name">{definition.label}</span>
        <span className="shader-card-plus" aria-hidden="true"><Plus size={11} strokeWidth={2.2} /></span>
      </span>
    </button>
  );
}

interface ShaderMenuProps {
  onAddShader: (shaderId: ShaderId) => void;
  onClose: () => void;
}

export function ShaderMenu({ onAddShader, onClose }: ShaderMenuProps) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Autofocus the filter field so typing narrows the gallery immediately.
    searchRef.current?.focus();
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const sections = useMemo<ShaderSectionModel[]>(() => {
    const matches = (label: string) => normalizedQuery === "" || label.toLowerCase().includes(normalizedQuery);
    const collect = (shaderIds: readonly ShaderId[]) =>
      shaderIds
        .map((shaderId) => ENTRY_BY_ID.get(shaderId))
        .filter((entry): entry is ShaderEntry => entry !== undefined && matches(entry[1].label));
    if (categoryId !== "all") {
      const category = SHADER_CATEGORIES.find((candidate) => candidate.id === categoryId);
      if (!category) return [];
      return [{ id: category.id, label: category.label, entries: collect(category.shaderIds) }];
    }
    return SHADER_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      entries: collect(category.shaderIds),
    })).filter((section) => section.entries.length > 0);
  }, [categoryId, normalizedQuery]);

  const visibleCount = sections.reduce((count, section) => count + section.entries.length, 0);

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="shader-menu" data-testid="shader-menu" role="menu" aria-label="Shader gallery">
      <div className="shader-menu-header">
        <div>
          <strong>Shader library</strong>
          <span>{SHADER_ENTRIES.length} animated backgrounds · click to place</span>
        </div>
        <kbd>S</kbd>
      </div>

      <div className="shader-menu-toolbar">
        <label className="shader-menu-search">
          <Search size={13} strokeWidth={1.8} aria-hidden="true" />
          <input
            aria-label="Search shaders"
            autoComplete="off"
            data-testid="shader-search-input"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search shaders…"
            ref={searchRef}
            spellCheck={false}
            type="text"
            value={query}
          />
        </label>
        <div aria-label="Filter by category" className="shader-menu-filters" role="group">
          <button
            aria-pressed={categoryId === "all"}
            className={`shader-chip${categoryId === "all" ? " is-active" : ""}`}
            data-testid="shader-filter-all"
            onClick={() => setCategoryId("all")}
            type="button"
          >
            All
          </button>
          {SHADER_CATEGORIES.map((category) => (
            <button
              aria-pressed={categoryId === category.id}
              className={`shader-chip${categoryId === category.id ? " is-active" : ""}`}
              data-testid={`shader-filter-${category.id}`}
              key={category.id}
              onClick={() => setCategoryId(category.id)}
              type="button"
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="shader-menu-body">
        {visibleCount === 0 ? (
          <div className="shader-menu-empty" data-testid="shader-menu-empty">
            <strong>No shaders match “{query.trim()}”</strong>
            <span>Try a different name or pick another category.</span>
          </div>
        ) : (
          sections.map((section) => (
            <section className="shader-menu-section" key={section.id}>
              <div className="shader-menu-group-label">
                {section.label}
                <small>{section.entries.length}</small>
              </div>
              <div className="shader-menu-grid">
                {section.entries.map((entry) => (
                  <ShaderCard entry={entry} key={entry[0]} onAddShader={onAddShader} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
