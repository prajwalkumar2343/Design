import { describe, expect, it } from "vitest";

import {
  childrenToJsx,
  elementToJsx,
  printComponent,
  printJsx,
  type ConversionContext,
  type JsxElement,
  type JsxNode,
} from "./jsx";
import type { ScriptAsset } from "./document";

function makeCtx(overrides: Partial<ConversionContext> = {}): ConversionContext {
  return {
    scopeClassName: "dc-test",
    componentName: "Test",
    notes: [],
    extractedRules: [],
    scriptMarkers: new Map(),
    seenCustomElements: new Set(),
    ...overrides,
  };
}

function parseElement(html: string): Element {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
  const el = doc.body.firstElementChild;
  if (!el) throw new Error("fixture produced no element");
  return el;
}

function childrenOf(html: string, ctx = makeCtx()): JsxNode[] {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
  const out: JsxNode[] = [];
  childrenToJsx(doc.body, out, ctx);
  return out;
}

describe("elementToJsx", () => {
  it("converts a figma-flavored node with renamed and stripped attributes", () => {
    const ctx = makeCtx();
    const el = parseElement(
      '<div data-design-element-id="a1" data-figma-type="FRAME" class="card" tabindex="0" style="position: absolute; top: 4px"><svg viewBox="0 0 4 4" stroke-width="2"><path d="M0 0"/></svg></div>',
    );
    const node = elementToJsx(el, ctx)!;
    expect(node.tag).toBe("div");
    expect(node.props).toEqual([
      { kind: "attr", name: "className", value: "card" },
      { kind: "attr", name: "tabIndex", value: "0" },
      {
        kind: "style",
        declarations: [
          { property: "position", value: "absolute" },
          { property: "top", value: "4px" },
        ],
      },
    ]);
    const svg = node.children[0] as JsxElement;
    expect(svg.tag).toBe("svg");
    expect(svg.namespace).toBe("svg");
    expect(svg.props).toEqual([
      { kind: "attr", name: "viewBox", value: "0 0 4 4" },
      { kind: "attr", name: "strokeWidth", value: "2" },
    ]);
  });

  it("maps checked and value onto uncontrolled defaults", () => {
    const ctx = makeCtx();
    const input = elementToJsx(
      parseElement('<input type="checkbox" checked value="yes" required>'),
      ctx,
    )!;
    expect(input.props).toEqual([
      { kind: "attr", name: "type", value: "checkbox" },
      { kind: "bool", name: "defaultChecked" },
      { kind: "attr", name: "defaultValue", value: "yes" },
      { kind: "bool", name: "required" },
    ]);
  });

  it("folds textarea children into defaultValue", () => {
    const ctx = makeCtx();
    const textarea = elementToJsx(
      parseElement("<textarea>first line\n  second line</textarea>"),
      ctx,
    )!;
    expect(textarea.children).toEqual([]);
    expect(textarea.props).toEqual([
      { kind: "expr", name: "defaultValue", expression: '"first line\\n  second line"' },
    ]);
  });

  it("folds option[selected] into select defaultValue", () => {
    const ctx = makeCtx();
    const select = elementToJsx(
      parseElement('<select><option value="a">A</option><option value="b" selected>B</option></select>'),
      ctx,
    )!;
    expect(select.props).toEqual([
      { kind: "expr", name: "defaultValue", expression: '"b"' },
    ]);
    const options = select.children as JsxElement[];
    expect(options[1]!.props).toEqual([{ kind: "attr", name: "value", value: "b" }]);
  });

  it("emits a defaultValue array for multiple selects", () => {
    const ctx = makeCtx();
    const select = elementToJsx(
      parseElement('<select multiple><option value="a" selected>A</option><option value="b" selected>B</option></select>'),
      ctx,
    )!;
    expect(select.props).toEqual([
      { kind: "bool", name: "multiple" },
      { kind: "expr", name: "defaultValue", expression: '["a","b"]' },
    ]);
  });

  it("neutralizes forms with a preventDefault onSubmit and a note", () => {
    const ctx = makeCtx();
    const form = elementToJsx(
      parseElement('<form action="/save"><button>Go</button></form>'),
      ctx,
    )!;
    expect(form.props).toContainEqual({
      kind: "expr",
      name: "onSubmit",
      expression: "(event) => event.preventDefault()",
    });
    expect(ctx.notes.map((n) => n.code)).toEqual(["form-neutralized"]);
  });

  it("inlines template content via dangerouslySetInnerHTML", () => {
    const ctx = makeCtx();
    const tpl = elementToJsx(
      parseElement('<template><p class="t">hi</p></template>'),
      ctx,
    )!;
    expect(tpl.props).toEqual([
      {
        kind: "expr",
        name: "dangerouslySetInnerHTML",
        expression: '{{ __html: "<p class=\\"t\\">hi</p>" }}',
      },
    ]);
    expect(ctx.notes.map((n) => n.code)).toEqual(["template-inlined"]);
  });

  it("notes custom elements once per tag", () => {
    const ctx = makeCtx();
    elementToJsx(parseElement("<my-card><my-card></my-card></my-card>"), ctx);
    expect(ctx.notes.filter((n) => n.code === "custom-element")).toHaveLength(1);
  });

  it("drops <base> with a note", () => {
    const ctx = makeCtx();
    expect(elementToJsx(parseElement('<base href="/x">'), ctx)).toBeNull();
    expect(ctx.notes.map((n) => n.code)).toEqual(["base-dropped"]);
  });

  it("extracts inline !important into dc-i rules and merges the class", () => {
    const ctx = makeCtx();
    const node = elementToJsx(
      parseElement('<div class="card" style="top: 1px !important; color: red"></div>'),
      ctx,
    )!;
    expect(node.props[0]).toEqual({
      kind: "attr",
      name: "className",
      value: "card dc-i0",
    });
    expect(ctx.extractedRules).toEqual([
      {
        className: "dc-i0",
        declarations: [{ property: "top", value: "1px !important" }],
      },
    ]);
  });

  it("adds the generated class when no class existed", () => {
    const ctx = makeCtx();
    const node = elementToJsx(
      parseElement('<div style="color: red !important"></div>'),
      ctx,
    )!;
    expect(node.props[0]).toEqual({ kind: "attr", name: "className", value: "dc-i0" });
  });

  it("flags javascript: urls but keeps them verbatim", () => {
    const ctx = makeCtx();
    const node = elementToJsx(parseElement('<a href="javascript:alert(1)">x</a>'), ctx)!;
    expect(node.props[0]).toEqual({ kind: "attr", name: "href", value: "javascript:alert(1)" });
    expect(ctx.notes.map((n) => n.code)).toEqual(["javascript-url"]);
  });

  it("flags remote and relative asset urls", () => {
    const ctx = makeCtx();
    const doc = new DOMParser().parseFromString(
      '<img src="https://cdn.example.com/a.png"><img src="images/b.png">',
      "text/html",
    );
    const out: JsxNode[] = [];
    childrenToJsx(doc.body, out, ctx);
    expect(ctx.notes.map((n) => n.code)).toEqual(["remote-asset", "relative-url-unresolved"]);
  });

  it("drops a body-position stylesheet link with a note", () => {
    const ctx = makeCtx();
    const doc = new DOMParser().parseFromString(
      '<body><link rel="stylesheet" href="https://cdn.example.com/x.css"><link rel="icon" href="f.png"></body>',
      "text/html",
    );
    const out: JsxNode[] = [];
    childrenToJsx(doc.body, out, ctx);
    expect(out.map((n) => (n.kind === "element" ? n.tag : n.kind))).toEqual(["link"]);
    expect(ctx.notes.map((n) => n.code)).toEqual([
      "stylesheet-dropped",
      "relative-url-unresolved",
    ]);
  });

  it("converts a marked script position into a ScriptNode element", () => {
    const asset: ScriptAsset = {
      markerId: "s0",
      src: "a.js",
      inlineCode: undefined,
      attributes: { src: "a.js", defer: "" },
      inHead: false,
    };
    const ctx = makeCtx();
    const doc = new DOMParser().parseFromString(
      '<p>before</p><span id="m"></span><p>after</p>',
      "text/html",
    );
    ctx.scriptMarkers.set(doc.getElementById("m")!, asset);
    const out: JsxNode[] = [];
    childrenToJsx(doc.body, out, ctx);
    const marker = out[1] as JsxElement;
    expect(marker.tag).toBe("ScriptNode");
    expect(marker.props).toEqual([
      { kind: "expr", name: "attributes", expression: '{"src":"a.js","defer":""}' },
    ]);
  });

  it("preserves noscript with a note", () => {
    const ctx = makeCtx();
    const node = elementToJsx(parseElement("<noscript><b>need js</b></noscript>"), ctx)!;
    expect(node.tag).toBe("noscript");
    expect((node.children[0] as JsxElement).tag).toBe("b");
    expect(ctx.notes.map((n) => n.code)).toEqual(["noscript-preserved"]);
  });

  it("drops conditional comments and keeps ordinary ones", () => {
    const ctx = makeCtx();
    const out = childrenOf("<p>a</p><!--[if IE]>x<![endif]--><!-- keep me -->", ctx);
    expect(out.map((n) => n.kind)).toEqual(["element", "comment"]);
    expect((out[1] as { text: string }).text).toBe(" keep me ");
    expect(ctx.notes.map((n) => n.code)).toEqual(["conditional-comment-dropped"]);
  });
});

