import { BRIDGE_RUNTIME_MARKER } from "../bridge/runtime";
import type { EditorState } from "../editor/model";
import { buildDTCGExportFile, buildTokenCssExportFile, hasExportableTokens } from "./tokens-export";
import { createZipArchive } from "./zip";

export interface CodeExportFile {
  /** File name inside the export, e.g. `index.html`. */
  filename: string;
  html: string;
}

export interface CodeExportPayload {
  text: string | Uint8Array;
  filename: string;
  mimeType: string;
  fileCount: number;
}

const BRIDGE_SCRIPT_PATTERN = new RegExp(
  `<script\\b[^>]*\\b${BRIDGE_RUNTIME_MARKER}\\b[^>]*>[\\s\\S]*?<\\/script>\\s*`,
  "gi",
);

/**
 * Removes editor bridge instrumentation so the exported document is pure
 * design code that runs anywhere without the canvas runtime.
 */
export function stripBridgeRuntime(html: string): string {
  return html.replace(BRIDGE_SCRIPT_PATTERN, "").trimStart();
}

/** Turns a human label into a safe cross-platform file stem. */
export function slugifyFileName(name: string): string {
  const transliterated = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[åÅ]/g, "a")
    .replace(/[ßẞ]/g, "ss")
    .replace(/[đĐ]/g, "d")
    .replace(/[łŁ]/g, "l");
  const slug = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "page";
}

function firstPageNameForDocument(state: EditorState, documentId: string): string {
  const pageId = state.documents[documentId]?.pageIds[0];
  const pageName = pageId ? state.pages[pageId]?.name : undefined;
  return pageName?.trim() || state.documents[documentId]?.name?.trim() || documentId;
}

/**
 * Collects one clean HTML file per unique canvas document. Frames sharing a
 * document (responsive previews of the same page) collapse into a single
 * file; the first file becomes `index.html` so the bundle opens as a site.
 */
export function buildCodeExportFiles(state: EditorState): CodeExportFile[] {
  const files: CodeExportFile[] = [];
  const usedNames = new Set<string>(["index.html"]);

  for (const document of Object.values(state.documents)) {
    const html = stripBridgeRuntime(document.srcDoc);
    if (html.length === 0) continue;

    let filename: string;
    if (files.length === 0) {
      filename = "index.html";
    } else {
      const base = slugifyFileName(firstPageNameForDocument(state, document.id));
      filename = `${base}.html`;
      let counter = 2;
      while (usedNames.has(filename)) {
        filename = `${base}-${counter}.html`;
        counter += 1;
      }
    }
    usedNames.add(filename);
    files.push({ filename, html });
  }

  return files;
}

/**
 * Builds the downloadable payload for the canvas design:
 * - no documents → null (caller surfaces honest feedback),
 * - one document → a single ready-to-open `.html` file,
 * - several documents → a ZIP bundle with `index.html` plus per-page files.
 */
export function buildCodeExportPayload(
  state: EditorState,
  projectName?: string,
): CodeExportPayload | null {
  const files = buildCodeExportFiles(state);
  if (files.length === 0) return null;

  if (files.length === 1) {
    const stem = projectName ? slugifyFileName(projectName) : "";
    return {
      text: files[0]!.html,
      filename: `${stem.length > 0 ? stem : "canvas"}.html`,
      mimeType: "text/html;charset=utf-8",
      fileCount: 1,
    };
  }

  const stem = projectName ? slugifyFileName(projectName) : "canvas";
  // Multi-page bundles also carry the active theme's tokens (DTCG JSON + CSS
  // variables) so the export is self-describing. The single-file contract
  // above stays exactly one ready-to-open .html file.
  const entries = files.map((file) => ({ name: file.filename, data: file.html }));
  if (hasExportableTokens(state.tokens)) {
    const dtcg = buildDTCGExportFile(state.tokens);
    const css = buildTokenCssExportFile(state.tokens);
    entries.push({ name: dtcg.filename, data: dtcg.text });
    entries.push({ name: css.filename, data: css.text });
  }
  const archive = createZipArchive(entries);
  return {
    text: archive,
    filename: `${stem}-code.zip`,
    mimeType: "application/zip",
    fileCount: files.length,
  };
}
