/**
 * Stylesheet scoping: every document selector is rewritten under the page's
 * `dc-<slug>` scope class so exported pages cannot restyle their host app or
 * each other (the App switcher mounts one page at a time, but all imported
 * CSS is global at bundle time). Declarations are never rewritten — the only
 * semantic touches are selector prefixes, per-page @keyframes renames, and
 * extracted `dc-i{n}` rules appended for inline !important declarations.
 */
import { generate, parse, walk, type CssTreeList, type CssTreeNode } from "css-tree";

import type { StyleAsset } from "./document";
import type { ExtractedRule } from "./jsx";
import type { ExportNote } from "./react-export";

const ROOT_ELEMENT_NAMES = new Set(["html", "body"]);

/** At-rules whose block holds style rules that must be scoped recursively. */
const RECURSIVE_AT_RULES = new Set([
  "media",
  "supports",
  "layer",
  "container",
  "scope",
  "starting-style",
]);

/** At-rules passed through byte-for-byte (no selector semantics to scope). */
const PASSTHROUGH_AT_RULES = new Set([
  "font-face",
  "property",
  "charset",
  "namespace",
  "page",
  "font-feature-values",
  "font-palette-values",
  "counter-style",
  "viewport",
  "position-try",
]);

const ANIMATION_PROPERTIES = /^(?:-[a-z]+-)?animation(?:-name)?$/i;

function listChildren(node: CssTreeNode, key: string): CssTreeNode[] {
  const value = node[key];
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is CssTreeNode =>
        typeof item === "object" && item !== null && typeof item.type === "string",
    );
  }
  if (typeof value === "object" && value !== null) {
    const toArray = (value as CssTreeList).toArray;
    if (typeof toArray === "function") return toArray.call(value);
  }
  return [];
}

function nodeName(node: CssTreeNode): string {
  return typeof node.name === "string" ? node.name : "";
}

function nodeProperty(node: CssTreeNode): string {
  return typeof node.property === "string" ? node.property : "";
}

function isCombinator(part: CssTreeNode): boolean {
  return part.type === "Combinator";
}

/** `html`, `body`, or `:root` — the document-root trio that maps to the scope
 *  root element in the exported component. */
function isRootSelectorNode(part: CssTreeNode): boolean {
  if (part.type === "TypeSelector") return ROOT_ELEMENT_NAMES.has(nodeName(part));
  return part.type === "PseudoClassSelector" && nodeName(part) === "root";
}

function isUniversalSelector(part: CssTreeNode): boolean {
  return part.type === "TypeSelector" && nodeName(part) === "*";
}

function scopeClassNode(scopeClassName: string): CssTreeNode {
  return { type: "ClassSelector", name: scopeClassName };
}

function descendantCombinator(): CssTreeNode {
  return { type: "Combinator", name: " " };
}

/** Splits a selector part list into compounds separated by combinators. */
function splitCompounds(parts: CssTreeNode[]): {
  compounds: CssTreeNode[][];
  combinators: CssTreeNode[];
} {
  const compounds: CssTreeNode[][] = [[]];
  const combinators: CssTreeNode[] = [];
  for (const part of parts) {
    if (isCombinator(part)) {
      combinators.push(part);
      compounds.push([]);
    } else {
      compounds[compounds.length - 1]!.push(part);
    }
  }
  return { compounds, combinators };
}

/** Reassembles compounds, emitting the combinator before each one (the list
 *  is appended after the rewritten first compound, which is why index 0 also
 *  carries a combinator). */
function joinCompounds(compounds: CssTreeNode[][], combinators: CssTreeNode[]): CssTreeNode[] {
  const out: CssTreeNode[] = [];
  compounds.forEach((compound, index) => {
    out.push(combinators[index]!, ...compound);
  });
  return out;
}

/** True when any node in the list (or nested inside pseudo-class arguments
 *  like `:not(body)` or `:has(> html)`) references the document root. */
function containsRootReference(parts: CssTreeNode[]): boolean {
  let found = false;
  const visit = (node: CssTreeNode): void => {
    if (found) return;
    if (isRootSelectorNode(node)) {
      found = true;
      return;
    }
    for (const child of listChildren(node, "children")) visit(child);
  };
  parts.forEach(visit);
  return found;
}

