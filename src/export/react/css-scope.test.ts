import { describe, expect, it } from "vitest";

import { scopeStylesheet } from "./css-scope";
import type { StyleAsset } from "./document";

function asset(cssText: string, extra: Partial<StyleAsset> = {}): StyleAsset {
  return { cssText, order: 0, origin: "document", ...extra };
}

function scope(cssText: string, scopeClassName = "dc-page") {
  return scopeStylesheet({
    assets: [asset(cssText)],
    scopeClassName,
    extractedRules: [],
    componentName: "Page",
  });
}

describe("scopeStylesheet selectors", () => {
  it("maps html, body and :root onto the scope class", () => {
    const { cssText } = scope("html { margin: 0 } body { padding: 0 } :root { --a: 1 }");
    expect(cssText).toBe(
      ".dc-page{margin:0}\n.dc-page{padding:0}\n.dc-page{--a: 1 }\n",
    );
  });

  it("keeps compound conditions on the document root", () => {
    const { cssText } = scope("body.dark .x { color: red }");
    expect(cssText).toBe(".dc-page.dark .x{color:red}\n");
  });

  it("collapses html body chains onto the scope class", () => {
    const { cssText } = scope("html body .x { color: red }");
    expect(cssText).toBe(".dc-page .x{color:red}\n");
    expect(scope("html body { margin: 0 }").cssText).toBe(".dc-page{margin:0}\n");
    expect(scope("html > body > .x { top: 0 }").cssText).toBe(".dc-page>.x{top:0}\n");
    expect(scope("html[lang] body.dark .x { top: 0 }").cssText).toBe(
      ".dc-page[lang].dark .x{top:0}\n",
    );
  });

  it("expands bare universal selectors to cover the scope root", () => {
    const { cssText } = scope("*, *::before, *::after { box-sizing: border-box }");
    expect(cssText).toBe(
      ".dc-page,.dc-page *,.dc-page::before,.dc-page *::before,.dc-page::after,.dc-page *::after{box-sizing:border-box}\n",
    );
  });

  it("covers a bare pseudo-element selector", () => {
    const { cssText } = scope("::selection { background: yellow }");
    expect(cssText).toBe(".dc-page::selection,.dc-page ::selection{background:yellow}\n");
  });

  it("prefixes ordinary selectors and preserves pseudo-classes", () => {
    const { cssText } = scope("a:hover, .b > .c { color: blue }");
    expect(cssText).toBe(".dc-page a:hover,.dc-page .b>.c{color:blue}\n");
  });

  it("dedupes selectors that collapse to the same text", () => {
    const { cssText } = scope("html, body { margin: 0 }");
    expect(cssText).toBe(".dc-page{margin:0}\n");
  });

  it("flags selectors whose root mention sits inside pseudo arguments", () => {
    const { cssText, notes } = scope(".x:not(body) { color: red }");
    expect(cssText).toBe(".dc-page .x:not(body){color:red}\n");
    expect(notes).toEqual([
      expect.objectContaining({ code: "selector-scope-fallback", severity: "warning" }),
    ]);
  });

  it("flags root mentions in later compounds", () => {
    const { cssText, notes } = scope(".a body { color: red }");
    expect(cssText).toBe(".dc-page .a body{color:red}\n");
    expect(notes[0]?.code).toBe("selector-scope-fallback");
  });
});

describe("scopeStylesheet at-rules", () => {
  it("recurses into @media without touching the query", () => {
    const { cssText } = scope("@media (max-width: 700px) { body { color: red } .x { top: 0 } }");
    expect(cssText).toBe(
      "@media (max-width:700px){.dc-page{color:red}.dc-page .x{top:0}}\n",
    );
  });

  it("recurses into @supports and @layer", () => {
    const { cssText } = scope(
      "@supports (display: grid) { .x { display: grid } } @layer base { html { margin: 0 } }",
    );
    expect(cssText).toBe(
      "@supports (display:grid){.dc-page .x{display:grid}}\n@layer base{.dc-page{margin:0}}\n",
    );
  });

  it("drops @import rules; the external sheet would load global unscoped CSS", () => {
    const { cssText, notes } = scope(
      '.x { color: red } @import "https://example.com/a.css"; .y { top: 0 }',
    );
    expect(cssText).toBe(".dc-page .x{color:red}\n.dc-page .y{top:0}\n");
    expect(notes).toEqual([
      expect.objectContaining({
        code: "stylesheet-dropped",
        severity: "warning",
        detail: '"https://example.com/a.css"',
      }),
    ]);
  });

  it("drops @import nested inside a conditional at-rule", () => {
    const { cssText, notes } = scope(
      '@media screen { @import "a.css"; .x { color: red } }',
    );
    expect(cssText).toBe("@media screen{.dc-page .x{color:red}}\n");
    expect(notes).toEqual([expect.objectContaining({ code: "stylesheet-dropped" })]);
  });

  it("passes @font-face and @property through unscoped", () => {
    const { cssText } = scope(
      '@font-face { font-family: "X"; src: url(x.woff2) } @property --p { syntax: "<length>"; initial-value: 0px }',
    );
    expect(cssText).toBe(
      '@font-face{font-family:"X";src:url(x.woff2)}\n@property --p{syntax:"<length>";initial-value:0px}\n',
    );
  });
});

