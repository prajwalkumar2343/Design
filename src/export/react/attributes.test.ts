import { describe, expect, it } from "vitest";

import {
  attributeToProp,
  BOOLEAN_ATTRIBUTES,
  EDITOR_ATTRIBUTE_PATTERN,
  HTML_ATTR_RENAMES,
  parseStyleAttribute,
  stylePropertyName,
  SVG_ATTR_RENAMES,
} from "./attributes";
import type { ConversionContext } from "./jsx";

function makeCtx(): ConversionContext {
  return {
    scopeClassName: "dc-test",
    componentName: "Test",
    notes: [],
    extractedRules: [],
    scriptMarkers: new Map(),
    seenCustomElements: new Set(),
  };
}

describe("attribute rename tables", () => {
  it("covers the HTML spellings React reserves", () => {
    expect(HTML_ATTR_RENAMES.class).toBe("className");
    expect(HTML_ATTR_RENAMES.for).toBe("htmlFor");
    expect(HTML_ATTR_RENAMES.tabindex).toBe("tabIndex");
    expect(HTML_ATTR_RENAMES.readonly).toBe("readOnly");
    expect(HTML_ATTR_RENAMES.maxlength).toBe("maxLength");
    expect(HTML_ATTR_RENAMES["http-equiv"]).toBe("httpEquiv");
    expect(HTML_ATTR_RENAMES.srcdoc).toBe("srcDoc");
    expect(HTML_ATTR_RENAMES.colspan).toBe("colSpan");
  });

  it("covers the SVG spellings Figma exports carry", () => {
    expect(SVG_ATTR_RENAMES["stroke-width"]).toBe("strokeWidth");
    expect(SVG_ATTR_RENAMES["stroke-linecap"]).toBe("strokeLinecap");
    expect(SVG_ATTR_RENAMES["fill-rule"]).toBe("fillRule");
    expect(SVG_ATTR_RENAMES["clip-rule"]).toBe("clipRule");
    expect(SVG_ATTR_RENAMES["marker-end"]).toBe("markerEnd");
    expect(SVG_ATTR_RENAMES["xlink:href"]).toBe("href");
    expect(SVG_ATTR_RENAMES["font-family"]).toBe("fontFamily");
    expect(SVG_ATTR_RENAMES["text-anchor"]).toBe("textAnchor");
    expect(SVG_ATTR_RENAMES["viewbox"]).toBeUndefined();
  });
});

describe("EDITOR_ATTRIBUTE_PATTERN", () => {
  it("matches every baked editor family", () => {
    expect(EDITOR_ATTRIBUTE_PATTERN.test("data-design-element-id")).toBe(true);
    expect(EDITOR_ATTRIBUTE_PATTERN.test("data-design-locked")).toBe(true);
    expect(EDITOR_ATTRIBUTE_PATTERN.test("data-design-tool-token-theme")).toBe(true);
    expect(EDITOR_ATTRIBUTE_PATTERN.test("data-figma-type")).toBe(true);
    expect(EDITOR_ATTRIBUTE_PATTERN.test("data-figma-hidden")).toBe(true);
    expect(EDITOR_ATTRIBUTE_PATTERN.test("data-canvas-paste-source")).toBe(true);
  });

  it("leaves ordinary data attributes alone", () => {
    expect(EDITOR_ATTRIBUTE_PATTERN.test("data-state")).toBe(false);
    expect(EDITOR_ATTRIBUTE_PATTERN.test("data-design")).toBe(false);
    expect(EDITOR_ATTRIBUTE_PATTERN.test("aria-label")).toBe(false);
    expect(EDITOR_ATTRIBUTE_PATTERN.test("data-figma")).toBe(false);
  });
});

