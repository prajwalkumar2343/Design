import { describe, expect, it, vi } from "vitest";
import { parseFig, type FigDocument } from "openfig-core";
import { serializeFigmaProject, type FigmaExportInput } from "./figma";
import type { FrameEntity, NodeEntity } from "../editor/model";

// Zip + kiwi serialization is CPU-bound; under full-suite parallel load the
// default 5s timeout flakes even though the test passes in isolation.
vi.setConfig({ testTimeout: 30_000 });

function frame(overrides: Partial<FrameEntity> = {}): FrameEntity {
  return {
    id: "desktop",
    pageId: "page-1",
    documentId: "doc-1",
    name: "Desktop · 1440 × 900",
    x: 0,
    y: 0,
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

function target(frameId: string, nodeId: string, attributes: Record<string, string>, text = "") {
  return {
    frameId,
    target: {
      elementId: nodeId,
      tagName: "div",
      path: "html/body/div[1]",
      name: `Layer ${nodeId}`,
      role: null,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      locked: false,
    },
    inspection: {
      target: {
        elementId: nodeId,
        tagName: "div",
        path: "html/body/div[1]",
        name: `Layer ${nodeId}`,
        role: null,
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        locked: false,
      },
      text,
      attributes,
      inlineStyle: {},
      computedStyle: {},
    },
  };
}

const created = { "data-design-tool-created": "true" };

function bounds(x: number, y: number, width: number, height: number) {
  return JSON.stringify({ x, y, width, height });
}

function input(overrides: Partial<FigmaExportInput> = {}): FigmaExportInput {
  return {
    frames: [frame()],
    nodes: {},
    bridgeTargets: {},
    ...overrides,
  };
}

async function parse(inputData: FigmaExportInput): Promise<FigDocument> {
  const bytes = await serializeFigmaProject(inputData);
  return parseFig(bytes);
}

function byName(doc: FigDocument, name: string) {
  return doc.nodes.find((item) => item.name === name);
}

describe("Figma .fig export", () => {
  it("produces a zip with canvas.fig, meta.json and a thumbnail", async () => {
    const bytes = await serializeFigmaProject(input());
    const view = new DataView(bytes.slice().buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);

    const doc = parseFig(bytes);
    expect(doc.header.prelude).toBe("fig-kiwi");
    expect(doc.meta).toMatchObject({ file_name: "brainstorm-session" });
    expect(doc.thumbnail).toBeTruthy();
    expect(doc.thumbnail && doc.thumbnail.length).toBeGreaterThan(100);
  });

  it("maps frames to FRAME nodes with canvas coordinates and background", async () => {
    const doc = await parse(input({
      frames: [
        frame({ id: "a", name: "Frame A", x: 40, y: 60, width: 320, height: 200, background: "#123456" }),
        frame({ id: "b", name: "Frame B", x: -80, y: 120, width: 100, height: 80, background: "#ffffff" }),
      ],
    }));
    const frameA = byName(doc, "Frame A")!;
    const frameB = byName(doc, "Frame B")!;
    expect(frameA.type).toBe("FRAME");
    expect(frameA.size).toEqual({ x: 320, y: 200 });
    expect(frameA.transform).toMatchObject({ m02: 40, m12: 60 });
    expect((frameA.fillPaints?.[0] as { color?: { r: number } })?.color?.r).toBeCloseTo(0x12 / 255, 4);
    expect(frameB.transform).toMatchObject({ m02: -80, m12: 120 });

    const page = doc.nodes.find((item) => item.type === "CANVAS" && item.name === "Page 1")!;
    const pageChildren = doc.childrenMap.get(`${page.guid.sessionID}:${page.guid.localID}`) ?? [];
    expect(pageChildren.map((child) => child.name)).toEqual(["Frame A", "Frame B"]);
  });

  it("converts a rectangle into a ROUNDED_RECTANGLE with corner radius and colors", async () => {
    const doc = await parse(input({
      nodes: { "rect-1": node("rect-1", "desktop") },
      bridgeTargets: {
        "desktop:rect-1": target("desktop", "rect-1", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(12, 24, 120, 80),
          "data-design-tool-fill": "#ff8800",
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "2",
          "data-design-tool-radius": "16",
        }),
      },
    }));
    const rect = byName(doc, "Layer rect-1")!;
    expect(rect.type).toBe("ROUNDED_RECTANGLE");
    expect(rect.cornerRadius).toBe(16);
    expect(rect.size).toEqual({ x: 120, y: 80 });
    expect(rect.transform).toMatchObject({ m02: 12, m12: 24 });
    const fill = rect.fillPaints?.[0] as { color?: { r: number; g: number; b: number } };
    expect(fill.color?.r).toBeCloseTo(1, 4);
    expect(fill.color?.g).toBeCloseTo(0x88 / 255, 4);
    expect(fill.color?.b).toBeCloseTo(0, 4);
    expect(rect.strokeWeight).toBe(2);
    expect(rect.strokeAlign).toBe("INSIDE");
  });

  it("converts lines into LINE nodes with rotation encoded in the transform", async () => {
    const doc = await parse(input({
      nodes: { "line-1": node("line-1", "desktop") },
      bridgeTargets: {
        "desktop:line-1": target("desktop", "line-1", {
          ...created,
          "data-design-tool-kind": "line",
          "data-design-tool-bounds": bounds(10, 10, 100, 50),
          "data-design-tool-points": JSON.stringify([{ x: 10, y: 10 }, { x: 110, y: 60 }]),
          "data-design-tool-stroke": "#111111",
          "data-design-tool-stroke-width": "3",
        }),
      },
    }));
    const line = byName(doc, "Layer line-1")!;
    expect(line.type).toBe("LINE");
    expect(line.size?.y).toBe(0);
    expect(line.size?.x).toBeCloseTo(Math.hypot(100, 50), 4);
    expect(line.transform?.m02).toBeCloseTo(10, 4);
    expect(line.transform?.m12).toBeCloseTo(10, 4);
    expect(line.strokeWeight).toBe(3);
    expect(line.strokeCap).toBe("ROUND");
  });

  it("converts arrows into VECTOR nodes with arrowhead geometry", async () => {
    const doc = await parse(input({
      nodes: { "arrow-1": node("arrow-1", "desktop") },
      bridgeTargets: {
        "desktop:arrow-1": target("desktop", "arrow-1", {
          ...created,
          "data-design-tool-kind": "arrow",
          "data-design-tool-bounds": bounds(10, 100, 80, 40),
          "data-design-tool-points": JSON.stringify([{ x: 10, y: 140 }, { x: 90, y: 100 }]),
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "2",
        }),
      },
    }));
    const arrow = byName(doc, "Layer arrow-1")!;
    expect(arrow.type).toBe("VECTOR");
    expect(Array.isArray(arrow.fillGeometry)).toBe(true);
    expect(arrow.vectorData?.vectorNetworkBlob).toBeTypeOf("number");
    expect(doc.message.blobs).toBeTruthy();
  });

  it("converts polygons and stars into native POLYGON and STAR nodes", async () => {
    const doc = await parse(input({
      nodes: { "poly-1": node("poly-1", "desktop"), "star-1": node("star-1", "desktop") },
      bridgeTargets: {
        "desktop:poly-1": target("desktop", "poly-1", {
          ...created,
          "data-design-tool-kind": "polygon",
          "data-design-tool-bounds": bounds(50, 50, 100, 100),
          "data-design-tool-points": JSON.stringify([{ x: 100, y: 50 }, { x: 150, y: 88 }, { x: 131, y: 150 }, { x: 69, y: 150 }, { x: 50, y: 88 }]),
          "data-design-tool-fill": "#d9d9d9",
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "2",
        }),
        "desktop:star-1": target("desktop", "star-1", {
          ...created,
          "data-design-tool-kind": "star",
          "data-design-tool-bounds": bounds(50, 200, 100, 100),
          "data-design-tool-points": JSON.stringify([]),
          "data-design-tool-fill": "#d9d9d9",
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "2",
        }),
      },
    }));
    const polygon = byName(doc, "Layer poly-1")!;
    const star = byName(doc, "Layer star-1")!;
    expect(polygon.type).toBe("REGULAR_POLYGON");
    expect(polygon.count).toBe(5);
    expect(star.type).toBe("STAR");
    expect(star.starInnerScale).toBeCloseTo(0.382, 3);
  });

  it("converts text layers into TEXT nodes with characters and typography", async () => {
    const doc = await parse(input({
      nodes: { "text-1": node("text-1", "desktop") },
      bridgeTargets: {
        "desktop:text-1": target("desktop", "text-1", {
          ...created,
          "data-design-tool-kind": "text",
          "data-design-tool-bounds": bounds(0, 0, 240, 30),
          "data-design-tool-fill": "#171717",
        }, "Type to edit"),
      },
    }));
    const text = byName(doc, "Layer text-1")!;
    expect(text.type).toBe("TEXT");
    expect(text.textData?.characters).toBe("Type to edit");
    expect(text.fontSize).toBe(16);
    expect(text.fontName?.family).toBe("Inter");
    expect(text.textAlignHorizontal).toBe("LEFT");
  });

  it("skips nodes that have no live inspection data", async () => {
    const doc = await parse(input({
      nodes: { "ghost-1": node("ghost-1", "desktop") },
      bridgeTargets: {},
    }));
    expect(byName(doc, "Layer ghost-1")).toBeUndefined();
  });

  it("creates a file that round-trips through the parser without errors", async () => {
    const doc = await parse(input({
      nodes: { "rect-1": node("rect-1", "desktop") },
      bridgeTargets: {
        "desktop:rect-1": target("desktop", "rect-1", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(0, 0, 200, 100),
          "data-design-tool-fill": "#ff8800",
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "2",
          "data-design-tool-radius": "0",
        }),
      },
    }));
    const documentNode = doc.nodes.find((item) => item.type === "DOCUMENT");
    expect(documentNode).toBeTruthy();
    expect(doc.nodes.some((item) => item.type === "FRAME")).toBe(true);
  });

  it("matches the real Design FRAME shape (no canvas background fields)", async () => {
    const doc = await parse(input());
    const frameNode = byName(doc, "Desktop · 1440 × 900")!;
    expect(frameNode.type).toBe("FRAME");
    expect("backgroundColor" in frameNode).toBe(false);
    expect("backgroundEnabled" in frameNode).toBe(false);
    expect(frameNode.strokeWeight).toBe(0);
    expect(frameNode.frameMaskDisabled).toBe(false);
    expect(frameNode.fillPaints?.length).toBeGreaterThan(0);
  });

  it("never emits empty text runs (Figma rejects them)", async () => {
    const doc = await parse(input({
      nodes: { "text-1": node("text-1", "desktop") },
      bridgeTargets: {
        "desktop:text-1": target("desktop", "text-1", {
          ...created,
          "data-design-tool-kind": "text",
          "data-design-tool-bounds": bounds(0, 0, 240, 30),
          "data-design-tool-fill": "#171717",
        }, ""),
      },
    }));
    expect(byName(doc, "Layer text-1")!.textData?.characters).toBe(" ");
  });

  it("carries the message envelope real Figma exports include", async () => {
    const doc = await parse(input());
    expect(doc.message.sessionID).toBe(0);
    expect(doc.message.ackID).toBe(0);
    expect(Array.isArray(doc.message.blobs)).toBe(true);
  });

  it("writes document profile and rich file meta like real exports", async () => {
    const doc = await parse(input());
    expect(doc.nodes.find((item) => item.type === "DOCUMENT")?.documentColorProfile).toBe("SRGB");
    expect(doc.meta?.file_name).toBe("brainstorm-session");
    expect(doc.meta?.exported_at).toBeTypeOf("string");
    expect(doc.meta?.client_meta?.thumbnail_size).toMatchObject({ width: 320, height: 180 });
  });

  it("drops stroke paint and weight when a shape has no stroke", async () => {
    const doc = await parse(input({
      nodes: { "rect-1": node("rect-1", "desktop") },
      bridgeTargets: {
        "desktop:rect-1": target("desktop", "rect-1", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(0, 0, 200, 100),
          "data-design-tool-fill": "#ff8800",
          "data-design-tool-radius": "0",
        }),
      },
    }));
    const rect = byName(doc, "Layer rect-1")!;
    expect(rect.strokeWeight).toBe(0);
    expect(rect.strokePaints ?? []).toEqual([]);
  });
});
