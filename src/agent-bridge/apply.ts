import {
  createFrameCommand,
  EditorCommandError,
  removeFrameCommand,
  selectBriefFrameCommand,
  setSelectionCommand,
  switchPageCommand,
} from "../editor/commands";
import type { EditorState } from "../editor/model";
import type { EditorStore } from "../editor/store";
import {
  DocumentExchangeError,
  DocumentExchangeService,
  validateRouterHtml,
} from "../router/document-exchange";
import { buildDesignDocumentHtml, type AgentOpResult, type AgentPushOp } from "./protocol";

const DEFAULT_FRAME_WIDTH = 1440;
const DEFAULT_FRAME_HEIGHT = 900;
const DEFAULT_BACKGROUND = "#ffffff";
/** Horizontal gap between the rightmost frame and an auto-placed push. */
const PLACEMENT_GAP = 120;
const FALLBACK_PAGE_ID = "agent";

function createId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function errorResult(op: string, code: string, message: string, violations?: unknown): AgentOpResult {
  return { ok: false, op, error: { code, message, ...(violations ? { violations } : {}) } };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Free spot on the page: right of the rightmost frame, aligned to the top row. */
function defaultPlacement(state: EditorState, pageId: string): { x: number; y: number } {
  const siblings = Object.values(state.frames).filter((frame) => frame.pageId === pageId);
  if (siblings.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.max(...siblings.map((frame) => frame.x + frame.width)) + PLACEMENT_GAP,
    y: Math.min(...siblings.map((frame) => frame.y)),
  };
}

function listResult(state: EditorState): AgentOpResult {
  return {
    ok: true,
    op: "list",
    activePageId: state.activePageId,
    session: {
      lifecycle: state.session.lifecycle,
      revision: state.session.revision,
    },
    pages: Object.values(state.pages).map((page) => ({
      id: page.id,
      name: page.name,
      documentId: page.documentId,
      frameIds: page.frameIds,
    })),
    frames: Object.values(state.frames).map((frame) => ({
      id: frame.id,
      pageId: frame.pageId,
      documentId: frame.documentId,
      name: frame.name,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      background: frame.background,
      freeform: frame.freeform ?? false,
      mode: state.documents[frame.documentId]?.mode ?? "design",
    })),
    documents: Object.values(state.documents).map((document) => ({
      id: document.id,
      name: document.name,
      mode: document.mode,
      revision: document.revision,
      htmlBytes: new TextEncoder().encode(document.srcDoc).byteLength,
    })),
  };
}

function applyPush(store: EditorStore, input: AgentPushOp): AgentOpResult {
  const state = store.getState();
  const lifecycle = state.session.lifecycle;
  if (lifecycle === "briefing" || lifecycle === "wireframing") {
    return errorResult(
      "push",
      "brainstorm-wireframe-required",
      "Active Brainstorm sessions only accept agent HTML in wireframe mode",
    );
  }

  const html = buildDesignDocumentHtml({ ...input, title: input.name });
  if (html === null) {
    return errorResult("push", "invalid-input", "push requires html, css+fragment, or fragment");
  }

  const frameTarget = input.id ? state.frames[input.id] : undefined;
  const documentTarget = input.documentId
    ? state.documents[input.documentId]
    : input.id
      ? state.documents[input.id]
      : undefined;

  // Replace path: an id/documentId that resolves to existing state swaps the
  // document's srcDoc in place; frame sizing/name can be patched along with it.
  if (frameTarget || documentTarget) {
    const documentId = frameTarget?.documentId ?? documentTarget!.id;
    const document = state.documents[documentId];
    const exchange = new DocumentExchangeService(store);
    try {
      store.transact(`Agent update ${document.name}`, () => {
        exchange.replaceHtml({
          documentId,
          expectedRevision: document.revision,
          html,
          mode: document.mode,
        });
        if (frameTarget) {
          const patch: {
            name?: string;
            width?: number;
            height?: number;
            background?: string;
          } = {};
          if (typeof input.name === "string" && input.name.trim()) patch.name = input.name.trim();
          if (isFiniteNumber(input.width) && input.width > 0) patch.width = input.width;
          if (isFiniteNumber(input.height) && input.height > 0) patch.height = input.height;
          if (typeof input.background === "string" && input.background.trim()) {
            patch.background = input.background;
          }
          if (Object.keys(patch).length > 0) {
            store.execute(
              { type: "frame/update", frameId: frameTarget.id, patch },
              { history: "skip" },
            );
          }
        }
      });
    } catch (error) {
      return mapError("push", error);
    }
    const updated = store.getState().documents[documentId];
    return {
      ok: true,
      op: "push",
      created: false,
      frameId: frameTarget?.id ?? null,
      documentId,
      mode: updated.mode,
      revision: updated.revision,
    };
  }

  // Create path.
  if (input.id && state.pages[input.id]) {
    return errorResult("push", "id-conflict", `id ${input.id} collides with an existing page`);
  }
  const frameId = input.id?.trim() ? input.id : createId("agent");
  const documentId = input.documentId ?? `${frameId}-doc`;
  if (state.documents[documentId]) {
    return errorResult("push", "id-conflict", `documentId ${documentId} already exists`);
  }

  const width = isFiniteNumber(input.width) && input.width > 0 ? input.width : DEFAULT_FRAME_WIDTH;
  const height = isFiniteNumber(input.height) && input.height > 0 ? input.height : DEFAULT_FRAME_HEIGHT;
  if ((input.x !== undefined && !isFiniteNumber(input.x)) || (input.y !== undefined && !isFiniteNumber(input.y))) {
    return errorResult("push", "invalid-position", "x and y must be finite numbers");
  }

  let validation;
  try {
    validation = validateRouterHtml(html);
  } catch (error) {
    return mapError("push", error);
  }

  const pageId = state.activePageId ?? FALLBACK_PAGE_ID;
  const placement = defaultPlacement(state, pageId);
  const x = input.x ?? placement.x;
  const y = input.y ?? placement.y;
  const name = input.name?.trim() || validation.title?.trim() || "Agent design";
  const background = input.background?.trim() || DEFAULT_BACKGROUND;

  try {
    store.transact(`Agent push ${name}`, () => {
      store.execute(selectBriefFrameCommand(null), { history: "skip" });
      store.execute(
        createFrameCommand({
          id: frameId,
          name,
          documentId,
          documentName: name,
          pageId,
          pageName: "Agent",
          mode: "design",
          x,
          y,
          width,
          height,
          srcDoc: html,
          background,
        }),
        { history: "skip" },
      );
      store.execute(switchPageCommand(pageId), { history: "skip" });
      store.execute(
        setSelectionCommand({
          frameIds: [frameId],
          nodeIds: [],
          primaryFrameId: frameId,
          primaryNodeId: null,
        }),
        { history: "skip" },
      );
    });
  } catch (error) {
    return mapError("push", error);
  }

  return {
    ok: true,
    op: "push",
    created: true,
    frameId,
    documentId,
    pageId,
    name,
    x,
    y,
    width,
    height,
    htmlBytes: validation.htmlBytes,
  };
}

function applyRemove(store: EditorStore, input: { frameId?: unknown }): AgentOpResult {
  const frameId = typeof input.frameId === "string" ? input.frameId : "";
  const frame = frameId ? store.getState().frames[frameId] : undefined;
  if (!frame) {
    return errorResult("remove", "frame-not-found", `Unknown frame: ${frameId || "(missing)"}`);
  }
  try {
    store.transact(`Agent remove ${frame.name}`, () => {
      store.execute(removeFrameCommand(frame.id), { history: "skip" });
    });
  } catch (error) {
    return mapError("remove", error);
  }
  return { ok: true, op: "remove", frameId: frame.id, documentId: frame.documentId };
}

function mapError(op: string, error: unknown): AgentOpResult {
  if (error instanceof DocumentExchangeError) {
    return errorResult(op, error.code, error.message, error.violations);
  }
  if (error instanceof EditorCommandError) {
    return errorResult(op, "invalid-input", error.message);
  }
  return errorResult(op, "internal", error instanceof Error ? error.message : String(error));
}

/** Applies one agent op against the live editor store. Never throws. */
export function applyAgentOp(store: EditorStore, raw: unknown): AgentOpResult {
  const op = raw && typeof raw === "object" && "op" in raw ? (raw as { op: unknown }).op : undefined;
  try {
    switch (op) {
      case "push":
        return applyPush(store, raw as AgentPushOp);
      case "remove":
        return applyRemove(store, raw as { frameId?: unknown });
      case "list":
        return listResult(store.getState());
      default:
        return errorResult(
          typeof op === "string" ? op : "unknown",
          "invalid-op",
          "op must be one of: push, remove, list",
        );
    }
  } catch (error) {
    return mapError(typeof op === "string" ? op : "unknown", error);
  }
}
