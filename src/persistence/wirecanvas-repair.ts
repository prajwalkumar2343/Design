/**
 * Salvage pass for damaged locally-stored projects.
 *
 * The strict codec in `wirecanvas.ts` is deliberately fail-closed — it is the
 * right boundary for *untrusted* file imports. But the same strictness applied
 * to the app's own localStorage payload meant any schema drift, a persisted
 * canvas-injected marker, or a single dangling reference made a whole file
 * unopenable forever.
 *
 * `repairWireCanvasProjectJson` is the lenient counterpart used only for the
 * app's own stored data: it rebuilds a damaged payload field-by-field, drops
 * or fixes whatever cannot be salvaged, and returns JSON that the strict
 * parser accepts. Callers must still run `parseWireCanvasProject` on the
 * result — repair produces a candidate, the codec remains the gatekeeper.
 */
import { BRIDGE_RUNTIME_MARKER } from "../bridge/runtime";
import { TOKEN_THEME_MARKER } from "../frame/token-theme";
import { WIREFRAME_THEME_MARKER } from "../frame/wireframe-theme";
import { validateCompleteHtml } from "../router/html-admission";
import { validateWireframeHtml } from "../router/wireframe-admission";
import {
  BRAINSTORM_SESSION_KIND,
  BRAINSTORM_SESSION_SCHEMA_VERSION,
  createEmptyBriefContent,
  type BrainstormSessionLifecycle,
} from "../session/model";
import type { DocumentMode } from "../editor/model";
import {
  createEmptyTokenStore,
  validateToken,
  validateTokenSet,
  validateTokenTheme,
  type DesignToken,
  type TokenSet,
  type TokenStoreState,
  type TokenTheme,
} from "../tokens";
import {
  WIRECANVAS_FILE_KIND,
  WIRECANVAS_FILE_SCHEMA_VERSION,
  WIRECANVAS_LIMITS,
} from "./wirecanvas";

type JsonRecord = Record<string, unknown>;

const MAX_STRING = WIRECANVAS_LIMITS.maxStringLength;
const MAX_ID = WIRECANVAS_LIMITS.maxIdLength;
const MAX_ELEMENT_ID = WIRECANVAS_LIMITS.maxElementIdLength;
const MAX_ITEMS = WIRECANVAS_LIMITS.maxCollectionItems;

const LIFECYCLES: readonly BrainstormSessionLifecycle[] = [
  "not-started",
  "briefing",
  "wireframing",
  "completed",
];
const NODE_KINDS = new Set(["element", "text", "component"]);
const TOOLS = new Set(["select", "hand", "frame", "rectangle", "text", "image", "comment", "pan"]);
const FRAME_CATEGORIES = new Set(["mobile", "tablet", "desktop"]);
const CHROME_TYPES = new Set(["notch", "dynamic-island", "punch-hole", "none"]);

const MINIMAL_DESIGN_DOC =
  "<!doctype html><html><head><title>Recovered page</title></head><body></body></html>";
const MINIMAL_WIREFRAME_DOC =
  "<!doctype html><html><head><title>Recovered wireframe</title></head><body><main></main></body></html>";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strings are truncated to the codec limit; an over-long srcDoc will fail admission and be replaced. */
function str(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
}

function nonEmptyStr(value: unknown, fallback: string): string {
  const s = str(value).trim();
  return s.length > 0 ? str(value) : fallback;
}

function idStr(value: unknown, fallback: string): string {
  const s = str(value);
  return s.length > 0 && s.length <= MAX_ID ? s : fallback;
}

/** Short deterministic fragment for generated ids that would exceed the id cap. */
function shortHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function nullableIdStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = str(value);
  return s.length > 0 && s.length <= MAX_ID ? s : null;
}

function elementIdStr(value: unknown, fallback: string): string {
  const s = str(value);
  return s.length > 0 && s.length <= MAX_ELEMENT_ID ? s : fallback;
}

function nullableElementIdStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = str(value);
  return s.length > 0 && s.length <= MAX_ELEMENT_ID ? s : null;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  const n = finite(value, NaN);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function intAtLeast(value: unknown, minimum: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  // Math.trunc leaves huge floats like 1e300 unchanged; the codec demands a
  // safe integer, so anything else collapses to the fallback.
  const safe = Number.isSafeInteger(n) ? n : fallback;
  return safe >= minimum ? safe : Math.max(minimum, fallback);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, MAX_ITEMS)
    .map((item) => str(item));
}