interface ScopedSelector {
  /** Selector part arrays — usually one, two for universal-led selectors. */
  selectors: CssTreeNode[][];
  /** True when the selector had a shape we could not confidently rewrite. */
  fallback: boolean;
}

/**
 * Rewrites one selector's part list under `.scope`. Cases:
 *  - leftmost compound holds html/body/:root → that node becomes `.scope`,
 *    other conditions in the compound stay (`body.dark` → `.scope.dark`);
 *    following `html`/`body` compounds fuse into it (`html body .x` →
 *    `.scope .x`, `html body.dark .x` → `.scope.dark .x`).
 *  - leftmost compound leads with `*` or a bare pseudo-element → two
 *    selectors (`.scope.x, .scope *.x`) so the scope root itself is covered.
 *  - a leading `&` nested selector stays as-is (the parent is already
 *    scoped); `&` elsewhere falls back to the plain prefix.
 *  - anything else → `.scope S`.
 *  - html/body/:root anywhere else (later compounds or inside pseudo
 *    arguments) → plain prefix + fallback so the reader knows.
 */
function scopeSelectorParts(parts: CssTreeNode[], scopeClassName: string): ScopedSelector {
  const prefixed = (): ScopedSelector => ({
    selectors: [[scopeClassNode(scopeClassName), descendantCombinator(), ...parts]],
    fallback: true,
  });

  if (parts.some((part) => part.type === "NestingSelector")) {
    return parts[0]?.type === "NestingSelector"
      ? { selectors: [parts], fallback: false }
      : prefixed();
  }

  const { compounds, combinators } = splitCompounds(parts);
  const first = compounds[0]!;
  const rootIndex = first.findIndex(isRootSelectorNode);

  if (rootIndex !== -1) {
    const scopedFirst = first.map((part, index) =>
      index === rootIndex ? scopeClassNode(scopeClassName) : part,
    );
    const restCompounds = compounds.slice(1);
    const restCombinators = combinators.slice(0);
    // Fuse following bare `body` compounds into the scope compound — `html
    // body` chains both name the document root. A following `html` would be
    // unmatchable markup (html is never a descendant of body), so it falls
    // through to the leftover check and gets the plain prefix + note.
    while (
      restCompounds.length > 0 &&
      restCompounds[0]!.some(
        (part) => part.type === "TypeSelector" && nodeName(part) === "body",
      )
    ) {
      const remainder = restCompounds[0]!.filter(
        (part) => !(part.type === "TypeSelector" && nodeName(part) === "body"),
      );
      scopedFirst.push(...remainder);
      restCompounds.shift();
      restCombinators.shift();
    }
    const leftover = [scopedFirst.slice(1), ...restCompounds].flat();
    if (containsRootReference(leftover)) return prefixed();
    return { selectors: [[...scopedFirst, ...joinCompounds(restCompounds, restCombinators)]], fallback: false };
  }

  // Any root mention left — a later compound (`div body`) or inside pseudo
  // arguments (`.x:not(body)`) — cannot be rewritten confidently.
  if (containsRootReference(parts)) return prefixed();

  const leading = first[0];
  if (leading && (isUniversalSelector(leading) || leading.type === "PseudoElementSelector")) {
    const fused =
      leading.type === "PseudoElementSelector"
        ? [scopeClassNode(scopeClassName), ...parts]
        : [scopeClassNode(scopeClassName), ...parts.slice(1)];
    const descendant = [scopeClassNode(scopeClassName), descendantCombinator(), ...parts];
    return { selectors: [fused, descendant], fallback: false };
  }

  return {
    selectors: [[scopeClassNode(scopeClassName), descendantCombinator(), ...parts]],
    fallback: false,
  };
}

