import type { BridgeElementTarget, BridgeHierarchyNode, BridgeHierarchySnapshot } from "../bridge/protocol";
import type { NodeEntity } from "../editor/model";

export interface LayerTreeNode {
  target: BridgeHierarchyNode;
  /** Friendly, design-tool-style label resolved once for display and search. */
  name: string;
  icon: LayerIconKind;
  children: LayerTreeNode[];
}

export type ElementProfileId = "button" | "text" | "shape" | "image" | "generic";

/** Coarse glyph classes for the layers panel, mirroring Figma's restrained set. */
export type LayerIconKind = "frame" | "group" | "text" | "image" | "vector" | "button" | "field";

const TEXT_TAG_NAMES = new Set([
  "p",
  "span",
  "a",
  "li",
  "label",
  "strong",
  "em",
  "small",
  "blockquote",
  "cite",
  "code",
  "pre",
  "figcaption",
  "dt",
  "dd",
  "legend",
  "time",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/** Elements that never render visually; they never belong in a layers panel. */
const NON_VISUAL_TAG_NAMES = new Set([
  "script",
  "style",
  "link",
  "meta",
  "title",
  "head",
  "noscript",
  "template",
  "base",
]);

/** Document shells already represented by the frame group heading. */
const SHELL_TAG_NAMES = new Set(["html", "body"]);

/** Layout-only wrappers hidden when they simply pass through to one child. */
const WRAPPER_TAG_NAMES = new Set(["div", "span"]);

/** Structural containers that stay visible with purposeful names, like Figma sections. */
const SEMANTIC_CONTAINER_TAG_NAMES = new Set([
  "main",
  "section",
  "article",
  "aside",
  "nav",
  "header",
  "footer",
  "form",
  "fieldset",
  "table",
  "ul",
  "ol",
  "dl",
  "figure",
  "dialog",
]);

const FALLBACK_NAMES: Record<string, string> = {
  article: "Article",
  aside: "Sidebar",
  audio: "Audio",
  blockquote: "Quote",
  button: "Button",
  canvas: "Canvas",
  cite: "Text",
  code: "Code",
  dd: "Description",
  dialog: "Dialog",
  div: "Group",
  dl: "List",
  dt: "Term",
  em: "Text",
  fieldset: "Form",
  figcaption: "Caption",
  figure: "Figure",
  footer: "Footer",
  form: "Form",
  h1: "Heading",
  h2: "Heading",
  h3: "Heading",
  h4: "Heading",
  h5: "Heading",
  h6: "Heading",
  header: "Header",
  iframe: "Embed",
  img: "Image",
  input: "Input",
  label: "Label",
  legend: "Label",
  li: "Text",
  main: "Main",
  nav: "Navigation",
  ol: "List",
  p: "Text",
  pre: "Code",
  section: "Section",
  select: "Dropdown",
  small: "Text",
  span: "Text",
  strong: "Text",
  svg: "Vector",
  table: "Table",
  textarea: "Text field",
  time: "Text",
  ul: "List",
  video: "Video",
};

const MAX_NAME_LENGTH = 64;

function truncateName(name: string): string {
  return name.length <= MAX_NAME_LENGTH ? name : `${name.slice(0, MAX_NAME_LENGTH - 1)}…`;
}

/** Classifies an element so the properties panel can show purpose-specific controls. */
export function elementProfile(
  target: Pick<BridgeElementTarget, "tagName" | "role">,
  node: NodeEntity | undefined,
  attributes?: Record<string, string>,
): ElementProfileId {
  // Tool-created text layers are <div>s carrying data-design-tool-kind="text";
  // the attribute catches them even when the node entity lookup misses.
  if (node?.kind === "text" || attributes?.["data-design-tool-kind"] === "text") return "text";
  const tagName = target.tagName.toLowerCase();
  if (tagName === "button" || target.role === "button") return "button";
  if (tagName === "img") return "image";
  if (tagName === "svg") return "shape";
  if (TEXT_TAG_NAMES.has(tagName)) return "text";
  return "generic";
}

/** Picks the layers-panel glyph, mirroring Figma's minimal icon vocabulary. */
export function layerIconKind(
  target: Pick<BridgeHierarchyNode, "tagName" | "role">,
  node: NodeEntity | undefined,
): LayerIconKind {
  if (node?.kind === "text") return "text";
  const tagName = target.tagName.toLowerCase();
  if (tagName === "button" || target.role === "button") return "button";
  if (tagName === "img") return "image";
  if (tagName === "svg") return "vector";
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return "field";
  if (TEXT_TAG_NAMES.has(tagName)) return "text";
  if (SEMANTIC_CONTAINER_TAG_NAMES.has(tagName)) return "frame";
  return "group";
}

export function layerDisplayName(
  target: Pick<BridgeHierarchyNode, "elementId" | "name" | "tagName">,
  nodes: Record<string, NodeEntity>,
): string {
  const renamed = nodes[target.elementId]?.name?.trim();
  if (renamed) return truncateName(renamed);
  const tagName = target.tagName.toLowerCase();
  // The bridge fills `name` with aria labels or visible text; ignore it when it
  // merely echoes the tag back because the element has neither.
  const described = target.name?.trim() ?? "";
  if (described && described.toLowerCase() !== tagName) return truncateName(described);
  return FALLBACK_NAMES[tagName] ?? (tagName ? `${tagName[0].toUpperCase()}${tagName.slice(1)}` : "Layer");
}

function matchesQuery(
  target: BridgeHierarchyNode,
  query: string,
  nodes: Record<string, NodeEntity>,
): boolean {
  if (!query) return true;
  const haystack = [
    layerDisplayName(target, nodes),
    target.tagName,
    target.role ?? "",
    target.path,
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

interface BuildContext {
  query: string;
  nodes: Record<string, NodeEntity>;
}

/**
 * Builds the visible subtree for one element. Returns every row it contributes
 * at this level: zero when the element is invisible plumbing, the promoted
 * children for document shells and pass-through wrappers, otherwise the row
 * itself.
 */
function buildNode(
  target: BridgeHierarchyNode,
  byId: Map<string, BridgeHierarchyNode>,
  context: BuildContext,
): LayerTreeNode[] {
  const tagName = target.tagName.toLowerCase();
  if (NON_VISUAL_TAG_NAMES.has(tagName)) return [];
  const children = target.childIds.flatMap((childId) => {
    const child = byId.get(childId);
    return child ? buildNode(child, byId, context) : [];
  });
  const matches = !context.query || matchesQuery(target, context.query, context.nodes);
  if (!matches && children.length === 0) return [];
  if (SHELL_TAG_NAMES.has(tagName)) return children;
  const renamed = Boolean(context.nodes[target.elementId]?.name);
  if (
    !context.query &&
    WRAPPER_TAG_NAMES.has(tagName) &&
    !target.role &&
    !renamed &&
    children.length === 1
  ) {
    return children;
  }
  return [{
    target,
    name: layerDisplayName(target, context.nodes),
    icon: layerIconKind(target, context.nodes[target.elementId]),
    children,
  }];
}

/** Appends design-tool-style counters ("Card 2") when siblings share a label. */
function disambiguateSiblingNames(siblings: LayerTreeNode[]): void {
  const totals = new Map<string, number>();
  for (const node of siblings) totals.set(node.name, (totals.get(node.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const node of siblings) {
    if ((totals.get(node.name) ?? 1) > 1) {
      const index = (seen.get(node.name) ?? 0) + 1;
      seen.set(node.name, index);
      if (index > 1) node.name = `${node.name} ${index}`;
    }
    disambiguateSiblingNames(node.children);
  }
}

export function buildLayerTree(
  snapshot: BridgeHierarchySnapshot,
  query: string,
  nodes: Record<string, NodeEntity>,
): LayerTreeNode[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.elementId, node]));
  const context: BuildContext = { query: query.trim(), nodes };
  const tree = snapshot.rootIds.flatMap((rootId) => {
    const root = byId.get(rootId);
    return root ? buildNode(root, byId, context) : [];
  });
  disambiguateSiblingNames(tree);
  return tree;
}

/** Counts the rows a subtree contributes, matching what the panel renders. */
export function countLayerNodes(tree: readonly LayerTreeNode[]): number {
  return tree.reduce((total, node) => total + 1 + countLayerNodes(node.children), 0);
}

export function mixedValue(values: readonly (string | number | null | undefined)[]): string | null {
  const normalized = values.map((value) => value == null ? "" : String(value));
  if (normalized.length === 0) return null;
  return normalized.every((value) => value === normalized[0]) ? normalized[0] : "mixed";
}

export function siblingIdsForNode(
  target: BridgeHierarchyNode,
  snapshot: BridgeHierarchySnapshot | undefined,
): string[] {
  if (!snapshot) return [];
  if (target.parentId) return snapshot.nodes.find((node) => node.elementId === target.parentId)?.childIds ?? [];
  return snapshot.rootIds;
}