/** Id lists are deduped because the strict codec rejects duplicates. */
function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_ID) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function elementIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_ELEMENT_ID) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function dedupeIds<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Stored documents                                                    */
/* ------------------------------------------------------------------ */

function htmlPasses(html: string, mode: DocumentMode): boolean {
  try {
    if (mode === "wireframe") validateWireframeHtml(html);
    else validateCompleteHtml(html);
    return true;
  } catch {
    return false;
  }
}

/**
 * A srcDoc can fail admission for reasons worth salvaging — most importantly
 * canvas-injected artifacts (bridge runtime, theme, font-face markers) that an
 * older build accidentally persisted. Those are stripped and the document is
 * re-validated; only truly unrecoverable markup is replaced by a minimal page
 * so the file still opens.
 */
function repairSrcDoc(html: string, mode: DocumentMode): string {
  if (htmlPasses(html, mode)) return html;
  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed
      .querySelectorAll(
        `[${BRIDGE_RUNTIME_MARKER}],[${WIREFRAME_THEME_MARKER}],[${TOKEN_THEME_MARKER}],[data-design-tool-font-faces]`,
      )
      .forEach((el) => el.remove());
    const cleaned = `<!doctype html>\n${parsed.documentElement.outerHTML}`;
    if (htmlPasses(cleaned, mode)) return cleaned;
  } catch {
    // DOMParser unavailable or produced unusable output — fall through.
  }
  return mode === "wireframe" ? MINIMAL_WIREFRAME_DOC : MINIMAL_DESIGN_DOC;
}

function repairDocument(value: unknown, index: number): JsonRecord | null {
  if (!isRecord(value)) return null;
  const id = idStr(value.id, `doc-recovered-${index}`);
  const mode: DocumentMode = value.mode === "wireframe" ? "wireframe" : "design";
  const srcDoc = repairSrcDoc(nonEmptyStr(value.srcDoc, MINIMAL_DESIGN_DOC), mode);
  return {
    id,
    name: nonEmptyStr(value.name, "Document"),
    mode,
    srcDoc,
    revision: intAtLeast(value.revision, 1, 1),
    rootNodeIds: elementIdList(value.rootNodeIds),
    pageIds: idList(value.pageIds),
  };
}

function repairPage(value: unknown, index: number): JsonRecord | null {
  if (!isRecord(value)) return null;
  return {
    id: idStr(value.id, `page-recovered-${index}`),
    documentId: idStr(value.documentId, ""),
    name: nonEmptyStr(value.name, "Page"),
    frameIds: idList(value.frameIds),
  };
}

function repairChrome(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null;
  if (!CHROME_TYPES.has(value.type as string)) return null;
  const chrome: JsonRecord = { type: value.type };
  if (typeof value.width === "number" && Number.isFinite(value.width)) chrome.width = value.width;
  if (typeof value.height === "number" && Number.isFinite(value.height)) chrome.height = value.height;
  if (typeof value.bezelRadius === "number" && Number.isFinite(value.bezelRadius)) chrome.bezelRadius = value.bezelRadius;
  if (value.punchPosition === "center" || value.punchPosition === "left") chrome.punchPosition = value.punchPosition;
  return chrome;
}

function repairFrame(value: unknown, index: number): JsonRecord | null {
  if (!isRecord(value)) return null;
  const frame: JsonRecord = {
    id: idStr(value.id, `frame-recovered-${index}`),
    pageId: idStr(value.pageId, ""),
    documentId: idStr(value.documentId, ""),
    name: nonEmptyStr(value.name, "Frame"),
    x: finite(value.x),
    y: finite(value.y),
    width: positive(value.width, 800),
    height: positive(value.height, 600),
    background: str(value.background, "#ffffff"),
  };
  if (FRAME_CATEGORIES.has(value.category as string)) frame.category = value.category;
  const chrome = repairChrome(value.chrome);
  if (chrome) frame.chrome = chrome;
  // Whitelist: only fields this branch's codec accepts may be emitted. A
  // stored `freeform` flag is dropped until the strict parser learns it.
  return frame;
}

