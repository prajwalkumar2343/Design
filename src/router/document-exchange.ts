import {
  createPageCommand,
  createFrameCommand,
  replaceDocumentHtmlCommand,
  switchPageCommand,
  wireframeCreatedCommand,
} from "../editor/commands";
import type { DocumentEntity, DocumentMode } from "../editor/model";
import { EditorReducerError } from "../editor/reducer";
import type { EditorStore } from "../editor/store";
import {
  BrainstormSessionReducerError,
  type BrainstormSessionReducerErrorCode,
} from "../session/reducer";
import { HtmlAdmissionError, validateCompleteHtml } from "./html-admission";
import {
  validateWireframeHtml,
  WireframeAdmissionError,
  type WireframeViolation,
  type WireframeViolationCode,
} from "./wireframe-admission";

export { MAX_ROUTER_HTML_BYTES } from "./html-admission";
export type { HtmlValidationResult } from "./html-admission";
export type { DocumentMode } from "../editor/model";
export { validateWireframeHtml } from "./wireframe-admission";
export type { WireframeViolation, WireframeViolationCode } from "./wireframe-admission";

export type DocumentExchangeErrorCode =
  | "document-not-found"
  | "invalid-html"
  | "invalid-revision"
  | "reserved-runtime-marker"
  | "reserved-wireframe-theme-marker"
  | "stale-revision"
  | "html-too-large"
  | "mode-required"
  | "invalid-mode"
  | "brainstorm-wireframe-required"
  | "brainstorm-session-required"
  | "duplicate-document-id"
  | "duplicate-page-id"
  | "duplicate-frame-id"
  | "inconsistent-wireframe-ids"
  | "invalid-position"
  | "invalid-size"
  | "invalid-background"
  | "invalid-input"
  | "invalid-session-revision"
  | "stale-session-revision"
  | "invalid-lifecycle-transition"
  | `wireframe-${WireframeViolationCode}`;

export interface DocumentHtmlSnapshot {
  documentId: string;
  html: string;
  mode: DocumentMode;
  revision: number;
}

export interface ReplaceDocumentHtmlInput {
  documentId: string;
  expectedRevision: number;
  html: string;
  mode: DocumentMode;
}

export interface ReplaceDocumentHtmlResult {
  documentId: string;
  mode: DocumentMode;
  previousRevision: number;
  revision: number;
  changed: boolean;
  affectedFrameIds: string[];
  htmlBytes: number;
}

export interface CreateWireframeInput {
  mode: "wireframe";
  expectedSessionRevision: number;
  documentId: string;
  pageId: string;
  frameId: string;
  documentName: string;
  pageName: string;
  frameName: string;
  html: string;
  x: number;
  y: number;
  width: number;
  height: number;
  background: string;
}

export interface CreateWireframeResult {
  documentId: string;
  pageId: string;
  frameId: string;
  mode: "wireframe";
  documentRevision: number;
  previousSessionRevision: number;
  sessionRevision: number;
  affectedFrameIds: string[];
  htmlBytes: number;
}

export class DocumentExchangeError extends Error {
  readonly code: DocumentExchangeErrorCode;
  readonly violations?: readonly WireframeViolation[];

  constructor(
    code: DocumentExchangeErrorCode,
    message: string,
    options: { violations?: readonly WireframeViolation[] } = {},
  ) {
    super(message);
    this.name = "DocumentExchangeError";
    this.code = code;
    this.violations = options.violations;
  }
}

export function validateRouterHtml(html: string) {
  try {
    return validateCompleteHtml(html);
  } catch (error) {
    if (error instanceof HtmlAdmissionError) {
      throw new DocumentExchangeError(error.code, error.message);
    }
    throw error;
  }
}

function validateExpectedRevision(expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new DocumentExchangeError(
      "invalid-revision",
      "Expected revision must be a positive safe integer",
    );
  }
}

function validateStableId(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DocumentExchangeError(
      "inconsistent-wireframe-ids",
      `${field} must be a non-empty stable id`,
    );
  }
}

