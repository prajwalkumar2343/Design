import type { BridgeHierarchyNode, BridgeHierarchySnapshot } from "../bridge/protocol";
import type { NodeEntity } from "../editor/model";

export interface LayerTreeNode {
  target: BridgeHierarchyNode;
  children: LayerTreeNode[];
}

export function layerDisplayName(
  target: Pick<BridgeHierarchyNode, "elementId" | "name" | "tagName">,
  nodes: Record<string, NodeEntity>,
): string {
  const name = nodes[target.elementId]?.name || target.name;
  const containerTags = new Set(["html", "head", "body", "main", "section", "article", "div", "nav", "header", "footer"]);
  return name && name.length <= 64 && !containerTags.has(target.tagName) ? name : target.tagName || "Layer";
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

function buildNode(
  target: BridgeHierarchyNode,
  byId: Map<string, BridgeHierarchyNode>,
  query: string,
  nodes: Record<string, NodeEntity>,
): LayerTreeNode | null {
  const children = target.childIds
    .map((id) => byId.get(id))
    .filter((child): child is BridgeHierarchyNode => Boolean(child))
    .map((child) => buildNode(child, byId, query, nodes))
    .filter((child): child is LayerTreeNode => Boolean(child));
  if (!query || matchesQuery(target, query, nodes) || children.length > 0) {
    return { target, children };
  }
  return null;
}

export function buildLayerTree(
  snapshot: BridgeHierarchySnapshot,
  query: string,
  nodes: Record<string, NodeEntity>,
): LayerTreeNode[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.elementId, node]));
  return snapshot.rootIds
    .map((id) => byId.get(id))
    .filter((node): node is BridgeHierarchyNode => Boolean(node))
    .map((node) => buildNode(node, byId, query.trim(), nodes))
    .filter((node): node is LayerTreeNode => Boolean(node));
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