function repairNode(value: unknown, index: number): JsonRecord | null {
  if (!isRecord(value)) return null;
  const node: JsonRecord = {
    id: elementIdStr(value.id, `node-recovered-${index}`),
    documentId: idStr(value.documentId, ""),
    parentId: nullableElementIdStr(value.parentId),
    kind: NODE_KINDS.has(value.kind as string) ? value.kind : "element",
    name: nonEmptyStr(value.name, "Layer"),
    childIds: elementIdList(value.childIds),
  };
  if (typeof value.tagName === "string" && value.tagName.length > 0) node.tagName = str(value.tagName);
  if (typeof value.locked === "boolean") node.locked = value.locked;
  if (typeof value.hidden === "boolean") node.hidden = value.hidden;
  if (typeof value.frameId === "string" && value.frameId.length > 0) node.frameId = str(value.frameId);
  const attributes: Record<string, string> = {};
  if (isRecord(value.attributes)) {
    for (const [key, item] of Object.entries(value.attributes)) {
      if (typeof item === "string" && key.length <= MAX_STRING) attributes[key] = str(item);
    }
  }
  node.attributes = attributes;
  return node;
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

function repairReference(value: unknown, index: number): JsonRecord | null {
  if (!isRecord(value)) return null;
  const url = str(value.url);
  return {
    id: idStr(value.id, `ref-${index}`),
    label: str(value.label),
    // Strict codec only allows http(s) references — anything else is dropped.
    url: /^https?:\/\//i.test(url) ? url : "",
    note: str(value.note),
  };
}

function repairDecision(value: unknown, index: number): JsonRecord | null {
  if (!isRecord(value)) return null;
  return {
    id: idStr(value.id, `decision-${index}`),
    statement: str(value.statement),
    rationale: str(value.rationale),
  };
}

function repairBriefContent(value: unknown): JsonRecord {
  const input = isRecord(value) ? value : {};
  const empty = createEmptyBriefContent();
  const references = dedupeIds(
    (Array.isArray(input.references) ? input.references : [])
      .map((item, index) => repairReference(item, index))
      .filter((item): item is JsonRecord => item !== null) as { id: string }[],
  );
  const decisions = dedupeIds(
    (Array.isArray(input.confirmedDecisions) ? input.confirmedDecisions : [])
      .map((item, index) => repairDecision(item, index))
      .filter((item): item is JsonRecord => item !== null) as { id: string }[],
  );
  return {
    projectDescription: str(input.projectDescription, empty.projectDescription),
    audience: str(input.audience, empty.audience),
    goals: stringList(input.goals),
    successCriteria: stringList(input.successCriteria),
    requiredFeatures: stringList(input.requiredFeatures),
    requiredContent: stringList(input.requiredContent),
    visualDirection: str(input.visualDirection, empty.visualDirection),
    constraints: stringList(input.constraints),
    references,
    openQuestions: stringList(input.openQuestions),
    confirmedDecisions: decisions,
  };
}

function repairBriefFrame(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null;
  return {
    id: idStr(value.id, "recovered-brief-frame"),
    kind: "brief",
    name: nonEmptyStr(value.name, "Project brief"),
    x: finite(value.x),
    y: finite(value.y),
    width: positive(value.width, 520),
    height: positive(value.height, 720),
    revision: intAtLeast(value.revision, 1, 1),
    content: repairBriefContent(value.content),
  };
}

function repairSession(value: unknown): JsonRecord {
  const input = isRecord(value) ? value : {};
  const briefFrame = repairBriefFrame(input.briefFrame);
  if (!briefFrame) {
    // Strict codec: not-started sessions may carry no id, frame, revision, or selection.
    return {
      kind: BRAINSTORM_SESSION_KIND,
      schemaVersion: BRAINSTORM_SESSION_SCHEMA_VERSION,
      lifecycle: "not-started",
      sessionId: null,
      revision: 0,
      briefFrame: null,
      selection: { type: "none" },
    };
  }
  const briefId = briefFrame.id as string;
  const briefRevision = briefFrame.revision as number;
  let lifecycle = input.lifecycle;
  if (typeof lifecycle !== "string" || !(LIFECYCLES as readonly string[]).includes(lifecycle)) {
    lifecycle = "briefing";
  }
  // A brief frame can never coexist with the not-started lifecycle.
  if (lifecycle === "not-started") lifecycle = "briefing";
  let sessionId = nullableIdStr(input.sessionId);
  if (!sessionId || sessionId === briefId) sessionId = `session-${briefId}`;
  // The codec's id cap and its sessionId ≠ briefFrame.id rule apply to
  // generated ids too; a deterministic hash stays inside both.
  if (sessionId.length > MAX_ID) sessionId = `session-${shortHash(briefId)}`;
  if (sessionId === briefId) sessionId = `${sessionId}-x`;
  const selectionInput = isRecord(input.selection) ? input.selection : {};
  const selection =
    selectionInput.type === "brief-frame" && selectionInput.briefFrameId === briefId
      ? { type: "brief-frame", briefFrameId: briefId }
      : { type: "none" };
  return {
    kind: BRAINSTORM_SESSION_KIND,
    schemaVersion: BRAINSTORM_SESSION_SCHEMA_VERSION,
    lifecycle,
    sessionId,
    revision: Math.max(1, briefRevision, intAtLeast(input.revision, 0, 0)),
    briefFrame,
    selection,
  };
}

/** A set survives bad members: invalid tokens are dropped one by one. */
function repairTokenSet(value: unknown, key: string): TokenSet | null {
  if (!isRecord(value)) return null;
  const tokens: Record<string, DesignToken> = {};
  const names = new Set<string>();
  if (isRecord(value.tokens)) {
    for (const [tokenKey, item] of Object.entries(value.tokens)) {
      try {
        const token = validateToken(item, `state.tokens.sets.${key}.tokens.${tokenKey}`);
        if (token.id !== tokenKey || names.has(token.name)) continue;
        names.add(token.name);
        tokens[tokenKey] = token;
      } catch {
        // Invalid token: drop it, keep the rest of the set.
      }
    }
  }
  try {
    const set = validateTokenSet({ ...value, tokens }, `state.tokens.sets.${key}`);
    return set.id === key ? set : null;
  } catch {
    return null;
  }
}

function repairTokenTheme(
  value: unknown,
  key: string,
  knownSetIds: ReadonlySet<string>,
): TokenTheme | null {
  if (!isRecord(value)) return null;
  // Keep only memberships in sets that survived repair; a theme left with
  // none fails validation and is dropped.
  const setIds = Array.isArray(value.setIds)
    ? [...new Set(value.setIds.filter((id): id is string => typeof id === "string" && knownSetIds.has(id)))]
    : value.setIds;
  try {
    const theme = validateTokenTheme({ ...value, setIds }, `state.tokens.themes.${key}`, knownSetIds);
    return theme.id === key ? theme : null;
  } catch {
    return null;
  }
}

function repairTokens(value: unknown): TokenStoreState {
  if (!isRecord(value)) return createEmptyTokenStore();
  const sets: Record<string, TokenSet> = {};
  if (isRecord(value.sets)) {
    for (const [key, item] of Object.entries(value.sets)) {
      const set = repairTokenSet(item, key);
      if (set) sets[key] = set;
    }
  }
  const knownSetIds = new Set(Object.keys(sets));
  const themes: Record<string, TokenTheme> = {};
  if (isRecord(value.themes)) {
    for (const [key, item] of Object.entries(value.themes)) {
      const theme = repairTokenTheme(item, key, knownSetIds);
      if (theme) themes[key] = theme;
    }
  }
  const activeThemeId =
    typeof value.activeThemeId === "string" &&
    Object.prototype.hasOwnProperty.call(themes, value.activeThemeId)
      ? value.activeThemeId
      : null;
  const revision =
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0
      ? value.revision
      : 0;
  return { sets, themes, activeThemeId, revision };
}

/* ------------------------------------------------------------------ */
/* Relational repair                                                   */
/* ------------------------------------------------------------------ */

/**
 * Rebuilds every membership list from the entity side so the strict
 * referential checks pass: pages are dropped when their document is gone,
 * frames when their page or document is gone, nodes when their document is
 * gone; parent/child links are made two-sided consistent and cycles broken.
 */
function repairRelations(state: {
  documents: JsonRecord[];
  pages: JsonRecord[];
  frames: JsonRecord[];
  nodes: JsonRecord[];
}): void {
  const documents = new Map(state.documents.map((d) => [d.id as string, d]));
  const pages = new Map<string, JsonRecord>();
  for (const page of state.pages) {
    if (documents.has(page.documentId as string)) pages.set(page.id as string, page);
  }
  const frames = new Map<string, JsonRecord>();
  for (const frame of state.frames) {
    if (pages.has(frame.pageId as string) && documents.has(frame.documentId as string)) {
      frames.set(frame.id as string, frame);
    }
  }
  const nodes = new Map<string, JsonRecord>();
  for (const node of state.nodes) {
    if (documents.has(node.documentId as string)) nodes.set(node.id as string, node);
  }

  for (const doc of state.documents) {
    doc.pageIds = state.pages
      .filter((p) => pages.has(p.id as string) && p.documentId === doc.id)
      .map((p) => p.id as string);
  }
  for (const page of pages.values()) {
    page.frameIds = state.frames
      .filter((f) => frames.has(f.id as string) && f.pageId === page.id)
      .map((f) => f.id as string);
  }

  // Node frameId must reference a frame in the same document.
  for (const node of nodes.values()) {
    if (typeof node.frameId === "string") {
      const frame = frames.get(node.frameId);
      if (!frame || frame.documentId !== node.documentId) delete node.frameId;
    }
  }

  // childIds: keep only existing same-document children; each child keeps its
  // first claimant so no node ends up with two parents.
  const claimed = new Set<string>();
  for (const node of state.nodes) {
    if (!nodes.has(node.id as string)) continue;
    const kept: string[] = [];
    for (const childId of node.childIds as string[]) {
      const child = nodes.get(childId);
      if (!child || child.documentId !== node.documentId || childId === node.id || claimed.has(childId)) continue;
      claimed.add(childId);
      kept.push(childId);
    }
    node.childIds = kept;
  }

  // parentId: keep only when the parent actually lists the node.
  const detach = (node: JsonRecord) => {
    const parent = typeof node.parentId === "string" ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.childIds = (parent.childIds as string[]).filter((id) => id !== node.id);
    }
    node.parentId = null;
  };
  for (const node of nodes.values()) {
    if (node.parentId === null) continue;
    const parent = nodes.get(node.parentId as string);
    if (!parent || parent.documentId !== node.documentId || !(parent.childIds as string[]).includes(node.id as string)) {
      node.parentId = null;
    }
  }

  // childIds: keep only children that point back at this node. A listed
  // child whose parentId is null (or elsewhere) is a codec-level
  // inconsistency — and it is how cycles through a root appear: root A
  // lists B, B lists A, but A's null parentId means the parent-chain walk
  // below can never see the loop. Filtering the childIds side first makes
  // the graph two-sided consistent, so every remaining cycle is a parentId
  // cycle the walk can break.
  for (const node of nodes.values()) {
    node.childIds = (node.childIds as string[]).filter((childId) => {
      const child = nodes.get(childId);
      return child !== undefined && child.parentId === node.id;
    });
  }

  // Break cycles: walk the parent chain; on a repeat, detach the start node.
  for (const node of nodes.values()) {
    if (node.parentId === null) continue;
    const seen = new Set<string>();
    let cursor: JsonRecord | undefined = node;
    while (cursor && cursor.parentId !== null) {
      if (seen.has(cursor.id as string)) {
        detach(node);
        break;
      }
      seen.add(cursor.id as string);
      cursor = nodes.get(cursor.parentId as string);
    }
  }

  // Rebuild document roots: original order first, then newly-orphaned roots.
  for (const doc of state.documents) {
    const docNodes = state.nodes.filter(
      (n) => nodes.has(n.id as string) && n.documentId === doc.id && n.parentId === null,
    );
    const rootSet = new Set(docNodes.map((n) => n.id as string));
    const ordered: string[] = [];
    const orderedSet = new Set<string>();
    for (const id of doc.rootNodeIds as string[]) {
      if (rootSet.has(id) && !orderedSet.has(id)) {
        ordered.push(id);
        orderedSet.add(id);
      }
    }
    for (const n of docNodes) {
      const id = n.id as string;
      if (!orderedSet.has(id)) {
        ordered.push(id);
        orderedSet.add(id);
      }
    }
    doc.rootNodeIds = ordered;
  }

  // Anything still unreachable is dropped so the codec's coverage check passes.
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    const node = nodes.get(id);
    if (!node) return;
    reachable.add(id);
    for (const childId of node.childIds as string[]) visit(childId);
  };
  for (const doc of state.documents) for (const id of doc.rootNodeIds as string[]) visit(id);
  state.nodes = state.nodes.filter((n) => reachable.has(n.id as string));

  state.pages = state.pages.filter((p) => pages.has(p.id as string));
  state.frames = state.frames.filter((f) => frames.has(f.id as string));
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * A storage write cut short (quota, crash mid-flush) leaves the payload
 * truncated at an arbitrary byte. Recover by cutting the tail back to the
 * last complete member boundary inside the innermost open container, then
 * closing every container still open. Returns null when no parseable
 * document remains.
 */
