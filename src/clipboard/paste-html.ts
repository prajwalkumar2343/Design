import {
  createFrameCommand,
  selectBriefFrameCommand,
  setActiveToolCommand,
  setSelectionCommand,
  switchPageCommand,
} from "../editor/commands";
import type { EditorStore } from "../editor/store";
import { HtmlAdmissionError, validateCompleteHtml } from "../router/html-admission";

export const PASTE_META_SOURCE_ATTR = "data-canvas-paste-source";
export const PASTE_META_TITLE_ATTR = "data-canvas-paste-title";
export const PASTE_META_WIDTH_ATTR = "data-canvas-paste-width";
export const PASTE_META_HEIGHT_ATTR = "data-canvas-paste-height";
export const PASTE_META_BACKGROUND_ATTR = "data-canvas-paste-background";

// Matches double-quoted, single-quoted, and unquoted attribute forms so the
// extension's metadata never survives into stored/exported documents.
const PASTE_META_ATTR_PATTERN = /\sdata-canvas-paste-[a-z-]+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const PASTE_OPEN_TAG_PATTERN = /<[a-zA-Z][^>]*>/g;

export const PASTED_FRAME_MIN_SIZE = 160;
export const PASTED_FRAME_MAX_SIZE = 2400;
export const PASTED_FRAME_DEFAULT_WIDTH = 800;
export const PASTED_FRAME_DEFAULT_HEIGHT = 600;
export const PASTED_FRAME_DEFAULT_BACKGROUND = "#ffffff";

const PASTE_ERROR_MESSAGES: Record<string, string> = {
  "invalid-html": "The clipboard content is not a complete HTML document.",
  "html-too-large": "The copied section is too large to paste (over 2 MB).",
  "reserved-runtime-marker": "The copied HTML uses a reserved Canvas runtime attribute.",
  "reserved-wireframe-theme-marker": "The copied HTML uses a reserved Canvas theme attribute.",
};

// ---------------------------------------------------------------------------
// Untrusted-HTML sanitizer (clipboard + file import).
//
// SECURITY BOUNDARY - design import vs wireframe admission:
// - Design import (this module + src/import-html/html-file-import.ts) keeps
//   full styling: colors, backgrounds, borders, fonts, layout, images, media,
//   external stylesheets, and navigation are all preserved, because imported
//   HTML is full-styled design content, never wireframe content.
// - What design import REMOVES before storage: <script> elements, plugin-like
//   executable embeds (<object>, <embed>, <applet>, <portal>), <base> (its
//   only function is hijacking relative URLs), event-handler attributes
//   (on*), javascript: URLs in URL attributes, and srcdoc embeds. The render
//   sandbox (sandbox="allow-scripts" without allow-same-origin) already
//   contains execution, but untrusted clipboard/file HTML is sanitized anyway
//   so saved webpages land as inert visual content.
// - What design import REJECTS (fail-closed, state untouched): empty input,
//   documents over 2 MB, and the reserved bridge/token/wireframe-theme
//   markers (runtime impersonation) via validateCompleteHtml.
// - Wireframe admission (src/router/wireframe-admission.ts) is far stricter:
//   on top of the above it also strips colors, backgrounds, borders, motion,
//   media/images, external resources, forms, and navigation, because Canvas
//   owns all visual treatment for wireframes.
// - The trusted agent path (DocumentExchangeService.createDesignDocument and
//   replaceHtml in design mode) does NOT sanitize: Codex-supplied scripts are
//   legitimate design content (the product renders HTML/CSS/JavaScript) and
//   stay sandbox-contained at render time.
// ---------------------------------------------------------------------------

const EXECUTABLE_ELEMENT_SELECTOR = "script, object, embed, applet, portal, base";

const EXECUTABLE_URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "cite",
  "data",
  "poster",
  "background",
  "xlink:href",
]);

