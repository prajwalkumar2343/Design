import { describe, expect, it } from "vitest";
import { buildLayerTree, mixedValue, siblingIdsForNode } from "./panel-model";
import type { BridgeHierarchySnapshot } from "../bridge/protocol";

const snapshot: BridgeHierarchySnapshot = {
  rootIds: ["root"],
  truncated: false,
  nodes: [
    { elementId: "root", tagName: "main", path: "html/body/main[1]", name: "Canvas", role: null, bounds: { x: 0, y: 0, width: 100, height: 100 }, parentId: null, childIds: ["title", "copy"] },
    { elementId: "title", tagName: "h1", path: "html/body/main[1]/h1[1]", name: "Headline", role: null, bounds: { x: 0, y: 0, width: 50, height: 20 }, parentId: "root", childIds: [] },
    { elementId: "copy", tagName: "p", path: "html/body/main[1]/p[1]", name: "Supporting copy", role: null, bounds: { x: 0, y: 30, width: 50, height: 20 }, parentId: "root", childIds: [] },
  ],
};

describe("sidebar panel model", () => {
  it("builds a live tree and keeps matching ancestors for search", () => {
    const tree = buildLayerTree(snapshot, "supporting", {});
    expect(tree).toHaveLength(1);
    expect(tree[0].target.elementId).toBe("root");
    expect(tree[0].children.map((child) => child.target.elementId)).toEqual(["copy"]);
  });

  it("reports mixed values for contextual multi-selection fields", () => {
    expect(mixedValue([12, 12])).toBe("12");
    expect(mixedValue([12, 18])).toBe("mixed");
    expect(mixedValue([])).toBeNull();
  });

  it("returns safe sibling order for root and nested layers", () => {
    expect(siblingIdsForNode(snapshot.nodes[1], snapshot)).toEqual(["title", "copy"]);
    expect(siblingIdsForNode(snapshot.nodes[0], snapshot)).toEqual(["root"]);
  });
});

