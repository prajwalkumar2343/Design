/**
 * Public seam: buildReactExportProject → an inspectable file map, and
 * buildReactExportPayload → a zip for the existing downloadAdapter seam.
 * Name allocation (slug → PascalCase + dedupe + reserved guard) lives here.
 */
import { slugifyFileName, stripBridgeRuntime } from "../code-export";
import type { DocumentId, DocumentEntity, EditorState } from "../../editor/model";
import type { CodeExportPayload } from "../code-export";
import {
  buildDTCGExportFile,
  buildTokenCssExportFile,
  hasExportableTokens,
} from "../tokens-export";
import { buildFontFaceCss, usedFontOptions } from "../../fonts/inject";
import type { FontOption } from "../../fonts/catalog";
import { buildThemeCssVariables } from "../../tokens/css";
import { injectTokenTheme } from "../../frame/token-theme";
import { createZipArchive } from "../zip";
import { parseExportDocument } from "./document";
import { scopeStylesheet } from "./css-scope";
import { printComponent } from "./jsx";
import {
  emitAppCss,
  emitAppTsx,
  emitIndexHtml,
  emitMainTsx,
  emitPackageJson,
  emitReadme,
  emitScriptNodeTsx,
  emitTsConfig,
  emitUseDocumentAttributesTs,
  emitViteConfig,
  type ScaffoldHeadItem,
} from "./scaffold";

// ===========================================================================
// Public types
// ===========================================================================

/** One emitted file; `path` is zip-relative POSIX (`src/design/Foo.tsx`). */
export interface ReactExportFile {
  path: string;
  text: string;
}

/**
 * A fidelity note: something the export preserved, adapted, or dropped.
 * Notes are data so the toast can count severities while README and the
 * manifest carry the full detail.
 */
export interface ExportNote {
  code: ExportNoteCode;
  severity: "info" | "warning";
  message: string;
  /** PascalCase component the note belongs to; absent = project-level. */
  componentName?: string;
  /** Machine detail: the tag, selector, or URL that caused it. */
  detail?: string;
}

export type ExportNoteCode =
  | "script-preserved"
  | "remote-stylesheet"
  | "remote-asset"
  | "relative-url-unresolved"
  | "form-neutralized"
  | "template-inlined"
  | "custom-element"
  | "event-handler-omitted"
  | "javascript-url"
  | "base-dropped"
  | "meta-refresh-dropped"
  | "conditional-comment-dropped"
  | "important-style-extracted"
  | "selector-scope-fallback"
  | "keyframes-renamed"
  | "editor-attrs-stripped"
  | "style-media-wrapped"
  | "noscript-preserved";

export interface ExportComponentSummary {
  componentName: string;
  fileName: string;
  cssFileName?: string;
  sourceDocumentId: DocumentId;
  sourceName: string;
  mode: DocumentEntity["mode"];
  /** kebab-case slug used for the hash route and the dc-<slug> scope class. */
  slug: string;
}

/**
 * The whole export as data: ordered file list, per-component summaries, and
 * every fidelity note. Deterministic: same state → byte-identical file text
 * (the manifest carries no timestamp; zip timestamps live in zip.ts).
 */
export interface ReactExportProject {
  files: ReactExportFile[];
  components: ExportComponentSummary[];
  notes: ExportNote[];
  /** True when design/ScriptNode.tsx was emitted (any doc had <script>). */
  usesScriptNode: boolean;
}

export interface ReactExportPayload extends CodeExportPayload {
  notes: ExportNote[];
  componentNames: string[];
}

// ===========================================================================
// Naming
// ===========================================================================

const RESERVED_COMPONENT_NAMES = new Set(["app", "main", "scriptnode", "index"]);

function isReservedName(name: string): boolean {
  // Case-insensitive: Scriptnode.tsx would collide with ScriptNode.tsx on
  // case-insensitive filesystems (macOS default).
  return RESERVED_COMPONENT_NAMES.has(name.toLowerCase());
}

function pascalCaseIdentifier(slug: string): string {
  const joined = slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  if (joined.length === 0) return "Page";
  return /^[0-9]/.test(joined) ? `Page${joined}` : joined;
}

function firstPageNameForDocument(state: EditorState, documentId: string): string {
  const document = state.documents[documentId];
  const pageId = document?.pageIds[0];
  const pageName = pageId ? state.pages[pageId]?.name?.trim() : undefined;
  const documentName = document?.name?.trim();
  // A default page label ("Page 1") hides the only name a single-page
  // document actually has; prefer the document name in that case.
  if (documentName && (!pageName || /^page\s*\d*$/i.test(pageName))) return documentName;
  return pageName || documentName || documentId;
}