function salvageTruncatedJson(text: string): unknown | null {
  const stack: { closer: string; lastMemberEnd: number }[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push({ closer: "}", lastMemberEnd: i + 1 });
    } else if (ch === "[") {
      stack.push({ closer: "]", lastMemberEnd: i + 1 });
    } else if (ch === ",") {
      if (stack.length === 0) return null;
      stack[stack.length - 1]!.lastMemberEnd = i;
    } else if (ch === "}" || ch === "]") {
      const open = stack.pop();
      if (!open || open.closer !== ch) return null;
      if (stack.length === 0) {
        // A complete document followed by trailing garbage — keep the document.
        try {
          return JSON.parse(text.slice(0, i + 1));
        } catch {
          return null;
        }
      }
      // A nested container close also completes its parent's member value.
      stack[stack.length - 1]!.lastMemberEnd = i + 1;
    }
  }
  if (stack.length === 0) return null;
  const cut = stack[stack.length - 1]!.lastMemberEnd;
  const closers = stack
    .map((open) => open.closer)
    .reverse()
    .join("");
  try {
    return JSON.parse(text.slice(0, cut) + closers);
  } catch {
    return null;
  }
}

/**
 * Returns a repaired JSON string for a damaged project payload, or null when
 * nothing salvageable remains (not JSON, not this file kind, or a future
 * schema we cannot safely interpret).
 */