function scopeSelectorList(
  selectorList: CssTreeNode,
  scopeClassName: string,
  onFallback: (selectorText: string) => void,
): void {
  const selectors = listChildren(selectorList, "children");
  const rewritten: CssTreeNode[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    const parts = listChildren(selector, "children");
    const scoped = scopeSelectorParts(parts, scopeClassName);
    if (scoped.fallback) onFallback(generate(selector));
    for (const partList of scoped.selectors) {
      const node: CssTreeNode = { type: "Selector", children: partList };
      const text = generate(node);
      if (seen.has(text)) continue;
      seen.add(text);
      rewritten.push(node);
    }
  }
  (selectorList as unknown as { children: unknown }).children = rewritten;
}

function keyframesIdentifier(node: CssTreeNode): CssTreeNode | undefined {
  const prelude = node.prelude;
  if (typeof prelude !== "object" || prelude === null) return undefined;
  if ((prelude as CssTreeNode).type === "Identifier") return prelude as CssTreeNode;
  const first = listChildren(prelude as CssTreeNode, "children")[0];
  return first && first.type === "Identifier" ? first : undefined;
}

/** Finds every `@keyframes <name>` in a sheet, including ones nested in
 *  @media, so the per-page rename map covers all references. */
function collectKeyframeNames(ast: CssTreeNode): Map<string, string> {
  const names = new Map<string, string>();
  walk(ast, (node) => {
    if (node.type === "Atrule" && nodeName(node).toLowerCase().endsWith("keyframes")) {
      const ident = keyframesIdentifier(node);
      const original = ident ? nodeName(ident) : "";
      if (original) names.set(original, "");
    }
  });
  return names;
}

function renameKeyframeReferences(ast: CssTreeNode, renames: Map<string, string>): void {
  walk(ast, (node) => {
    if (node.type !== "Declaration") return;
    if (!ANIMATION_PROPERTIES.test(nodeProperty(node))) return;
    const value = node.value;
    if (typeof value !== "object" || value === null) return;
    walk(value as CssTreeNode, (inner) => {
      if (inner.type === "Identifier" && renames.has(nodeName(inner))) {
        inner.name = renames.get(nodeName(inner))!;
      } else if (inner.type === "String" && renames.has(String(inner.value ?? ""))) {
        inner.value = renames.get(String(inner.value))!;
      }
    });
  });
}

function scopeRuleList(
  nodes: CssTreeNode[],
  scopeClassName: string,
  keyframeRenames: Map<string, string>,
  notes: ExportNote[],
  componentName: string,
  hoistedImports: CssTreeNode[],
  topLevel: boolean,
): CssTreeNode[] {
  const out: CssTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "Rule") {
      const prelude = node.prelude;
      if (typeof prelude === "object" && prelude !== null) {
        scopeSelectorList(prelude as CssTreeNode, scopeClassName, (selectorText) => {
          notes.push({
            code: "selector-scope-fallback",
            severity: "warning",
            message: `Selector "${selectorText}" could not be scoped cleanly; it was prefixed without restructuring.`,
            componentName,
            detail: selectorText,
          });
        });
      }
      out.push(node);
      continue;
    }
    if (node.type !== "Atrule") {
      out.push(node);
      continue;
    }
    const name = nodeName(node).toLowerCase();
    if (name === "import" && topLevel) {
      hoistedImports.push(node);
      continue;
    }
    if (name.endsWith("keyframes")) {
      const ident = keyframesIdentifier(node);
      if (ident && keyframeRenames.has(nodeName(ident))) {
        ident.name = keyframeRenames.get(nodeName(ident))!;
      }
      out.push(node);
      continue;
    }
    if (PASSTHROUGH_AT_RULES.has(name)) {
      out.push(node);
      continue;
    }
    if (RECURSIVE_AT_RULES.has(name)) {
      const block = node.block;
      if (typeof block === "object" && block !== null) {
        const children = listChildren(block as CssTreeNode, "children");
        (block as unknown as { children: unknown }).children = scopeRuleList(
          children,
          scopeClassName,
          keyframeRenames,
          notes,
          componentName,
          hoistedImports,
          false,
        );
      }
      out.push(node);
      continue;
    }
    // Unknown at-rule: a blockful unknown rule still gets its contents scoped
    // so rules inside don't leak; prelude-only rules pass through.
    const block = node.block;
    if (typeof block === "object" && block !== null) {
      const children = listChildren(block as CssTreeNode, "children");
      (block as unknown as { children: unknown }).children = scopeRuleList(
        children,
        scopeClassName,
        keyframeRenames,
        notes,
        componentName,
        hoistedImports,
        false,
      );
    }
    out.push(node);
  }
  return out;
}

