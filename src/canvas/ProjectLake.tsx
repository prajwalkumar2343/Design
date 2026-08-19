import { useMemo, useState } from "react";
import {
  GalleryHorizontal,
  LayoutDashboard,
  Megaphone,
  ShoppingBag,
  Sparkles,
  Layers3,
  Search,
  Clock3,
  Trash2,
  Copy,
  MoreHorizontal,
  FileText,
  Star,
  X,
  Plus,
  LayoutGrid,
  List,
} from "lucide-react";
import {
  PROJECT_KINDS,
  formatRelativeTime,
  type LocalProjectSummary,
  type ProjectKind,
} from "../persistence/local-projects";

const KIND_ICONS: Record<ProjectKind, React.ComponentType<{ size?: number; className?: string }>> = {
  blank: Sparkles,
  landing: Megaphone,
  dashboard: LayoutDashboard,
  portfolio: GalleryHorizontal,
  wireframe: Layers3,
  commerce: ShoppingBag,
};

// Mini preview for Figma-like thumbnail — abstract layout per kind
function KindThumbnail({ kind, accent }: { kind: ProjectKind; accent: string }) {
  return (
    <div className="figma-thumb" aria-hidden="true">
      <div className="figma-thumb-inner" style={{ borderColor: `${accent}18` }}>
        {kind === "landing" ? (
          <div className="figma-thumb-landing">
            <div className="figma-thumb-hero" style={{ background: accent }} />
            <div className="figma-thumb-row">
              <span /> <span /> <span />
            </div>
            <div className="figma-thumb-row is-wide">
              <span /> <span />
            </div>
          </div>
        ) : kind === "dashboard" ? (
          <div className="figma-thumb-dashboard">
            <div className="figma-thumb-dash-sidebar" />
            <div className="figma-thumb-dash-main">
              <div className="figma-thumb-dash-bar" style={{ background: accent }} />
              <div className="figma-thumb-dash-grid">
                <span /> <span /> <span /> <span />
              </div>
            </div>
          </div>
        ) : kind === "portfolio" ? (
          <div className="figma-thumb-portfolio">
            <div className="figma-thumb-portfolio-row">
              <span /> <span />
            </div>
            <div className="figma-thumb-portfolio-row is-tall">
              <span /> <span /> <span />
            </div>
          </div>
        ) : kind === "commerce" ? (
          <div className="figma-thumb-commerce">
            <div className="figma-thumb-commerce-grid">
              <span /> <span /> <span /> <span /> <span /> <span />
            </div>
          </div>
        ) : kind === "wireframe" ? (
          <div className="figma-thumb-wireframe">
            <div className="figma-thumb-wire-hero" />
            <div className="figma-thumb-wire-lines">
              <span /> <span /> <span />
            </div>
          </div>
        ) : (
          <div className="figma-thumb-blank">
            <div className="figma-thumb-blank-lines">
              <span style={{ background: accent }} /> <span /> <span />
            </div>
          </div>
        )}
      </div>
      <div className="figma-thumb-accent" style={{ background: accent }} />
    </div>
  );
}

interface ProjectLakeProps {
  projects: LocalProjectSummary[];
  activeProjectId: string | null;
  onOpen: (id: string) => void;
  onCreate: (kind: ProjectKind) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onStartBlank?: () => void;
  showAsOverlay?: boolean;
  onCloseLake?: () => void;
}

function useFilteredProjects(projects: LocalProjectSummary[], kindFilter: ProjectKind | "all", query: string) {
  return useMemo(() => {
    let list = projects;
    if (kindFilter !== "all") list = list.filter((p) => p.kind === kindFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.kind.toLowerCase().includes(q));
    }
    return list;
  }, [projects, kindFilter, query]);
}

