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

/**
 * Zero-GPU thumbnails for the gallery — a full menu of live previews can
 * exhaust the browser's WebGL context budget. Each is a CSS stand-in in the
 * shader's palette; hovering or focusing a card mounts the real preview.
 */
const SHADER_THUMBS: Record<ShaderId, string> = {
  "mesh-gradient": "radial-gradient(at 18% 25%, #6f6cf5 0%, transparent 55%), radial-gradient(at 82% 18%, #f06a9b 0%, transparent 50%), radial-gradient(at 55% 88%, #f5b86c 0%, transparent 55%), linear-gradient(140deg, #2a2740, #1c1a30)",
  "grain-gradient": "radial-gradient(at 25% 30%, #f5a86c 0%, transparent 60%), radial-gradient(at 75% 75%, #e05a7a 0%, transparent 55%), linear-gradient(135deg, #3a2430, #241a26)",
  "static-mesh-gradient": "radial-gradient(at 70% 20%, #5cc8f0 0%, transparent 55%), radial-gradient(at 20% 80%, #8a7bf5 0%, transparent 55%), linear-gradient(150deg, #20223a, #161628)",
  "static-radial-gradient": "radial-gradient(circle at 50% 45%, #f0d98c 0%, #e08a5a 45%, #4a2c3a 100%)",
  "color-panels": "linear-gradient(90deg, #e05a5a 0 33%, #f0c05a 33% 66%, #5a8ae0 66% 100%)",
  heatmap: "radial-gradient(circle at 30% 60%, #f5d23c 0%, transparent 45%), radial-gradient(circle at 68% 35%, #f05a2a 0%, transparent 45%), radial-gradient(circle at 50% 80%, #b02418 0%, transparent 40%), #20101a",
  "neuro-noise": "radial-gradient(at 30% 40%, #7b5cf0 0%, transparent 55%), radial-gradient(at 70% 65%, #4a3a9b 0%, transparent 60%), #241d3d",
  "simplex-noise": "linear-gradient(135deg, #3a3d46 0%, #6a6f7c 50%, #2a2d36 100%)",
  "perlin-noise": "linear-gradient(135deg, #1f4d3f 0%, #3d8a6a 50%, #16352c 100%)",
  warp: "conic-gradient(from 200deg at 50% 50%, #2a3f8f, #5a7bf0, #2a3f8f, #1a2a66)",
  metaballs: "radial-gradient(circle at 30% 35%, #8a5cf0 0%, transparent 32%), radial-gradient(circle at 68% 60%, #6a3ad0 0%, transparent 30%), radial-gradient(circle at 45% 75%, #4a2aa0 0%, transparent 28%), #1c1330",
  "dot-orbit": "radial-gradient(circle at 50% 50%, #f0f0f5 0%, transparent 30%), radial-gradient(circle, #3a3f52 1.4px, transparent 1.5px) 0 0 / 14px 14px, #171a26",
  "dot-grid": "radial-gradient(circle, #2a2d3a 1.3px, transparent 1.4px) 0 0 / 12px 12px, #eceef2",
  "halftone-dots": "radial-gradient(circle at 35% 40%, #2a2d3a 22%, transparent 24%), radial-gradient(circle, #3a3d4a 1.6px, transparent 1.7px) 0 0 / 11px 11px, #d8dae2",
  "halftone-cmyk": "radial-gradient(circle, #e05a8a 1.4px, transparent 1.5px) 0 0 / 10px 10px, radial-gradient(circle, #3aa0e0 1.4px, transparent 1.5px) 5px 5px / 10px 10px, #f2f0ea",
  voronoi: "radial-gradient(circle at 25% 30%, #4a7bf0 0%, transparent 34%), radial-gradient(circle at 70% 25%, #f06a8a 0%, transparent 30%), radial-gradient(circle at 55% 75%, #f0b04a 0%, transparent 32%), radial-gradient(circle at 80% 70%, #4ad0a0 0%, transparent 26%), #1c1f2e",
  spiral: "conic-gradient(from 0deg at 50% 50%, #2a2450, #7a5cf0, #2a2450, #5a3ad0, #2a2450)",
  swirl: "conic-gradient(from 120deg at 55% 45%, #f06a9b, #8a5cf0, #3a7bd0, #f06a9b)",
  dithering: "conic-gradient(#2a2d3a 25%, transparent 0 50%, #2a2d3a 0 75%, transparent 0) 0 0 / 8px 8px, #d8dae2",
  "smoke-ring": "radial-gradient(circle at 50% 50%, transparent 30%, #6a7080 38%, transparent 52%), radial-gradient(circle at 50% 50%, #23262f 0%, #16181f 100%)",
  "god-rays": "conic-gradient(from 250deg at 60% -10%, #f5d98c 0deg, transparent 40deg, #f0c86a 70deg, transparent 110deg, #f5d98c 140deg, transparent 200deg, #2a2118 360deg), #241c14",
  waves: "repeating-linear-gradient(115deg, #1d4d6b 0 12px, #2a7aa0 12px 24px, #173a52 24px 36px)",
  water: "radial-gradient(at 30% 30%, #4ac0e8 0%, transparent 55%), radial-gradient(at 75% 70%, #2a7ac0 0%, transparent 55%), #123a5a",
  "pulsing-border": "linear-gradient(#1c1f2e, #1c1f2e) center/74% 66% no-repeat, linear-gradient(135deg, #6f6cf5, #f06a9b, #f5b86c, #6f6cf5)",
  "gem-smoke": "radial-gradient(at 30% 60%, #3ad0c0 0%, transparent 50%), radial-gradient(at 70% 30%, #8a5cf0 0%, transparent 50%), #161428",
  "liquid-metal": "linear-gradient(120deg, #585c68 0%, #d8dae2 28%, #4a4d5a 52%, #c8cad2 76%, #3a3d48 100%)",
  "paper-texture": "linear-gradient(135deg, #efe9dc 0%, #e2dac8 50%, #ece4d2 100%)",
  "fluted-glass": "repeating-linear-gradient(90deg, rgba(140,160,200,0.5) 0 6px, rgba(230,236,246,0.7) 6px 12px, rgba(160,170,200,0.5) 12px 18px)",
  "lens-distortion": "radial-gradient(circle at 50% 50%, #9ab8e8 0%, #5a7ab8 40%, #24344f 100%)",
  "image-dithering": "radial-gradient(circle, #3a3d4a 1.2px, transparent 1.3px) 0 0 / 7px 7px, linear-gradient(135deg, #e8a05a, #5a7ab8)",
  "ferro-tide": "radial-gradient(at 50% 100%, #0e7490 0%, transparent 60%), radial-gradient(at 50% 0%, #164e63 0%, transparent 55%), #0a1420",
};

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

/**
 * Static thumbnail by default; the live WebGL preview mounts only while the
 * card is hovered or focused, keeping at most one extra GL context alive.
 */
function ShaderCardPreview({ shaderId, live }: { shaderId: ShaderId; live: boolean }) {
  return (
    <div className="shader-card-preview" aria-hidden="true">
      <span className="shader-card-thumb" style={{ background: SHADER_THUMBS[shaderId] }} />
      {live ? <LiveShaderPreview shaderId={shaderId} /> : null}
    </div>
  );
}

interface ShaderCardProps {
  entry: ShaderEntry;
  onAddShader: (shaderId: ShaderId) => void;
}

function ShaderCard({ entry, onAddShader }: ShaderCardProps) {
  const [shaderId, definition] = entry;
  const [live, setLive] = useState(false);
  return (
    <button
      className="shader-card"
      data-testid={`shader-card-${shaderId}`}
      onBlur={() => setLive(false)}
      onClick={() => onAddShader(shaderId)}
      onFocus={() => setLive(true)}
      onPointerEnter={() => setLive(true)}
      onPointerLeave={() => setLive(false)}
      role="menuitem"
      title={`Add ${definition.label}`}
      type="button"
    >
      <ShaderCardPreview live={live} shaderId={shaderId} />
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