function allocateComponentNames(
  label: string,
  taken: Set<string>,
  takenScopes: Set<string>,
): { componentName: string; scopeClassName: string; slug: string } {
  const baseSlug = slugifyFileName(label);
  let slug = baseSlug;
  let slugCounter = 2;
  while (takenScopes.has(`dc-${slug}`)) {
    slug = `${baseSlug}-${slugCounter}`;
    slugCounter += 1;
  }
  const scopeClassName = `dc-${slug}`;
  takenScopes.add(scopeClassName);
  const base = pascalCaseIdentifier(slug);
  let componentName = base;
  let counter = 2;
  while (taken.has(componentName) || isReservedName(componentName)) {
    componentName = `${base}${counter}`;
    counter += 1;
  }
  taken.add(componentName);
  return { componentName, scopeClassName, slug };
}

// ===========================================================================
// Manifest
// ===========================================================================

export interface ExportManifest {
  version: 1;
  generatedBy: "design-canvas react-export";
  projectName: string;
  components: Array<{
    componentName: string;
    fileName: string;
    cssFileName?: string;
    sourceDocumentId: string;
    sourceName: string;
    mode: DocumentEntity["mode"];
  }>;
  tokens?: { themeName?: string; files: ["tokens.css", "tokens.json"] };
  fonts?: { families: string[]; file: "fonts.css" };
  runtimeHelpers?: string[];
  notes: ExportNote[];
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Builds the complete project file map, or null when the canvas has no
 * exportable documents (same contract as buildCodeExportPayload). Pure:
 * reads state, touches no stores, no I/O beyond DOMParser.
 */
export function buildReactExportProject(
  state: EditorState,
  projectName?: string,
): ReactExportProject | null {
  const documents = Object.values(state.documents).filter(
    (document) => stripBridgeRuntime(document.srcDoc).trim().length > 0,
  );
  if (documents.length === 0) return null;

  const projectSlug = projectName ? slugifyFileName(projectName) : "canvas";
  const resolvedProjectName = projectName?.trim() || "Canvas export";
  const themeCss = buildThemeCssVariables(state.tokens);

  const takenNames = new Set<string>();
  const takenScopes = new Set<string>();
  const designFiles: ReactExportFile[] = [];
  const components: ExportComponentSummary[] = [];
  const notes: ExportNote[] = [];
  const fonts = new Map<string, FontOption>();
  let usesScriptNode = false;
  let usesDocumentAttributes = false;
  let firstExportDoc: ReturnType<typeof parseExportDocument> | null = null;

  for (const document of documents) {
    const sourceName = firstPageNameForDocument(state, document.id);
    const { componentName, scopeClassName, slug } = allocateComponentNames(
      sourceName,
      takenNames,
      takenScopes,
    );

    const exportDoc = parseExportDocument(document.srcDoc, {
      componentName,
      scopeClassName,
      mode: document.mode,
      themeCssText: document.mode === "design" ? themeCss : undefined,
    });
    firstExportDoc ??= exportDoc;

    // Fonts must see the injected theme so token --*font* variables that name
    // catalog families register — same order the canvas renders them in.
    const fontSource =
      document.mode === "design" && themeCss
        ? injectTokenTheme(document.srcDoc, themeCss)
        : document.srcDoc;
    const documentFonts = usedFontOptions(fontSource);
    for (const option of documentFonts) fonts.set(option.name.toLowerCase(), option);

    const scoped = scopeStylesheet({
      assets: exportDoc.stylesheets,
      scopeClassName,
      extractedRules: exportDoc.extractedRules,
      componentName,
    });
    // The scope root stands in for <body>, so it carries the UA default
    // margin. Emitted first: authored body rules override it in the cascade.
    const pageCss = `.${scopeClassName} { margin: 8px; }\n\n${scoped.cssText}`;
    const cssFileName = `${componentName}.css`;

    const documentAttributes =
      exportDoc.htmlAttrs.length > 0 || exportDoc.bodyAttrs.length > 0
        ? {
            html: Object.fromEntries(exportDoc.htmlAttrs.map((attr) => [attr.name, attr.value])),
            body: Object.fromEntries(exportDoc.bodyAttrs.map((attr) => [attr.name, attr.value])),
          }
        : undefined;

    const tsx = printComponent({
      componentName,
      jsx: exportDoc.root,
      head: exportDoc.head,
      headScripts: exportDoc.scripts.filter((script) => script.inHead),
      cssImport: `./${cssFileName}`,
      importsFontsCss: documentFonts.length > 0,
      usesScriptNode: exportDoc.scripts.length > 0,
      documentAttributes,
    });

    usesScriptNode ||= exportDoc.scripts.length > 0;
    usesDocumentAttributes ||= documentAttributes !== undefined;

    const tsxPath = `src/design/${componentName}.tsx`;
    designFiles.push({ path: tsxPath, text: tsx });
    designFiles.push({ path: `src/design/${cssFileName}`, text: pageCss });
    components.push({
      componentName,
      fileName: tsxPath,
      cssFileName: `src/design/${cssFileName}`,
      sourceDocumentId: document.id,
      sourceName,
      mode: document.mode,
      slug,
    });
    notes.push(...exportDoc.notes, ...scoped.notes);
  }

  // design/ assets shared across pages: token record, font faces, helpers.
  const themeName = state.tokens.activeThemeId
    ? state.tokens.themes[state.tokens.activeThemeId]?.name
    : undefined;
  if (hasExportableTokens(state.tokens)) {
    designFiles.push({ path: "src/design/tokens.css", text: buildTokenCssExportFile(state.tokens).text });
    designFiles.push({ path: "src/design/tokens.json", text: buildDTCGExportFile(state.tokens).text });
  }
  if (fonts.size > 0) {
    designFiles.push({ path: "src/design/fonts.css", text: `${buildFontFaceCss([...fonts.values()])}\n` });
  }
  if (usesDocumentAttributes) {
    designFiles.push({ path: "src/design/useDocumentAttributes.ts", text: emitUseDocumentAttributesTs() });
  }
  if (usesScriptNode) {
    designFiles.push({ path: "src/design/ScriptNode.tsx", text: emitScriptNodeTsx() });
  }

  const manifest: ExportManifest = {
    version: 1,
    generatedBy: "design-canvas react-export",
    projectName: resolvedProjectName,
    components: components.map((component) => ({
      componentName: component.componentName,
      fileName: component.fileName,
      cssFileName: component.cssFileName,
      sourceDocumentId: component.sourceDocumentId,
      sourceName: component.sourceName,
      mode: component.mode,
    })),
    ...(hasExportableTokens(state.tokens)
      ? { tokens: { themeName, files: ["tokens.css", "tokens.json"] as ["tokens.css", "tokens.json"] } }
      : {}),
    ...(fonts.size > 0
      ? { fonts: { families: [...fonts.values()].map((font) => font.name), file: "fonts.css" as const } }
      : {}),
    ...(usesScriptNode || usesDocumentAttributes
      ? {
          runtimeHelpers: [
            ...(usesScriptNode ? ["ScriptNode.tsx"] : []),
            ...(usesDocumentAttributes ? ["useDocumentAttributes.ts"] : []),
          ],
        }
      : {}),
    notes,
  };
  designFiles.push({
    path: "src/design/export-manifest.json",
    text: `${JSON.stringify(manifest, null, 2)}\n`,
  });

  const scaffoldHead: ScaffoldHeadItem[] = (firstExportDoc?.head ?? []).filter(
    (item): item is ScaffoldHeadItem => item.kind !== "element",
  );
  const scaffoldInput = {
    projectName: resolvedProjectName,
    projectSlug,
    pages: components.map((component) => ({
      componentName: component.componentName,
      slug: component.slug,
      title: component.sourceName,
    })),
    documentMeta: firstExportDoc?.documentMeta ?? {},
    head: scaffoldHead,
    notes,
  };

  const files: ReactExportFile[] = [
    { path: "README.md", text: emitReadme(scaffoldInput) },
    { path: "package.json", text: emitPackageJson(scaffoldInput) },
    { path: "index.html", text: emitIndexHtml(scaffoldInput) },
    { path: "tsconfig.json", text: emitTsConfig() },
    { path: "vite.config.ts", text: emitViteConfig() },
    { path: "src/main.tsx", text: emitMainTsx() },
    { path: "src/App.tsx", text: emitAppTsx(scaffoldInput) },
    { path: "src/app.css", text: emitAppCss(components.length) },
    { path: "src/vite-env.d.ts", text: `/// <reference types="vite/client" />\n` },
    ...designFiles,
  ];

  return { files, components, notes, usesScriptNode };
}

/** Always a `<slug>-react.zip` — a lone .tsx cannot run, so the runnable
 *  project contract is uniform. */
export function buildReactExportPayload(
  state: EditorState,
  projectName?: string,
): ReactExportPayload | null {
  const project = buildReactExportProject(state, projectName);
  if (!project) return null;
  const stem = projectName ? slugifyFileName(projectName) : "canvas";
  const archive = createZipArchive(
    project.files.map((file) => ({ name: file.path, data: file.text })),
  );
  return {
    text: archive,
    filename: `${stem}-react.zip`,
    mimeType: "application/zip",
    fileCount: project.components.length,
    notes: project.notes,
    componentNames: project.components.map((component) => component.componentName),
  };
}
