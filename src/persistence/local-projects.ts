import { createEmptyEditorState, type EditorState } from "../editor/model";
import {
  parseWireCanvasProject,
  serializeWireCanvasProjectCompact,
} from "./wirecanvas";
import { repairWireCanvasProjectJson } from "./wirecanvas-repair";
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
  /**
   * Serialized project payload. Records returned by `loadProjectIndex` carry
   * `""` here — payloads live under their own storage keys; read them through
   * `readProjectData` / `loadEditorStateForProject`. Assigning a non-empty
   * string marks the payload for writing on the next `saveProjectIndex`.
   */
  data: string;
}

export type LocalProjectSummary = Omit<LocalProjectRecord, "data">;

/**
 * Storage layout (v2):
 * - `wirecanvas:projects:v2`          metadata-only index (LocalProjectSummary[])
 * - `wirecanvas:projects:v2:backup`   last-good copy of the index
 * - `wirecanvas:project-data:<id>`    serialized project payload
 * - `wirecanvas:project-backup:<id>`  last payload that parsed successfully
 * - `wirecanvas:projects:v1`          legacy single-blob index, migrated lazily
 *
 * The v1 layout stored every payload inside one JSON blob: an index-parse
 * failure wiped out every file at once, quota overflow silently evicted the
 * oldest projects, and two tabs could clobber each other on read-modify-write.
 * Per-project keys isolate corruption to a single file, backups keep a
 * last-good copy, and the index stays small enough to merge on write.
 */
const LS_KEY_INDEX = "wirecanvas:projects:v2";
const LS_KEY_INDEX_BACKUP = "wirecanvas:projects:v2:backup";
const LS_KEY_LEGACY_INDEX = "wirecanvas:projects:v1";
const LS_KEY_ACTIVE = "wirecanvas:activeProjectId:v1";
const LS_PREFIX_DATA = "wirecanvas:project-data:";
const LS_PREFIX_BACKUP = "wirecanvas:project-backup:";
const MAX_PROJECTS = 100;

const KNOWN_LIFECYCLES: readonly BrainstormSessionLifecycle[] = [
  "not-started",
  "briefing",
  "wireframing",
  "completed",
];

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

/**
 * Tolerant index-entry read. A record is only dropped when it has no usable
 * id — unknown kinds (written by a different build), missing names, or absent
 * timestamps must never make a file vanish from the lake.
 */
function readIndexEntry(item: unknown): LocalProjectSummary | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  if (typeof rec.id !== "string" || rec.id.length === 0) return null;
  return {
    id: rec.id,
    name: typeof rec.name === "string" && rec.name.trim().length > 0 ? rec.name.slice(0, 120) : "Untitled project",
    kind: isProjectKind(rec.kind) ? rec.kind : "blank",
    createdAt: typeof rec.createdAt === "number" && Number.isFinite(rec.createdAt) ? rec.createdAt : nowMs(),
    updatedAt: typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt) ? rec.updatedAt : nowMs(),
    frameCount: typeof rec.frameCount === "number" && Number.isFinite(rec.frameCount) && rec.frameCount >= 0 ? rec.frameCount : 0,
    lifecycle: KNOWN_LIFECYCLES.includes(rec.lifecycle as BrainstormSessionLifecycle)
      ? (rec.lifecycle as BrainstormSessionLifecycle)
      : "not-started",
  };
}

function parseIndexRaw(raw: string | null): LocalProjectSummary[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out: LocalProjectSummary[] = [];
    for (const item of parsed) {
      const entry = readIndexEntry(item);
      if (entry) out.push(entry);
    }
    return out;
  } catch {
    return null;
  }
}

function sortIndex(list: LocalProjectSummary[]): LocalProjectSummary[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Ids that currently have a payload or backup payload key. */
function enumerateDataIds(storage: Storage): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (key.startsWith(LS_PREFIX_DATA)) ids.add(key.slice(LS_PREFIX_DATA.length));
    else if (key.startsWith(LS_PREFIX_BACKUP)) ids.add(key.slice(LS_PREFIX_BACKUP.length));
  }
  return ids;
}