export function repairWireCanvasProjectJson(text: string): string | null {
  if (typeof text !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = salvageTruncatedJson(text);
    if (parsed === null) return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.kind !== WIRECANVAS_FILE_KIND) return null;
  if (
    typeof parsed.schemaVersion === "number" &&
    parsed.schemaVersion > WIRECANVAS_FILE_SCHEMA_VERSION
  ) {
    return null;
  }
  const input = isRecord(parsed.state) ? parsed.state : {};

  const documents = dedupeIds(
    (Array.isArray(input.documents) ? input.documents : [])
      .map((item, index) => repairDocument(item, index))
      .filter((item): item is JsonRecord => item !== null) as { id: string }[],
  ).slice(0, MAX_ITEMS);
  const pages = dedupeIds(
    (Array.isArray(input.pages) ? input.pages : [])
      .map((item, index) => repairPage(item, index))
      .filter((item): item is JsonRecord => item !== null) as { id: string }[],
  ).slice(0, MAX_ITEMS);
  const frames = dedupeIds(
    (Array.isArray(input.frames) ? input.frames : [])
      .map((item, index) => repairFrame(item, index))
      .filter((item): item is JsonRecord => item !== null) as { id: string }[],
  ).slice(0, MAX_ITEMS);
  const nodes = dedupeIds(
    (Array.isArray(input.nodes) ? input.nodes : [])
      .map((item, index) => repairNode(item, index))
      .filter((item): item is JsonRecord => item !== null) as { id: string }[],
  ).slice(0, MAX_ITEMS);

  const state = { documents, pages, frames, nodes };
  repairRelations(state);

  const keptFrameIds = new Set(state.frames.map((f) => f.id as string));
  const keptNodeIds = new Set(state.nodes.map((n) => n.id as string));
  const keptPageIds = new Set(state.pages.map((p) => p.id as string));

  const selectionInput = isRecord(input.selection) ? input.selection : {};
  const frameIds = idList(selectionInput.frameIds).filter((id) => keptFrameIds.has(id));
  const nodeIds = elementIdList(selectionInput.nodeIds).filter((id) => keptNodeIds.has(id));
  const primaryFrameId = nullableIdStr(selectionInput.primaryFrameId);
  const primaryNodeId = nullableElementIdStr(selectionInput.primaryNodeId);

  const activePageId = nullableIdStr(input.activePageId);

  const repaired = {
    kind: WIRECANVAS_FILE_KIND,
    schemaVersion: WIRECANVAS_FILE_SCHEMA_VERSION,
    state: {
      session: repairSession(input.session),
      tokens: repairTokens(input.tokens),
      documents: state.documents,
      pages: state.pages,
      frames: state.frames,
      nodes: state.nodes,
      activePageId:
        keptPageIds.size === 0
          ? null
          : activePageId !== null && keptPageIds.has(activePageId)
            ? activePageId
            : (state.pages[0]!.id as string),
      selection: {
        frameIds,
        nodeIds,
        primaryFrameId: primaryFrameId !== null && frameIds.includes(primaryFrameId) ? primaryFrameId : null,
        primaryNodeId: primaryNodeId !== null && nodeIds.includes(primaryNodeId) ? primaryNodeId : null,
      },
      activeTool: TOOLS.has(input.activeTool as string) ? input.activeTool : "select",
    },
  };
  return JSON.stringify(repaired);
}
