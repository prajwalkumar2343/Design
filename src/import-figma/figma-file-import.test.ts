import { describe, expect, it, vi } from "vitest";
import { parseFig, type FigDocument } from "openfig-core";
import { serializeFigmaProject, type FigmaExportInput } from "../persistence/figma";
import { createEditorStore } from "../editor/store";
import { createEmptyEditorState, type FrameEntity, type NodeEntity } from "../editor/model";
import { FigmaImportError, importFigmaFileIntoStore, planFigmaImport } from "./figma-file-import";

// Zip + kiwi serialization is CPU-bound; keep the same generous timeout the
// export tests use.
vi.setConfig({ testTimeout: 30_000 });

function frame(overrides: Partial<FrameEntity> = {}): FrameEntity {
  return {
    id: "desktop",
    pageId: "page-1",
    documentId: "doc-1",
    name: "Desktop",
    x: 1120,
    y: 90,
    width: 1440,
    height: 900,
    background: "#f3f0e9",
    ...overrides,
  };
}

function node(id: string, frameId: string, overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    id,
    documentId: "doc-1",
    parentId: null,
    kind: "element",
    name: `Layer ${id}`,
    attributes: {},
    childIds: [],
    frameId,
    ...overrides,
  };
}

function target(
  frameId: string,
  nodeId: string,
  attributes: Record<string, string>,
  text = "",
  extras: {
    inlineStyle?: Record<string, string>;
    computedStyle?: Record<string, string>;
    bounds?: { x: number; y: number; width: number; height: number };
  } = {},
) {
  const liveBounds = extras.bounds ?? { x: 0, y: 0, width: 10, height: 10 };
  const targetMeta = {
    elementId: nodeId,
    tagName: "div",
    path: "html/body/div[1]",
    name: `Layer ${nodeId}`,
    role: null,
    bounds: liveBounds,
    locked: false,
  };
  return {
    frameId,
    target: targetMeta,
    inspection: {
      target: targetMeta,
      text,
      attributes,
      inlineStyle: extras.inlineStyle ?? {},
      computedStyle: extras.computedStyle ?? {},
    },
  };
}

const created = { "data-design-tool-created": "true" };

function bounds(x: number, y: number, width: number, height: number) {
  return JSON.stringify({ x, y, width, height });
}

/** Single-quoted data-* attribute values entity-escape both quote kinds. */
function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function shapeInput(nodeId: string, attributes: Record<string, string>, text = ""): FigmaExportInput {
  return {
    frames: [frame()],
    nodes: { [nodeId]: node(nodeId, "desktop") },
    bridgeTargets: { [`desktop:${nodeId}`]: target("desktop", nodeId, attributes, text) },
  };
}

