/**
 * JSX intermediate representation and printer.
 *
 * The invariant the pipeline relies on: a JsxNode tree printed by printJsx
 * renders — through React — a DOM subtree deep-equal to the source DOM
 * subtree, modulo the documented delta set (scope class on the root, stripped
 * editor attributes, ScriptNode markers, dropped `on*` handlers). Every
 * semantic decision (renames, style objects, whitespace sensitivity) happens
 * while building this tree; the printer only does syntax.
 */
import { attributeToProp, HTML_ATTR_RENAMES } from "./attributes";
import type { ScriptAsset } from "./document";
import type { ExportNote } from "./react-export";

export type JsxNode = JsxElement | JsxText | JsxComment;

export interface JsxElement {
  kind: "element";
  tag: string;
  /** svg children use the SVG attribute table; <foreignObject> flips back. */
  namespace: "html" | "svg";
  props: JsxProp[];
  children: JsxNode[];
  /** True for <img>, <br>, <input>… — cosmetic; the printer self-closes any
   *  childless element anyway. */
  voidElement: boolean;
}

/**
 * A prop is never a bare string — the union encodes HOW to emit it, and the
 * printer is the sole escaping authority.
 *  attr:  name="value" — printer entity-escapes the value
 *  bool:  bare `disabled` — only for the HTML boolean-attribute set
 *  style: style={{ … }} built from ordered StyleDecls
 *  expr:  name={expression} — expression is a JS source fragment
 *         (dangerouslySetInnerHTML objects, onSubmit preventDefault,
 *         ScriptNode props, defaultValue literals)
 */
export type JsxProp =
  | { kind: "attr"; name: string; value: string }
  | { kind: "bool"; name: string }
  | { kind: "style"; declarations: StyleDecl[] }
  | { kind: "expr"; name: string; expression: string };

/**
 * One style declaration normalized for a React style object: `property` is
 * camelCase ("marginTop") or a verbatim custom property ("--accent"); `value`
 * stays a string so var()/calc() survive. `!important` never reaches this
 * type — the attribute layer extracts it first.
 */
export interface StyleDecl {
  property: string;
  value: string;
}

/** An inline !important declaration lifted into the scoped stylesheet. */
export interface ExtractedRule {
  /** Generated class, `dc-i{n}`. */
  className: string;
  /** Kebab-case declarations; each value already ends with ` !important`. */
  declarations: StyleDecl[];
}

/** Text plus the emission hint decided by the whitespace rule. */
export interface JsxText {
  kind: "text";
  text: string;
  /** "literal" → `{"…"}` (boundary whitespace, braces, preformatted text);
   *  "jsx" → entity-escaped JSX text; "space" → exactly `{" "}`. */
  emit: "jsx" | "literal" | "space";
}

/** HTML comment → `{/* … *​/}` (`*​/` sequences inside are sanitized). */
export interface JsxComment {
  kind: "comment";
  text: string;
}

/**
 * Per-document conversion state. Append-only: conversion problems attach as
 * notes, extracted rules, or marker lookups — they never throw.
 */
export interface ConversionContext {
  scopeClassName: string;
  componentName: string;
  notes: ExportNote[];
  extractedRules: ExtractedRule[];
  /** Marker span → lifted script, so position is preserved in the tree. */
  scriptMarkers: Map<Element, ScriptAsset>;
  /** Custom-element tag names already noted (dedupe). */
  seenCustomElements: Set<string>;
}

export const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Elements whose text content is whitespace-significant. */
const PREFORMATTED_ELEMENTS = new Set(["pre", "listing"]);

const REMOTE_URL = /^[a-z][a-z0-9+.-]*:/i;

type UrlKind = "remote" | "relative" | "javascript" | "fragment" | "data";

function classifyUrl(value: string): UrlKind {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return "fragment";
  if (/^javascript:/i.test(trimmed)) return "javascript";
  if (/^(?:data|blob|mailto|tel|about):/i.test(trimmed)) return "data";
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) return "remote";
  if (REMOTE_URL.test(trimmed)) return "remote";
  return "relative";
}

/** Attributes whose values are URLs worth noting when remote or relative.
 *  form action/formaction are excluded — the form-neutralized note covers them. */
const URL_ATTRIBUTES = new Set([
  "src",
  "href",
  "poster",
  "data",
  "background",
  "xlink:href",
]);

