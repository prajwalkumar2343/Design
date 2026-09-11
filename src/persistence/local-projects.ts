import { createEmptyEditorState, type EditorState } from "../editor/model";
import { parseWireCanvasProject, serializeWireCanvasProject } from "./wirecanvas";
import type { BrainstormSessionLifecycle } from "../session/model";
import { getProjectIdFromUrl } from "../routing";

export type CanvasCategory = "website" | "mobile";

export interface CanvasCategoryDef {
  id: CanvasCategory;
  label: string;
  shortLabel: string;
  description: string;
  hint: string;
  accent: string;
}

export const CANVAS_CATEGORIES: readonly CanvasCategoryDef[] = [
  {
    id: "website",
    label: "Website Design",
    shortLabel: "Website",
    description: "Responsive sites — mobile, tablet, desktop.",
    hint: "Marketing, product and editorial — all breakpoints.",
    accent: "#161615",
  },
  {
    id: "mobile",
    label: "Mobile Design",
    shortLabel: "Mobile",
    description: "App flows — phones & tablets.",
    hint: "Native-feeling screens, gestures, no desktop.",
    accent: "#0e7a5a",
  },
] as const;

/**
 * Agent hardness / prompt file per canvas category.
 * Each canvas will load a different agent.md / hardness spec.
 * Mapping is intentional and versioned — define the file later.
 */
export const CANVAS_AGENT_FILES: Record<CanvasCategory, string> = {
  website: "agent.md",
  mobile: "agent-mobile.md",
};

export type ProjectKind =
  | "blank"
  | "landing"
  | "dashboard"
  | "portfolio"
  | "wireframe"
  | "commerce"
  | "mobile-app"
  | "mobile-blank"
  | "app-wireframe";

export interface ProjectKindDef {
  id: ProjectKind;
  label: string;
  description: string;
  hint: string;
  accent: string;
  canvas: CanvasCategory;
}

export const PROJECT_KINDS: readonly ProjectKindDef[] = [
  // — Website — all devices (mobile + tablet + desktop)
  {
    id: "blank",
    label: "Blank brief",
    description: "Start from the project brief. No presets.",
    hint: "A clear, minimal beginning.",
    accent: "#161615",
    canvas: "website",
  },
  {
    id: "landing",
    label: "Landing page",
    description: "Hero, features, proof and CTA — premium marketing flow.",
    hint: "High-contrast hero + editorial grid.",
    accent: "#5d5ce2",
    canvas: "website",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Tables, charts and controls for a data-dense app.",
    hint: "Dense, systematic, calm.",
    accent: "#0e7a5a",
    canvas: "website",
  },
  {
    id: "portfolio",
    label: "Portfolio",
    description: "Image-forward editorial showcase.",
    hint: "Quiet typography, airy spacing.",
    accent: "#b45309",
    canvas: "website",
  },
  {
    id: "wireframe",
    label: "Wireframe system",
    description: "Low-fidelity flows for rapid iteration.",
    hint: "Grayscale, structured, fast.",
    accent: "#6b7280",
    canvas: "website",
  },
  {
    id: "commerce",
    label: "Storefront",
    description: "Product grid, detail, cart and checkout.",
    hint: "Tactile cards, calm commerce.",
    accent: "#c2416a",
    canvas: "website",
  },
  // — Mobile — phones & tablets only, no desktop frames
  {
    id: "mobile-blank",
    label: "Blank app",
    description: "Start from the project brief. No presets — phones & tablets only.",
    hint: "A clear, minimal beginning for apps.",
    accent: "#0e7a5a",
    canvas: "mobile",
  },
  {
    id: "mobile-app",
    label: "Mobile App",
    description: "Native app shell — tabs, lists, detail and actions.",
    hint: "Phone-first, gesture-driven.",
    accent: "#0e7a5a",
    canvas: "mobile",
  },
  {
    id: "app-wireframe",
    label: "App Wireframe",
    description: "Low-fidelity app flow — screens and navigation map.",
    hint: "Grayscale, phones & tablets.",
    accent: "#6b7280",
    canvas: "mobile",
  },
] as const;

export interface LocalProjectRecord {
  id: string;
  name: string;
  kind: ProjectKind;
  createdAt: number;
  updatedAt: number;
  frameCount: number;
  lifecycle: BrainstormSessionLifecycle;
  data: string;
}

export type LocalProjectSummary = Omit<LocalProjectRecord, "data">;