// Fast-path gate for the DOMParser scrub below. Every browser-reachable
// spelling must trip it: `/`- or quote-adjacent handlers (`<svg/onload=`,
// `a="b"onload=` — both legal attribute separators in HTML5 tokenization) and
// schemes with interleaved whitespace (`java\tscript:` — browsers strip tabs,
// newlines and control chars before matching the scheme).
const EXECUTABLE_DETECT_PATTERN =
  /<(script|object|embed|applet|portal|base)[\s/>]|j[\s\u0000-\u0020]*a[\s\u0000-\u0020]*v[\s\u0000-\u0020]*a[\s\u0000-\u0020]*s[\s\u0000-\u0020]*c[\s\u0000-\u0020]*r[\s\u0000-\u0020]*i[\s\u0000-\u0020]*p[\s\u0000-\u0020]*t[\s\u0000-\u0020]*:|[\s/"']on[a-zA-Z]+\s*=/i;

function isExecutableUrl(value: string): boolean {
  const cleaned = value.replace(/[\s\u0000-\u0020]+/g, "").toLowerCase();
  return cleaned.startsWith("javascript:");
}

export interface SanitizedImportedHtml {
  html: string;
  removedExecutables: boolean;
}

/**
 * Strip executable content from untrusted HTML. Clean input is returned
 * byte-for-byte unchanged; when anything is removed the result is normalized
 * to a complete document (callers still run ensureCompleteDocument +
 * validateCompleteHtml afterwards, so the fail-closed markers/size checks
 * always apply to the stored bytes).
 */
export function sanitizeImportedHtml(html: string): SanitizedImportedHtml {
  if (!EXECUTABLE_DETECT_PATTERN.test(html)) {
    return { html, removedExecutables: false };
  }
  const parsed = new DOMParser().parseFromString(html, "text/html");
  let removed = false;
  for (const element of Array.from(parsed.querySelectorAll(EXECUTABLE_ELEMENT_SELECTOR))) {
    element.remove();
    removed = true;
  }
  for (const element of Array.from(parsed.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        removed = true;
      } else if (name === "srcdoc") {
        element.removeAttribute(attribute.name);
        removed = true;
      } else if (EXECUTABLE_URL_ATTRIBUTES.has(name) && isExecutableUrl(attribute.value)) {
        if (name === "href" || name === "action" || name === "formaction") {
          element.setAttribute(attribute.name, "#");
        } else {
          element.removeAttribute(attribute.name);
        }
        removed = true;
      }
    }
  }
  if (!removed) {
    return { html, removedExecutables: false };
  }
  return {
    html: `<!doctype html>\n${parsed.documentElement.outerHTML}`,
    removedExecutables: true,
  };
}

export interface PastedHtmlMetadata {
  sourceUrl: string | null;
  title: string | null;
  width: number | null;
  height: number | null;
  background: string | null;
}

export interface PreparedPasteHtml {
  srcDoc: string;
  metadata: PastedHtmlMetadata;
  removedExecutables: boolean;
}

export interface PastedFrameResult {
  frameId: string;
  name: string;
  rect: { x: number; y: number; width: number; height: number };
}