function readIndexSummaries(storage: Storage): LocalProjectSummary[] {
  const primary = parseIndexRaw(storage.getItem(LS_KEY_INDEX));
  const backup = parseIndexRaw(storage.getItem(LS_KEY_INDEX_BACKUP));
  // A primary that parses but lists fewer files than the backup was truncated
  // by an interrupted write — trusting it would let the next save shrink the
  // backup too and vanish those files. Union both copies (the primary wins
  // per id) and heal the primary, same as the corrupt-index path below.
  if (primary !== null && backup !== null && backup.length > primary.length) {
    const byId = new Map<string, LocalProjectSummary>();
    for (const meta of backup) byId.set(meta.id, meta);
    for (const meta of primary) byId.set(meta.id, meta);
    const merged = sortIndex([...byId.values()]).slice(0, MAX_PROJECTS);
    try {
      storage.setItem(LS_KEY_INDEX, JSON.stringify(merged));
    } catch {}
    return merged;
  }
  if (primary !== null) return sortIndex(primary).slice(0, MAX_PROJECTS);
  // The primary index is corrupt — restore from the last-good copy instead of
  // presenting an empty lake while every payload is still on disk.
  if (backup !== null) {
    try {
      storage.setItem(LS_KEY_INDEX, JSON.stringify(sortIndex(backup)));
    } catch {}
    return sortIndex(backup).slice(0, MAX_PROJECTS);
  }
  return [];
}

/** Reads a project payload from the legacy single-blob index, if still present. */
function readLegacyProjectData(storage: Storage, id: string): string | null {
  const raw = storage.getItem(LS_KEY_LEGACY_INDEX);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      if (rec.id === id && typeof rec.data === "string" && rec.data.length > 0) return rec.data;
    }
  } catch {}
  return null;
}

/**
 * One-time migration from the v1 single-blob layout. Each record's payload is
 * moved to its own key; the legacy blob is only removed once every payload
 * landed safely — a mid-migration quota failure leaves it in place so the
 * remaining entries migrate on the next load (and stay readable via the
 * legacy fallback in `readProjectData`).
 */
function migrateLegacyIndex(storage: Storage): void {
  const raw = storage.getItem(LS_KEY_LEGACY_INDEX);
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt blob — keep it; the raw text may still hold recoverable data.
    return;
  }
  if (!Array.isArray(parsed)) {
    try {
      storage.removeItem(LS_KEY_LEGACY_INDEX);
    } catch {}
    return;
  }
  const metas: LocalProjectSummary[] = [];
  let fullyMigrated = true;
  for (const item of parsed) {
    const meta = readIndexEntry(item);
    if (!meta) continue;
    const data =
      item && typeof item === "object" && typeof (item as Record<string, unknown>).data === "string"
        ? ((item as Record<string, unknown>).data as string)
        : "";
    const hasKey = storage.getItem(LS_PREFIX_DATA + meta.id) !== null;
    if (data.length > 0 && !hasKey) {
      try {
        storage.setItem(LS_PREFIX_DATA + meta.id, data);
      } catch {
        fullyMigrated = false;
        continue;
      }
    } else if (data.length === 0 && !hasKey) {
      // No payload anywhere — nothing worth listing.
      continue;
    }
    metas.push(meta);
  }
  const existing = readIndexSummaries(storage);
  const byId = new Map<string, LocalProjectSummary>();
  for (const meta of metas) byId.set(meta.id, meta);
  for (const meta of existing) byId.set(meta.id, meta); // v2 entries win
  try {
    const json = JSON.stringify(sortIndex([...byId.values()]).slice(0, MAX_PROJECTS));
    storage.setItem(LS_KEY_INDEX, json);
    try {
      storage.setItem(LS_KEY_INDEX_BACKUP, json);
    } catch {}
  } catch {
    fullyMigrated = false;
  }
  if (fullyMigrated) {
    try {
      storage.removeItem(LS_KEY_LEGACY_INDEX);
    } catch {}
  }
}

