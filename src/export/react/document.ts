/**
 * srcDoc → ExportDocument IR. The only module that calls DOMParser.
 *
 * Boundary responsibilities: bridge-runtime safety strip, editor-attribute
 * stripping, lifting <style>/<script>/head items into typed slots, merging
 * <html>/<body> attributes onto the scope-root wrapper, and appending the
 * render-time theme asset the canvas would inject (token theme for design
 * docs, WIREFRAME_THEME_CSS for wireframes).
 */
import { stripBridgeRuntime } from "../code-export";
import { WIREFRAME_THEME_CSS } from "../../frame/wireframe-theme";
import type { DocumentEntity } from "../../editor/model";
import {
  attributeToProp,
  EDITOR_ATTRIBUTE_PATTERN,
  parseStyleAttribute,
} from "./attributes";
import {
  childrenToJsx,
  elementToJsx,
  type ConversionContext,
  type ExtractedRule,
  type JsxElement,
  type JsxProp,
  type StyleDecl,
} from "./jsx";
import type { ExportNote } from "./react-export";

/** A lifted <style> block, in source order. */
export interface StyleAsset {
  cssText: string;
  order: number;
  /** media attribute on the source <style>, wrapped as @media when scoped. */
  media?: string;
  /** "wireframe-theme"/"token-theme" mark render-time CSS the canvas injects. */
  origin: "document" | "wireframe-theme" | "token-theme";
}

/** A lifted <script>. Body scripts keep their position via marker elements;
 *  head scripts are emitted at the top of the component instead. */
export interface ScriptAsset {
  markerId: string;
  src?: string;
  inlineCode?: string;
  /** All surviving attributes (src, type, async, defer, nonce…). */
  attributes: Record<string, string>;
  inHead: boolean;
}

/** Head items that make sense inside a component; React 19 hoists them. */
export type HeadItem =
  | { kind: "title"; text: string }
  | { kind: "meta"; attributes: Record<string, string> }
  | { kind: "link"; attributes: Record<string, string> }
  | { kind: "element"; node: JsxElement };

export interface DocumentAttr {
  name: string;
  value: string;
}

/** Document-level IR: a page component, not just an element tree. */
export interface ExportDocument {
  /** Wrapper div: scope class + merged html/body attributes + body subtree. */
  root: JsxElement;
  scopeClassName: string;
  stylesheets: StyleAsset[];
  scripts: ScriptAsset[];
  head: HeadItem[];
  documentMeta: { charset?: string; viewport?: string; lang?: string };
  htmlAttrs: DocumentAttr[];
  bodyAttrs: DocumentAttr[];
  /** Inline !important declarations lifted into generated dc-i{n} rules. */
  extractedRules: ExtractedRule[];
  notes: ExportNote[];
}

const CANVAS_OWNED_ATTR = /^data-design-tool-/;

function elementAttrRecord(element: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    out[attr.name] = attr.value;
  }
  return out;
}

function hasCanvasOwnedMarker(element: Element): boolean {
  return Array.from(element.attributes).some((attr) => CANVAS_OWNED_ATTR.test(attr.name));
}

function linkRel(element: Element): string {
  return (element.getAttribute("rel") ?? "").toLowerCase();
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) || value.trim().startsWith("//");
}

function isRelativeUrl(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed !== "" &&
    !trimmed.startsWith("#") &&
    !isRemoteUrl(trimmed) &&
    !/^(?:data|blob|mailto|tel|javascript|about):/i.test(trimmed)
  );
}

/**
 * Merges <html>/<body> attributes into the root wrapper's prop list.
 * `class` concatenates into className (scope class first), `style`
 * concatenates declarations (body wins on conflicts), other attributes
 * dedupe last-wins. Anything attributeToProp drops stays dropped and noted.
 */
function mergeDocumentAttributes(
  root: JsxElement,
  htmlAttrs: DocumentAttr[],
  bodyAttrs: DocumentAttr[],
  ctx: ConversionContext,
): void {
  const classes: string[] = [ctx.scopeClassName];
  const merged = new Map<string, JsxProp>();
  const styleDecls = new Map<string, StyleDecl>();

  const apply = (attrs: DocumentAttr[]): void => {
    for (const { name, value } of attrs) {
      const lower = name.toLowerCase();
      if (lower === "class") {
        classes.push(...value.split(/\s+/).filter(Boolean));
        continue;
      }
      if (lower === "style") {
        const { styleDecls: decls, importantDecls } = parseStyleAttribute(value);
        for (const decl of decls) styleDecls.set(decl.property, decl);
        if (importantDecls.length > 0) {
          const className = `dc-i${ctx.extractedRules.length}`;
          ctx.extractedRules.push({
            className,
            declarations: importantDecls.map((decl) => ({
              property: decl.property,
              value: `${decl.value} !important`,
            })),
          });
          classes.push(className);
        }
        continue;
      }
      if (lower === "xmlns") continue;
      const prop = attributeToProp(name, value, "html", ctx);
      if (!prop) continue;
      const key = prop.kind === "attr" || prop.kind === "expr" || prop.kind === "bool"
        ? prop.name
        : "style";
      merged.set(key, prop);
    }
  };
  apply(htmlAttrs);
  apply(bodyAttrs);

  const props: JsxProp[] = [{ kind: "attr", name: "className", value: classes.join(" ") }];
  props.push(...merged.values());
  if (styleDecls.size > 0) {
    props.push({ kind: "style", declarations: [...styleDecls.values()] });
  }
  root.props = props;
}

