import { describe, expect, it } from "vitest";
import { buildLayerTree, countLayerNodes, elementProfile, layerDisplayName, layerIconKind, mixedValue, siblingIdsForNode } from "./panel-model";
import type { BridgeHierarchyNode, BridgeHierarchySnapshot } from "../bridge/protocol";
import type { NodeEntity } from "../editor/model";

const snapshot: BridgeHierarchySnapshot = {
  rootIds: ["root"],
  truncated: false,
  nodes: [
    { elementId: "root", tagName: "main", path: "html/body/main[1]", name: "Canvas", role: null, bounds: { x: 0, y: 0, width: 100, height: 100 }, parentId: null, childIds: ["title", "copy"] },
    { elementId: "title", tagName: "h1", path: "html/body/main[1]/h1[1]", name: "Headline", role: null, bounds: { x: 0, y: 0, width: 50, height: 20 }, parentId: "root", childIds: [] },
    { elementId: "copy", tagName: "p", path: "html/body/main[1]/p[1]", name: "Supporting copy", role: null, bounds: { x: 0, y: 30, width: 50, height: 20 }, parentId: "root", childIds: [] },
  ],
};

const node = (
  elementId: string,
  tagName: string,
  overrides: Partial<BridgeHierarchyNode> = {},
): BridgeHierarchyNode => ({
  elementId,
  tagName,
  path: `html/body/${tagName}[1]`,
  name: "",
  role: null,
  bounds: { x: 0, y: 0, width: 40, height: 20 },
  parentId: null,
  childIds: [],
  ...overrides,
});