export function loadProjectIndex(): LocalProjectRecord[] {
  const storage = safeStorage();
  if (!storage) return [];
  migrateLegacyIndex(storage);
  const metas = readIndexSummaries(storage);
  // Prune ghost entries — index rows whose payload is gone from every location
  // would list as files that can never open. `loadEditorStateForProjectDetailed`
  // re-lists an orphaned payload when it is opened directly, so recovery is
  // still possible via URL.
  const dataIds = enumerateDataIds(storage);
  const legacyRaw = storage.getItem(LS_KEY_LEGACY_INDEX);
  let legacyIds: Set<string> | null = null;
  if (legacyRaw !== null) {
    try {
      const parsed = JSON.parse(legacyRaw) as unknown;
      if (Array.isArray(parsed)) {
        legacyIds = new Set(
          parsed
            .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
            .filter((item) => typeof item.id === "string" && typeof item.data === "string" && item.data.length > 0)
            .map((item) => item.id as string),
        );
      }
    } catch {}
  }
  return metas
    .filter((meta) => dataIds.has(meta.id) || legacyIds?.has(meta.id))
    .map((meta) => ({ ...meta, data: "" }));
}

/**
 * Writes the index and any pending payloads.
 *
 * - `rec.data` is persisted to the record's own key only when it is a
 *   non-empty string — index-only records carry `data: ""` and never touch
 *   their payload.
 * - The incoming list is merged over the stored index: stored entries absent
 *   from it survive only while their payload key exists, which keeps files
 *   created in another tab while letting deletes and cap-drops stay dropped.
 * - Nothing is silently evicted on quota failure — the write fails honestly
 *   so callers can surface the existing storage-full toast.
 */
export function saveProjectIndex(
  records: LocalProjectSummary[],
  options: { dropIds?: readonly string[] } = {},
): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    migrateLegacyIndex(storage);
    const dropIds = new Set(options.dropIds ?? []);
    const incomingIds = new Set(records.map((r) => r.id));
    const dataIds = enumerateDataIds(storage);
    const merged: LocalProjectSummary[] = [];
    const pendingData: { id: string; text: string }[] = [];
    for (const rec of records) {
      if (typeof rec.id !== "string" || rec.id.length === 0) continue;
      merged.push({
        id: rec.id,
        name: rec.name,
        kind: isProjectKind(rec.kind) ? rec.kind : "blank",
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        frameCount: rec.frameCount,
        lifecycle: rec.lifecycle,
      });
      const data = (rec as LocalProjectRecord).data;
      if (typeof data === "string" && data.length > 0) pendingData.push({ id: rec.id, text: data });
    }
    for (const stored of readIndexSummaries(storage)) {
      if (incomingIds.has(stored.id) || dropIds.has(stored.id)) continue;
      if (dataIds.has(stored.id)) merged.push(stored);
    }
    const sorted = sortIndex(merged);
    const kept = sorted.slice(0, MAX_PROJECTS);
    // Payload keys land before the index so the index never points at a
    // missing file. If the index write then fails, the payloads are rolled
    // back — otherwise a new file is stranded under a key the lake can't
    // list. Prior payloads are restored rather than deleted so a failed
    // update doesn't erase the last good copy.
    const writtenData: { id: string; prev: string | null }[] = [];
    const seededBackups: string[] = [];
    try {
      for (const { id, text } of pendingData) {
        writtenData.push({ id, prev: storage.getItem(LS_PREFIX_DATA + id) });
        storage.setItem(LS_PREFIX_DATA + id, text);
        // Seed the last-good copy for files that have never been opened; the
        // read path advances it to the newest payload that parses.
        if (storage.getItem(LS_PREFIX_BACKUP + id) === null) {
          try {
            storage.setItem(LS_PREFIX_BACKUP + id, text);
            seededBackups.push(id);
          } catch {}
        }
      }
      const json = JSON.stringify(kept);
      storage.setItem(LS_KEY_INDEX, json);
      try {
        storage.setItem(LS_KEY_INDEX_BACKUP, json);
      } catch {}
    } catch (error) {
      for (const { id, prev } of writtenData) {
        try {
          if (prev === null) storage.removeItem(LS_PREFIX_DATA + id);
          else storage.setItem(LS_PREFIX_DATA + id, prev);
        } catch {}
      }
      for (const id of seededBackups) {
        try {
          storage.removeItem(LS_PREFIX_BACKUP + id);
        } catch {}
      }
      throw error;
    }
    // Index write succeeded — payloads of over-cap entries can go now.
    for (const dropped of sorted.slice(MAX_PROJECTS)) {
      try {
        storage.removeItem(LS_PREFIX_DATA + dropped.id);
        storage.removeItem(LS_PREFIX_BACKUP + dropped.id);
      } catch {}
    }
    return true;
  } catch {
    return false;
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
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (
        key === LS_KEY_INDEX ||
        key === LS_KEY_INDEX_BACKUP ||
        key === LS_KEY_LEGACY_INDEX ||
        key === LS_KEY_ACTIVE ||
        key.startsWith(LS_PREFIX_DATA) ||
        key.startsWith(LS_PREFIX_BACKUP)
      ) {
        storage.removeItem(key);
      }
    }
  } catch {}
}