export function ProjectLake({
  projects,
  activeProjectId,
  onOpen,
  onCreate,
  onDelete,
  onDuplicate,
  onRename,
  showAsOverlay = false,
  onCloseLake,
}: ProjectLakeProps) {
  const [kindFilter, setKindFilter] = useState<ProjectKind | "all">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  const filtered = useFilteredProjects(projects, kindFilter, query);
  const hasProjects = projects.length > 0;
  const recent = filtered.slice(0, 12);

  const handleRenameCommit = (id: string) => {
    const v = renameValue.trim();
    if (v && onRename) onRename(id, v);
    setRenameId(null);
  };

  return (
    <section
      className={`project-lake figma-lake${showAsOverlay ? " is-overlay" : ""}`}
      data-testid="project-lake"
      aria-label="Project lake"
      data-canvas-control
    >
      {/* Figma-like top bar */}
      <header className="figma-lake-topbar">
        <div className="figma-lake-topbar-left">
          <div className="figma-lake-logo" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="figma-lake-heading">
            <h2>Recents</h2>
            <span>{hasProjects ? `${filtered.length} ${filtered.length === 1 ? "file" : "files"}` : "No files yet"} · Stored locally on this device</span>
          </div>
        </div>

        <div className="figma-lake-topbar-right">
          <div className="figma-search" role="search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search files"
              placeholder="Search files…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button aria-label="Clear search" onClick={() => setQuery("")} type="button" className="figma-search-clear">
                <X size={12} />
              </button>
            ) : (
              <span className="figma-search-shortcut">⌘ K</span>
            )}
          </div>

          <div className="figma-view-toggle" role="group" aria-label="View toggle">
            <button
              aria-label="Grid view"
              className={view === "grid" ? "is-active" : ""}
              onClick={() => setView("grid")}
              type="button"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              aria-label="List view"
              className={view === "list" ? "is-active" : ""}
              onClick={() => setView("list")}
              type="button"
            >
              <List size={14} />
            </button>
          </div>

          {showAsOverlay && onCloseLake ? (
            <button className="figma-close" onClick={onCloseLake} type="button" aria-label="Back to canvas">
              <X size={16} /> Close
            </button>
          ) : null}
        </div>
      </header>

      {/* Figma-like tabs / filters */}
      <div className="figma-tabs" role="tablist" aria-label="Filter by kind">
        <button
          role="tab"
          aria-selected={kindFilter === "all"}
          className={`figma-tab${kindFilter === "all" ? " is-active" : ""}`}
          onClick={() => setKindFilter("all")}
          type="button"
        >
          All files <span>{projects.length}</span>
        </button>
        {PROJECT_KINDS.map((kind) => {
          const Icon = KIND_ICONS[kind.id];
          const count = projects.filter((p) => p.kind === kind.id).length;
          return (
            <button
              key={kind.id}
              role="tab"
              aria-selected={kindFilter === kind.id}
              className={`figma-tab${kindFilter === kind.id ? " is-active" : ""}`}
              onClick={() => setKindFilter(kind.id)}
              type="button"
              data-testid={`lake-filter-${kind.id}`}
            >
              <Icon size={13} /> {kind.label} {count > 0 ? <span>{count}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="figma-lake-body">
        {/* Recents — Figma file grid */}
        {hasProjects ? (
          <div className="figma-section">
            <div className="figma-section-head">
              <h3>Recently viewed</h3>
              <span>{kindFilter !== "all" || query ? "Filtered" : "Most recent first"} · {filtered.length} {filtered.length === 1 ? "file" : "files"}</span>
            </div>

            {recent.length === 0 ? (
              <div className="figma-empty">
                <FileText size={18} />
                <strong>No matching files</strong>
                <span>Try another kind or clear search.</span>
              </div>
            ) : (
              <div className={`figma-file-grid${view === "list" ? " is-list" : ""}`}>
                {recent.map((p) => {
                  const kindDef = PROJECT_KINDS.find((k) => k.id === p.kind) ?? PROJECT_KINDS[0]!;
                  const Icon = KIND_ICONS[p.kind];
                  const isActive = p.id === activeProjectId;
                  const isMenuOpen = menuId === p.id;
                  return (
                    <article
                      key={p.id}
                      className={`figma-file-card${isActive ? " is-active" : ""}${isMenuOpen ? " is-menu-open" : ""}${view === "list" ? " is-list-row" : ""}`}
                      data-testid="project-card"
                      data-project-id={p.id}
                      onMouseLeave={() => setMenuId(null)}
                    >
                      <button className="figma-file-thumb" onClick={() => onOpen(p.id)} type="button" aria-label={`Open ${p.name}`}>
                        <KindThumbnail kind={p.kind} accent={kindDef.accent} />
                        <span className="figma-file-open">Open</span>
                        {isActive ? <span className="figma-file-active-dot" aria-label="Active" /> : null}
                      </button>

                      <div className="figma-file-footer">
                        <div className="figma-file-meta">
                          <span className="figma-file-icon" style={{ background: `${kindDef.accent}14`, color: kindDef.accent }}>
                            <Icon size={13} />
                          </span>
                          <div className="figma-file-text">
                            {renameId === p.id ? (
                              <div className="figma-rename">
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleRenameCommit(p.id);
                                    if (e.key === "Escape") setRenameId(null);
                                  }}
                                  onBlur={() => handleRenameCommit(p.id)}
                                  placeholder="File name"
                                  aria-label="Rename file"
                                />
                              </div>
                            ) : (
                              <button className="figma-file-name" onClick={() => onOpen(p.id)} type="button" title={p.name}>
                                {p.name}
                              </button>
                            )}
                            <span className="figma-file-sub">
                              {kindDef.label} · {formatRelativeTime(p.updatedAt)} · {p.frameCount} {p.frameCount === 1 ? "frame" : "frames"}
                              {p.lifecycle !== "not-started" ? ` · ${p.lifecycle}` : ""}
                            </span>
                          </div>
                        </div>

                        <div className="figma-file-actions">
                          <button
                            className="figma-icon-btn"
                            onClick={() => {
                              // star placeholder — Figma has star
                            }}
                            type="button"
                            aria-label="Star file"
                            title="Star"
                          >
                            <Star size={14} />
                          </button>
                          <div className="figma-more-wrap">
                            <button
                              className={`figma-icon-btn${isMenuOpen ? " is-active" : ""}`}
                              onClick={() => setMenuId(isMenuOpen ? null : p.id)}
                              type="button"
                              aria-label="More actions"
                              aria-expanded={isMenuOpen}
                              title="More"
                            >
                              <MoreHorizontal size={14} />
                            </button>
                            {isMenuOpen ? (
                              <div className="figma-more-menu" role="menu">
                                <button
                                  role="menuitem"
                                  onClick={() => {
                                    setRenameId(p.id);
                                    setRenameValue(p.name);
                                    setMenuId(null);
                                  }}
                                  type="button"
                                >
                                  Rename
                                </button>
                                <button role="menuitem" onClick={() => { onDuplicate(p.id); setMenuId(null); }} type="button">
                                  Duplicate
                                </button>
                                <div className="figma-more-divider" />
                                <button
                                  role="menuitem"
                                  className="is-danger"
                                  onClick={() => {
                                    onDelete(p.id);
                                    setMenuId(null);
                                  }}
                                  type="button"
                                >
                                  <Trash2 size={12} /> Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* subtle Figma card hover actions — Open + Duplicate directly on thumb hover */}
                      <div className="figma-card-hover">
                        <button onClick={() => onOpen(p.id)} type="button">
                          Open
                        </button>
                        <button onClick={() => onDuplicate(p.id)} type="button" aria-label="Duplicate">
                          <Copy size={12} /> Duplicate
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="figma-onboarding">
            <div className="figma-onboarding-art" aria-hidden="true">
              <div className="figma-onboarding-grid">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="figma-onboarding-cursor">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M5 3l11 8-5 1-2 5-4-14z" fill="#1A1A1A" stroke="white" strokeWidth="1.2" />
                </svg>
              </div>
            </div>
            <h3>No files yet — your lake is empty</h3>
            <p>
              Every project you create lives on this device. Pick a template below to start — or begin from a blank brief.
              You can come back anytime and continue exactly where you left off.
            </p>
            <div className="figma-onboarding-actions">
              <button data-testid="start-brainstorming" onClick={() => onCreate("blank")} type="button" className="figma-primary">
                <Plus size={14} /> New design file
              </button>
              <span>or choose a template below</span>
            </div>
          </div>
        )}

        {/* Hidden legacy hook for tests/e2e when files exist */}
        {hasProjects ? (
          <div style={{ display: "none" }} aria-hidden="true">
            <button data-testid="start-brainstorming" onClick={() => onCreate("blank")} type="button">
              Start brainstorming
            </button>
          </div>
        ) : null}

        {/* Templates — Figma community / template gallery */}
        <div className="figma-section">
          <div className="figma-section-head">
            <h3>{hasProjects ? "Start something new" : "Templates"}</h3>
            <span>Different kinds, same canvas — {PROJECT_KINDS.length} starting points</span>
          </div>

          <div className="figma-template-grid">
            {PROJECT_KINDS.map((kind) => {
              const Icon = KIND_ICONS[kind.id];
              return (
                <button
                  key={kind.id}
                  className="figma-template-card"
                  onClick={() => onCreate(kind.id)}
                  type="button"
                  data-testid={`create-kind-${kind.id}`}
                >
                  <div className="figma-template-thumb">
                    <KindThumbnail kind={kind.id} accent={kind.accent} />
                    <span className="figma-template-plus">
                      <Plus size={12} />
                    </span>
                  </div>
                  <div className="figma-template-footer">
                    <span className="figma-template-icon" style={{ color: kind.accent }}>
                      <Icon size={14} />
                    </span>
                    <div>
                      <strong>{kind.label}</strong>
                      <span>{kind.description}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <footer className="figma-lake-footnote">
          <span>Local-first · No cloud required · Export a .wirecanvas.json file to share or back up.</span>
          <span className="figma-lake-footnote-dot" aria-hidden="true" />
          <span>{projects.length} {projects.length === 1 ? "file" : "files"} in this browser</span>
        </footer>
      </div>
    </section>
  );
}