function noteUrl(
  element: Element,
  name: string,
  value: string,
  ctx: ConversionContext,
): void {
  const tag = element.localName;
  if (!URL_ATTRIBUTES.has(name.toLowerCase())) return;
  const trimmed = value.trim();
  const kind = classifyUrl(trimmed);
  if (kind === "javascript") {
    ctx.notes.push({
      code: "javascript-url",
      severity: "warning",
      message: `A javascript: URL on <${tag}> was kept verbatim; it will not run under React.`,
      componentName: ctx.componentName,
      detail: trimmed.slice(0, 120),
    });
    return;
  }
  if (kind === "remote" && tag !== "a" && tag !== "area") {
    ctx.notes.push({
      code: "remote-asset",
      severity: "warning",
      message: `<${tag}> loads a remote URL that needs network access.`,
      componentName: ctx.componentName,
      detail: trimmed.slice(0, 200),
    });
  } else if (kind === "relative") {
    ctx.notes.push({
      code: "relative-url-unresolved",
      severity: "warning",
      message:
        tag === "a" || tag === "area"
          ? `Link target "${trimmed.slice(0, 120)}" is relative and will not resolve in the exported app.`
          : `<${tag}> references "${trimmed.slice(0, 120)}" which is not bundled in the export.`,
      componentName: ctx.componentName,
      detail: trimmed.slice(0, 120),
    });
  }
}

function noteSrcset(tag: string, value: string, ctx: ConversionContext): void {
  for (const candidate of value.split(",")) {
    const url = candidate.trim().split(/\s+/)[0] ?? "";
    const kind = classifyUrl(url);
    if (kind === "remote") {
      ctx.notes.push({
        code: "remote-asset",
        severity: "warning",
        message: `<${tag}> srcset loads a remote URL that needs network access.`,
        componentName: ctx.componentName,
        detail: url.slice(0, 200),
      });
    } else if (kind === "relative") {
      ctx.notes.push({
        code: "relative-url-unresolved",
        severity: "warning",
        message: `<${tag}> srcset references "${url.slice(0, 120)}" which is not bundled in the export.`,
        componentName: ctx.componentName,
        detail: url.slice(0, 120),
      });
    }
  }
}

const CONDITIONAL_COMMENT = /^\s*(?:\[if\b|<!\s*\[endif)/i;

function textToJsx(text: string, preformatted: boolean): JsxText | null {
  if (text.trim() === "") {
    return text.includes("\n") || text.includes("\r") || text.includes("\f")
      ? null
      : { kind: "text", text: " ", emit: "space" };
  }
  if (preformatted) return { kind: "text", text, emit: "literal" };
  if (/^\s|\s$/.test(text) || /[{}\n\r\t]/.test(text)) {
    return { kind: "text", text, emit: "literal" };
  }
  return { kind: "text", text, emit: "jsx" };
}

interface ChildWalkOptions {
  /** Inside <pre>/<listing>: every text node is whitespace-significant. */
  preformatted: boolean;
  /** Inside a <select> subtree: option[selected] folds into defaultValue. */
  insideSelect: boolean;
}

function scriptAssetToElement(asset: ScriptAsset): JsxElement {
  const props: JsxProp[] = [];
  if (Object.keys(asset.attributes).length > 0) {
    props.push({
      kind: "expr",
      name: "attributes",
      expression: JSON.stringify(asset.attributes),
    });
  }
  if (asset.inlineCode !== undefined) {
    props.push({ kind: "expr", name: "code", expression: JSON.stringify(asset.inlineCode) });
  }
  return {
    kind: "element",
    tag: "ScriptNode",
    namespace: "html",
    props,
    children: [],
    voidElement: false,
  };
}

/**
 * Converts a parent's childNodes into JsxNodes (elements, text, comments).
 * Used for <body> at the document boundary and recursively for elements.
 */
export function childrenToJsx(
  parent: Element,
  into: JsxNode[],
  ctx: ConversionContext,
  options: ChildWalkOptions = { preformatted: false, insideSelect: false },
): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      const node = textToJsx(child.nodeValue ?? "", options.preformatted);
      if (node) into.push(node);
      continue;
    }
    if (child.nodeType === 4 /* CDATA_SECTION_NODE */) {
      const text = child.nodeValue ?? "";
      if (text.trim() !== "") into.push({ kind: "text", text, emit: "literal" });
      continue;
    }
    if (child.nodeType === 8 /* COMMENT_NODE */) {
      const text = child.nodeValue ?? "";
      if (CONDITIONAL_COMMENT.test(text)) {
        ctx.notes.push({
          code: "conditional-comment-dropped",
          severity: "warning",
          message: "A conditional comment was dropped; IE-era constructs have no React equivalent.",
          componentName: ctx.componentName,
          detail: text.trim().slice(0, 120),
        });
      } else if (text.trim() !== "") {
        into.push({ kind: "comment", text });
      }
      continue;
    }
    if (child.nodeType !== 1) continue;
    const converted = elementToJsxInternal(child as Element, ctx, options);
    if (converted) into.push(converted);
  }
}

