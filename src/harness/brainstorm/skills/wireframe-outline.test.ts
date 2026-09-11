import { describe, expect, it } from "vitest";

import { VALID_WIREFRAME } from "../../main/agent.test";
import { validateWireframeHtml } from "../../../router/wireframe-admission";
import {
  alignReplacementToOriginal,
  buildWireframeOutline,
  getWireframeElementHtml,
  renderWireframeOutline,
  spliceWireframeElement,
} from "./wireframe-outline";

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("buildWireframeOutline", () => {
  it("roots the outline at body and reports stable element indexes", () => {
    const entries = buildWireframeOutline(VALID_WIREFRAME);
    expect(entries[0].tag).toBe("body");
    const main = entries.find((entry) => entry.tag === "main");
    const heading = entries.find((entry) => entry.tag === "h1");
    const link = entries.find((entry) => entry.tag === "a");
    expect(main?.classes).toEqual(["pricing"]);
    expect(heading?.textPreview).toBe("Pick a plan");
    expect(link!.index).toBeGreaterThan(heading!.index);
    expect(entries.every((entry, i, all) => i === 0 || all[i - 1].depth <= entry.depth)).toBe(true);
  });

  it("renders readable lines with indexes", () => {
    const entries = buildWireframeOutline(VALID_WIREFRAME);
    const heading = entries.find((entry) => entry.tag === "h1")!;
    const rendered = renderWireframeOutline(entries);
    expect(rendered).toContain(`[${heading.index}]`);
    expect(rendered).toContain(`<h1> "Pick a plan"`);
  });
});

describe("getWireframeElementHtml", () => {
  it("returns the exact element markup", () => {
    const heading = buildWireframeOutline(VALID_WIREFRAME).find((e) => e.tag === "h1")!;
    expect(getWireframeElementHtml(VALID_WIREFRAME, heading.index)).toContain("<h1>Pick a plan</h1>");
  });

  it("returns null for negative or out-of-range indexes", () => {
    expect(getWireframeElementHtml(VALID_WIREFRAME, -1)).toBeNull();
    expect(getWireframeElementHtml(VALID_WIREFRAME, 9999)).toBeNull();
  });
});

describe("spliceWireframeElement", () => {
  it("replaces exactly one element and keeps the rest of the document", () => {
    const paragraph = buildWireframeOutline(VALID_WIREFRAME).find((e) => e.tag === "p")!;
    const spliced = spliceWireframeElement(VALID_WIREFRAME, paragraph.index, "<p>Brand new copy</p>")!;
    expect(collapse(spliced.html)).toContain("Brand new copy");
    expect(collapse(spliced.html)).toContain("Pick a plan");
    expect(collapse(spliced.html)).toContain("Learn more");
    expect(collapse(spliced.html)).not.toContain("Simple pricing for small teams.");
    expect(() => validateWireframeHtml(spliced.html)).not.toThrow();
  });

  it("normalizes fragments wrapped in a full document down to their body children", () => {
    const paragraph = buildWireframeOutline(VALID_WIREFRAME).find((e) => e.tag === "p")!;
    const wrapped = `<!DOCTYPE html><html><head><title>x</title></head><body><section><p>Nested replacement</p></section></body></html>`;
    const spliced = spliceWireframeElement(VALID_WIREFRAME, paragraph.index, wrapped)!;
    expect(collapse(spliced.html)).toContain("<section><p>Nested replacement</p></section>");
    expect(collapse(spliced.html)).not.toContain("<title>x</title>");
  });

  it("returns null when the index is invalid or the fragment has no elements", () => {
    expect(spliceWireframeElement(VALID_WIREFRAME, 9999, "<p>x</p>")).toBeNull();
    const paragraph = buildWireframeOutline(VALID_WIREFRAME).find((e) => e.tag === "p")!;
    expect(spliceWireframeElement(VALID_WIREFRAME, paragraph.index, "plain text only")).toBeNull();
  });
});

describe("alignReplacementToOriginal", () => {
  function withHeadline(html: string, headline: string): string {
    return html.replace(/<h1>.*?<\/h1>/s, `<h1>${headline}</h1>`);
  }

  it("swaps only the targeted element when the generated doc keeps its slot", () => {
    const heading = buildWireframeOutline(VALID_WIREFRAME).find((e) => e.tag === "h1")!;
    const generated = withHeadline(VALID_WIREFRAME, "Choose a plan");
    const aligned = alignReplacementToOriginal(VALID_WIREFRAME, heading.index, generated)!;
    expect(aligned).not.toBeNull();
    expect(collapse(aligned)).toContain("<h1>Choose a plan</h1>");
    expect(collapse(aligned)).not.toContain("Pick a plan");
    expect(collapse(aligned)).toContain("Simple pricing for small teams.");
  });

  it("falls back to the nearest matching tag when earlier elements were removed", () => {
    const heading = buildWireframeOutline(VALID_WIREFRAME).find((e) => e.tag === "h1")!;
    const shifted = VALID_WIREFRAME.replace(/\s*<p>Simple pricing for small teams\.<\/p>/, "");
    const generated = withHeadline(shifted, "Choose a plan");
    const aligned = alignReplacementToOriginal(VALID_WIREFRAME, heading.index, generated)!;
    expect(collapse(aligned)).toContain("Choose a plan");
    expect(collapse(aligned)).toContain("Simple pricing for small teams.");
  });

  it("returns null when no matching element exists in the generated output", () => {
    const heading = buildWireframeOutline(VALID_WIREFRAME).find((e) => e.tag === "h1")!;
    const noHeading = VALID_WIREFRAME.replace(/<h1>.*?<\/h1>/s, "");
    expect(alignReplacementToOriginal(VALID_WIREFRAME, heading.index, noHeading)).toBeNull();
    expect(alignReplacementToOriginal(VALID_WIREFRAME, 9999, VALID_WIREFRAME)).toBeNull();
  });
});