function validateCreateWireframeInput(input: CreateWireframeInput): void {
  if (input.mode === undefined) {
    throw new DocumentExchangeError("mode-required", "Wireframe creation must declare mode wireframe");
  }
  if (input.mode !== "wireframe") {
    throw new DocumentExchangeError("invalid-mode", "Wireframe creation only accepts mode wireframe");
  }
  if (!Number.isSafeInteger(input.expectedSessionRevision) || input.expectedSessionRevision < 1) {
    throw new DocumentExchangeError(
      "invalid-session-revision",
      "Expected brainstorm session revision must be a positive safe integer",
    );
  }
  validateStableId(input.documentId, "documentId");
  validateStableId(input.pageId, "pageId");
  validateStableId(input.frameId, "frameId");
  if (new Set([input.documentId, input.pageId, input.frameId]).size !== 3) {
    throw new DocumentExchangeError(
      "inconsistent-wireframe-ids",
      "documentId, pageId, and frameId must be distinct",
    );
  }
  for (const [field, value] of [
    ["documentName", input.documentName],
    ["pageName", input.pageName],
    ["frameName", input.frameName],
    ["background", input.background],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new DocumentExchangeError("invalid-input", `${field} must not be empty`);
    }
  }
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    throw new DocumentExchangeError("invalid-position", "Wireframe x and y must be finite numbers");
  }
  if (!Number.isFinite(input.width) || input.width <= 0 || !Number.isFinite(input.height) || input.height <= 0) {
    throw new DocumentExchangeError("invalid-size", "Wireframe width and height must be positive finite numbers");
  }
}

function validateDocumentMode(mode: unknown): asserts mode is DocumentMode {
  if (mode === undefined) {
    throw new DocumentExchangeError(
      "mode-required",
      "Codex document replacement must declare an explicit document mode",
    );
  }
  if (mode !== "design" && mode !== "wireframe") {
    throw new DocumentExchangeError(
      "invalid-mode",
      "Document mode must be either design or wireframe",
    );
  }
}

function wireframeErrorCode(code: WireframeViolationCode): `wireframe-${WireframeViolationCode}` {
  return `wireframe-${code}`;
}

function mapWireframeAdmissionError(error: WireframeAdmissionError): DocumentExchangeError {
  const first = error.violations[0];
  return new DocumentExchangeError(
    wireframeErrorCode(first.code),
    first.message,
    { violations: error.violations },
  );
}

/** Transport-independent document boundary for the Codex router plugin. */
export class DocumentExchangeService {
  constructor(private readonly store: EditorStore) {}

  getHtml(documentId: string): DocumentHtmlSnapshot {
    const document = this.requireDocument(documentId);
    return {
      documentId: document.id,
      html: document.srcDoc,
      mode: document.mode,
      revision: document.revision,
    };
  }

  replaceHtml(input: ReplaceDocumentHtmlInput): ReplaceDocumentHtmlResult {
    validateExpectedRevision(input.expectedRevision);
    validateDocumentMode(input.mode);

    const document = this.requireDocument(input.documentId);
    if (document.revision !== input.expectedRevision) {
      throw new DocumentExchangeError(
        "stale-revision",
        `Document ${document.id} is at revision ${document.revision}, not ${input.expectedRevision}`,
      );
    }

    const lifecycle = this.store.getState().session.lifecycle;
    if ((lifecycle === "briefing" || lifecycle === "wireframing") && input.mode !== "wireframe") {
      throw new DocumentExchangeError(
        "brainstorm-wireframe-required",
        "Active Brainstorm sessions only accept agent HTML in wireframe mode",
      );
    }

    const validation = input.mode === "wireframe"
      ? this.validateWireframe(input.html)
      : validateRouterHtml(input.html);
    const changed = this.store.execute(
      replaceDocumentHtmlCommand({
        documentId: document.id,
        expectedRevision: input.expectedRevision,
        srcDoc: input.html,
        mode: input.mode,
      }),
      { label: `Replace ${input.mode} HTML for ${document.name}` },
    );
    const updatedDocument = this.store.getState().documents[document.id];
    const affectedFrameIds = Object.values(this.store.getState().frames)
      .filter((frame) => frame.documentId === document.id)
      .map((frame) => frame.id);

    return {
      documentId: document.id,
      mode: updatedDocument.mode,
      previousRevision: document.revision,
      revision: updatedDocument.revision,
      changed,
      affectedFrameIds,
      htmlBytes: validation.htmlBytes,
    };
  }