describe("attributeToProp", () => {
  it("renames reserved HTML attributes", () => {
    const ctx = makeCtx();
    expect(attributeToProp("class", "a b", "html", ctx)).toEqual({
      kind: "attr",
      name: "className",
      value: "a b",
    });
    expect(attributeToProp("for", "email", "html", ctx)).toEqual({
      kind: "attr",
      name: "htmlFor",
      value: "email",
    });
    expect(attributeToProp("tabindex", "0", "html", ctx)).toEqual({
      kind: "attr",
      name: "tabIndex",
      value: "0",
    });
  });

  it("emits bare props for canonical boolean attributes", () => {
    const ctx = makeCtx();
    expect(attributeToProp("disabled", "", "html", ctx)).toEqual({
      kind: "bool",
      name: "disabled",
    });
    expect(attributeToProp("readonly", "readonly", "html", ctx)).toEqual({
      kind: "bool",
      name: "readOnly",
    });
    expect(attributeToProp("multiple", "", "html", ctx)).toEqual({
      kind: "bool",
      name: "multiple",
    });
  });

  it("keeps a real value on enumerated attributes like hidden=until-found", () => {
    const ctx = makeCtx();
    expect(attributeToProp("hidden", "until-found", "html", ctx)).toEqual({
      kind: "attr",
      name: "hidden",
      value: "until-found",
    });
  });

  it("passes aria and data attributes through untouched", () => {
    const ctx = makeCtx();
    expect(attributeToProp("aria-label", "Close", "html", ctx)).toEqual({
      kind: "attr",
      name: "aria-label",
      value: "Close",
    });
    expect(attributeToProp("data-state", "open", "html", ctx)).toEqual({
      kind: "attr",
      name: "data-state",
      value: "open",
    });
  });

  it("drops editor bookkeeping attributes silently", () => {
    const ctx = makeCtx();
    expect(attributeToProp("data-design-element-id", "abc", "html", ctx)).toBeNull();
    expect(attributeToProp("data-figma-type", "FRAME", "html", ctx)).toBeNull();
    expect(ctx.notes).toHaveLength(0);
  });

  it("drops on* handlers with a warning note", () => {
    const ctx = makeCtx();
    expect(attributeToProp("onclick", "go()", "html", ctx)).toBeNull();
    expect(ctx.notes).toEqual([
      {
        code: "event-handler-omitted",
        severity: "warning",
        message: 'Event handler attribute "onclick" was dropped; inline handlers do not survive React conversion.',
        componentName: "Test",
        detail: "onclick",
      },
    ]);
  });

  it("renames SVG attributes inside svg subtrees", () => {
    const ctx = makeCtx();
    expect(attributeToProp("stroke-width", "2", "svg", ctx)).toEqual({
      kind: "attr",
      name: "strokeWidth",
      value: "2",
    });
    expect(attributeToProp("xlink:href", "#a", "svg", ctx)).toEqual({
      kind: "attr",
      name: "href",
      value: "#a",
    });
    expect(attributeToProp("viewBox", "0 0 10 10", "svg", ctx)).toEqual({
      kind: "attr",
      name: "viewBox",
      value: "0 0 10 10",
    });
  });

  it("turns style into a style prop and diverts !important into a rule", () => {
    const ctx = makeCtx();
    const prop = attributeToProp(
      "style",
      "color: var(--ink); margin-top: 4px !important; --pad: 8px",
      "html",
      ctx,
    );
    expect(prop).toEqual({
      kind: "style",
      declarations: [
        { property: "color", value: "var(--ink)" },
        { property: "--pad", value: "8px" },
      ],
    });
    expect(ctx.extractedRules).toEqual([
      {
        className: "dc-i0",
        declarations: [{ property: "margin-top", value: "4px !important" }],
      },
    ]);
    expect(ctx.notes.map((note) => note.code)).toEqual(["important-style-extracted"]);
  });
});

describe("parseStyleAttribute", () => {
  it("camelCases properties and keeps var()/calc() values verbatim", () => {
    const { styleDecls, importantDecls } = parseStyleAttribute(
      "margin-top: 1px; -webkit-line-clamp: 2; background: var(--x, red); width: calc(100% - 4px)",
    );
    expect(styleDecls).toEqual([
      { property: "marginTop", value: "1px" },
      { property: "WebkitLineClamp", value: "2" },
      { property: "background", value: "var(--x, red)" },
      { property: "width", value: "calc(100% - 4px)" },
    ]);
    expect(importantDecls).toEqual([]);
  });

  it("splits important declarations out", () => {
    const { styleDecls, importantDecls } = parseStyleAttribute(
      "color: red !important; top: 0; left: 1px !IMPORTANT",
    );
    expect(styleDecls).toEqual([{ property: "top", value: "0" }]);
    expect(importantDecls).toEqual([
      { property: "color", value: "red" },
      { property: "left", value: "1px" },
    ]);
  });

  it("keeps custom properties verbatim including leading space trim", () => {
    const { styleDecls } = parseStyleAttribute("--accent:  #fff; --pad:0px");
    expect(styleDecls).toEqual([
      { property: "--accent", value: "#fff" },
      { property: "--pad", value: "0px" },
    ]);
  });
});

describe("stylePropertyName", () => {
  it("maps vendor prefixes to React spellings", () => {
    expect(stylePropertyName("-ms-transform")).toBe("msTransform");
    expect(stylePropertyName("-webkit-transform")).toBe("WebkitTransform");
    expect(stylePropertyName("-moz-appearance")).toBe("MozAppearance");
    expect(stylePropertyName("border-radius")).toBe("borderRadius");
    expect(stylePropertyName("--token")).toBe("--token");
  });
});

describe("BOOLEAN_ATTRIBUTES", () => {
  it("uses JSX-spelled names", () => {
    expect(BOOLEAN_ATTRIBUTES.has("disabled")).toBe(true);
    expect(BOOLEAN_ATTRIBUTES.has("readOnly")).toBe(true);
    expect(BOOLEAN_ATTRIBUTES.has("readonly")).toBe(false);
    expect(BOOLEAN_ATTRIBUTES.has("defaultChecked")).toBe(true);
  });
});