describe("text emission", () => {
  it("emits {\" \"} for inline whitespace between elements", () => {
    const out = childrenOf("<b>a</b> <i>b</i>");
    expect(out[1]).toEqual({ kind: "text", text: " ", emit: "space" });
  });

  it("drops newline-only formatting whitespace", () => {
    const out = childrenOf("<b>a</b>\n  <i>b</i>");
    expect(out).toHaveLength(2);
  });

  it("emits a string expression for boundary whitespace", () => {
    const out = childrenOf("<p>a </p> trailing");
    expect(out[1]).toEqual({ kind: "text", text: " trailing", emit: "literal" });
  });

  it("emits a string expression for brace characters", () => {
    const out = childrenOf("<p>{code}</p>");
    const p = out[0] as JsxElement;
    expect(p.children[0]).toEqual({ kind: "text", text: "{code}", emit: "literal" });
  });

  it("keeps <pre> whitespace exact", () => {
    const ctx = makeCtx();
    const pre = elementToJsx(parseElement("<pre>  a\n    b\n</pre>"), ctx)!;
    expect(pre.children[0]).toEqual({ kind: "text", text: "  a\n    b\n", emit: "literal" });
  });
});

describe("printJsx", () => {
  it("escapes attribute values and text", () => {
    const ctx = makeCtx();
    const node = elementToJsx(
      parseElement(
        '<a href="?a=1&amp;b=2" title="say &quot;hi&quot; &lt;now&gt;">x &amp; y</a>',
      ),
      ctx,
    )!;
    expect(printJsx(node)).toBe(
      '<a href="?a=1&amp;b=2" title="say &quot;hi&quot; &lt;now&gt;">x &amp; y</a>',
    );
  });

  it("prints style objects with camel and custom properties", () => {
    const node: JsxElement = {
      kind: "element",
      tag: "div",
      namespace: "html",
      props: [
        {
          kind: "style",
          declarations: [
            { property: "marginTop", value: "1px" },
            { property: "--accent", value: "var(--x)" },
          ],
        },
      ],
      children: [],
      voidElement: false,
    };
    expect(printJsx(node)).toBe('<div style={{ marginTop: "1px", "--accent": "var(--x)" }} />');
  });

  it("prints bool bare and expr verbatim", () => {
    const node: JsxElement = {
      kind: "element",
      tag: "input",
      namespace: "html",
      props: [
        { kind: "bool", name: "disabled" },
        { kind: "expr", name: "onFocus", expression: "f()" },
      ],
      children: [],
      voidElement: true,
    };
    expect(printJsx(node)).toBe("<input disabled onFocus={f()} />");
  });

  it("sanitizes comment bodies so */ cannot break the JSX comment", () => {
    const node: JsxNode = { kind: "comment", text: " a */ b " };
    expect(
      printJsx({
        kind: "element",
        tag: "div",
        namespace: "html",
        props: [],
        children: [node],
        voidElement: false,
      }),
    ).toBe("<div>{/* a *\\/ b */}</div>");
  });

  it("self-closes childless elements and void elements", () => {
    const ctx = makeCtx();
    expect(printJsx(elementToJsx(parseElement("<br>"), ctx)!)).toBe("<br />");
    expect(printJsx(elementToJsx(parseElement('<div class="x"></div>'), ctx)!)).toBe(
      '<div className="x" />',
    );
  });

  it("emits JSON string expressions for whitespace-sensitive text", () => {
    const ctx = makeCtx();
    const p = elementToJsx(parseElement("<p>  padded  </p>"), ctx)!;
    expect(printJsx(p)).toBe('<p>{"  padded  "}</p>');
  });

  it("wraps long prop lists one per line", () => {
    const node: JsxElement = {
      kind: "element",
      tag: "div",
      namespace: "html",
      props: [
        { kind: "attr", name: "className", value: "a" },
        { kind: "attr", name: "id", value: "the-element" },
        { kind: "attr", name: "data-state", value: "open" },
        { kind: "attr", name: "aria-label", value: "a fairly long label to push the line wide" },
      ],
      children: [],
      voidElement: false,
    };
    expect(printJsx(node)).toBe(
      '<div\n  className="a"\n  id="the-element"\n  data-state="open"\n  aria-label="a fairly long label to push the line wide"\n/>',
    );
  });
});