const LS_KEY_PROJECTS = "wirecanvas:projects:v1";
const LS_KEY_ACTIVE = "wirecanvas:activeProjectId:v1";
const MAX_PROJECTS = 24;

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    // probe
    const k = "__wirecanvas_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return null;
  }
}

function nowMs(): number {
  return Date.now();
}

export function createProjectId(): string {
  const rnd =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `project-${rnd}`;
}

export function deriveProjectName(state: EditorState, kind: ProjectKind): string {
  const brief = state.session.briefFrame;
  const desc = brief?.content.projectDescription?.trim() ?? "";
  if (desc.length > 0) {
    const head = desc.split("\n")[0]!.trim();
    return head.slice(0, 48) + (head.length > 48 ? "…" : "");
  }
  const docName = Object.values(state.documents)[0]?.name?.trim();
  if (docName) return docName.slice(0, 48);
  const kindDef = PROJECT_KINDS.find((k) => k.id === kind);
  return kindDef ? kindDef.label : "Untitled project";
}

export function getKindDef(kind: ProjectKind): ProjectKindDef {
  return PROJECT_KINDS.find((k) => k.id === kind) ?? PROJECT_KINDS[0]!;
}

export function isProjectKind(value: unknown): value is ProjectKind {
  return typeof value === "string" && PROJECT_KINDS.some((k) => k.id === value);
}

export function isCanvasCategory(value: unknown): value is CanvasCategory {
  return typeof value === "string" && (CANVAS_CATEGORIES as readonly CanvasCategoryDef[]).some((c) => c.id === value);
}

export function getCanvasCategoryForKind(kind: ProjectKind): CanvasCategory {
  return getKindDef(kind).canvas;
}

export function getKindsForCanvas(canvas: CanvasCategory): readonly ProjectKindDef[] {
  return PROJECT_KINDS.filter((k) => k.canvas === canvas);
}

export function getCanvasDef(canvas: CanvasCategory): CanvasCategoryDef {
  return CANVAS_CATEGORIES.find((c) => c.id === canvas) ?? CANVAS_CATEGORIES[0]!;
}

export function getCanvasCategoryLabel(canvas: CanvasCategory): string {
  return getCanvasDef(canvas).label;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = nowMs() - timestamp;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

export function getBriefPresetForKind(kind: ProjectKind): Partial<import("../session/model").BriefContent> {
  switch (kind) {
    case "landing":
      return {
        projectDescription: "Premium landing page for a new product — hero, features, proof, pricing and closing CTA.",
        audience: "Curious first-time visitors deciding whether to try the product.",
        goals: ["Explain the value in under 12 seconds", "Drive one primary CTA", "Feel calm, premium and trustworthy"],
        visualDirection: "Quiet editorial typography, generous whitespace, soft grayscale with one accent.",
      };
    case "dashboard":
      return {
        projectDescription: "Operational dashboard for monitoring key metrics, tables and recent activity.",
        audience: "Operators who scan quickly and act on exceptions.",
        goals: ["Surface what needs attention first", "Make tables scannable and dense without noise", "Support keyboard / power use"],
        visualDirection: "Systematic, high density, muted neutrals with restrained data color.",
      };
    case "portfolio":
      return {
        projectDescription: "Portfolio of selected work — editorial index and immersive case studies.",
        audience: "Potential clients and collaborators evaluating taste and range.",
        goals: ["Let images lead, typography stay quiet", "Slow, confident scrolling rhythm", "Remember the work, not the chrome"],
        visualDirection: "Large type, airy grids, soft paper tones, minimal ornament.",
      };
    case "wireframe":
      return {
        projectDescription: "Low-fidelity wireframe system covering the core user flow end to end.",
        audience: "Product team aligning on structure before visual design.",
        goals: ["Expose structure and hierarchy", "Keep fidelity deliberately low", "Make decisions reversible"],
        visualDirection: "Strict grayscale, neutral boxes, no color, no imagery — structure only.",
      };
    case "commerce":
      return {
        projectDescription: "Storefront — browse products, view detail, add to cart and check out.",
        audience: "Shoppers comparing options and buying with confidence.",
        goals: ["Make products tactile and comparable", "Keep cart and price always legible", "Checkout feels safe and light"],
        visualDirection: "Calm, tactile product cards, clear price hierarchy, soft surfaces.",
      };
    case "mobile-app":
      return {
        projectDescription: "Native mobile app — onboarding, home feed, detail, and primary action flow.",
        audience: "Phone-first users completing a core task in under 30 seconds.",
        goals: ["One thumb, one hand — all primary actions reachable", "Instant clarity at 390px width", "Feel native, fast, and tactile"],
        visualDirection: "Large tap targets, bottom navigation, soft surfaces, phone-only — phones & tablets, no desktop.",
      };
    case "app-wireframe":
      return {
        projectDescription: "App wireframe — map the core user flow screen by screen at low fidelity.",
        audience: "Product team aligning on app structure before visual design.",
        goals: ["Expose navigation and hierarchy", "Keep fidelity deliberately low (grayscale boxes)", "Validate flow on phones & tablets only"],
        visualDirection: "Strict grayscale, neutral boxes, no color — structure only. Phones & tablets, no desktop.",
      };
    case "mobile-blank":
    case "blank":
    default:
      return {};
  }
}

export function loadProjectIndex(): LocalProjectRecord[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(LS_KEY_PROJECTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: LocalProjectRecord[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.id !== "string" || typeof rec.name !== "string" || typeof rec.data !== "string") continue;
      if (!isProjectKind(rec.kind)) continue;
      if (typeof rec.createdAt !== "number" || typeof rec.updatedAt !== "number") continue;
      out.push({
        id: rec.id,
        name: rec.name.slice(0, 120) || "Untitled project",
        kind: rec.kind,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        frameCount: typeof rec.frameCount === "number" ? rec.frameCount : 0,
        lifecycle: (typeof rec.lifecycle === "string" ? rec.lifecycle : "not-started") as BrainstormSessionLifecycle,
        data: rec.data,
      });
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out.slice(0, MAX_PROJECTS);
  } catch {
    return [];
  }
}

export function saveProjectIndex(records: LocalProjectRecord[]): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    const sorted = [...records].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROJECTS);
    storage.setItem(LS_KEY_PROJECTS, JSON.stringify(sorted));
    return true;
  } catch {
    // quota exceeded — try to drop oldest and retry once
    try {
      const trimmed = [...records].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, MAX_PROJECTS - 4));
      storage.setItem(LS_KEY_PROJECTS, JSON.stringify(trimmed));
      return true;
    } catch {
      return false;
    }
  }
}