/**
 * Parses one `DocumentEntity.srcDoc` into an ExportDocument. Never throws on
 * malformed input: DOMParser is total and unconvertible constructs become
 * notes, not exceptions.
 */
export function parseExportDocument(
  srcDoc: string,
  options: {
    componentName: string;
    scopeClassName: string;
    mode: DocumentEntity["mode"];
    /** Active theme's `:root` block (design mode); appended as a style asset. */
    themeCssText?: string;
  },
): ExportDocument {
  const { componentName, scopeClassName, mode, themeCssText } = options;
  const notes: ExportNote[] = [];
  const document = new DOMParser().parseFromString(stripBridgeRuntime(srcDoc), "text/html");

  const ctx: ConversionContext = {
    scopeClassName,
    componentName,
    notes,
    extractedRules: [],
    scriptMarkers: new Map(),
    seenCustomElements: new Set(),
  };

  // Lift <style> blocks (any position; order is preserved for the cascade).
  // This runs BEFORE the editor-attribute strip because the canvas-owned
  // marker (data-design-tool-*) matches the strip pattern — the markers must
  // still be visible when we check for them.
  const stylesheets: StyleAsset[] = [];
  for (const style of Array.from(document.querySelectorAll("style"))) {
    if (hasCanvasOwnedMarker(style)) {
      style.remove();
      continue;
    }
    const media = style.getAttribute("media")?.trim();
    stylesheets.push({
      cssText: style.textContent ?? "",
      order: stylesheets.length,
      media: media ? media : undefined,
      origin: "document",
    });
    style.remove();
  }

  // Lift <script>: body scripts become position markers that elementToJsx
  // turns into <ScriptNode>; head scripts are emitted at the component top.
  const scripts: ScriptAsset[] = [];
  for (const script of Array.from(document.querySelectorAll("script"))) {
    if (hasCanvasOwnedMarker(script)) {
      script.remove();
      continue;
    }
    const attributes = elementAttrRecord(script);
    for (const name of Object.keys(attributes)) {
      if (EDITOR_ATTRIBUTE_PATTERN.test(name)) delete attributes[name];
    }
    const inlineCode = script.textContent ?? "";
    const asset: ScriptAsset = {
      markerId: `s${scripts.length}`,
      src: script.getAttribute("src") ?? undefined,
      inlineCode: inlineCode.trim() !== "" ? inlineCode : undefined,
      attributes,
      inHead: !document.body.contains(script),
    };
    scripts.push(asset);
    notes.push({
      code: "script-preserved",
      severity: "warning",
      message: asset.src
        ? `A <script src="${asset.src}"> was preserved; it runs after mount where the host enables scripts.`
        : "An inline <script> was preserved; it runs after mount where the host enables scripts.",
      componentName,
      detail: asset.src ?? "inline script",
    });
    if (asset.src && isRemoteUrl(asset.src)) {
      notes.push({
        code: "remote-asset",
        severity: "warning",
        message: "A preserved script loads a remote URL that needs network access.",
        componentName,
        detail: asset.src.slice(0, 200),
      });
    } else if (asset.src && isRelativeUrl(asset.src)) {
      notes.push({
        code: "relative-url-unresolved",
        severity: "warning",
        message: `Script "${asset.src.slice(0, 120)}" is relative and is not bundled in the export.`,
        componentName,
        detail: asset.src.slice(0, 120),
      });
    }
    if (asset.inHead) {
      script.remove();
    } else {
      const marker = document.createElement("span");
      ctx.scriptMarkers.set(marker, asset);
      script.replaceWith(marker);
    }
  }

  // Editor bookkeeping attributes baked into stored docs (figma imports,
  // canvas-paste markers) — stripped everywhere, counted once. Runs after the
  // style/script lifts so canvas-owned markers are already handled.
  let strippedAttrs = 0;
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      if (EDITOR_ATTRIBUTE_PATTERN.test(attr.name)) {
        element.removeAttribute(attr.name);
        strippedAttrs += 1;
      }
    }
  }
  if (strippedAttrs > 0) {
    notes.push({
      code: "editor-attrs-stripped",
      severity: "info",
      message: `${strippedAttrs} editor bookkeeping attribute${strippedAttrs === 1 ? " was" : "s were"} stripped.`,
      componentName,
      detail: `${strippedAttrs}`,
    });
  }

  // Head items → component head JSX + index.html metadata for the first doc.
  const head: HeadItem[] = [];
  const documentMeta: ExportDocument["documentMeta"] = {};
  documentMeta.lang = document.documentElement.getAttribute("lang") ?? undefined;

  for (const child of Array.from(document.head.childNodes)) {
    if (child.nodeType === 8) {
      const text = child.nodeValue ?? "";
      if (/\[if\b|<!\s*\[endif/i.test(text)) {
        notes.push({
          code: "conditional-comment-dropped",
          severity: "warning",
          message: "A conditional comment in <head> was dropped.",
          componentName,
          detail: text.trim().slice(0, 120),
        });
      }
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const tag = element.localName;
    if (tag === "title") {
      head.push({ kind: "title", text: element.textContent ?? "" });
      continue;
    }
    if (tag === "base") {
      notes.push({
        code: "base-dropped",
        severity: "warning",
        message: "A <base> element was dropped; it would hijack relative URLs in the host app.",
        componentName,
        detail: element.getAttribute("href") ?? undefined,
      });
      continue;
    }
    if (tag === "meta") {
      if (element.hasAttribute("charset")) {
        documentMeta.charset = element.getAttribute("charset") ?? "utf-8";
        continue;
      }
      const equiv = element.getAttribute("http-equiv")?.toLowerCase();
      if (equiv === "refresh") {
        notes.push({
          code: "meta-refresh-dropped",
          severity: "warning",
          message: "A meta refresh directive was dropped; it would reload the exported page.",
          componentName,
          detail: element.getAttribute("content") ?? undefined,
        });
        continue;
      }
      if (equiv === "content-type") {
        const charset = /charset=([\w-]+)/i.exec(element.getAttribute("content") ?? "")?.[1];
        if (charset) documentMeta.charset = charset;
        continue;
      }
      if ((element.getAttribute("name") ?? "").toLowerCase() === "viewport") {
        documentMeta.viewport = element.getAttribute("content") ?? undefined;
        continue;
      }
      head.push({ kind: "meta", attributes: elementAttrRecord(element) });
      continue;
    }
    if (tag === "link") {
      const href = element.getAttribute("href") ?? "";
      if (linkRel(element).split(/\s+/).includes("stylesheet")) {
        notes.push({
          code: "stylesheet-dropped",
          severity: "warning",
          message:
            "A stylesheet <link> was dropped; the external sheet would load global, unscoped CSS.",
          componentName,
          detail: href.slice(0, 200) || undefined,
        });
        continue;
      }
      head.push({ kind: "link", attributes: elementAttrRecord(element) });
      if (isRemoteUrl(href)) {
        notes.push({
          code: "remote-asset",
          severity: "warning",
          message: `A remote <link rel="${linkRel(element)}"> was kept; it needs network access.`,
          componentName,
          detail: href.slice(0, 200),
        });
      }
      continue;
    }
    // Anything else renderable in <head> (noscript…) is emitted as-is.
    const node = elementToJsx(element, ctx);
    if (node) head.push({ kind: "element", node });
  }

  // html/body attributes merge onto the scope-root wrapper.
  const htmlAttrs: DocumentAttr[] = Array.from(document.documentElement.attributes)
    .filter((attr) => attr.name !== "xmlns")
    .map((attr) => ({ name: attr.name, value: attr.value }));
  const bodyAttrs: DocumentAttr[] = document.body
    ? Array.from(document.body.attributes).map((attr) => ({ name: attr.name, value: attr.value }))
    : [];

  const root: JsxElement = {
    kind: "element",
    tag: "div",
    namespace: "html",
    props: [],
    children: [],
    voidElement: false,
  };
  mergeDocumentAttributes(root, htmlAttrs, bodyAttrs, ctx);
  if (document.body) {
    childrenToJsx(document.body, root.children, ctx);
  }

  if (mode === "wireframe") {
    stylesheets.push({
      cssText: WIREFRAME_THEME_CSS,
      order: stylesheets.length,
      origin: "wireframe-theme",
    });
  } else if (themeCssText && themeCssText.trim().length > 0) {
    // Last asset wins ties, matching injectTokenTheme's append-to-head order.
    stylesheets.push({
      cssText: themeCssText,
      order: stylesheets.length,
      origin: "token-theme",
    });
  }

  return {
    root,
    scopeClassName,
    stylesheets,
    scripts,
    head,
    documentMeta,
    htmlAttrs,
    bodyAttrs,
    extractedRules: ctx.extractedRules,
    notes,
  };
}