const ASSET_LABELS: Record<StyleAsset["origin"], string | null> = {
  document: null,
  "token-theme": "canvas design tokens for the active theme",
  "wireframe-theme": "canvas wireframe theme",
};

/**
 * Scopes every stylesheet asset under `.${scopeClassName}` and appends the
 * extracted `dc-i{n}` !important rules. Returns the concatenated CSS text
 * (hoisted `@import`s first) plus any scoping notes. Unparseable stylesheets
 * are emitted unscoped at the end of the file with a fallback note — losing
 * the CSS entirely would cost more fidelity than the leak risks.
 */
export function scopeStylesheet(input: {
  assets: StyleAsset[];
  scopeClassName: string;
  extractedRules: ExtractedRule[];
  componentName: string;
}): { cssText: string; notes: ExportNote[] } {
  const { assets, scopeClassName, extractedRules, componentName } = input;
  const notes: ExportNote[] = [];
  const hoistedImports: CssTreeNode[] = [];
  const sections: string[] = [];

  const parsedAssets = assets.map((asset) => {
    const source = asset.media
      ? `@media ${asset.media} {\n${asset.cssText}\n}`
      : asset.cssText;
    if (asset.media) {
      notes.push({
        code: "style-media-wrapped",
        severity: "info",
        message: `A <style media="${asset.media}"> block was wrapped in an equivalent @media rule.`,
        componentName,
        detail: asset.media,
      });
    }
    try {
      return { asset, ast: parse(source, { context: "stylesheet" }), raw: null as string | null };
    } catch {
      return { asset, ast: null, raw: source };
    }
  });

  // First pass: collect every keyframes name across the page's assets so the
  // rename map is stable regardless of which block references it.
  const keyframeRenames = new Map<string, string>();
  for (const { ast } of parsedAssets) {
    if (!ast) continue;
    for (const name of collectKeyframeNames(ast).keys()) {
      if (!keyframeRenames.has(name)) keyframeRenames.set(name, `${scopeClassName}-${name}`);
    }
  }

  for (const { asset, ast, raw } of parsedAssets) {
    if (!ast) {
      sections.push(`/* Could not scope the following CSS; emitted unscoped. */\n${raw}`);
      notes.push({
        code: "selector-scope-fallback",
        severity: "warning",
        message: "A stylesheet could not be parsed and was emitted unscoped.",
        componentName,
      });
      continue;
    }
    const scoped = scopeRuleList(
      listChildren(ast, "children"),
      scopeClassName,
      keyframeRenames,
      notes,
      componentName,
      hoistedImports,
      true,
    );
    if (keyframeRenames.size > 0) renameKeyframeReferences(ast, keyframeRenames);
    const body = scoped.map((node) => generate(node)).join("\n");
    const label = ASSET_LABELS[asset.origin];
    sections.push(label ? `/* ${label} */\n${body}` : body);
  }

  for (const name of keyframeRenames.keys()) {
    notes.push({
      code: "keyframes-renamed",
      severity: "info",
      message: `@keyframes "${name}" was renamed to "${scopeClassName}-${name}" to avoid collisions between pages.`,
      componentName,
      detail: name,
    });
  }

  if (extractedRules.length > 0) {
    const lines = extractedRules.map(
      (rule) =>
        `.${scopeClassName} .${rule.className} {${rule.declarations
          .map((decl) => `${decl.property}: ${decl.value};`)
          .join("")}}`,
    );
    sections.push(
      `/* !important declarations extracted from inline styles */\n${lines.join("\n")}`,
    );
  }

  const importText = hoistedImports.map((node) => generate(node)).join("\n");
  const cssText = [importText, ...sections]
    .filter((section) => section.trim().length > 0)
    .join("\n\n");
  return { cssText: cssText ? `${cssText}\n` : "", notes };
}
