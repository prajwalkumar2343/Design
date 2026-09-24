import { describe, expect, it } from "vitest";
import {
  bridgeNodeIdForElement,
  buildFreeformDocument,
  buildFreeformImageMarkup,
  buildFreeformShapeMarkup,
  buildFreeformTextMarkup,
} from "./freeform";

const bounds = { x: 8, y: 8, width: 200, height: 100 };

describe("buildFreeformShapeMarkup", () => {
  it("emits the same svg contract as the bridge runtime for a rectangle", () => {
    const markup = buildFreeformShapeMarkup({
      elementId: "shape-abc",
      kind: "rectangle",
      bounds,
      points: [{ x: 8, y: 8 }, { x: 208, y: 108 }],
      fill: "#d9d9d9",
      stroke: "#222222",
      strokeWidth: 0,
      radius: 12,
    });

    const svg = new DOMParser().parseFromString(markup, "text/html").querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 200 100");
    expect(svg.getAttribute("aria-label")).toBe("rectangle");
    expect(svg.getAttribute("data-design-element-id")).toBe("shape-abc");
    expect(svg.getAttribute("data-design-tool-created")).toBe("true");
    expect(svg.getAttribute("data-design-tool-kind")).toBe("rectangle");
    expect(JSON.parse(svg.getAttribute("data-design-tool-bounds")!)).toEqual(bounds);
    expect(JSON.parse(svg.getAttribute("data-design-tool-points")!)).toEqual(
      [{ x: 8, y: 8 }, { x: 208, y: 108 }],
    );
    expect(svg.getAttribute("data-design-tool-radius")).toBe("12");
    expect(svg.style.position).toBe("fixed");
    expect(svg.style.left).toBe("8px");
    expect(svg.style.width).toBe("200px");
    expect(svg.style.overflow).toBe("visible");

    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("rx")).toBe("12");
    expect(rect.getAttribute("fill")).toBe("#d9d9d9");
  });

  it("emits a line with the arrowhead marker for arrows", () => {
    const markup = buildFreeformShapeMarkup({
      elementId: "shape-arrow",
      kind: "arrow",
      bounds,
      points: [{ x: 8, y: 108 }, { x: 208, y: 8 }],
      stroke: "#222222",
      strokeWidth: 2,
    });

    const svg = new DOMParser().parseFromString(markup, "text/html").querySelector("svg")!;
    const line = svg.querySelector("line")!;
    // Points are normalized into viewBox space (bounds origin is 8,8).
    expect(line.getAttribute("x1")).toBe("0");
    expect(line.getAttribute("y1")).toBe("100");
    expect(line.getAttribute("x2")).toBe("200");
    expect(line.getAttribute("y2")).toBe("0");
    expect(line.getAttribute("marker-end")).toBe("url(#design-tool-arrowhead)");
    expect(svg.querySelector("marker#design-tool-arrowhead")).toBeTruthy();
  });
});

describe("buildFreeformTextMarkup", () => {
  it("emits an editable text div and escapes its content", () => {
    const markup = buildFreeformTextMarkup({
      elementId: "text-1",
      bounds,
      text: `Hello <b>"world"</b> & friends`,
    });
    const div = new DOMParser().parseFromString(markup, "text/html").querySelector("div")!;

    expect(div.getAttribute("contenteditable")).toBe("true");
    expect(div.getAttribute("data-design-tool-kind")).toBe("text");
    expect(div.getAttribute("data-design-tool-editable")).toBe("true");
    expect(div.textContent).toBe('Hello <b>"world"</b> & friends');
    expect(div.style.position).toBe("fixed");
    expect(div.style.height).toBe("auto");
  });
});

describe("buildFreeformImageMarkup", () => {
  it("emits a positioned img and escapes the alt text", () => {
    const markup = buildFreeformImageMarkup({
      elementId: "img-1",
      bounds,
      src: "data:image/png;base64,AAAA",
      alt: 'a "quoted" <name>',
    });
    const img = new DOMParser().parseFromString(markup, "text/html").querySelector("img")!;

    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img.getAttribute("alt")).toBe('a "quoted" <name>');
    expect(img.getAttribute("data-design-tool-kind")).toBe("image");
    expect(img.getAttribute("data-design-tool-editable")).toBe("false");
    expect(img.style.objectFit).toBe("cover");
    expect(img.style.position).toBe("fixed");
  });
});

describe("buildFreeformDocument", () => {
  it("wraps markup in a complete document with an escaped title", () => {
    const doc = buildFreeformDocument("<svg></svg>", 'Rect <one> "two"');
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain("<body><svg></svg></body>");
    expect(doc).toContain('<title>Rect &lt;one&gt; "two"</title>');
    // The bridge runtime injects after <head> — a real head must exist.
    expect(doc).toMatch(/<head>/);
  });
});

describe("bridgeNodeIdForElement", () => {
  it("matches the bridge runtime's data: id derivation", () => {
    expect(bridgeNodeIdForElement("shape-abc")).toBe("data:shape-abc");
    expect(bridgeNodeIdForElement("a b/c")).toBe(`data:${encodeURIComponent("a b/c")}`);
  });
});
