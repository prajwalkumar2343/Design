import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  FileText,
  GalleryHorizontal,
  Globe,
  LayoutDashboard,
  Layers3,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  CANVAS_CATEGORIES,
  PROJECT_KINDS,
  formatRelativeTime,
  loadEditorStateForProject,
  type CanvasCategory,
  type LocalProjectSummary,
  type ProjectKind,
} from "../persistence/local-projects";
import { injectWireframeTheme } from "../frame/wireframe-theme";
import { injectTokenTheme } from "../frame/token-theme";
import { injectCanvasFonts } from "../fonts";
import { buildThemeCssVariables } from "../tokens";

const KIND_ICONS: Record<ProjectKind, React.ComponentType<{ size?: number; className?: string }>> = {
  blank: Sparkles,
  landing: Megaphone,
  dashboard: LayoutDashboard,
  portfolio: GalleryHorizontal,
  wireframe: Layers3,
  commerce: ShoppingBag,
  "mobile-blank": Smartphone,
  "mobile-app": Smartphone,
  "app-wireframe": Layers3,
};

const CANVAS_ICONS: Record<CanvasCategory, React.ComponentType<{ size?: number; className?: string }>> = {
  website: Globe,
  mobile: Smartphone,
};

// Maps blank chooser canvas -> internal blank kind
const BLANK_KIND_FOR_CANVAS: Record<CanvasCategory, ProjectKind> = {
  website: "blank",
  mobile: "mobile-blank",
};

/* ------------------------------------------------------------------ */
/* Live project thumbnail — real scaled preview of the saved document  */
/* ------------------------------------------------------------------ */

interface LiveThumb {
  srcDoc: string;
  width: number;
  height: number;
}

// Bounded parse cache keyed by id + revision marker so re-mounts and
// re-renders never re-parse stored project payloads.
const liveThumbCache = new Map<string, LiveThumb | null>();
const LIVE_THUMB_CACHE_MAX = 48;

function resolveLiveThumb(projectId: string, updatedAt: number): LiveThumb | null {
  const key = `${projectId}:${updatedAt}`;
  if (liveThumbCache.has(key)) return liveThumbCache.get(key) ?? null;
  let result: LiveThumb | null = null;
  try {
    const state = loadEditorStateForProject(projectId);
    if (state) {
      const frames = Object.values(state.frames);
      // The largest frame is the most representative screen of the file.
      const hero = frames.reduce<(typeof frames)[number] | null>(
        (best, f) => (best === null || f.width * f.height > best.width * best.height ? f : best),
        null,
      );
      const doc = (hero ? state.documents[hero.documentId] : undefined) ?? Object.values(state.documents)[0];
      if (doc && typeof doc.srcDoc === "string" && doc.srcDoc.trim().length > 0) {
        const themed = injectCanvasFonts(
          doc.mode === "wireframe"
            ? injectWireframeTheme(doc.srcDoc)
            : injectTokenTheme(doc.srcDoc, buildThemeCssVariables(state.tokens)),
        );
        result = { srcDoc: themed, width: hero?.width ?? 1280, height: hero?.height ?? 800 };
      }
    }
  } catch {
    result = null;
  }
  if (liveThumbCache.size >= LIVE_THUMB_CACHE_MAX) {
    const oldest = liveThumbCache.keys().next().value;
    if (oldest !== undefined) liveThumbCache.delete(oldest);
  }
  liveThumbCache.set(key, result);
  return result;
}

