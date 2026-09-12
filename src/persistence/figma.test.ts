import { describe, expect, it, vi } from "vitest";
import { geometryBlobToSVGPath, parseFig, type FigDocument } from "openfig-core";
import { serializeFigmaProject, type FigmaExportInput } from "./figma";
import type { FrameEntity, NodeEntity, PageEntity } from "../editor/model";

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
  return {
    frameId,
    target: {
      elementId: nodeId,
      tagName: "div",
      path: "html/body/div[1]",
      name: `Layer ${nodeId}`,
      role: null,
      bounds: liveBounds,
      locked: false,
    },
    inspection: {
      target: {
        elementId: nodeId,
        tagName: "div",
        path: "html/body/div[1]",
        name: `Layer ${nodeId}`,
        role: null,
        bounds: liveBounds,
        locked: false,
      },
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

  it("exports polygons and stars as exact-point VECTOR nodes", async () => {
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
          "data-design-tool-points": JSON.stringify([
            { x: 100, y: 200 }, { x: 115, y: 235 }, { x: 150, y: 235 }, { x: 122, y: 258 },
            { x: 131, y: 295 }, { x: 100, y: 275 }, { x: 69, y: 295 }, { x: 78, y: 258 },
            { x: 50, y: 235 }, { x: 85, y: 235 },
          ]),
          "data-design-tool-fill": "#d9d9d9",
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "2",
        }),
      },
    }));
    const polygon = byName(doc, "Layer poly-1")!;
    const star = byName(doc, "Layer star-1")!;
    expect(polygon.type).toBe("VECTOR");
    expect(star.type).toBe("VECTOR");
    expect(polygon.fillGeometry?.length).toBeGreaterThan(0);
    expect(polygon.strokeGeometry?.length).toBeGreaterThan(0);
    expect(polygon.vectorData?.vectorNetworkBlob).toBeTypeOf("number");
    // The drawn pentagon is not a regular polygon — the exported path must
    // carry the literal points (localized to the element box), not an
    // approximation.
    const polygonBlob = doc.message.blobs[polygon.fillGeometry![0].commandsBlob] as { bytes: Uint8Array };
    const path = geometryBlobToSVGPath(polygonBlob.bytes);
    expect(path.startsWith("M50 0")).toBe(true);
    expect(path).toContain("L100 38");
    expect(path).toContain("L81 100");
    expect(path).toContain("L19 100");
    expect(path).toContain("L0 38");
    expect(path.endsWith("Z")).toBe(true);
    expect(star.fillGeometry?.length).toBeGreaterThan(0);
  });

  it("never emits NaN or negative geometry from malformed attributes", async () => {
    const doc = await parse(input({
      nodes: {
        "rect-1": node("rect-1", "desktop"),
        "rect-2": node("rect-2", "desktop"),
        "line-1": node("line-1", "desktop"),
        "arrow-1": node("arrow-1", "desktop"),
      },
      bridgeTargets: {
        "desktop:rect-1": target("desktop", "rect-1", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(0, 0, 100, 50),
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "not-a-number",
          "data-design-tool-radius": "-5",
        }),
        "desktop:rect-2": target("desktop", "rect-2", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": JSON.stringify({ x: 0, y: 0, width: -10, height: 20 }),
        }),
        "desktop:line-1": target("desktop", "line-1", {
          ...created,
          "data-design-tool-kind": "line",
          "data-design-tool-bounds": bounds(0, 0, 10, 10),
          "data-design-tool-points": JSON.stringify([{ x: 0, y: 0 }, { x: "bad", y: 10 }]),
        }),
        "desktop:arrow-1": target("desktop", "arrow-1", {
          ...created,
          "data-design-tool-kind": "arrow",
          "data-design-tool-bounds": bounds(0, 0, 10, 10),
          "data-design-tool-points": JSON.stringify([{ x: 5, y: 5 }, { x: 5, y: 5 }]),
        }),
      },
    }));

    const rect = byName(doc, "Layer rect-1")!;
    expect(rect.type).toBe("ROUNDED_RECTANGLE");
    expect(rect.cornerRadius).toBe(0);
    expect(rect.strokeWeight).toBe(2);
    expect(byName(doc, "Layer rect-2")).toBeUndefined();
    expect(byName(doc, "Layer line-1")).toBeUndefined();
    expect(byName(doc, "Layer arrow-1")).toBeUndefined();
    for (const item of doc.nodes) {
      if (item.size) {
        expect(Number.isFinite(item.size.x)).toBe(true);
        expect(Number.isFinite(item.size.y)).toBe(true);
      }
    }
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

  it("resolves the full range of CSS colors without throwing or NaN", async () => {
    const shapes: [string, string][] = [
      ["c-hex3", "#f80"],
      ["c-hex8", "#ff000080"],
      ["c-hsl", "hsl(0, 100%, 50%)"],
      ["c-hsl-slash", "hsl(240 100% 50% / 0.5)"],
      ["c-named", "rebeccapurple"],
      ["c-rgb-pct", "rgb(100% 0% 0% / 50%)"],
      ["c-rgba", "rgba(0, 128, 255, 0.5)"],
      ["c-bad", "var(--brand-primary)"],
      ["c-none", "none"],
    ];
    const doc = await parse(input({
      nodes: Object.fromEntries(shapes.map(([id]) => [id, node(id, "desktop")])),
      bridgeTargets: Object.fromEntries(shapes.map(([id, fill]) => [
        `desktop:${id}`,
        target("desktop", id, {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(0, 0, 10, 10),
          "data-design-tool-fill": fill,
          "data-design-tool-stroke": "#222222",
          "data-design-tool-stroke-width": "2",
        }),
      ])),
    }));
    const paintOf = (id: string) => byName(doc, `Layer ${id}`)!.fillPaints?.[0] as
      | { color?: { r: number; g: number; b: number; a: number } }
      | undefined;

    expect(paintOf("c-hex3")!.color).toMatchObject({ r: 1, a: 1 });
    expect(paintOf("c-hex3")!.color!.g).toBeCloseTo(0x88 / 255, 4);
    expect(paintOf("c-hex8")!.color!.a).toBeCloseTo(0x80 / 255, 4);
    expect(paintOf("c-hsl")!.color).toMatchObject({ r: 1, g: 0, b: 0, a: 1 });
    expect(paintOf("c-hsl-slash")!.color!.b).toBeCloseTo(1, 4);
    expect(paintOf("c-hsl-slash")!.color!.a).toBeCloseTo(0.5, 4);
    expect(paintOf("c-named")!.color!.r).toBeCloseTo(0x66 / 255, 4);
    expect(paintOf("c-named")!.color!.b).toBeCloseTo(0x99 / 255, 4);
    expect(paintOf("c-rgb-pct")!.color).toMatchObject({ r: 1, g: 0, b: 0 });
    expect(paintOf("c-rgb-pct")!.color!.a).toBeCloseTo(0.5, 4);
    expect(paintOf("c-rgba")!.color!.g).toBeCloseTo(128 / 255, 4);
    expect(paintOf("c-rgba")!.color!.a).toBeCloseTo(0.5, 4);
    // Unknown colors fall back to the shape default instead of crashing or NaN.
    expect(paintOf("c-bad")!.color!.r).toBeCloseTo(0xd9 / 255, 4);
    // Explicit "none" means no fill — not a gray fallback.
    expect(byName(doc, "Layer c-none")!.fillPaints ?? []).toEqual([]);

    for (const item of doc.nodes) {
      for (const paint of [...(item.fillPaints ?? []), ...(item.strokePaints ?? [])] as {
        color?: { r: number; g: number; b: number; a: number };
      }[]) {
        if (!paint.color) continue;
        for (const channel of [paint.color.r, paint.color.g, paint.color.b, paint.color.a]) {
          expect(Number.isFinite(channel)).toBe(true);
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("positions moved and rotated elements from live styles, not stale creation bounds", async () => {
    const doc = await parse(input({
      nodes: { "rect-1": node("rect-1", "desktop"), "rect-2": node("rect-2", "desktop") },
      bridgeTargets: {
        // Moved via transform translate (overlay gestures never touch left/top).
        "desktop:rect-1": target("desktop", "rect-1", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(10, 10, 100, 50),
          "data-design-tool-fill": "#d9d9d9",
        }, "", {
          inlineStyle: { left: "10px", top: "10px", width: "100px", height: "50px" },
          computedStyle: { transform: "matrix(1, 0, 0, 1, 60, 30)" },
        }),
        // Rotated 45 degrees about the element center.
        "desktop:rect-2": target("desktop", "rect-2", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(200, 200, 40, 40),
          "data-design-tool-fill": "#d9d9d9",
        }, "", {
          inlineStyle: { left: "200px", top: "200px", width: "40px", height: "40px" },
          computedStyle: { transform: "rotate(45deg)" },
        }),
      },
    }));
    const moved = byName(doc, "Layer rect-1")!;
    expect(moved.transform?.m02).toBeCloseTo(70, 3);
    expect(moved.transform?.m12).toBeCloseTo(40, 3);
    const rotated = byName(doc, "Layer rect-2")!;
    expect(rotated.transform?.m00).toBeCloseTo(Math.SQRT1_2, 4);
    expect(rotated.transform?.m10).toBeCloseTo(Math.SQRT1_2, 4);
    expect(rotated.transform?.m01).toBeCloseTo(-Math.SQRT1_2, 4);
  });

  it("exports path kind as an open stroked VECTOR", async () => {
    const doc = await parse(input({
      nodes: { "path-1": node("path-1", "desktop") },
      bridgeTargets: {
        "desktop:path-1": target("desktop", "path-1", {
          ...created,
          "data-design-tool-kind": "path",
          "data-design-tool-bounds": bounds(20, 20, 200, 100),
          "data-design-tool-points": JSON.stringify([{ x: 20, y: 120 }, { x: 120, y: 20 }, { x: 220, y: 120 }]),
          "data-design-tool-stroke": "#334455",
          "data-design-tool-stroke-width": "4",
        }),
      },
    }));
    const path = byName(doc, "Layer path-1")!;
    expect(path.type).toBe("VECTOR");
    expect(path.fillPaints ?? []).toEqual([]);
    expect(path.strokeWeight).toBe(4);
    expect(path.strokePaints?.length).toBe(1);
    expect(path.strokeGeometry?.length).toBeGreaterThan(0);
    expect(path.vectorData?.vectorNetworkBlob).toBeTypeOf("number");
    // Stroke ribbon is a filled outline — verify it parses to a closed path.
    const blob = doc.message.blobs[path.strokeGeometry![0].commandsBlob] as { bytes: Uint8Array };
    const d = geometryBlobToSVGPath(blob.bytes);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("exports one CANVAS per page and keeps frames on their own page", async () => {
    const pages: PageEntity[] = [
      { id: "page-1", documentId: "doc-1", name: "Wireframes", frameIds: ["a"] },
      { id: "page-2", documentId: "doc-1", name: "Components", frameIds: ["b"] },
    ];
    const doc = await parse(input({
      frames: [
        frame({ id: "a", pageId: "page-1", name: "Frame A", x: 0, y: 0 }),
        frame({ id: "b", pageId: "page-2", name: "Frame B", x: 100, y: 100 }),
      ],
      pages,
    }));
    const canvases = doc.nodes.filter((item) => item.type === "CANVAS" && !item.internalOnly);
    expect(canvases.map((item) => item.name).sort()).toEqual(["Components", "Wireframes"]);
    const wire = canvases.find((item) => item.name === "Wireframes")!;
    const comp = canvases.find((item) => item.name === "Components")!;
    const key = (guid: { sessionID: number; localID: number }) => `${guid.sessionID}:${guid.localID}`;
    const wireChildren = doc.childrenMap.get(key(wire.guid))?.map((item) => item.name) ?? [];
    const compChildren = doc.childrenMap.get(key(comp.guid))?.map((item) => item.name) ?? [];
    expect(wireChildren).toEqual(["Frame A"]);
    expect(compChildren).toEqual(["Frame B"]);
  });

  it("keeps child layers in document insertion order, not id order", async () => {
    const doc = await parse(input({
      nodes: {
        "z-late": node("z-late", "desktop"),
        "a-early": node("a-early", "desktop"),
      },
      bridgeTargets: {
        "desktop:z-late": target("desktop", "z-late", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(0, 0, 10, 10),
        }),
        "desktop:a-early": target("desktop", "a-early", {
          ...created,
          "data-design-tool-kind": "rectangle",
          "data-design-tool-bounds": bounds(20, 20, 10, 10),
        }),
      },
    }));
    const frameNode = byName(doc, "Desktop · 1440 × 900")!;
    const key = `${frameNode.guid.sessionID}:${frameNode.guid.localID}`;
    const children = doc.childrenMap.get(key)?.map((item) => item.name) ?? [];
    expect(children).toEqual(["Layer z-late", "Layer a-early"]);
  });

  it("uses live computed typography for text nodes", async () => {
    const doc = await parse(input({
      nodes: { "text-1": node("text-1", "desktop") },
      bridgeTargets: {
        "desktop:text-1": target("desktop", "text-1", {
          ...created,
          "data-design-tool-kind": "text",
          "data-design-tool-bounds": bounds(0, 0, 240, 40),
          "data-design-tool-fill": "#171717",
        }, "Big title", {
          computedStyle: {
            "font-size": "24px",
            "line-height": "30px",
            "letter-spacing": "2px",
            "text-align": "center",
            "font-weight": "700",
            "font-style": "normal",
            color: "rgb(255, 0, 0)",
            opacity: "0.8",
          },
        }),
      },
    }));
    const text = byName(doc, "Layer text-1")!;
    expect(text.fontSize).toBe(24);
    expect(text.lineHeight).toMatchObject({ value: 30, units: "PIXELS" });
    expect(text.letterSpacing).toMatchObject({ value: 2, units: "PIXELS" });
    expect(text.textAlignHorizontal).toBe("CENTER");
    expect(text.fontName?.style).toBe("Bold");
    expect(text.opacity).toBeCloseTo(0.8, 4);
    const fill = text.fillPaints?.[0] as { color?: { r: number } } | undefined;
    expect(fill?.color?.r).toBeCloseTo(1, 4);
  });
});