export function getActiveProjectId(): string | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const v = storage.getItem(LS_KEY_ACTIVE);
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setActiveProjectId(id: string | null): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    if (id === null) storage.removeItem(LS_KEY_ACTIVE);
    else storage.setItem(LS_KEY_ACTIVE, id);
  } catch {}
}

export function clearAllLocalProjects(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(LS_KEY_PROJECTS);
    storage.removeItem(LS_KEY_ACTIVE);
  } catch {}
}

export function upsertLocalProject(record: LocalProjectRecord): void {
  const index = loadProjectIndex();
  const existingIdx = index.findIndex((p) => p.id === record.id);
  if (existingIdx >= 0) index.splice(existingIdx, 1);
  index.unshift(record);
  saveProjectIndex(index.slice(0, MAX_PROJECTS));
}

export function deleteLocalProject(id: string): LocalProjectRecord[] {
  const index = loadProjectIndex().filter((p) => p.id !== id);
  saveProjectIndex(index);
  if (getActiveProjectId() === id) setActiveProjectId(index[0]?.id ?? null);
  return index;
}

export function duplicateLocalProject(id: string): LocalProjectRecord | null {
  const index = loadProjectIndex();
  const src = index.find((p) => p.id === id);
  if (!src) return null;
  const dup: LocalProjectRecord = {
    ...src,
    id: createProjectId(),
    name: `Copy of ${src.name}`.slice(0, 120),
    createdAt: nowMs(),
    updatedAt: nowMs(),
  };
  index.unshift(dup);
  saveProjectIndex(index.slice(0, MAX_PROJECTS));
  return dup;
}

export function renameLocalProject(id: string, name: string): void {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return;
  const index = loadProjectIndex();
  const rec = index.find((p) => p.id === id);
  if (!rec) return;
  rec.name = trimmed;
  rec.updatedAt = nowMs();
  saveProjectIndex(index);
}