function LiveThumbnail({
  projectId,
  updatedAt,
  fallback,
}: {
  projectId: string;
  updatedAt: number;
  fallback: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [resolved, setResolved] = useState<LiveThumb | null | undefined>(undefined);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [painted, setPainted] = useState(false);

  // Only pay for iframe previews once the card is near the viewport.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNearViewport(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport || resolved !== undefined) return;
    setResolved(resolveLiveThumb(projectId, updatedAt));
  }, [nearViewport, resolved, projectId, updatedAt]);

  useEffect(() => {
    if (!nearViewport) return;
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nearViewport]);

  useEffect(() => setPainted(false), [projectId, updatedAt]);

  const scale =
    resolved && box.w > 0 && box.h > 0 && resolved.width > 0 && resolved.height > 0
      ? Math.min(box.w / resolved.width, box.h / resolved.height)
      : 0;

  return (
    <div className="figma-thumb-live" ref={hostRef} aria-hidden="true">
      {resolved ? (
        <iframe
          className={`figma-thumb-frame${painted ? " is-painted" : ""}`}
          title=""
          sandbox=""
          scrolling="no"
          tabIndex={-1}
          srcDoc={resolved.srcDoc}
          onLoad={() => setPainted(true)}
          style={{
            width: resolved.width,
            height: resolved.height,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        />
      ) : (
        fallback
      )}
    </div>
  );
}

/* -------------------------------------------------------------- */
/* Kind thumbnails — abstract layout art used for templates &      */
/* projects without renderable content yet                          */
/* -------------------------------------------------------------- */

function KindThumbnail({ kind, accent }: { kind: ProjectKind; accent: string }) {
  const mobile = kind === "mobile-app" || kind === "mobile-blank" || kind === "app-wireframe";
  const wireframe = kind === "wireframe" || kind === "app-wireframe";
  return (
    <div className="template-preview" data-kind={kind} style={{ "--preview-accent": accent } as React.CSSProperties} aria-hidden="true">
      {kind === "blank" ? <div className="template-blank-art"><Plus size={25} strokeWidth={1} /><span>A fresh start</span></div> : (
        <div className={`template-mini-page${mobile ? " is-mobile" : ""}${wireframe ? " is-wireframe" : ""}`}>
          <div className="template-mini-nav"><span /><span /><span /></div>
          {wireframe ? <div className="template-wire-art"><div /><span /><span /><div className="template-mini-tiles"><i /><i /><i /></div></div>
            : kind === "dashboard" ? <div className="template-dashboard-art"><span>Overview</span><strong>24,680<small> +18.6%</small></strong><div className="template-chart">{[35, 52, 44, 66, 58, 82, 72, 96].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div>
            : kind === "portfolio" ? <div className="template-portfolio-art"><span>Independent designer</span><strong>Selected works.</strong><div className="template-mini-tiles"><i /><i /><i /></div></div>
            : kind === "commerce" ? <div className="template-commerce-art"><strong>The everyday edit.</strong><div className="template-mini-tiles"><i /><i /><i /></div><span>Objects for a slower life</span></div>
            : mobile ? <div className="template-mobile-art"><span>Monday, 24</span><strong>Your day,<br />in focus.</strong><div /><span className="template-mobile-row" /><span className="template-mobile-row" /></div>
            : <div className="template-landing-art"><span>Made for what's next</span><strong>Ideas into<br />impact.</strong><span className="template-mini-cta">Explore the possibilities <span>↗</span></span><div className="template-orbit" /></div>}
        </div>
      )}
    </div>
  );
}

function BlankCanvasChooser({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (canvas: CanvasCategory) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && cardRef.current) {
        // Lightweight focus trap — keep Tab cycling inside the dialog.
        const items = Array.from(
          cardRef.current.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])"),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    const firstOption = cardRef.current?.querySelector<HTMLElement>(".blank-chooser-option");
    firstOption?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="blank-chooser-backdrop"
      data-testid="blank-chooser-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="blank-chooser-card"
        role="dialog"
        aria-modal="true"
        aria-label="Choose canvas for new blank project"
        data-testid="blank-chooser"
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="blank-chooser-close" aria-label="Close" onClick={onClose} type="button">
          <X size={16} />
        </button>

        <div className="blank-chooser-header">
          <h3>New file</h3>
          <p>Choose a canvas.</p>
        </div>

        <div className="blank-chooser-options" role="group" aria-label="Canvas options">
          {CANVAS_CATEGORIES.map((canvas) => {
            const Icon = CANVAS_ICONS[canvas.id];
            const isWebsite = canvas.id === "website";
            return (
              <button
                key={canvas.id}
                className="blank-chooser-option"
                data-testid={`blank-choose-${canvas.id}`}
                onClick={() => onChoose(canvas.id)}
                type="button"
                aria-label={`Create blank ${canvas.label}`}
                style={{ "--option-accent": canvas.accent } as React.CSSProperties}
              >
                <span className="blank-chooser-option-icon" style={{ background: `${canvas.accent}14`, color: canvas.accent }}>
                  <Icon size={18} />
                </span>
                <span className="blank-chooser-option-copy">
                  <strong>{canvas.label}</strong>
                  <small>{isWebsite ? "Mobile, tablet and desktop" : "Mobile and tablet"}</small>
                </span>
                <span className="blank-chooser-option-arrow" aria-hidden="true">
                  <Plus size={14} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="blank-chooser-foot">
          <button className="blank-chooser-cancel" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
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
  showAsOverlay?: boolean;
  onCloseLake?: () => void;
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
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuUp, setMenuUp] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showBlankChooser, setShowBlankChooser] = useState(false);
  // Tracks the live rename session so Enter→unmount-blur can never
  // double-commit and Escape reliably cancels instead of committing.
  const renameSessionRef = useRef<{ id: string; original: string; done: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);

  const closeMenu = (restoreFocus = false) => {
    setMenuId(null);
    setConfirmDeleteId(null);
    if (restoreFocus) menuTriggerRef.current?.focus();
    menuTriggerRef.current = null;
  };

  // Outside pointer-down closes the card menu.
  useEffect(() => {
    if (menuId === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest("[data-lake-pop]") !== null) return;
      closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuId]);

  // Global Escape chain: card menu > overlay close. The chooser and the
  // rename input own their own Escape handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || showBlankChooser) return;
      if (menuId !== null) {
        closeMenu(true);
        return;
      }
      if (renameId !== null) return;
      if (showAsOverlay) onCloseLake?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuId, renameId, showBlankChooser, showAsOverlay, onCloseLake]);

  // Focus the first item when a card menu or the delete confirm opens.
  useEffect(() => {
    if (menuId === null) return;
    const el = menuRef.current?.querySelector<HTMLElement>("button");
    el?.focus();
  }, [menuId, confirmDeleteId]);

  const hasProjects = projects.length > 0;

  const startRename = (id: string, currentName: string) => {
    renameSessionRef.current = { id, original: currentName, done: false };
    setRenameValue(currentName);
    setRenameId(id);
    closeMenu();
  };

  const commitRename = (id: string) => {
    const session = renameSessionRef.current;
    if (!session || session.id !== id || session.done) return;
    session.done = true;
    const v = renameValue.trim();
    setRenameId(null);
    renameSessionRef.current = null;
    if (v && v !== session.original && onRename) onRename(id, v);
  };

  const cancelRename = (id: string) => {
    const session = renameSessionRef.current;
    if (session && session.id === id) session.done = true;
    renameSessionRef.current = null;
    setRenameId(null);
  };

  const openCardMenu = (id: string, trigger: HTMLElement) => {
    if (menuId === id) {
      closeMenu();
      return;
    }
    menuTriggerRef.current = trigger;
    setConfirmDeleteId(null);
    // Flip the menu up when there isn't room below (overlay mode, short viewports).
    const rect = trigger.getBoundingClientRect();
    setMenuUp(window.innerHeight - rect.bottom < 230 && rect.top > 260);
    setMenuId(id);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = menuRef.current ? Array.from(menuRef.current.querySelectorAll<HTMLElement>("button")) : [];
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1 + items.length) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      closeMenu();
    }
  };

  const handleBlankChoose = (canvas: CanvasCategory) => {
    setShowBlankChooser(false);
    const kind = BLANK_KIND_FOR_CANVAS[canvas];
    onCreate(kind);
  };

  // Bundled entries — hide internal blank variants, keep a single blank card
  // that opens the canvas chooser.
  const templateKinds = useMemo(
    () => PROJECT_KINDS.filter((k) => k.id !== "mobile-blank"),
    [],
  );

  return (
    <section
      className={`project-lake figma-lake${showAsOverlay ? " is-overlay" : ""}`}
      data-testid="project-lake"
      aria-label="Library"
      data-canvas-control
    >
      <header className="figma-lake-topbar">
        <div className="figma-lake-topbar-left">
          <div className="figma-lake-logo" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="figma-lake-heading">
            <h2>Library</h2>
          </div>
        </div>

        {showAsOverlay && onCloseLake ? (
          <button className="figma-close" onClick={onCloseLake} type="button" aria-label="Back to canvas">
            <X size={16} /> Close
          </button>
        ) : null}
      </header>

      <div className="figma-lake-body">
        {/* Bundled — starting points shipped with the app */}
        <div className="figma-section">
          <div className="figma-section-head">
            <h3>Bundled</h3>
            <span>{templateKinds.length} {templateKinds.length === 1 ? "note" : "notes"}</span>
          </div>

          <div className="figma-template-grid">
            {templateKinds.map((kind) => {
              const Icon = KIND_ICONS[kind.id];
              const isBlank = kind.id === "blank";
              return (
                <button
                  key={kind.id}
                  className="figma-template-card"
                  onClick={() => {
                    if (isBlank) setShowBlankChooser(true);
                    else onCreate(kind.id);
                  }}
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
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Saved — notes the user has saved locally */}
        <div className="figma-section">
          <div className="figma-section-head">
            <h3>Saved</h3>
            <span>{projects.length} {projects.length === 1 ? "note" : "notes"}</span>
          </div>

          {hasProjects ? (
            <div className="figma-file-grid">
              {projects.map((p) => {
                const kindDef = PROJECT_KINDS.find((k) => k.id === p.kind) ?? PROJECT_KINDS[0]!;
                const Icon = KIND_ICONS[p.kind];
                const isActive = p.id === activeProjectId;
                const isMenuOpen = menuId === p.id;
                return (
                  <article
                    key={p.id}
                    className={`figma-file-card${isActive ? " is-active" : ""}${isMenuOpen ? " is-menu-open" : ""}`}
                    data-testid="project-card"
                    data-project-id={p.id}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <button className="figma-file-thumb" onClick={() => onOpen(p.id)} type="button" aria-label={`Open ${p.name}`}>
                      <LiveThumbnail
                        projectId={p.id}
                        updatedAt={p.updatedAt}
                        fallback={<KindThumbnail kind={p.kind} accent={kindDef.accent} />}
                      />
                      <span className="figma-file-open">Open</span>
                      {isActive ? <span className="figma-file-active-dot" title="Active file" /> : null}
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
                                maxLength={80}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === "Enter") commitRename(p.id);
                                  if (e.key === "Escape") cancelRename(p.id);
                                }}
                                onBlur={() => commitRename(p.id)}
                                placeholder="File name"
                                aria-label="Rename file"
                              />
                            </div>
                          ) : (
                            <button
                              className="figma-file-name"
                              onClick={() => onOpen(p.id)}
                              onDoubleClick={() => onRename && startRename(p.id, p.name)}
                              type="button"
                              title={onRename ? `${p.name} — double-click to rename` : p.name}
                            >
                              {p.name}
                            </button>
                          )}
                          <span className="figma-file-sub" title={`${kindDef.label} · ${p.frameCount} ${p.frameCount === 1 ? "frame" : "frames"}`}>
                            {formatRelativeTime(p.updatedAt)}
                          </span>
                        </div>
                      </div>

                      <div className="figma-file-actions">
                        <div className="figma-more-wrap" data-lake-pop>
                          <button
                            className={`figma-icon-btn${isMenuOpen ? " is-active" : ""}`}
                            onClick={(e) => openCardMenu(p.id, e.currentTarget)}
                            type="button"
                            aria-label="More actions"
                            aria-expanded={isMenuOpen}
                            aria-haspopup="menu"
                            title="More"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {isMenuOpen ? (
                            <div
                              className={`figma-more-menu${menuUp ? " is-up" : ""}`}
                              role="menu"
                              ref={menuRef}
                              onKeyDown={onMenuKeyDown}
                            >
                              {confirmDeleteId === p.id ? (
                                <div className="figma-more-confirm" role="alertdialog" aria-label={`Delete ${p.name}`}>
                                  <strong>Delete “{p.name}”?</strong>
                                  <span>This can’t be undone.</span>
                                  <div className="figma-more-confirm-actions">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmDeleteId(null);
                                        menuRef.current?.querySelector<HTMLElement>("button")?.focus();
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="is-danger"
                                      data-testid="confirm-delete-project"
                                      onClick={() => {
                                        closeMenu();
                                        onDelete(p.id);
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button
                                    role="menuitem"
                                    onClick={() => startRename(p.id, p.name)}
                                    type="button"
                                  >
                                    <Pencil size={13} /> Rename
                                  </button>
                                  <button role="menuitem" onClick={() => { onDuplicate(p.id); closeMenu(); }} type="button">
                                    <Copy size={13} /> Duplicate
                                  </button>
                                  <div className="figma-more-divider" />
                                  <button
                                    role="menuitem"
                                    className="is-danger"
                                    onClick={() => setConfirmDeleteId(p.id)}
                                    type="button"
                                  >
                                    <Trash2 size={13} /> Delete…
                                  </button>
                                </>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="figma-empty">
              <FileText size={18} />
              <strong>No saved notes yet</strong>
              <span>Pick a bundled note above, or start from a blank canvas.</span>
              <button
                data-testid="start-brainstorming"
                onClick={() => setShowBlankChooser(true)}
                type="button"
                className="figma-primary"
              >
                <Plus size={14} /> New blank note
              </button>
            </div>
          )}
        </div>

        {/* Hidden legacy hook for tests/e2e when files exist */}
        {hasProjects ? (
          <div style={{ display: "none" }} aria-hidden="true">
            <button data-testid="start-brainstorming" onClick={() => onCreate("blank")} type="button">
              Start brainstorming
            </button>
          </div>
        ) : null}
      </div>

      <BlankCanvasChooser open={showBlankChooser} onClose={() => setShowBlankChooser(false)} onChoose={handleBlankChoose} />
    </section>
  );
}
