// Wire contract for the local agent bridge. The matching endpoint lives in
// vite-plugin-canvas-agent.ts and serves dev + preview servers on loopback.
export const AGENT_BRIDGE_BASE = "/__canvas-agent";

/**
 * Agent ops. `push` is an upsert: when `id`/`documentId` matches an existing
 * frame or document its HTML is replaced, otherwise a new design-mode frame is
 * minted on the active page. `remove` deletes a frame; `list` snapshots the
 * canvas so the agent can discover IDs before targeting edits.
 */
export type AgentOp = AgentPushOp | AgentRemoveOp | AgentListOp;

export interface AgentPushOp {
  op: "push";
  /** Caller-chosen stable id; reusing it turns a later push into a replace. */
  id?: string;
  documentId?: string;
  name?: string;
  /** Complete document. If it lacks a doctype it is treated as a fragment. */
  html?: string;
  /** Stylesheet text, injected as a <style> element into <head>. */
  css?: string;
  /** Body markup for designs the agent did not wrap in a full document. */
  fragment?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  background?: string;
}

export interface AgentRemoveOp {
  op: "remove";
  frameId: string;
}

export interface AgentListOp {
  op: "list";
}

export type AgentOpResult =
  | { ok: true; op: string; [key: string]: unknown }
  | {
      ok: false;
      op: string;
      error: { code: string; message: string; violations?: unknown };
    };

const DOCTYPE_PATTERN = /^\s*<!doctype\s+html/i;
const STYLE_MARKER = "data-canvas-agent-css";

function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

function injectCss(html: string, css: string): string {
  const tag = `<style ${STYLE_MARKER}>\n${escapeStyleText(css)}\n</style>`;
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, `${tag}\n</head>`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}\n<head>${tag}</head>`);
  }
  // A bare doctype with body markup (no <html>/<head> tags) still parses with
  // the style in an implicit head — but only if the doctype stays first.
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    return `${doctype[0]}\n${tag}\n${html.slice(doctype[0].length)}`;
  }
  return `${tag}\n${html}`;
}

/**
 * Normalizes agent output into a complete doctype document. Accepts a full
 * `html` document, a bare `fragment`, or either plus a separate `css` sheet.
 * Returns null when nothing renderable was supplied.
 */
export function buildDesignDocumentHtml(input: {
  html?: string;
  css?: string;
  fragment?: string;
  title?: string;
}): string | null {
  const html = input.html?.trim() ? input.html : null;
  const fragment = input.fragment?.trim() ? input.fragment : null;
  const css = input.css?.trim() ? input.css : null;
  if (!html && !fragment) return null;

  if (html && DOCTYPE_PATTERN.test(html)) {
    return css ? injectCss(html, css) : html;
  }

  const body = html ?? fragment ?? "";
  const title = input.title?.trim() ? input.title.trim() : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    title ? `<title>${title.replace(/</g, "&lt;")}</title>` : "",
    css ? `<style ${STYLE_MARKER}>\n${escapeStyleText(css)}\n</style>` : "",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