export function saveEditorStateToActiveProject(
  state: EditorState,
  options: { activeId: string | null; fallbackKind?: ProjectKind; preserveName?: string | null },
): { record: LocalProjectRecord; isNew: boolean } | null {
  const isEmpty =
    state.session.lifecycle === "not-started" &&
    Object.keys(state.documents).length === 0 &&
    Object.keys(state.frames).length === 0 &&
    Object.keys(state.pages).length === 0;
  if (isEmpty) return null;
  let serialized: string;
  try {
    serialized = serializeWireCanvasProject(state);
  } catch {
    return null;
  }
  const index = loadProjectIndex();
  let activeId = options.activeId ?? getActiveProjectId();
  let rec = activeId ? index.find((p) => p.id === activeId) : undefined;
  const isNew = !rec;
  if (!rec) {
    const kind = options.fallbackKind ?? "blank";
    const newId = createProjectId();
    const name = options.preserveName?.trim().slice(0, 80) || deriveProjectName(state, kind);
    rec = {
      id: newId,
      name,
      kind,
      createdAt: nowMs(),
      updatedAt: nowMs(),
      frameCount: Object.keys(state.frames).length,
      lifecycle: state.session.lifecycle,
      data: serialized,
    };
    index.unshift(rec);
    activeId = newId;
    setActiveProjectId(newId);
  } else {
    rec.data = serialized;
    rec.updatedAt = nowMs();
    rec.frameCount = Object.keys(state.frames).length;
    rec.lifecycle = state.session.lifecycle;
    // preserve custom rename unless the derived name is meaningfully different and user hasn't renamed
    // Simple heuristic: if current name equals a kind label or "Untitled", auto-update
    const kindLabel = getKindDef(rec.kind).label;
    if (rec.name === kindLabel || rec.name.startsWith("Untitled") || rec.name.startsWith("Copy of")) {
      // keep as is to respect custom rename
    } else {
      const derived = deriveProjectName(state, rec.kind);
      const isDerivedBlank = derived === kindLabel || derived === "Untitled project";
      if (!isDerivedBlank && derived !== rec.name) {
        // keep existing custom name; don't overwrite automatically
      }
    }
    // move to front
    const filtered = index.filter((p) => p.id !== rec!.id);
    filtered.unshift(rec);
    // replace index content
    index.length = 0;
    index.push(...filtered);
  }
  saveProjectIndex(index.slice(0, MAX_PROJECTS));
  return { record: rec, isNew };
}

export function loadEditorStateForProject(id: string): EditorState | null {
  const rec = loadProjectIndex().find((p) => p.id === id);
  if (!rec) return null;
  try {
    return parseWireCanvasProject(rec.data);
  } catch {
    return null;
  }
}

export function hydrateInitialState(
  suppliedFrames: unknown[] | undefined,
  opts: { disablePersistence?: boolean } = {},
): { state: EditorState; activeId: string | null; wasHydrated: boolean; urlProjectId: string | null; notFound: boolean } {
  if (opts.disablePersistence) {
    return { state: createEmptyEditorState(), activeId: null, wasHydrated: false, urlProjectId: null, notFound: false };
  }
  if (Array.isArray(suppliedFrames) && suppliedFrames.length > 0) {
    // demo mode — don't hydrate
    return { state: createEmptyEditorState(), activeId: null, wasHydrated: false, urlProjectId: null, notFound: false };
  }
  if (typeof window !== "undefined") {
    const search = window.location.search ?? "";
    if (search.includes("demo=1")) {
      return { state: createEmptyEditorState(), activeId: null, wasHydrated: false, urlProjectId: null, notFound: false };
    }
    // URL takes precedence: /design/:id
    const urlId = getProjectIdFromUrl();
    if (urlId) {
      const state = loadEditorStateForProject(urlId);
      if (state) {
        setActiveProjectId(urlId);
        return { state, activeId: urlId, wasHydrated: true, urlProjectId: urlId, notFound: false };
      }
      return { state: createEmptyEditorState(), activeId: null, wasHydrated: false, urlProjectId: urlId, notFound: true };
    }
    return { state: createEmptyEditorState(), activeId: null, wasHydrated: false, urlProjectId: null, notFound: false };
  }
  const activeId = getActiveProjectId();
  if (activeId) {
    const state = loadEditorStateForProject(activeId);
    if (state) return { state, activeId, wasHydrated: true, urlProjectId: activeId, notFound: false };
  }
  return { state: createEmptyEditorState(), activeId: null, wasHydrated: false, urlProjectId: null, notFound: false };
}

export function getLocalProjectSummaries(): LocalProjectSummary[] {
  return loadProjectIndex().map(({ data: _d, ...rest }) => rest);
}
