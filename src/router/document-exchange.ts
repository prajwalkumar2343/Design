import { BRIDGE_RUNTIME_MARKER } from "../bridge/runtime";
import { replaceDocumentHtmlCommand } from "../editor/commands";
import type { DocumentEntity } from "../editor/model";
import type { EditorStore } from "../editor/store";

export const MAX_ROUTER_HTML_BYTES = 2 * 1024 * 1024;

export type DocumentExchangeErrorCode =
  | "document-not-found"
  | "invalid-html"
  | "invalid-revision"
  | "reserved-runtime-marker"
  | "stale-revision"
  | "html-too-large";

export interface DocumentHtmlSnapshot {
  documentId: string;
  html: string;
  revision: number;
}

export interface ReplaceDocumentHtmlInput {
  documentId: string;
  expectedRevision: number;
  html: string;
}

export interface ReplaceDocumentHtmlResult {
  documentId: string;
  previousRevision: number;
  revision: number;
  changed: boolean;
  affectedFrameIds: string[];
  htmlBytes: number;
}

export interface HtmlValidationResult {
  htmlBytes: number;
  title: string;
  language: string | null;
}

export class DocumentExchangeError extends Error {
  readonly code: DocumentExchangeErrorCode;

  constructor(code: DocumentExchangeErrorCode, message: string) {
    super(message);
    this.name = "DocumentExchangeError";
    this.code = code;
  }
}

function htmlByteLength(html: string): number {
  return new TextEncoder().encode(html).byteLength;
}

export function validateRouterHtml(html: string): HtmlValidationResult {
  if (typeof html !== "string" || html.trim().length === 0 || html.includes("\0")) {
    throw new DocumentExchangeError(
      "invalid-html",
      "Codex must supply a non-empty HTML document without null bytes",
    );
  }

  const htmlBytes = htmlByteLength(html);
  if (htmlBytes > MAX_ROUTER_HTML_BYTES) {
    throw new DocumentExchangeError(
      "html-too-large",
      `HTML document is ${htmlBytes} bytes; the limit is ${MAX_ROUTER_HTML_BYTES}`,
    );
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  if (!parsed.doctype || parsed.doctype.name.toLowerCase() !== "html") {
    throw new DocumentExchangeError(
      "invalid-html",
      "Codex must supply a complete HTML document with an HTML doctype",
    );
  }
  if (parsed.querySelector(`script[${BRIDGE_RUNTIME_MARKER}]`)) {
    throw new DocumentExchangeError(
      "reserved-runtime-marker",
      `HTML cannot define the reserved ${BRIDGE_RUNTIME_MARKER} runtime marker`,
    );
  }

  return {
    htmlBytes,
    title: parsed.title,
    language: parsed.documentElement.getAttribute("lang"),
  };
}

/**
 * Transport-independent document boundary for the Codex router plugin.
 * The service performs no model calls and preserves the exact admitted HTML.
 */
export class DocumentExchangeService {
  constructor(private readonly store: EditorStore) {}

  getHtml(documentId: string): DocumentHtmlSnapshot {
    const document = this.requireDocument(documentId);
    return {
      documentId: document.id,
      html: document.srcDoc,
      revision: document.revision,
    };
  }

  replaceHtml(input: ReplaceDocumentHtmlInput): ReplaceDocumentHtmlResult {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new DocumentExchangeError(
        "invalid-revision",
        "Expected revision must be a positive safe integer",
      );
    }

    const document = this.requireDocument(input.documentId);
    if (document.revision !== input.expectedRevision) {
      throw new DocumentExchangeError(
        "stale-revision",
        `Document ${document.id} is at revision ${document.revision}, not ${input.expectedRevision}`,
      );
    }

    const validation = validateRouterHtml(input.html);
    const changed = this.store.execute(
      replaceDocumentHtmlCommand({
        documentId: document.id,
        expectedRevision: input.expectedRevision,
        srcDoc: input.html,
      }),
      { label: `Replace HTML for ${document.name}` },
    );
    const revision = this.store.getState().documents[document.id].revision;
    const affectedFrameIds = Object.values(this.store.getState().frames)
      .filter((frame) => frame.documentId === document.id)
      .map((frame) => frame.id);

    return {
      documentId: document.id,
      previousRevision: document.revision,
      revision,
      changed,
      affectedFrameIds,
      htmlBytes: validation.htmlBytes,
    };
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