describe("Figma .fig import", () => {
  it("maps a Figma canvas to a page and its frames to app frames/documents", async () => {
    const bytes = await serializeFigmaProject({
      frames: [
        frame({ id: "a", name: "Frame A", x: 40, y: 60, width: 320, height: 200, background: "#123456" }),
        frame({ id: "b", name: "Frame B", x: -80, y: 120, width: 100, height: 80, background: "#ffffff" }),
      ],
      nodes: {},
      bridgeTargets: {},
    });
    const plan = planFigmaImport(bytes);
    expect(plan.seeds.length).toBe(2);
    expect(plan.pageIds.length).toBe(1);
    const [seedA, seedB] = plan.seeds;
    expect(seedA.name).toBe("Frame A");
    expect(seedA.pageId).toBe(plan.pageIds[0]);
    expect(seedB.pageId).toBe(plan.pageIds[0]);
    // Two frames share one page but each owns its own document.
    expect(seedA.documentId).not.toBe(seedB.documentId);
    expect(seedA.x).toBeCloseTo(40, 2);
    expect(seedA.y).toBeCloseTo(60, 2);
    expect(seedA.width).toBe(320);
    expect(seedA.height).toBe(200);
    expect(seedA.background).toBe("#123456");
    expect(seedB.background).toBe("#ffffff");
    expect(plan.firstFrameId).toBe(seedA.id);
    expect(plan.firstPageId).toBe(plan.pageIds[0]);
    expect(plan.firstFrameRect).toMatchObject({ x: 40, y: 60, width: 320, height: 200 });
  });

  it("imports a rounded rectangle with exact colors, stroke, and bridge attrs", async () => {
    const bytes = await serializeFigmaProject(shapeInput("rect-1", {
      ...created,
      "data-design-tool-kind": "rectangle",
      "data-design-tool-bounds": bounds(12, 24, 120, 80),
      "data-design-tool-fill": "#ff8800",
      "data-design-tool-stroke": "#222222",
      "data-design-tool-stroke-width": "2",
      "data-design-tool-radius": "16",
    }));
    const plan = planFigmaImport(bytes);
    expect(plan.seeds.length).toBe(1);
    const srcDoc = plan.seeds[0].srcDoc;
    expect(srcDoc).toContain('data-design-element-id="');
    expect(srcDoc).toContain('data-design-tool-kind="rectangle"');
    expect(srcDoc).toContain('data-design-tool-created="true"');
    expect(srcDoc).toContain('data-design-tool-space="document"');
    expect(srcDoc).toContain("#ff8800");
    expect(srcDoc).toContain("#222222");
    expect(srcDoc).toContain('rx="16"');
    expect(srcDoc).toContain('stroke-width="2"');
    expect(srcDoc).toContain("left:12px");
    expect(srcDoc).toContain("top:24px");
    expect(srcDoc).toContain("width:120px");
    expect(srcDoc).toContain("height:80px");
    expect(srcDoc).toContain("data-design-tool-bounds");
    expect(srcDoc).toContain("data-design-tool-transform");
    expect(srcDoc).toContain("data-design-tool-local-transform");
  });

  it("preserves alpha in semi-transparent fills", async () => {
    const bytes = await serializeFigmaProject(shapeInput("rect-1", {
      ...created,
      "data-design-tool-kind": "rectangle",
      "data-design-tool-bounds": bounds(0, 0, 100, 50),
      "data-design-tool-fill": "rgba(0, 128, 255, 0.5)",
    }));
    const srcDoc = planFigmaImport(bytes).seeds[0].srcDoc;
    expect(srcDoc).toContain("rgba(0, 128, 255, 0.5)");
  });

  it("imports ellipses as ellipse shapes with paint", async () => {
    const bytes = await serializeFigmaProject(shapeInput("ellipse-1", {
      ...created,
      "data-design-tool-kind": "ellipse",
      "data-design-tool-bounds": bounds(40, 40, 60, 60),
      "data-design-tool-fill": "#d9d9d9",
      "data-design-tool-stroke": "#222222",
      "data-design-tool-stroke-width": "2",
    }));
    const srcDoc = planFigmaImport(bytes).seeds[0].srcDoc;
    expect(srcDoc).toContain('data-design-tool-kind="ellipse"');
    expect(srcDoc).toContain("<ellipse");
    expect(srcDoc).toContain("#d9d9d9");
    expect(srcDoc).toContain('stroke="#222222"');
  });

  it("imports lines with document-space endpoints and stroke weight", async () => {
    const bytes = await serializeFigmaProject(shapeInput("line-1", {
      ...created,
      "data-design-tool-kind": "line",
      "data-design-tool-bounds": bounds(10, 10, 100, 50),
      "data-design-tool-points": JSON.stringify([{ x: 10, y: 10 }, { x: 110, y: 60 }]),
      "data-design-tool-stroke": "#111111",
      "data-design-tool-stroke-width": "3",
    }));
    const srcDoc = planFigmaImport(bytes).seeds[0].srcDoc;
    expect(srcDoc).toContain('data-design-tool-kind="line"');
    expect(srcDoc).toContain("<line");
    expect(srcDoc).toContain('stroke="#111111"');
    expect(srcDoc).toContain('stroke-width="3"');
    expect(srcDoc).toContain("data-design-tool-points");
    const pointsAttr = srcDoc.match(/data-design-tool-points='([^']+)'/)?.[1];
    expect(pointsAttr).toBeTruthy();
    const points = JSON.parse(decodeAttr(pointsAttr!)) as { x: number; y: number }[];
    expect(points[0]).toMatchObject({ x: 10, y: 10 });
    expect(points[1].x).toBeCloseTo(110, 1);
    expect(points[1].y).toBeCloseTo(60, 1);
  });

  it("imports vector shapes with their resolved path geometry", async () => {
    const bytes = await serializeFigmaProject(shapeInput("poly-1", {
      ...created,
      "data-design-tool-kind": "polygon",
      "data-design-tool-bounds": bounds(50, 50, 100, 100),
      "data-design-tool-points": JSON.stringify([
        { x: 100, y: 50 }, { x: 150, y: 88 }, { x: 131, y: 150 }, { x: 69, y: 150 }, { x: 50, y: 88 },
      ]),
      "data-design-tool-fill": "#d9d9d9",
      "data-design-tool-stroke": "#222222",
      "data-design-tool-stroke-width": "2",
    }));
    const srcDoc = planFigmaImport(bytes).seeds[0].srcDoc;
    expect(srcDoc).toContain('data-design-tool-kind="vector"');
    expect(srcDoc).toContain("<path");
    const pathAttr = srcDoc.match(/data-design-tool-path='([^']+)'/)?.[1];
    expect(pathAttr).toBeTruthy();
    expect(decodeAttr(pathAttr!)).toContain("M50 0");
  });

  it("imports text with characters and typography", async () => {
    const bytes = await serializeFigmaProject(shapeInput("text-1", {
      ...created,
      "data-design-tool-kind": "text",
      "data-design-tool-bounds": bounds(0, 0, 252, 38),
      "data-design-tool-fill": "#171717",
    }, "Type to edit"));
    const srcDoc = planFigmaImport(bytes).seeds[0].srcDoc;
    expect(srcDoc).toContain('data-design-tool-kind="text"');
    expect(srcDoc).toContain('data-design-tool-editable="true"');
    expect(srcDoc).toContain("Type to edit");
    expect(srcDoc).toContain("font-size:16px");
    expect(srcDoc).toContain('font-family:"Inter"');
    expect(srcDoc).toContain("color:#171717");
  });

  it("rotates imported content via element transforms", async () => {
    const bytes = await serializeFigmaProject(shapeInput("line-1", {
      ...created,
      "data-design-tool-kind": "line",
      "data-design-tool-bounds": bounds(10, 10, 100, 50),
      "data-design-tool-points": JSON.stringify([{ x: 10, y: 10 }, { x: 110, y: 60 }]),
      "data-design-tool-stroke": "#111111",
      "data-design-tool-stroke-width": "3",
    }));
    const srcDoc = planFigmaImport(bytes).seeds[0].srcDoc;
    expect(srcDoc).toContain("transform:matrix(");
    expect(srcDoc).toContain("transform-origin:0 0");
  });

  it("skips hidden canvases and empty pages", async () => {
    const bytes = await serializeFigmaProject({
      frames: [frame()],
      nodes: {},
      bridgeTargets: {},
    });
    const plan = planFigmaImport(bytes);
    expect(plan.seeds.length).toBe(1);
    // The exporter always writes an invisible "Internal Only Canvas"; it must
    // never become a page or frame.
    expect(plan.pageIds.length).toBe(1);
    expect(plan.seeds[0].name).toBe("Desktop");
  });

  it("inserts a multi-frame import in one undoable transaction", async () => {
    const bytes = await serializeFigmaProject({
      frames: [
        frame({ id: "a", name: "Frame A", x: 40, y: 60, width: 320, height: 200 }),
        frame({ id: "b", name: "Frame B", x: -80, y: 120, width: 100, height: 80 }),
      ],
      nodes: {},
      bridgeTargets: {},
    });
    const store = createEditorStore(createEmptyEditorState());
    const summary = importFigmaFileIntoStore(store, bytes);
    const state = store.getState();
    expect(summary.frameIds.length).toBe(2);
    expect(Object.keys(state.frames)).toHaveLength(2);
    expect(Object.keys(state.documents)).toHaveLength(2);
    expect(Object.keys(state.pages)).toHaveLength(1);
    // Both frames share one imported page.
    const page = state.pages[summary.pageIds[0]];
    expect(page.frameIds).toEqual(summary.frameIds);
    expect(state.activePageId).toBe(summary.pageIds[0]);
    expect(state.selection.frameIds).toEqual([summary.firstFrameId]);
    expect(state.activeTool).toBe("select");
    // One undo removes everything the import added.
    expect(store.undo()).toBe(true);
    expect(Object.keys(store.getState().frames)).toHaveLength(0);
    expect(Object.keys(store.getState().pages)).toHaveLength(0);
  });

  it("leaves the store untouched and throws for non-fig bytes", () => {
    const store = createEditorStore(createEmptyEditorState());
    const before = store.getState();
    expect(() => importFigmaFileIntoStore(store, new TextEncoder().encode("not a fig file")))
      .toThrowError(FigmaImportError);
    expect(store.getState()).toBe(before);
    expect(store.getHistory().past).toHaveLength(0);
  });

  it("throws for a fig file with no importable content", async () => {
    // A fig with no canvases at all still parses but has nothing to place.
    const bytes = await serializeFigmaProject({ frames: [], nodes: {}, bridgeTargets: {} });
    expect(() => planFigmaImport(bytes)).toThrowError(FigmaImportError);
  });

  it("round-trips an export through import back into Figma nodes", async () => {
    const original = await serializeFigmaProject({
      frames: [frame({ id: "desktop", name: "Desktop", x: 100, y: 200, width: 400, height: 300, background: "#112233" })],
      nodes: {
        "rect-1": node("rect-1", "desktop"),
        "text-1": node("text-1", "desktop"),
      },
      bridgeTargets: {
        "desktop:rect-1": target("desktop", "rect-1", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(12, 24, 120, 80),
          "data-design-tool-fill": "#ff8800",
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "2",
          "data-design-tool-radius": "16",
        }, "", {
          inlineStyle: { left: "12px", top: "24px", width: "120px", height: "80px" },
        }),
        "desktop:text-1": target("desktop", "text-1", {
          ...created,
          "data-design-tool-kind": "text",
          "data-design-tool-bounds": bounds(0, 100, 252, 38),
          "data-design-tool-fill": "#171717",
        }, "Hello canvas", {
          inlineStyle: { left: "0px", top: "100px", width: "252px", height: "38px" },
        }),
      },
    });
    const imported = planFigmaImport(original);
    const store = createEditorStore(createEmptyEditorState());
    importFigmaFileIntoStore(store, original);
    const state = store.getState();
    const importedFrame = state.frames[imported.seeds[0].id];
    expect(importedFrame.x).toBeCloseTo(100, 0);
    expect(importedFrame.y).toBeCloseTo(200, 0);
    expect(importedFrame.width).toBe(400);
    expect(importedFrame.height).toBe(300);

    // Rebuild bridge targets the way a live inspection would report them —
    // attributes + inline styles lifted straight from the generated srcDoc.
    const dom = new DOMParser().parseFromString(
      state.documents[imported.seeds[0].documentId].srcDoc,
      "text/html",
    );
    const bridgeTargets: Record<string, ReturnType<typeof target>> = {};
    for (const element of dom.querySelectorAll("[data-design-tool-created]")) {
      const elementId = element.getAttribute("data-design-element-id")!;
      const attributes: Record<string, string> = {};
      for (const attr of Array.from(element.attributes)) {
        if (attr.name.startsWith("data-")) attributes[attr.name] = attr.value;
      }
      const inlineStyle: Record<string, string> = {};
      for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
        const [prop, value] = declaration.split(":");
        if (prop && value) inlineStyle[prop.trim()] = value.trim();
      }
      bridgeTargets[`${importedFrame.id}:${elementId}`] = target(
        importedFrame.id,
        elementId,
        attributes,
        element.textContent ?? "",
        { inlineStyle },
      );
    }
    const nodes = Object.fromEntries(
      Object.keys(bridgeTargets).map((key) => {
        const elementId = key.split(":")[1];
        const element = dom.querySelector(`[data-design-element-id="${elementId}"]`);
        const name = element?.getAttribute("aria-label") ?? elementId;
        return [elementId, node(elementId, importedFrame.id, { name })];
      }),
    );

    const reExported = await serializeFigmaProject({
      frames: [importedFrame],
      nodes,
      bridgeTargets,
      pages: [state.pages[imported.pageIds[0]]],
    });
    const doc: FigDocument = parseFig(reExported);
    const reExportedFrame = doc.nodes.find((item) => item.type === "FRAME" && item.name === "Desktop");
    expect(reExportedFrame).toBeTruthy();
    expect(reExportedFrame?.size).toEqual({ x: 400, y: 300 });
    expect(reExportedFrame?.transform).toMatchObject({ m02: 100, m12: 200 });

    // The rectangle re-exports at its authored position with its paint.
    const rect = doc.nodes.find((item) => item.type === "ROUNDED_RECTANGLE" && item.name === "Layer rect-1");
    expect(rect).toBeTruthy();
    expect(rect?.transform?.m02).toBeCloseTo(12, 1);
    expect(rect?.transform?.m12).toBeCloseTo(24, 1);
    expect(rect?.size).toEqual({ x: 120, y: 80 });
    const fill = rect?.fillPaints?.[0] as { color?: { r: number; g: number; b: number } } | undefined;
    expect(fill?.color?.r).toBeCloseTo(1, 4);
    expect(fill?.color?.g).toBeCloseTo(0x88 / 255, 4);
    expect(rect?.cornerRadius).toBe(16);

    const text = doc.nodes.find((item) => item.type === "TEXT");
    expect(text?.textData?.characters).toBe("Hello canvas");
    // The text element carries the 6px/4px padding convention: the figma
    // TEXT node's transform lands at bounds+pad — exactly what the original
    // export produced (0+6, 100+4).
    expect(text?.transform?.m02).toBeCloseTo(6, 1);
    expect(text?.transform?.m12).toBeCloseTo(104, 1);
  });
});