describe("sidebar panel model", () => {
  it("builds a live tree and keeps matching ancestors for search", () => {
    const tree = buildLayerTree(snapshot, "supporting", {});
    expect(tree).toHaveLength(1);
    expect(tree[0].target.elementId).toBe("root");
    expect(tree[0].children.map((child) => child.target.elementId)).toEqual(["copy"]);
  });

  it("drops invisible plumbing and promotes document shells", () => {
    const dom: BridgeHierarchySnapshot = {
      rootIds: ["html"],
      truncated: false,
      nodes: [
        node("html", "html", { childIds: ["head", "body"] }),
        node("head", "head", { parentId: "html", childIds: ["meta", "script", "style"] }),
        node("meta", "meta", { parentId: "head" }),
        node("script", "script", { parentId: "head" }),
        node("style", "style", { parentId: "head" }),
        node("body", "body", { parentId: "html", childIds: ["hero"] }),
        node("hero", "h1", { parentId: "body", name: "Welcome" }),
      ],
    };

    const tree = buildLayerTree(dom, "", {});

    expect(tree.map((row) => row.target.elementId)).toEqual(["hero"]);
    expect(tree[0].name).toBe("Welcome");
  });

  it("collapses single-child wrapper chains into the meaningful layer", () => {
    const dom: BridgeHierarchySnapshot = {
      rootIds: ["outer"],
      truncated: false,
      nodes: [
        node("outer", "div", { childIds: ["mid"] }),
        node("mid", "div", { parentId: "outer", childIds: ["label"] }),
        node("label", "span", { parentId: "mid", name: "Sign in" }),
      ],
    };

    const tree = buildLayerTree(dom, "", {});

    expect(tree.map((row) => row.target.elementId)).toEqual(["label"]);
  });

  it("keeps multi-child containers and labeled wrappers visible", () => {
    const dom: BridgeHierarchySnapshot = {
      rootIds: ["card"],
      truncated: false,
      nodes: [
        node("card", "div", { childIds: ["heading", "body", "labeled"] }),
        node("heading", "h2", { parentId: "card", name: "Plan" }),
        node("body", "p", { parentId: "card", name: "Details" }),
        node("labeled", "div", { role: "button", name: "Choose plan", parentId: "card", childIds: ["inner"] }),
        node("inner", "span", { parentId: "labeled", name: "Choose plan" }),
      ],
    };

    const tree = buildLayerTree(dom, "", {});

    expect(tree).toHaveLength(1);
    expect(tree[0].target.elementId).toBe("card");
    expect(tree[0].children.map((child) => child.target.elementId)).toEqual(["heading", "body", "labeled"]);
    // The role-carrying wrapper keeps its own row and its inner span.
    expect(tree[0].children[2].children.map((child) => child.target.elementId)).toEqual(["inner"]);
  });

  it("falls back to purposeful names instead of raw tags", () => {
    const named = (name: string) => ({ elementId: "x", name, tagName: "div" });
    expect(layerDisplayName(node("x", "img"), {})).toBe("Image");
    expect(layerDisplayName(node("x", "svg"), {})).toBe("Vector");
    expect(layerDisplayName(node("x", "nav"), {})).toBe("Navigation");
    expect(layerDisplayName(node("x", "ul"), {})).toBe("List");
    expect(layerDisplayName(node("x", "input"), {})).toBe("Input");
    expect(layerDisplayName(node("x", "div"), {})).toBe("Group");
    expect(layerDisplayName(named("Get started"), {})).toBe("Get started");
    expect(layerDisplayName({ elementId: "x", name: "div", tagName: "div" }, {})).toBe("Group");
  });

  it("prefers user renames over bridge-derived names", () => {
    const target = node("x", "div", { name: "Accumulated text" });
    expect(layerDisplayName(target, {})).toBe("Accumulated text");
    expect(layerDisplayName(target, { x: { kind: "element", name: "Hero card" } as unknown as NodeEntity })).toBe("Hero card");
  });

  it("numbers siblings that resolve to the same label", () => {
    const dom: BridgeHierarchySnapshot = {
      rootIds: ["a", "b", "c"],
      truncated: false,
      nodes: [
        node("a", "img", { name: "" }),
        node("b", "img", { name: "" }),
        node("c", "img", { name: "" }),
      ],
    };

    const tree = buildLayerTree(dom, "", {});

    expect(tree.map((row) => row.name)).toEqual(["Image", "Image 2", "Image 3"]);
  });

  it("classifies rows into restrained glyph kinds", () => {
    expect(layerIconKind(node("x", "button"), undefined)).toBe("button");
    expect(layerIconKind(node("x", "div", { role: "button" }), undefined)).toBe("button");
    expect(layerIconKind(node("x", "h1"), undefined)).toBe("text");
    expect(layerIconKind(node("x", "img"), undefined)).toBe("image");
    expect(layerIconKind(node("x", "svg"), undefined)).toBe("vector");
    expect(layerIconKind(node("x", "textarea"), undefined)).toBe("field");
    expect(layerIconKind(node("x", "section"), undefined)).toBe("frame");
    expect(layerIconKind(node("x", "div"), undefined)).toBe("group");
  });

  it("counts rendered rows rather than raw snapshot nodes", () => {
    const tree = buildLayerTree(snapshot, "", {});
    expect(countLayerNodes(tree)).toBe(3);
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

  it("classifies elements into purpose-specific profiles", () => {
    const target = (tagName: string, role: string | null = null) => ({ tagName, role });
    const entity = (kind: NodeEntity["kind"]) => ({ kind } as NodeEntity);
    expect(elementProfile(target("button"), undefined)).toBe("button");
    expect(elementProfile(target("div", "button"), undefined)).toBe("button");
    expect(elementProfile(target("h1"), undefined)).toBe("text");
    expect(elementProfile(target("p"), undefined)).toBe("text");
    expect(elementProfile(target("span"), undefined)).toBe("text");
    expect(elementProfile(target("div"), entity("text"))).toBe("text");
    expect(elementProfile(target("svg"), undefined)).toBe("shape");
    expect(elementProfile(target("img"), undefined)).toBe("image");
    expect(elementProfile(target("main"), undefined)).toBe("generic");
    expect(elementProfile(target("button"), entity("text"))).toBe("text");
  });
});