describe("scopeStylesheet keyframes", () => {
  it("renames keyframes per page and rewrites animation declarations", () => {
    const { cssText, notes } = scope(
      "@keyframes spin { to { transform: rotate(1turn) } } .x { animation: spin 1s linear; animation-name: spin } .y { animation-name: other }",
    );
    expect(cssText).toContain("@keyframes dc-page-spin{to{transform:rotate(1turn)}}");
    expect(cssText).toContain(".dc-page .x{animation:dc-page-spin 1s linear;animation-name:dc-page-spin}");
    expect(cssText).toContain(".dc-page .y{animation-name:other}");
    expect(notes).toEqual([
      expect.objectContaining({ code: "keyframes-renamed", detail: "spin" }),
    ]);
  });

  it("renames keyframes referenced across separate assets", () => {
    const { cssText } = scopeStylesheet({
      assets: [
        asset(".x { animation: pulse 2s }"),
        asset("@keyframes pulse { from { opacity: 0 } }", { order: 1 }),
      ],
      scopeClassName: "dc-p",
      extractedRules: [],
      componentName: "P",
    });
    expect(cssText).toContain(".dc-p .x{animation:dc-p-pulse 2s}");
    expect(cssText).toContain("@keyframes dc-p-pulse{from{opacity:0}}");
  });
});

describe("scopeStylesheet assets and extraction", () => {
  it("wraps a style media attribute in an @media block with a note", () => {
    const { cssText, notes } = scopeStylesheet({
      assets: [asset(".x { color: red }", { media: "print" })],
      scopeClassName: "dc-p",
      extractedRules: [],
      componentName: "P",
    });
    expect(cssText).toBe("@media print{.dc-p .x{color:red}}\n");
    expect(notes).toEqual([
      expect.objectContaining({ code: "style-media-wrapped", severity: "info" }),
    ]);
  });

  it("appends extracted !important rules scoped under the page class", () => {
    const { cssText } = scopeStylesheet({
      assets: [asset(".x { color: red }")],
      scopeClassName: "dc-p",
      extractedRules: [
        {
          className: "dc-i0",
          declarations: [
            { property: "margin-top", value: "4px !important" },
            { property: "color", value: "red !important" },
          ],
        },
      ],
      componentName: "P",
    });
    expect(cssText).toBe(
      ".dc-p .x{color:red}\n\n/* !important declarations extracted from inline styles */\n.dc-p.dc-i0,.dc-p .dc-i0 {margin-top: 4px !important;color: red !important;}\n",
    );
  });

  it("labels the token theme asset and orders assets by source order", () => {
    const { cssText } = scopeStylesheet({
      assets: [
        asset(".a { color: red }"),
        asset(":root { --t: 1 }", { order: 1, origin: "token-theme" }),
      ],
      scopeClassName: "dc-p",
      extractedRules: [],
      componentName: "P",
    });
    expect(cssText).toBe(
      ".dc-p .a{color:red}\n\n/* canvas design tokens for the active theme */\n.dc-p{--t: 1 }\n",
    );
  });

  it("never touches declaration bodies", () => {
    const { cssText } = scope(
      ".x { background: url(\"a b.png\") no-repeat; content: \"a>b\" !important }",
    );
    expect(cssText).toBe(
      '.dc-page .x{background:url(a\\ b.png)no-repeat;content:"a>b"!important}\n',
    );
  });
});