function createStableId(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function decodeMetaText(value: string | null): string | null {
  if (value === null || value.length === 0) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readMetaNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stripPasteMetadata(html: string): string {
  // Metadata normally rides on <html>, but strip it from every opening tag so
  // fragments wrapped into complete documents are covered as well.
  return html.replace(PASTE_OPEN_TAG_PATTERN, (tag) => tag.replace(PASTE_META_ATTR_PATTERN, ""));
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

function wrapAdmissionError(error: unknown): never {
  if (error instanceof HtmlAdmissionError) {
    throw new HtmlAdmissionError(error.code, PASTE_ERROR_MESSAGES[error.code] ?? error.message);
  }
  throw error;
}

/**
 * Normalize raw clipboard content into a complete, validated HTML document.
 * The Canvas Capture extension embeds paste metadata as data attributes on the
 * `<html>` element; those attributes are read here and removed before the HTML
 * is stored on the canvas.
 */
export function preparePastedHtml(raw: string): PreparedPasteHtml {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new HtmlAdmissionError("invalid-html", "The clipboard does not contain any HTML.");
  }

  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const root = parsed.documentElement;
  const metadata: PastedHtmlMetadata = {
    sourceUrl: decodeMetaText(root?.getAttribute(PASTE_META_SOURCE_ATTR) ?? null),
    title: decodeMetaText(root?.getAttribute(PASTE_META_TITLE_ATTR) ?? null),
    width: readMetaNumber(root?.getAttribute(PASTE_META_WIDTH_ATTR) ?? null),
    height: readMetaNumber(root?.getAttribute(PASTE_META_HEIGHT_ATTR) ?? null),
    background: decodeMetaText(root?.getAttribute(PASTE_META_BACKGROUND_ATTR) ?? null),
  };

  let srcDoc: string;
  let removedExecutables = false;
  try {
    const sanitized = sanitizeImportedHtml(stripPasteMetadata(raw));
    removedExecutables = sanitized.removedExecutables;
    srcDoc = ensureCompleteDocument(sanitized.html);
    validateCompleteHtml(srcDoc);
  } catch (error) {
    wrapAdmissionError(error);
  }
  return { srcDoc, metadata, removedExecutables };
}

export function looksLikeHtml(text: string): boolean {
  if (typeof text !== "string" || text.trim().length === 0) {
    return false;
  }
  return /<!doctype\s+html/i.test(text)
    || /<html[\s>]/i.test(text)
    || /<(?:section|div|article|main|header|footer|nav|aside|form|ul|ol|table|figure|p|h[1-6]|span|a|img|button)[\s>]/i.test(text);
}

export function resolvePastedFrameSize(metadata: PastedHtmlMetadata): { width: number; height: number } {
  const clamp = (value: number | null, fallback: number): number => {
    if (value === null || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.min(PASTED_FRAME_MAX_SIZE, Math.max(PASTED_FRAME_MIN_SIZE, Math.round(value)));
  };
  return {
    width: clamp(metadata.width, PASTED_FRAME_DEFAULT_WIDTH),
    height: clamp(metadata.height, PASTED_FRAME_DEFAULT_HEIGHT),
  };
}

function resolvePastedFrameBackground(metadata: PastedHtmlMetadata): string {
  const background = metadata.background?.trim();
  return background && background.length <= 128 ? background : PASTED_FRAME_DEFAULT_BACKGROUND;
}

function sourceHostLabel(sourceUrl: string | null): string | null {
  if (!sourceUrl) {
    return null;
  }
  try {
    return new URL(sourceUrl).hostname || null;
  } catch {
    return null;
  }
}

export function resolvePastedFrameName(metadata: PastedHtmlMetadata): string {
  const title = metadata.title?.trim();
  if (title && title.length > 0) {
    return title.length > 48 ? `${title.slice(0, 48)}…` : title;
  }
  const host = sourceHostLabel(metadata.sourceUrl);
  if (host) {
    return `Pasted from ${host}`;
  }
  return "Pasted section";
}

export interface InsertDesignDocumentOptions {
  name: string;
  documentName: string;
  pageName?: string;
  width: number;
  height: number;
  background: string;
  position: { x: number; y: number };
  transactionLabel: string;
}

/**
 * Shared insertion core for every untrusted-HTML entry point (clipboard paste
 * and .html file import). One undoable transaction adds the sanitized HTML as
 * a new design-mode document (revision 1), page, and frame, switches to that
 * page, and selects the new frame. Returns the created frame for camera
 * fitting. The HTML is stored verbatim so project export/import and code
 * export round-trip byte-for-byte.
 */
export function insertDesignDocumentFromHtml(
  store: EditorStore,
  srcDoc: string,
  options: InsertDesignDocumentOptions,
): PastedFrameResult {
  const documentId = createStableId("doc");
  const pageId = createStableId("page");
  const frameId = createStableId("frame");

  const x = Math.round(options.position.x);
  const y = Math.round(options.position.y);

  store.transact(options.transactionLabel, () => {
    store.execute(createFrameCommand({
      id: frameId,
      name: options.name,
      documentId,
      pageId,
      documentName: options.documentName,
      pageName: options.pageName ?? "Page 1",
      mode: "design",
      x,
      y,
      width: options.width,
      height: options.height,
      srcDoc,
      background: options.background,
    }), { history: "skip" });
    store.execute(switchPageCommand(pageId), { history: "skip" });
    store.execute(selectBriefFrameCommand(null), { history: "skip" });
    store.execute(setSelectionCommand({
      frameIds: [frameId],
      nodeIds: [],
      primaryFrameId: frameId,
      primaryNodeId: null,
    }), { history: "skip" });
    store.execute(setActiveToolCommand("select"), { history: "skip" });
  });

  return {
    frameId,
    name: options.name,
    rect: { x, y, width: options.width, height: options.height },
  };
}

/**
 * Create one undoable editor transaction that adds the pasted HTML as a new
 * design-mode document, page, and frame, switches to that page, and selects
 * the new frame. Returns the created frame for camera fitting.
 */
export function pasteHtmlIntoStore(
  store: EditorStore,
  srcDoc: string,
  metadata: PastedHtmlMetadata,
  position: { x: number; y: number },
): PastedFrameResult {
  const name = resolvePastedFrameName(metadata);
  const host = sourceHostLabel(metadata.sourceUrl);
  const { width, height } = resolvePastedFrameSize(metadata);
  const background = resolvePastedFrameBackground(metadata);

  return insertDesignDocumentFromHtml(store, srcDoc, {
    name,
    documentName: host ? `Pasted from ${host}` : "Pasted HTML",
    pageName: "Page 1",
    width,
    height,
    background,
    position,
    transactionLabel: "Paste section",
  });
}