export function upsertLocalProject(record: LocalProjectRecord): boolean {
  const index = loadProjectIndex();
  const existingIdx = index.findIndex((p) => p.id === record.id);
  if (existingIdx >= 0) index.splice(existingIdx, 1);
  index.unshift(record);
  return saveProjectIndex(index);
}

export function deleteLocalProject(id: string): LocalProjectRecord[] | null {
  const storage = safeStorage();
  if (!storage) return null;
  const index = loadProjectIndex().filter((p) => p.id !== id);
  // The payload keys are only removed after the index write lands — a failed
  // write must leave the file fully intact, and `dropIds` keeps the merge
  // from resurrecting the entry while its payload is still present.
  if (!saveProjectIndex(index, { dropIds: [id] })) return null;
  try {
    storage.removeItem(LS_PREFIX_DATA + id);
    storage.removeItem(LS_PREFIX_BACKUP + id);
  } catch {}
  if (getActiveProjectId() === id) setActiveProjectId(index[0]?.id ?? null);
  return index;
}

export function duplicateLocalProject(id: string): LocalProjectRecord | null {
  const index = loadProjectIndex();
  const src = index.find((p) => p.id === id);
  if (!src) return null;
  const data = readProjectData(id);
  if (data === null) return null;
  const dup: LocalProjectRecord = {
    id: createProjectId(),
    name: `Copy of ${src.name}`.slice(0, 120),
    kind: src.kind,
    createdAt: nowMs(),
    updatedAt: nowMs(),
    frameCount: src.frameCount,
    lifecycle: src.lifecycle,
    data,
  };
  index.unshift(dup);
  return saveProjectIndex(index) ? dup : null;
}

export function renameLocalProject(id: string, name: string): boolean {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return false;
  const index = loadProjectIndex();
  const rec = index.find((p) => p.id === id);
  if (!rec) return false;
  rec.name = trimmed;
  rec.updatedAt = nowMs();
  return saveProjectIndex(index);
}

/**
 * Reads a project's serialized payload: primary key first, then the last-good
 * backup, then the legacy blob if a migration never completed.
 */
export function readProjectData(id: string): string | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const primary = storage.getItem(LS_PREFIX_DATA + id);
    if (primary !== null) return primary;
    const backup = storage.getItem(LS_PREFIX_BACKUP + id);
    if (backup !== null) return backup;
    return readLegacyProjectData(storage, id);
  } catch {
    return null;
  }
}

/** True when the project is listed in the index or still has a payload on disk. */
export function hasLocalProject(id: string): boolean {
  const storage = safeStorage();
  if (!storage) return false;
  if (loadProjectIndex().some((p) => p.id === id)) return true;
  try {
    return (
      storage.getItem(LS_PREFIX_DATA + id) !== null ||
      storage.getItem(LS_PREFIX_BACKUP + id) !== null ||
      readLegacyProjectData(storage, id) !== null
    );
  } catch {
    return false;
  }
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
    serialized = serializeWireCanvasProjectCompact(state);
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
  if (!saveProjectIndex(index)) return null;
  if (isNew) setActiveProjectId(rec.id);
  return { record: rec, isNew };
}