/**
 * Converts one DOM element (and its subtree) into a JsxElement. Returns null
 * only for elements that must disappear entirely (`<base>`).
 */
export function elementToJsx(element: Element, ctx: ConversionContext): JsxElement | null {
  return elementToJsxInternal(element, ctx, { preformatted: false, insideSelect: false });
}

function elementToJsxInternal(
  element: Element,
  ctx: ConversionContext,
  options: ChildWalkOptions,
): JsxElement | null {
  const markerScript = ctx.scriptMarkers.get(element);
  if (markerScript) return scriptAssetToElement(markerScript);

  const namespace =
    element.namespaceURI === "http://www.w3.org/2000/svg" ? ("svg" as const) : ("html" as const);
  const tag = element.localName;

  if (namespace === "html" && tag === "base") {
    ctx.notes.push({
      code: "base-dropped",
      severity: "warning",
      message: "A <base> element was dropped; it would hijack relative URLs in the host app.",
      componentName: ctx.componentName,
      detail: element.getAttribute("href") ?? undefined,
    });
    return null;
  }

  // A stylesheet link outside <head> would render as a real <link> whose
  // rules apply globally, so it is dropped like the head links in document.ts.
  if (
    namespace === "html" &&
    tag === "link" &&
    (element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet")
  ) {
    ctx.notes.push({
      code: "stylesheet-dropped",
      severity: "warning",
      message:
        "A stylesheet <link> was dropped; the external sheet would load global, unscoped CSS.",
      componentName: ctx.componentName,
      detail: (element.getAttribute("href") ?? "").slice(0, 200) || undefined,
    });
    return null;
  }

  if (namespace === "html" && tag === "template") {
    ctx.notes.push({
      code: "template-inlined",
      severity: "info",
      message: "A <template> was emitted with its content as an HTML string.",
      componentName: ctx.componentName,
    });
    return {
      kind: "element",
      tag: "template",
      namespace,
      props: [
        {
          kind: "expr",
          name: "dangerouslySetInnerHTML",
          expression: `{{ __html: ${JSON.stringify(element.innerHTML)} }}`,
        },
      ],
      children: [],
      voidElement: false,
    };
  }

  if (namespace === "html" && tag.includes("-") && !ctx.seenCustomElements.has(tag)) {
    ctx.seenCustomElements.add(tag);
    ctx.notes.push({
      code: "custom-element",
      severity: "warning",
      message: `<${tag}> is a custom element; it needs its definition registered at runtime.`,
      componentName: ctx.componentName,
      detail: tag,
    });
  }

  if (namespace === "html" && tag === "noscript") {
    ctx.notes.push({
      code: "noscript-preserved",
      severity: "info",
      message: "<noscript> content was kept; it renders only when scripts are disabled.",
      componentName: ctx.componentName,
    });
  }

  const props: JsxProp[] = [];
  const generatedClasses: string[] = [];

  for (const attr of Array.from(element.attributes)) {
    const name = attr.name;
    const lower = name.toLowerCase();
    const value = attr.value;

    // Uncontrolled-form mapping: checked/value/selected become defaults.
    if (lower === "checked" && tag === "input") {
      props.push({ kind: "bool", name: "defaultChecked" });
      continue;
    }
    if (lower === "value" && (tag === "input" || tag === "textarea" || tag === "select")) {
      props.push({ kind: "attr", name: "defaultValue", value });
      continue;
    }
    if (lower === "selected" && tag === "option" && options.insideSelect) {
      continue;
    }

    const before = ctx.extractedRules.length;
    const prop = attributeToProp(name, value, namespace, ctx);
    if (ctx.extractedRules.length > before) {
      for (const rule of ctx.extractedRules.slice(before)) generatedClasses.push(rule.className);
    }
    if (prop) {
      props.push(prop);
      if (lower === "srcset") noteSrcset(tag, value, ctx);
      else noteUrl(element, lower, value, ctx);
    }
  }

  const children: JsxNode[] = [];
  let extraProps: JsxProp[] = [];

  if (tag === "textarea" && namespace === "html") {
    const text = element.textContent ?? "";
    const existing = props.findIndex(
      (prop) => prop.kind === "attr" && prop.name === "defaultValue",
    );
    const defaultValueProp: JsxProp = {
      kind: "expr",
      name: "defaultValue",
      expression: JSON.stringify(text),
    };
    if (existing !== -1) props[existing] = defaultValueProp;
    else extraProps.push(defaultValueProp);
  } else if (tag === "select" && namespace === "html") {
    const hasValue = props.some((prop) => prop.kind === "attr" && prop.name === "defaultValue");
    if (!hasValue) {
      const selected = Array.from(element.querySelectorAll("option"))
        .filter((option) => option.hasAttribute("selected"))
        .map((option) => option.getAttribute("value") ?? option.textContent ?? "");
      if (selected.length > 0) {
        const multiple = element.hasAttribute("multiple");
        extraProps.push({
          kind: "expr",
          name: "defaultValue",
          expression: multiple && selected.length > 1
            ? JSON.stringify(selected)
            : JSON.stringify(selected[0]),
        });
      }
    }
  }

  if (tag === "form" && namespace === "html") {
    props.push({
      kind: "expr",
      name: "onSubmit",
      expression: "(event) => event.preventDefault()",
    });
    ctx.notes.push({
      code: "form-neutralized",
      severity: "warning",
      message: "A <form> was neutralized with onSubmit={preventDefault} so preview submits cannot navigate.",
      componentName: ctx.componentName,
      detail: element.getAttribute("action") ?? undefined,
    });
  }

  const childOptions: ChildWalkOptions = {
    preformatted:
      options.preformatted || (namespace === "html" && PREFORMATTED_ELEMENTS.has(tag)),
    insideSelect: options.insideSelect || (namespace === "html" && tag === "select"),
  };
  // textarea content is already in defaultValue; nothing else is skipped.
  // foreignObject children arrive with the HTML namespaceURI already, so the
  // per-element namespace check handles the flip without a flag.
  if (!(tag === "textarea" && namespace === "html")) {
    childrenToJsx(element, children, ctx, childOptions);
  }

  if (generatedClasses.length > 0) {
    const classProp = props.find((prop) => prop.kind === "attr" && prop.name === "className");
    if (classProp && classProp.kind === "attr") {
      classProp.value = `${classProp.value} ${generatedClasses.join(" ")}`;
    } else {
      props.unshift({ kind: "attr", name: "className", value: generatedClasses.join(" ") });
    }
  }

  return {
    kind: "element",
    tag,
    namespace,
    props: [...props, ...extraProps],
    children,
    voidElement: VOID_ELEMENTS.has(tag),
  };
}

// ===========================================================================
// Printer — the sole escaping authority
// ===========================================================================

function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

function escapeJsxText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isBareIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function printProp(prop: JsxProp): string {
  switch (prop.kind) {
    case "attr":
      return `${prop.name}="${escapeAttrValue(prop.value)}"`;
    case "bool":
      return prop.name;
    case "style":
      return `style={{ ${prop.declarations
        .map(
          (decl) =>
            `${isBareIdentifier(decl.property) ? decl.property : JSON.stringify(decl.property)}: ${JSON.stringify(decl.value)}`,
        )
        .join(", ")} }}`;
    case "expr":
      return `${prop.name}={${prop.expression}}`;
  }
}

function printComment(text: string): string {
  return `{/*${text.replace(/\*\//g, "*\\/")}*/}`;
}

function printText(node: JsxText): string {
  if (node.emit === "space") return `{" "}`;
  if (node.emit === "literal") return `{${JSON.stringify(node.text)}}`;
  return escapeJsxText(node.text);
}

const PROP_WRAP_WIDTH = 96;

function printOpenTag(element: JsxElement, indent: string, selfClosing: boolean): string {
  const printed = element.props.map(printProp);
  const oneLine = `${indent}<${element.tag}${printed.map((p) => ` ${p}`).join("")}${selfClosing ? " />" : ">"}`;
  if (oneLine.length <= PROP_WRAP_WIDTH) return oneLine;
  const lines = printed.map((p) => `${indent}  ${p}`);
  return `${indent}<${element.tag}\n${lines.join("\n")}\n${indent}${selfClosing ? "/>" : ">"}`;
}

function printElement(element: JsxElement, indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  if (element.children.length === 0) {
    return printOpenTag(element, indent, true);
  }
  const onlyChild = element.children[0];
  if (
    element.children.length === 1 &&
    onlyChild &&
    (onlyChild.kind === "text" || onlyChild.kind === "comment")
  ) {
    const inner = onlyChild.kind === "text" ? printText(onlyChild) : printComment(onlyChild.text);
    const line = `${printOpenTag(element, indent, false)}${inner}</${element.tag}>`;
    if (line.length <= 140) return line;
  }
  const open = printOpenTag(element, indent, false);
  const body = element.children.map((child) => printNode(child, indentLevel + 1)).join("\n");
  return `${open}\n${body}\n${indent}</${element.tag}>`;
}

function printNode(node: JsxNode, indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  if (node.kind === "element") return printElement(node, indentLevel);
  if (node.kind === "comment") return `${indent}${printComment(node.text)}`;
  return `${indent}${printText(node)}`;
}

/** Prints a JsxElement as an indented JSX expression body. */
export function printJsx(root: JsxElement, indentLevel = 0): string {
  return printElement(root, indentLevel);
}

// ===========================================================================
// Component shell
// ===========================================================================

/** Head items lifted by document.ts and emitted inside the component so
 *  React can hoist them (<title> retitles the page on switch). */
export type PrintableHeadItem =
  | { kind: "title"; text: string }
  | { kind: "meta"; attributes: Record<string, string> }
  | { kind: "link"; attributes: Record<string, string> }
  | { kind: "element"; node: JsxElement };

function headItemToJsx(item: PrintableHeadItem): JsxNode {
  if (item.kind === "element") return item.node;
  if (item.kind === "title") {
    return {
      kind: "element",
      tag: "title",
      namespace: "html",
      props: [],
      children: [{ kind: "text", text: item.text, emit: "literal" }],
      voidElement: false,
    };
  }
  const tag = item.kind;
  const props: JsxProp[] = Object.entries(item.attributes).map(([name, value]) => ({
    kind: "attr" as const,
    name: HTML_ATTR_RENAMES[name.toLowerCase()] ?? name,
    value,
  }));
  return { kind: "element", tag, namespace: "html", props, children: [], voidElement: true };
}

export interface PrintComponentInput {
  componentName: string;
  jsx: JsxElement;
  head: PrintableHeadItem[];
  /** Scripts lifted from <head>; rendered as ScriptNode markers at the top
   *  of the component so they run before body-position scripts. */
  headScripts: ScriptAsset[];
  /** "./Fieldwork.css" when a scoped stylesheet was emitted. */
  cssImport?: string;
  importsFontsCss: boolean;
  usesScriptNode: boolean;
}

/** Wraps the printed JSX tree in a complete .tsx module. */
export function printComponent(input: PrintComponentInput): string {
  const lines: string[] = [];
  if (input.usesScriptNode) {
    lines.push(`import { ScriptNode } from "./ScriptNode";`);
  }
  if (input.cssImport) lines.push(`import "${input.cssImport}";`);
  if (input.importsFontsCss) lines.push(`import "./fonts.css";`);
  if (lines.length > 0) lines.push("");

  const topNodes: JsxNode[] = [
    ...input.head.map(headItemToJsx),
    ...input.headScripts.map(scriptAssetToElement),
    input.jsx,
  ];
  const fragment = topNodes.length > 1;

  lines.push(`export default function ${input.componentName}() {`);
  lines.push(`  return (`);
  if (fragment) lines.push(`    <>`);
  for (const node of topNodes) {
    lines.push(printNode(node, fragment ? 3 : 2));
  }
  if (fragment) lines.push(`    </>`);
  lines.push(`  );`);
  lines.push(`}`);
  return `${lines.join("\n")}\n`;
}
