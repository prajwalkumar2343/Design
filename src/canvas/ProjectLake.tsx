import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  Check,
  GalleryHorizontal,
  Globe,
  LayoutDashboard,
  Layers3,
  Megaphone,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Search,
  Trash2,
  Copy,
  MoreHorizontal,
  FileText,
  X,
  Plus,
  LayoutGrid,
  List,
  Pencil,
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

type LakeView = "grid" | "list";
type LakeSort = "recent" | "name" | "created";

const LAKE_SORTS: readonly { id: LakeSort; label: string }[] = [
  { id: "recent", label: "Last modified" },
  { id: "name", label: "Alphabetical" },
  { id: "created", label: "Newest first" },
];

const LAKE_PREFS_KEY = "wirecanvas:lake-ui:v1";

interface LakePrefs {
  view: LakeView;
  sort: LakeSort;
  kindFilter: ProjectKind | "all";
}

function loadLakePrefs(): LakePrefs {
  const fallback: LakePrefs = { view: "grid", sort: "recent", kindFilter: "all" };
  try {
    const raw = window.localStorage?.getItem(LAKE_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<LakePrefs>;
    return {
      view: parsed.view === "list" ? "list" : "grid",
      sort: LAKE_SORTS.some((s) => s.id === parsed.sort) ? (parsed.sort as LakeSort) : "recent",
      kindFilter:
        typeof parsed.kindFilter === "string" &&
        (parsed.kindFilter === "all" || PROJECT_KINDS.some((k) => k.id === parsed.kindFilter))
          ? (parsed.kindFilter as ProjectKind | "all")
          : "all",
    };
  } catch {
    return fallback;
  }
}

function saveLakePrefs(prefs: LakePrefs): void {
  try {
    window.localStorage?.setItem(LAKE_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
  );
}

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
              >
                <span className="blank-chooser-option-icon" style={{ background: `${canvas.accent}14`, color: canvas.accent, borderColor: `${canvas.accent}22` }}>
                  <Icon size={18} />
                </span>
                <span className="blank-chooser-option-copy">
                  <strong>{canvas.label}</strong>
                  <small>{isWebsite ? "Mobile, tablet and desktop" : "Mobile and tablet"}</small>
                </span>
                <span className="blank-chooser-option-arrow" aria-hidden="true">
                  <Plus size={14} />
                </span>
                <span className="blank-chooser-accent" style={{ background: canvas.accent }} />
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
  onStartBlank?: () => void;
  showAsOverlay?: boolean;
  onCloseLake?: () => void;
}

function useFilteredProjects(
  projects: LocalProjectSummary[],
  kindFilter: ProjectKind | "all",
  query: string,
  sort: LakeSort,
) {
  return useMemo(() => {
    let list = projects;
    if (kindFilter !== "all") list = list.filter((p) => p.kind === kindFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.kind.toLowerCase().includes(q));
    }
    if (sort === "name") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    } else if (sort === "created") {
      list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    }
    // "recent" keeps the store order (updatedAt desc)
    return list;
  }, [projects, kindFilter, query, sort]);
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
  const initialPrefs = useMemo(loadLakePrefs, []);
  const [kindFilter, setKindFilter] = useState<ProjectKind | "all">(initialPrefs.kindFilter);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LakeView>(initialPrefs.view);
  const [sort, setSort] = useState<LakeSort>(initialPrefs.sort);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuUp, setMenuUp] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [showBlankChooser, setShowBlankChooser] = useState(false);
  // Tracks the live rename session so Enter→unmount-blur can never
  // double-commit and Escape reliably cancels instead of committing.
  const renameSessionRef = useRef<{ id: string; original: string; done: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const sortWrapRef = useRef<HTMLDivElement>(null);
  const newWrapRef = useRef<HTMLDivElement>(null);

  const isMac =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform ?? navigator.userAgent ?? "");

  const closeMenu = (restoreFocus = false) => {
    setMenuId(null);
    setConfirmDeleteId(null);
    if (restoreFocus) menuTriggerRef.current?.focus();
    menuTriggerRef.current = null;
  };

  // Outside pointer-down closes whichever popover is open.
  useEffect(() => {
    if (menuId === null && !sortOpen && !newOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest("[data-lake-pop]") !== null) return;
      closeMenu();
      setSortOpen(false);
      setNewOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuId, sortOpen, newOpen]);

  // Global Escape chain: menu/sort/new > overlay close. The chooser and the
  // rename input own their own Escape handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || showBlankChooser) return;
      if (menuId !== null) {
        closeMenu(true);
        return;
      }
      if (sortOpen) {
        setSortOpen(false);
        return;
      }
      if (newOpen) {
        setNewOpen(false);
        return;
      }
      if (renameId !== null) return;
      if (showAsOverlay) onCloseLake?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuId, sortOpen, newOpen, renameId, showBlankChooser, showAsOverlay, onCloseLake]);

  // ⌘K / Ctrl+K and "/" focus search, matching the hint chip on the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const withMod = e.metaKey || e.ctrlKey;
      if (withMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === "/" && !withMod && !e.altKey && !isEditableTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Persist view / sort / filter so the lake reopens exactly as left.
  useEffect(() => {
    saveLakePrefs({ view, sort, kindFilter });
  }, [view, sort, kindFilter]);

  // Focus the first item when a card menu or the delete confirm opens.
  useEffect(() => {
    if (menuId === null) return;
    const el = menuRef.current?.querySelector<HTMLElement>("button");
    el?.focus();
  }, [menuId, confirmDeleteId]);

  const filtered = useFilteredProjects(projects, kindFilter, query, sort);
  const hasProjects = projects.length > 0;
  // Show every matching file. The lake caps at 24 stored projects, and an
  // arbitrary cut made files look missing / unopenable.
  const recent = filtered;

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

  // Templates visible on home — hide internal blank variants, keep single blank card for chooser
  const templateKinds = useMemo(
    () => PROJECT_KINDS.filter((k) => k.id !== "mobile-blank"),
    [],
  );

  const sortLabel = LAKE_SORTS.find((s) => s.id === sort)?.label ?? "Last modified";

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
          </div>
          <div className="figma-lake-heading">
            <h2>{kindFilter === "all" ? "All files" : PROJECT_KINDS.find((kind) => kind.id === kindFilter)?.label ?? "Files"}</h2>
          </div>
        </div>

        <div className="figma-lake-topbar-right">
          <div className="figma-search" role="search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              aria-label="Search files"
              placeholder="Search files…"
              value={query}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (query) setQuery("");
                  else e.currentTarget.blur();
                  e.stopPropagation();
                }
              }}
            />
            {query ? (
              <button aria-label="Clear search" onClick={() => setQuery("")} type="button" className="figma-search-clear">
                <X size={12} />
              </button>
            ) : (
              <kbd className="figma-search-shortcut">{isMac ? "⌘" : "Ctrl"} K</kbd>
            )}
          </div>

          <div className="figma-sort-wrap" data-lake-pop ref={sortWrapRef}>
            <button
              className={`figma-sort-button${sortOpen ? " is-active" : ""}`}
              onClick={() => {
                setSortOpen((v) => !v);
                setNewOpen(false);
              }}
              type="button"
              aria-label={`Sort files, currently ${sortLabel}`}
              aria-expanded={sortOpen}
              aria-haspopup="menu"
              title="Sort"
            >
              <ArrowDownWideNarrow size={14} />
              <span>{sortLabel}</span>
            </button>
            {sortOpen ? (
              <div className="figma-more-menu figma-sort-menu" role="menu" aria-label="Sort files">
                {LAKE_SORTS.map((s) => (
                  <button
                    key={s.id}
                    role="menuitemradio"
                    aria-checked={sort === s.id}
                    onClick={() => {
                      setSort(s.id);
                      setSortOpen(false);
                    }}
                    type="button"
                  >
                    <span className="figma-menu-check">{sort === s.id ? <Check size={13} /> : null}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="figma-view-toggle" role="group" aria-label="View toggle">
            <button
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              className={view === "grid" ? "is-active" : ""}
              onClick={() => setView("grid")}
              type="button"
              title="Grid view"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              aria-label="List view"
              aria-pressed={view === "list"}
              className={view === "list" ? "is-active" : ""}
              onClick={() => setView("list")}
              type="button"
              title="List view"
            >
              <List size={14} />
            </button>
          </div>

          <div className="figma-new-wrap" data-lake-pop ref={newWrapRef}>
            <button
              className="figma-new-file"
              onClick={() => {
                setNewOpen((v) => !v);
                setSortOpen(false);
              }}
              type="button"
              aria-expanded={newOpen}
              aria-haspopup="menu"
              data-testid="new-file-button"
            >
              <Plus size={14} /> New
            </button>
            {newOpen ? (
              <div className="figma-more-menu figma-new-menu" role="menu" aria-label="Create a file">
                <button
                  role="menuitem"
                  onClick={() => {
                    setNewOpen(false);
                    setShowBlankChooser(true);
                  }}
                  type="button"
                >
                  <Sparkles size={13} /> Blank canvas…
                </button>
                <div className="figma-more-divider" />
                {templateKinds
                  .filter((k) => k.id !== "blank")
                  .map((kind) => {
                    const Icon = KIND_ICONS[kind.id];
                    return (
                      <button
                        key={kind.id}
                        role="menuitem"
                        onClick={() => {
                          setNewOpen(false);
                          onCreate(kind.id);
                        }}
                        type="button"
                      >
                        <Icon size={13} /> {kind.label}
                      </button>
                    );
                  })}
              </div>
            ) : null}
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
        <span className="lake-nav-heading">Your files</span>
        <button
          role="tab"
          aria-selected={kindFilter === "all"}
          className={`figma-tab${kindFilter === "all" ? " is-active" : ""}`}
          onClick={() => setKindFilter("all")}
          type="button"
        >
          <LayoutGrid size={14} aria-hidden="true" /> All files <span>{projects.length}</span>
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
              <h3>{sort === "name" ? "A–Z" : sort === "created" ? "Newest" : "Recent"}</h3>
              <span>{filtered.length} {filtered.length === 1 ? "file" : "files"}</span>
            </div>

            {recent.length === 0 ? (
              <div className="figma-empty">
                <FileText size={18} />
                <strong>No matching files</strong>
                <span>Try another kind or clear search.</span>
                <button
                  className="figma-empty-clear"
                  onClick={() => {
                    setQuery("");
                    setKindFilter("all");
                  }}
                  type="button"
                >
                  Clear search &amp; filters
                </button>
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
            <h3>No files yet</h3>
            <p>Create your first file to get started.</p>
            <div className="figma-onboarding-actions">
              <button data-testid="start-brainstorming" onClick={() => setShowBlankChooser(true)} type="button" className="figma-primary">
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
            <h3>Templates</h3>
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

      </div>

      <BlankCanvasChooser open={showBlankChooser} onClose={() => setShowBlankChooser(false)} onChoose={handleBlankChoose} />
    </section>
  );
}