  createWireframe(input: CreateWireframeInput): CreateWireframeResult {
    validateCreateWireframeInput(input);

    const before = this.store.getState();
    const session = before.session;
    if (session.lifecycle !== "briefing" && session.lifecycle !== "wireframing") {
      throw new DocumentExchangeError(
        session.lifecycle === "not-started" ? "brainstorm-session-required" : "invalid-lifecycle-transition",
        "Wireframe creation requires an active Brainstorm session in briefing or wireframing",
      );
    }
    if (session.revision !== input.expectedSessionRevision) {
      throw new DocumentExchangeError(
        "stale-session-revision",
        `Brainstorm session is at revision ${session.revision}, not ${input.expectedSessionRevision}`,
      );
    }
    if (before.documents[input.documentId]) {
      throw new DocumentExchangeError("duplicate-document-id", `Document already exists: ${input.documentId}`);
    }
    if (before.pages[input.pageId]) {
      throw new DocumentExchangeError("duplicate-page-id", `Page already exists: ${input.pageId}`);
    }
    if (before.frames[input.frameId]) {
      throw new DocumentExchangeError("duplicate-frame-id", `Frame already exists: ${input.frameId}`);
    }

    const validation = this.validateWireframe(input.html);
    const document: DocumentEntity = {
      id: input.documentId,
      name: input.documentName.trim(),
      mode: "wireframe",
      srcDoc: input.html,
      revision: 1,
      rootNodeIds: [],
      pageIds: [input.pageId],
    };

    try {
      this.store.transact(`Create wireframe ${document.name}`, () => {
        this.store.execute({ type: "document/create", document }, { history: "skip" });
        this.store.execute(createPageCommand({
          id: input.pageId,
          documentId: input.documentId,
          name: input.pageName.trim(),
          frameIds: [input.frameId],
        }), { history: "skip" });
        this.store.execute(createFrameCommand({
          id: input.frameId,
          name: input.frameName.trim(),
          documentId: input.documentId,
          pageId: input.pageId,
          mode: "wireframe",
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
          srcDoc: input.html,
          background: input.background,
        }), { history: "skip" });
        this.store.execute(switchPageCommand(input.pageId), { history: "skip" });
        this.store.execute(wireframeCreatedCommand(input.expectedSessionRevision), { history: "skip" });
      });
    } catch (error) {
      const reducerError = error instanceof BrainstormSessionReducerError
        ? error
        : error instanceof EditorReducerError && error.cause instanceof BrainstormSessionReducerError
          ? error.cause
          : null;
      if (reducerError) {
        const code = reducerError.code === "stale-revision"
          ? "stale-session-revision"
          : reducerError.code === "invalid-revision"
            ? "invalid-session-revision"
            : reducerError.code === "invalid-lifecycle-transition"
              ? "invalid-lifecycle-transition"
              : "invalid-input";
        throw new DocumentExchangeError(code, reducerError.message);
      }
      throw error;
    }

    const after = this.store.getState();
    return {
      documentId: input.documentId,
      pageId: input.pageId,
      frameId: input.frameId,
      mode: "wireframe",
      documentRevision: after.documents[input.documentId].revision,
      previousSessionRevision: session.revision,
      sessionRevision: after.session.revision,
      affectedFrameIds: [input.frameId],
      htmlBytes: validation.htmlBytes,
    };
  }

  private validateWireframe(html: string) {
    try {
      return validateWireframeHtml(html);
    } catch (error) {
      if (error instanceof WireframeAdmissionError) throw mapWireframeAdmissionError(error);
      throw error;
    }
  }

  private requireDocument(documentId: string): DocumentEntity {
    const document = this.store.getState().documents[documentId];
    if (!document) {
      throw new DocumentExchangeError(
        "document-not-found",
        `Unknown document: ${documentId}`,
      );
    }
    return document;
  }
}
