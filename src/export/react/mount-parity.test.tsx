/**
 * Mount parity: emitted components rendered through React must produce a DOM
 * subtree deep-equal to the source document's <body> children, modulo the
 * documented delta set — the dc-* scope class on the wrapper, stripped editor
 * attributes, ScriptNode markers, dropped `on*` handlers, and HTML comments
 * (which JSX does not emit as DOM nodes).
 *
 * The emitted project is written to tmp/react-export-fixture/ and loaded
 * through a real vite dev server (ssrLoadModule), so the .tsx is exercised
 * through vite's transform rather than assumed valid. A tiny harness module
 * keeps react/react-dom resolved inside the same ssr graph, avoiding
 * duplicate-module hook hazards.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";

import { createEditorStateFromFrameSeeds } from "../../editor/model";
import { demoDocument } from "../../demo/documents";

// Same reason as react-export.test.ts — the catalog's woff2 ?inline imports
// resolve outside the worktree root and vite's fs.allow denies them.
vi.mock("../../fonts/catalog", () => ({
  FONT_CATALOG: [
    {
      id: "inter",
      name: "Inter",
      stack: "Inter, ui-sans-serif, system-ui, sans-serif",
      category: "Sans",
      license: "OFL-1.1",
      faces: [{ src: "data:font/woff2;base64,AAAA", weight: "100 900", style: "normal" }],
    },
  ],
}));

import { buildReactExportProject, type ReactExportProject } from "./react-export";

const WORKTREE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_DIR = join(WORKTREE, "tmp", "react-export-fixture");

const FIGMA_DOC = `<!doctype html>
<html lang="en"><head><style>html, body { margin: 0 } .card { color: #111 }</style></head>
<body>
  <div data-design-element-id="f:1" data-figma-type="FRAME" class="card"
       style="position: absolute; left: 24px; top: 40px; width: 320px; background: var(--fill, #eee)">
    <svg viewBox="0 0 10 10" stroke-width="2" fill-rule="evenodd" aria-hidden="true">
      <path d="M0 0L10 10" marker-end="url(#arrow)" />
    </svg>
    <input type="text" value="prefilled" required aria-label="Field">
    <p>hello&nbsp;world <b>bold</b></p>
  </div>
</body></html>`;

const SCRIPT_DOC = `<!doctype html>
<html><head><title>Scripted</title><script src="https://cdn.example.com/head.js" defer></script></head>
<body>
  <p>first</p>
  <script>window.__inline = 1;</script>
  <p>second</p>
</body></html>`;

const HARNESS_TSX = `import { createElement, StrictMode, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

export function mount(container: Element, Component: ComponentType): Root {
  const root = createRoot(container);
  flushSync(() => {
    root.render(createElement(Component));
  });
  return root;
}

export function mountStrict(container: Element, Component: ComponentType): Root {
  const root = createRoot(container);
  flushSync(() => {
    root.render(createElement(StrictMode, null, createElement(Component)));
  });
  return root;
}
`;

interface NormalizedNode {
  tag: string;
  attrs: [string, string][];
  children: Normalized[];
}
type Normalized = NormalizedNode | { text: string };

const EDITOR_ATTR = /^data-(?:design-|figma-|canvas-paste-)/;
const SKIP_TAGS = new Set(["script", "style"]);

function normalizeStyle(styleText: string): [string, string][] {
  return styleText
    .split(";")
    .map((decl) => decl.split(/:(.*)/s) as [string, string?])
    .filter(([name]) => name.trim() !== "")
    .map(([name, value]) => {
      const prop = name.trim();
      const camel = prop.startsWith("--")
        ? prop
        : prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
      return [camel, (value ?? "").trim()] as [string, string];
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function normalizeChildren(parent: Element | DocumentFragment | null): Normalized[] {
  if (!parent) return [];
  const out: Normalized[] = [];
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3 || child.nodeType === 4) {
      const text = child.nodeValue ?? "";
      if (text.trim() === "" && /[\n\r\f]/.test(text)) continue;
      out.push({ text });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (SKIP_TAGS.has(el.localName)) continue;
    if (el.hasAttribute("data-script-node")) continue;
    const attrs: [string, string][] = [];
    for (const attr of Array.from(el.attributes)) {
      if (EDITOR_ATTR.test(attr.name)) continue;
      if (attr.name === "style") {
        for (const decl of normalizeStyle(attr.value)) attrs.push([`style:${decl[0]}`, decl[1]]);
        continue;
      }
      attrs.push([attr.name, attr.value]);
    }
    attrs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    out.push({
      tag: el.localName,
      attrs,
      children: normalizeChildren(el),
    });
  }
  return out;
}

function diff(expected: Normalized[], actual: Normalized[], path: string, diffs: string[]): void {
  if (expected.length !== actual.length) {
    diffs.push(`${path}: child count ${expected.length} !== ${actual.length}`);
    return;
  }
  expected.forEach((exp, index) => {
    const act = actual[index]!;
    const at = `${path} > [${index}]`;
    if ("text" in exp || "text" in act) {
      if ("text" in exp && "text" in act && exp.text === act.text) return;
      diffs.push(`${at}: text ${JSON.stringify(exp)} !== ${JSON.stringify(act)}`);
      return;
    }
    if (exp.tag !== act.tag) {
      diffs.push(`${at}: <${exp.tag}> !== <${act.tag}>`);
      return;
    }
    const expAttrs = Object.fromEntries(exp.attrs);
    const actAttrs = Object.fromEntries(act.attrs);
    const names = new Set([...Object.keys(expAttrs), ...Object.keys(actAttrs)]);
    for (const name of names) {
      if (expAttrs[name] !== actAttrs[name]) {
        diffs.push(`${at} <${exp.tag}> ${name}: ${JSON.stringify(expAttrs[name])} !== ${JSON.stringify(actAttrs[name])}`);
      }
    }
    diff(exp.children, act.children, `${at} <${exp.tag}>`, diffs);
  });
}

describe("mount parity", { timeout: 60000 }, () => {
  let server: ViteDevServer;
  let project: ReactExportProject;
  const seeds = [
    {
      id: "f-demo",
      name: "Desktop",
      documentId: "fieldwork",
      x: 0, y: 0, width: 1440, height: 900,
      srcDoc: demoDocument,
      background: "#f3f0e9",
    },
    {
      id: "f-figma",
      name: "Figma",
      documentId: "figma",
      pageId: "p-figma",
      pageName: "Figma Paste",
      documentName: "Figma",
      x: 0, y: 1000, width: 800, height: 600,
      srcDoc: FIGMA_DOC,
      background: "#fff",
    },
    {
      id: "f-script",
      name: "Scripted",
      documentId: "scripted",
      pageId: "p-script",
      pageName: "Scripted Page",
      documentName: "Scripted",
      x: 0, y: 2000, width: 800, height: 600,
      srcDoc: SCRIPT_DOC,
      background: "#fff",
    },
  ];
  const srcDocs = [demoDocument, FIGMA_DOC, SCRIPT_DOC];

  beforeAll(async () => {
    const state = createEditorStateFromFrameSeeds(seeds);
    project = buildReactExportProject(state, "Parity")!;
    expect(project).not.toBeNull();
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
    for (const file of project.files) {
      const target = join(FIXTURE_DIR, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.text);
    }
    writeFileSync(join(FIXTURE_DIR, "mount-harness.tsx"), HARNESS_TSX);
    server = await createServer({
      root: WORKTREE,
      logLevel: "silent",
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
      appType: "custom",
    });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it("emitted components render DOM equal to the source documents", async () => {
    const harness = (await server.ssrLoadModule(
      join(FIXTURE_DIR, "mount-harness.tsx"),
    )) as { mount: (el: Element, c: never) => { unmount: () => void } };

    for (let index = 0; index < project.components.length; index += 1) {
      const component = project.components[index]!;
      const mod = (await server.ssrLoadModule(join(FIXTURE_DIR, component.fileName))) as {
        default: never;
      };
      const container = document.createElement("div");
      document.body.appendChild(container);
      try {
        const root = harness.mount(container, mod.default);
        await new Promise((resolveFlush) => setTimeout(resolveFlush, 0));

        // Head items/ScriptNode markers may precede the scope root.
        const scope = Array.from(container.children).find((el) =>
          el.classList.contains(`dc-${component.slug}`),
        );
        if (!scope) throw new Error(`${component.componentName}: scope root missing`);
        expect(scope.tagName).toBe("DIV");

        const expected = new DOMParser().parseFromString(srcDocs[index]!, "text/html");
        const diffs: string[] = [];
        diff(normalizeChildren(expected.body), normalizeChildren(scope), component.componentName, diffs);
        expect(diffs, diffs.join("\n")).toEqual([]);

        // The wrapper carries merged html/body attributes (lang, classes).
        const mergedClasses = new Set([
          `dc-${component.slug}`,
          ...(expected.documentElement.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
          ...(expected.body.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
        ]);
        for (const cls of mergedClasses) expect(scope.classList.contains(cls)).toBe(true);

        root.unmount();
      } finally {
        container.remove();
      }
    }
  }, 60_000);

  it("keeps document attributes on the scope root and hoists the title", async () => {
    const harness = (await server.ssrLoadModule(
      join(FIXTURE_DIR, "mount-harness.tsx"),
    )) as { mount: (el: Element, c: never) => { unmount: () => void } };
    const figmaComponent = project.components.find((c) => c.slug === "figma-paste")!;
    const mod = (await server.ssrLoadModule(join(FIXTURE_DIR, figmaComponent.fileName))) as {
      default: never;
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const previousLang = document.documentElement.getAttribute("lang");
    try {
      const root = harness.mount(container, mod.default);
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0));
      // The wrapper carries merged html/body attributes; the real document
      // is never touched, so a host app embedding the component is safe.
      expect(
        container.querySelector(".dc-figma-paste")?.getAttribute("lang"),
      ).toBe("en");
      expect(document.documentElement.getAttribute("lang")).toBe(previousLang);
      root.unmount();
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0));
      expect(document.documentElement.getAttribute("lang")).toBe(previousLang);
    } finally {
      container.remove();
    }
  }, 60_000);

  it("runs authored scripts only inside EnableScripts, once under StrictMode", async () => {
    const harness = (await server.ssrLoadModule(
      join(FIXTURE_DIR, "mount-harness.tsx"),
    )) as {
      mount: (el: Element, c: never) => { unmount: () => void };
      mountStrict: (el: Element, c: never) => { unmount: () => void };
    };
    const scripted = project.components.find((c) => c.slug === "scripted-page")!;
    const mod = (await server.ssrLoadModule(join(FIXTURE_DIR, scripted.fileName))) as {
      default: never;
    };
    const scriptNodeModule = (await server.ssrLoadModule(
      join(FIXTURE_DIR, "src/design/ScriptNode.tsx"),
    )) as { EnableScripts: never };

    const appended: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node instanceof HTMLScriptElement) {
            appended.push(node.getAttribute("src") ?? "inline");
          }
        }
      }
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    observer.observe(container, { childList: true, subtree: true });
    try {
      // Without the opt-in a dropped-in component stays inert.
      const plain = harness.mount(container, mod.default);
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0));
      expect(container.querySelectorAll("[data-script-node]")).toHaveLength(2);
      expect(appended).toEqual([]);
      plain.unmount();
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0));

      // With EnableScripts under StrictMode each script element is appended
      // exactly once. The replay cleanup removes it, but it ran only once.
      const enabled = () =>
        createElement(scriptNodeModule.EnableScripts, null, createElement(mod.default));
      const strict = harness.mountStrict(container, enabled as never);
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0));
      expect(appended).toEqual(["https://cdn.example.com/head.js", "inline"]);
      expect(container.querySelectorAll("script")).toHaveLength(0);
      // React hoists the emitted <title> into the real document head.
      expect(document.title).toBe("Scripted");
      strict.unmount();
      await new Promise((resolveFlush) => setTimeout(resolveFlush, 0));
      expect(container.querySelectorAll("script")).toHaveLength(0);
    } finally {
      observer.disconnect();
      container.remove();
    }
  }, 60_000);
});