describe("printComponent", () => {
  it("emits imports and a fragment with head items", () => {
    const jsx: JsxElement = {
      kind: "element",
      tag: "div",
      namespace: "html",
      props: [{ kind: "attr", name: "className", value: "dc-x" }],
      children: [{ kind: "text", text: "hi", emit: "jsx" }],
      voidElement: false,
    };
    const out = printComponent({
      componentName: "Card",
      jsx,
      head: [
        { kind: "title", text: "Hello & bye" },
        { kind: "meta", attributes: { name: "description", content: "d" } },
        { kind: "link", attributes: { rel: "icon", href: "https://x/f.png" } },
      ],
      headScripts: [
        {
          markerId: "s0",
          src: "a.js",
          attributes: { src: "a.js" },
          inHead: true,
        },
      ],
      cssImport: "./Card.css",
      importsFontsCss: true,
      usesScriptNode: true,
    });
    expect(out).toBe(`import { ScriptNode } from "./ScriptNode";
import "./Card.css";
import "./fonts.css";

export default function Card() {
  return (
    <>
      <title>{"Hello & bye"}</title>
      <meta name="description" content="d" />
      <link rel="icon" href="https://x/f.png" />
      <ScriptNode attributes={{"src":"a.js"}} />
      <div className="dc-x">hi</div>
    </>
  );
}
`);
  });

  it("emits a bare root when there is no head or scripts", () => {
    const jsx: JsxElement = {
      kind: "element",
      tag: "div",
      namespace: "html",
      props: [{ kind: "attr", name: "className", value: "dc-x" }],
      children: [],
      voidElement: false,
    };
    const out = printComponent({
      componentName: "Card",
      jsx,
      head: [],
      headScripts: [],
      importsFontsCss: false,
      usesScriptNode: false,
    });
    expect(out).toBe(`export default function Card() {
  return (
    <div className="dc-x" />
  );
}
`);
  });
});
