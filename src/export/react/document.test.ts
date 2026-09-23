import { describe, expect, it } from "vitest";

import { parseExportDocument } from "./document";
import type { JsxElement, JsxText } from "./jsx";

const OPTS = { componentName: "Doc", scopeClassName: "dc-doc", mode: "design" as const };

function parse(
  srcDoc: string,
  extra: Partial<Parameters<typeof parseExportDocument>[1]> = {},
) {
  return parseExportDocument(srcDoc, { ...OPTS, ...extra });
}

describe("parseExportDocument partition", () => {
  it("lifts styles in document order and records media", () => {
    const doc = parse(`<!doctype html><html><head>
      <style>.a { color: red }</style>
      <style media="print">.b { color: blue }</style>
      </head><body><style>.c { color: green }</style><p>hi</p></body></html>`);
    expect(doc.stylesheets).toEqual([
      { cssText: ".a { color: red }", order: 0, media: undefined, origin: "document" },
      { cssText: ".b { color: blue }", order: 1, media: "print", origin: "document" },
      { cssText: ".c { color: green }", order: 2, media: undefined, origin: "document" },
    ]);
    // Style elements are gone from the emitted tree.
    const walk = (n: JsxElement): boolean =>
      n.tag === "style" || n.children.some((c) => c.kind === "element" && walk(c));
    expect(walk(doc.root)).toBe(false);
  });

  it("partitions head items and document metadata", () => {
    const doc = parse(`<!doctype html><html><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width">
      <meta name="description" content="hello">
      <meta http-equiv="refresh" content="5">
      <link rel="stylesheet" href="https://cdn.example.com/x.css">
      <link rel="icon" href="favicon.png">
      <title>Hello</title>
      <base href="/app/">
      </head><body></body></html>`);
    expect(doc.documentMeta).toEqual({ charset: "utf-8", viewport: "width=device-width", lang: undefined });
    expect(doc.head).toEqual([
      { kind: "meta", attributes: { name: "description", content: "hello" } },
      {
        kind: "link",
        attributes: { rel: "stylesheet", href: "https://cdn.example.com/x.css" },
      },
      { kind: "link", attributes: { rel: "icon", href: "favicon.png" } },
      { kind: "title", text: "Hello" },
    ]);
    expect(doc.notes.map((n) => n.code)).toEqual([
      "meta-refresh-dropped",
      "remote-stylesheet",
      "base-dropped",
    ]);
  });

  it("lifts scripts: head scripts become assets, body scripts become markers", () => {
    const doc = parse(`<!doctype html><html><head>
      <script src="https://x.example/head.js" defer></script>
      </head><body>
      <p>before</p>
      <script>window.run = true;</script>
      <script src="./app.js"></script>
      <p>after</p>
      </body></html>`);
    expect(doc.scripts).toHaveLength(3);
    expect(doc.scripts[0]).toMatchObject({ markerId: "s0", src: "https://x.example/head.js", inHead: true });
    expect(doc.scripts[1]).toMatchObject({ markerId: "s1", inlineCode: "window.run = true;", inHead: false });
    expect(doc.scripts[2]).toMatchObject({ markerId: "s2", src: "./app.js", inHead: false });
    const tags = (doc.root.children as JsxElement[]).map((n) => n.tag);
    expect(tags).toEqual(["p", "ScriptNode", "ScriptNode", "p"]);
    expect(doc.notes.filter((n) => n.code === "script-preserved")).toHaveLength(3);
  });

  it("merges html and body attributes onto the wrapper and records them", () => {
    const doc = parse(`<!doctype html><html lang="en" dir="ltr" class="theme-dark"><body class="page scroll" data-mode="x"><p>hi</p></body></html>`);
    expect(doc.htmlAttrs).toEqual([
      { name: "lang", value: "en" },
      { name: "dir", value: "ltr" },
      { name: "class", value: "theme-dark" },
    ]);
    expect(doc.bodyAttrs).toEqual([
      { name: "class", value: "page scroll" },
      { name: "data-mode", value: "x" },
    ]);
    expect(doc.root.tag).toBe("div");
    expect(doc.root.props).toEqual([
      { kind: "attr", name: "className", value: "dc-doc theme-dark page scroll" },
      { kind: "attr", name: "lang", value: "en" },
      { kind: "attr", name: "dir", value: "ltr" },
      { kind: "attr", name: "data-mode", value: "x" },
    ]);
  });

  it("merges html and body style attributes into one style object", () => {
    const doc = parse(
      `<html style="color-scheme: dark; --x: 1"><body style="margin: 0; --x: 2"><p>hi</p></body></html>`,
    );
    const style = doc.root.props.find((p) => p.kind === "style");
    expect(style).toEqual({
      kind: "style",
      declarations: [
        { property: "colorScheme", value: "dark" },
        { property: "--x", value: "2" },
        { property: "margin", value: "0" },
      ],
    });
  });

  it("strips editor attributes once and notes the count", () => {
    const doc = parse(
      `<html data-design-doc="1"><body><div data-design-element-id="n1" data-figma-type="FRAME" data-state="keep"><p data-canvas-paste-source="x">hi</p></div></body></html>`,
    );
    const div = doc.root.children[0] as JsxElement;
    expect(div.props).toEqual([{ kind: "attr", name: "data-state", value: "keep" }]);
    expect(doc.notes.filter((n) => n.code === "editor-attrs-stripped")).toHaveLength(1);
    expect(doc.notes[0]).toMatchObject({ detail: "4" });
    expect(doc.htmlAttrs).toEqual([]);
  });

  it("appends the token theme as the last design-mode asset", () => {
    const doc = parse(
      `<html><head><style>.a { color: red }</style></head><body></body></html>`,
      { themeCssText: ":root { --t: 1 }" },
    );
    expect(doc.stylesheets.at(-1)).toEqual({
      cssText: ":root { --t: 1 }",
      order: 1,
      media: undefined,
      origin: "token-theme",
    });
  });

  it("appends the wireframe theme for wireframe docs", () => {
    const doc = parse(`<html><body><p>x</p></body></html>`, { mode: "wireframe" });
    expect(doc.stylesheets.at(-1)?.origin).toBe("wireframe-theme");
    expect(doc.stylesheets.at(-1)?.cssText).toContain("outline: 1px dashed");
  });

  it("removes canvas-injected style and script blocks as noise", () => {
    const doc = parse(`<html><head>
      <style data-design-tool-token-theme="true">:root { --x: 1 }</style>
      <script data-design-tool-iframe-bridge="true">noop()</script>
      <style>.real { color: red }</style>
      </head><body><p>hi</p></body></html>`);
    expect(doc.stylesheets).toHaveLength(1);
    expect(doc.scripts).toHaveLength(0);
    expect(doc.notes.filter((n) => n.code === "script-preserved")).toHaveLength(0);
  });

  it("keeps head noscript as a converted element item", () => {
    const doc = parse(`<html><head><noscript><b>need js</b></noscript></head><body></body></html>`);
    expect(doc.head[0]).toMatchObject({ kind: "element", node: { tag: "noscript" } });
    expect(doc.notes.map((n) => n.code)).toEqual(["noscript-preserved"]);
  });

  it("emits body text and comments into the wrapper children", () => {
    const doc = parse(`<html><body>hello <b>bold</b><!-- note --></body></html>`);
    const kinds = doc.root.children.map((n) => n.kind);
    expect(kinds).toEqual(["text", "element", "comment"]);
    expect((doc.root.children[0] as JsxText).emit).toBe("literal");
    expect((doc.root.children[0] as JsxText).text).toBe("hello ");
  });
});
