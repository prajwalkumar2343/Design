import {
  insertDesignDocumentFromHtml,
  PASTED_FRAME_DEFAULT_HEIGHT,
  PASTED_FRAME_DEFAULT_WIDTH,
  sanitizeImportedHtml,
  type PastedFrameResult,
} from "../clipboard/paste-html";
import type { EditorStore } from "../editor/store";
import { HtmlAdmissionError, validateCompleteHtml } from "../router/html-admission";

// Paper-like .html file import for design mode: a saved webpage lands as a
// live, full-styled design frame (never wireframe admission). Untrusted file
// bytes go through the same sanitize + complete-document + validate pipeline
// as clipboard paste (see src/clipboard/paste-html.ts for the security
// boundary), and insertion reuses the same undoable transaction core, so
// paste, file import, and the agent createDesignDocument operation all store
// identical canonical bytes that round-trip through .wirecanvas.json and code
// export byte-for-byte.

export const IMPORTED_HTML_DEFAULT_NAME = "Imported HTML";
export const IMPORTED_HTML_MAX_NAME_LENGTH = 48;

export interface PreparedHtmlFileImport {
  srcDoc: string;
  name: string;
  removedExecutables: boolean;
}

function humanizeFileStem(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const withoutExtension = base.replace(/\.html?$/i, "").trim();
  if (withoutExtension.length === 0) {
    return null;
  }
  const humanized = withoutExtension.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (humanized.length === 0) {
    return null;
  }
  return humanized.length > IMPORTED_HTML_MAX_NAME_LENGTH
    ? `${humanized.slice(0, IMPORTED_HTML_MAX_NAME_LENGTH)}…`
    : humanized;
}

function readDocumentTitle(html: string): string | null {
  try {
    const title = new DOMParser().parseFromString(html, "text/html").title.trim();
    if (title.length === 0) {
      return null;
    }
    return title.length > IMPORTED_HTML_MAX_NAME_LENGTH
      ? `${title.slice(0, IMPORTED_HTML_MAX_NAME_LENGTH)}…`
      : title;
  } catch {
    return null;
  }
}

/**
 * Name an imported file after its <title> element, falling back to a
 * humanized file stem (e.g. "pricing-page.html" becomes "pricing page").
 */
export function resolveImportedHtmlName(html: string, filename: string): string {
  return readDocumentTitle(html)
    ?? humanizeFileStem(filename)
    ?? IMPORTED_HTML_DEFAULT_NAME;
}

function ensureCompleteDocument(html: string): string {
  const trimmed = html.trim();
  if (/<!doctype\s+html/i.test(trimmed)) {
    return trimmed;
  }
  const hasDocumentStructure = /<html[\s>]/i.test(trimmed)
    || /<head[\s>]/i.test(trimmed)
    || /<body[\s>]/i.test(trimmed);
  if (hasDocumentStructure) {
    return `<!doctype html>\n${trimmed}`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${trimmed}</body></html>`;
}

function wrapAdmissionError(error: unknown, filename: string): never {
  if (error instanceof HtmlAdmissionError) {
    const detail = error.code === "html-too-large"
      ? `The file "${filename}" is too large to import (over 2 MB).`
      : error.code === "reserved-runtime-marker" || error.code === "reserved-wireframe-theme-marker"
        ? `The file "${filename}" uses a reserved Canvas runtime attribute.`
        : `The file "${filename}" is not a complete HTML document.`;
    throw new HtmlAdmissionError(error.code, detail);
  }
  throw error;
}

/**
 * Normalize raw file bytes into a complete, validated HTML document. Rejects
 * with an honest HtmlAdmissionError without touching editor state; accepted
 * HTML keeps full styling (design mode, no wireframe grayscale stripping).
 */
export function prepareHtmlFileImport(raw: string, filename: string): PreparedHtmlFileImport {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new HtmlAdmissionError("invalid-html", `The file "${filename}" is empty.`);
  }
  const name = resolveImportedHtmlName(raw, filename);
  let srcDoc: string;
  let removedExecutables = false;
  try {
    const sanitized = sanitizeImportedHtml(raw);
    removedExecutables = sanitized.removedExecutables;
    srcDoc = ensureCompleteDocument(sanitized.html);
    validateCompleteHtml(srcDoc);
  } catch (error) {
    wrapAdmissionError(error, filename);
  }
  return { srcDoc, name, removedExecutables };
}

/**
 * Insert prepared file HTML as one undoable "Import HTML file" transaction:
 * a new design-mode document (revision 1), page, and frame sized to the
 * 800x600 default (files carry no captured section geometry), selected and
 * ready for camera fitting by the caller.
 */
export function importHtmlFileIntoStore(
  store: EditorStore,
  srcDoc: string,
  name: string,
  position: { x: number; y: number },
): PastedFrameResult {
  return insertDesignDocumentFromHtml(store, srcDoc, {
    name,
    documentName: name,
    pageName: "Page 1",
    width: PASTED_FRAME_DEFAULT_WIDTH,
    height: PASTED_FRAME_DEFAULT_HEIGHT,
    background: "#ffffff",
    position,
    transactionLabel: "Import HTML file",
  });
}