export type ProjectLoadSource =
  | "primary"
  | "repaired"
  | "backup"
  | "repaired-backup"
  | "legacy"
  | "repaired-legacy";

export interface ProjectLoadResult {
  state: EditorState;
  /** Where the returned state came from — anything but "primary" recovered a damaged file. */
  source: ProjectLoadSource;
}

function tryParseOrRepair(text: string): { state: EditorState; repairedText: string | null } | null {
  try {
    return { state: parseWireCanvasProject(text), repairedText: null };
  } catch {}
  const repaired = repairWireCanvasProjectJson(text);
  if (repaired !== null) {
    try {
      return { state: parseWireCanvasProject(repaired), repairedText: repaired };
    } catch {}
  }
  return null;
}

/**
 * Loads a project with the full recovery ladder:
 *   strict parse → salvage repair → last-good backup → repaired backup →
 *   legacy blob. Whatever wins is written back to the primary key, so a
 *   damaged file heals itself on first successful open. A recovered entry
 *   missing from the index is re-listed so orphaned files reappear in the lake.
 */
export function loadEditorStateForProjectDetailed(id: string): ProjectLoadResult | null {
  const storage = safeStorage();
  if (!storage) return null;
  migrateLegacyIndex(storage);

  const persistHealed = (text: string) => {
    try {
      storage.setItem(LS_PREFIX_DATA + id, text);
    } catch {}
  };
  const refreshBackup = (text: string) => {
    try {
      if (storage.getItem(LS_PREFIX_BACKUP + id) !== text) {
        storage.setItem(LS_PREFIX_BACKUP + id, text);
      }
    } catch {}
  };
  const backupParses = () => {
    const existing = storage.getItem(LS_PREFIX_BACKUP + id);
    if (existing === null) return false;
    try {
      parseWireCanvasProject(existing);
      return true;
    } catch {
      return false;
    }
  };
  const relistIfMissing = (state: EditorState) => {
    try {
      if (readIndexSummaries(storage).some((s) => s.id === id)) return;
      const summaries = readIndexSummaries(storage);
      summaries.unshift({
        id,
        name: deriveProjectName(state, "blank").slice(0, 80) || "Recovered project",
        kind: "blank",
        createdAt: nowMs(),
        updatedAt: nowMs(),
        frameCount: Object.keys(state.frames).length,
        lifecycle: state.session.lifecycle,
      });
      saveProjectIndex(summaries);
    } catch {}
  };

  const finish = (result: { state: EditorState; repairedText: string | null }, source: ProjectLoadSource, raw: string): ProjectLoadResult => {
    if (result.repairedText !== null) persistHealed(result.repairedText);
    else if (source !== "primary") persistHealed(raw);
    // A repair can be a lossy salvage — it replaces the last-good backup only
    // when the backup is missing or no longer parses on its own.
    if (result.repairedText === null || !backupParses()) {
      refreshBackup(result.repairedText ?? raw);
    }
    relistIfMissing(result.state);
    return { state: result.state, source };
  };

  const primary = storage.getItem(LS_PREFIX_DATA + id);
  if (primary !== null) {
    const result = tryParseOrRepair(primary);
    if (result) return finish(result, result.repairedText !== null ? "repaired" : "primary", primary);
  }
  const backup = storage.getItem(LS_PREFIX_BACKUP + id);
  if (backup !== null && backup !== primary) {
    const result = tryParseOrRepair(backup);
    if (result) return finish(result, result.repairedText !== null ? "repaired-backup" : "backup", backup);
  }
  const legacy = readLegacyProjectData(storage, id);
  if (legacy !== null) {
    const result = tryParseOrRepair(legacy);
    if (result) return finish(result, result.repairedText !== null ? "repaired-legacy" : "legacy", legacy);
  }
  return null;
}

export function loadEditorStateForProject(id: string): EditorState | null {
  return loadEditorStateForProjectDetailed(id)?.state ?? null;
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
