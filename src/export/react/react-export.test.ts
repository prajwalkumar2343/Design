import { describe, expect, it, vi } from "vitest";

import { createEditorStateFromFrameSeeds } from "../../editor/model";
import { demoDocument } from "../../demo/documents";
import { luminaStationDocument } from "../../demo/lumina-station";
import { parseZipArchive } from "../zip.test";

// The font catalog imports bundled woff2 files via `?inline`; under the
// worktree's symlinked node_modules vite cannot serve them, so tests stub
// the catalog. The emit path (usedFontOptions → buildFontFaceCss) is
// exercised for real.
vi.mock("../../fonts/catalog", () => ({
  FONT_CATALOG: [
    {
      id: "inter",
      name: "Inter",
      stack: "Inter, ui-sans-serif, system-ui, sans-serif",
      category: "Sans",
      license: "OFL-1.1",
      faces: [
        { src: "data:font/woff2;base64,AAAA", weight: "100 900", style: "normal" },
      ],
    },
    {
      id: "georgia",
      name: "Georgia",
      stack: "Georgia, serif",
      category: "Serif",
      license: "OFL-1.1",
      faces: [
        { src: "data:font/woff2;base64,BBBB", weight: "400", style: "normal" },
      ],
    },
  ],
}));

import { buildReactExportPayload, buildReactExportProject } from "./react-export";

const DEMO_SEED = {
  id: "frame-1",
  name: "Desktop",
  documentId: "fieldwork",
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  srcDoc: demoDocument,
  background: "#f3f0e9",
};

const LUMINA_SEED = {
  id: "frame-2",
  name: "Lumina",
  documentId: "lumina",
  pageId: "lumina-page",
  pageName: "Lumina Station",
  documentName: "Lumina",
  x: 0,
  y: 1000,
  width: 1440,
  height: 900,
  srcDoc: luminaStationDocument,
  background: "#ffffff",
};

const SIMPLE_DOC = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Card</title>
<style>body { margin: 0 } .card { color: var(--color-text-primary, #111) }</style>
</head><body><div class="card"><b>Hi</b></div></body></html>`;

function stateWith(srcDoc: string, mode: "design" | "wireframe" = "design") {
  return createEditorStateFromFrameSeeds([
    {
      id: "f",
      name: "One",
      documentId: "d",
      pageId: "p",
      pageName: "Page One",
      documentName: "Doc",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      srcDoc,
      background: "#fff",
      mode,
    },
  ]);
}

describe("buildReactExportProject", { timeout: 30000 }, () => {
  it("returns null when there are no non-empty documents", () => {
    const state = stateWith("   ");
    expect(buildReactExportProject(state, "X")).toBeNull();
    expect(buildReactExportPayload(state, "X")).toBeNull();
  });

  it("emits the fixed zip layout for the real demo documents", () => {
    const state = createEditorStateFromFrameSeeds([DEMO_SEED, LUMINA_SEED]);
    const project = buildReactExportProject(state, "Demo Canvas");
    expect(project).not.toBeNull();
    expect(project!.files.map((f) => f.path)).toEqual([
      "README.md",
      "package.json",
      "index.html",
      "tsconfig.json",
      "vite.config.ts",
      "src/main.tsx",
      "src/App.tsx",
      "src/app.css",
      "src/vite-env.d.ts",
      "src/design/Fieldwork.tsx",
      "src/design/Fieldwork.css",
      "src/design/LuminaStation.tsx",
      "src/design/LuminaStation.css",
      "src/design/tokens.css",
      "src/design/tokens.json",
      "src/design/fonts.css",
      "src/design/export-manifest.json",
    ]);
    expect(project!.components.map((c) => c.componentName)).toEqual([
      "Fieldwork",
      "LuminaStation",
    ]);
    // No <script> in either doc → no ScriptNode helper.
    expect(project!.usesScriptNode).toBe(false);
  });

  it("scopes the active token theme into the page stylesheet", () => {
    const state = stateWith(SIMPLE_DOC);
    const project = buildReactExportProject(state, "X")!;
    const css = project.files.find((f) => f.path === "src/design/PageOne.css")!.text;
    expect(css).toContain(".dc-page-one .card{color:var(--color-text-primary, #111)}");
    expect(css).toContain("--color-text-primary: var(--color-ink-primary)");
    expect(css).toContain("/* canvas design tokens for the active theme */\n.dc-page-one{");
    // And the record files ship alongside.
    expect(project.files.some((f) => f.path === "src/design/tokens.css")).toBe(true);
    expect(project.files.some((f) => f.path === "src/design/tokens.json")).toBe(true);
  });

  it("emits fonts.css only when a catalog font is used", () => {
    const withFont = stateWith(
      `<html><head><style>.x { font-family: Inter, sans-serif }</style></head><body><p>x</p></body></html>`,
    );
    const project = buildReactExportProject(withFont, "X")!;
    const fonts = project.files.find((f) => f.path === "src/design/fonts.css")!;
    expect(fonts.text).toContain("@font-face");
    expect(fonts.text).toContain('font-family:"Inter"');
    const tsx = project.files.find((f) => f.path.endsWith(".tsx") && f.path.includes("design"))!.text;
    expect(tsx).toContain('import "./fonts.css";');

    // A wireframe doc gets no token theme, so nothing names a catalog font.
    const noFont = stateWith(
      `<html><body><p style="font-family: serif">x</p></body></html>`,
      "wireframe",
    );
    const project2 = buildReactExportProject(noFont, "X")!;
    expect(project2.files.some((f) => f.path === "src/design/fonts.css")).toBe(false);
  });

  it("emits ScriptNode.tsx only when a document has a script", () => {
    const state = stateWith(
      `<html><body><p>x</p><script>window.a = 1;</script></body></html>`,
    );
    const project = buildReactExportProject(state, "X")!;
    expect(project.usesScriptNode).toBe(true);
    const scriptNode = project.files.find((f) => f.path === "src/design/ScriptNode.tsx")!;
    // Scripts are inert unless a host opts in; the generated App opts in.
    expect(scriptNode.text).toContain("export function EnableScripts");
    expect(scriptNode.text).toContain("createContext(false)");
    const tsx = project.files.find((f) => f.path.endsWith("PageOne.tsx"))!.text;
    expect(tsx).toContain('import { ScriptNode } from "./ScriptNode";');
    expect(tsx).toContain('<ScriptNode code={"window.a = 1;"} />');
    const app = project.files.find((f) => f.path === "src/App.tsx")!.text;
    expect(app).toContain('import { EnableScripts } from "./design/ScriptNode";');
    expect(app).toContain("<EnableScripts><PageOne /></EnableScripts>");
    expect(project.notes.map((n) => n.code)).toContain("script-preserved");
  });

  it("drops stylesheet links and @import rules instead of loading global CSS", () => {
    const state = stateWith(
      `<html><head>
      <link rel="stylesheet" href="https://cdn.example.com/global.css">
      <link rel="icon" href="f.png">
      <style>@import "https://cdn.example.com/other.css"; body { display: none }</style>
      </head><body><link rel="stylesheet" href="more.css"><p>x</p></body></html>`,
    );
    const project = buildReactExportProject(state, "X")!;
    const index = project.files.find((f) => f.path === "index.html")!.text;
    expect(index).not.toContain("stylesheet");
    expect(index).toContain('<link rel="icon" href="f.png" />');
    const tsx = project.files.find((f) => f.path.endsWith("PageOne.tsx"))!.text;
    expect(tsx).not.toContain("stylesheet");
    const css = project.files.find((f) => f.path.endsWith("PageOne.css"))!.text;
    expect(css).not.toContain("@import");
    expect(css).toContain(".dc-page-one{display:none}");
    expect(
      project.notes.filter((n) => n.code === "stylesheet-dropped"),
    ).toHaveLength(3);
  });

  it("renders a single page without the switcher", () => {
    const project = buildReactExportProject(stateWith(SIMPLE_DOC), "X")!;
    const app = project.files.find((f) => f.path === "src/App.tsx")!.text;
    expect(app).toBe(`import PageOne from "./design/PageOne";

export default function App() {
  return <PageOne />;
}
`);
    expect(project.files.find((f) => f.path === "src/app.css")!.text).not.toContain(
      "app-switcher",
    );
  });

  it("renders a hash switcher for multiple pages", () => {
    const state = createEditorStateFromFrameSeeds([DEMO_SEED, LUMINA_SEED]);
    const project = buildReactExportProject(state, "Demo")!;
    const app = project.files.find((f) => f.path === "src/App.tsx")!.text;
    expect(app).toContain('href={`#/${page.slug}`}');
    expect(app).toContain('{ slug: "lumina-station", title: "Lumina Station", Component: LuminaStation }');
    expect(app).toContain('window.location.hash');
  });

  it("bakes the first document head into index.html", () => {
    const state = createEditorStateFromFrameSeeds([LUMINA_SEED, DEMO_SEED]);
    const project = buildReactExportProject(state, "Demo")!;
    const index = project.files.find((f) => f.path === "index.html")!.text;
    expect(index).toContain('<html lang="en">');
    expect(index).toContain("<title>Lumina Station — Quiet power, clearly arranged.</title>");
    expect(index).toContain('<meta name="theme-color" content="#f3f1ed" />');
  });

  it("names colliding pages deterministically and guards reserved names", () => {
    const seeds = ["App", "Main", "ScriptNode", "Page One", "Page One"].map(
      (name, index) => ({
        id: `f${index}`,
        name,
        documentId: `d${index}`,
        pageId: `p${index}`,
        pageName: name,
        documentName: name,
        x: index * 100,
        y: 0,
        width: 800,
        height: 600,
        srcDoc: SIMPLE_DOC,
        background: "#fff",
      }),
    );
    const project = buildReactExportProject(
      createEditorStateFromFrameSeeds(seeds),
      "X",
    )!;
    expect(project.components.map((c) => c.componentName)).toEqual([
      "App2",
      "Main2",
      "Scriptnode2",
      "PageOne",
      "PageOne2",
    ]);
    expect(project.components.map((c) => c.slug)).toEqual([
      "app",
      "main",
      "scriptnode",
      "page-one",
      "page-one-2",
    ]);
    expect(project.files.map((f) => f.path)).toContain("src/design/App2.tsx");
  });

  it("aggregates notes with the owning component name", () => {
    const state = stateWith(
      `<html><body><a href="javascript:void(0)" onclick="x()">go</a><script src="https://x/a.js"></script></body></html>`,
    );
    const project = buildReactExportProject(state, "X")!;
    const codes = project.notes.map((n) => n.code);
    for (const code of [
      "event-handler-omitted",
      "javascript-url",
      "script-preserved",
      "remote-asset",
    ]) {
      expect(codes).toContain(code);
    }
    expect(project.notes.every((n) => n.componentName === "PageOne")).toBe(true);
  });

  it("keeps design/ imports inside the boundary", () => {
    const state = createEditorStateFromFrameSeeds([DEMO_SEED, LUMINA_SEED]);
    const project = buildReactExportProject(state, "Demo")!;
    for (const file of project.files.filter((f) => f.path.startsWith("src/design/"))) {
      if (!/\.(tsx?|ts)$/.test(file.path)) continue;
      const specifiers = [...file.text.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      for (const specifier of specifiers) {
        expect(specifier === "react" || specifier!.startsWith("./")).toBe(true);
      }
    }
  });

  it("writes a deterministic timestamp-free manifest", () => {
    const state = createEditorStateFromFrameSeeds([LUMINA_SEED]);
    const manifest = JSON.parse(
      buildReactExportProject(state, "Demo")!.files.find(
        (f) => f.path === "src/design/export-manifest.json",
      )!.text,
    );
    expect(manifest.version).toBe(1);
    expect(manifest.generatedBy).toBe("design-canvas react-export");
    expect(manifest.projectName).toBe("Demo");
    expect(manifest.components[0]).toMatchObject({
      componentName: "LuminaStation",
      fileName: "src/design/LuminaStation.tsx",
      cssFileName: "src/design/LuminaStation.css",
      sourceDocumentId: "lumina",
      mode: "design",
    });
    expect(manifest.tokens.files).toEqual(["tokens.css", "tokens.json"]);
    expect(manifest.fonts.families).toEqual(["Inter"]);
    expect(JSON.stringify(manifest)).not.toContain("generatedAt");
  });
});

describe("buildReactExportPayload", { timeout: 30000 }, () => {
  it("produces a zip with the same entries and the right shape", () => {
    const state = createEditorStateFromFrameSeeds([DEMO_SEED, LUMINA_SEED]);
    const payload = buildReactExportPayload(state, "Demo Canvas")!;
    expect(payload.filename).toBe("demo-canvas-react.zip");
    expect(payload.mimeType).toBe("application/zip");
    expect(payload.fileCount).toBe(2);
    expect(payload.componentNames).toEqual(["Fieldwork", "LuminaStation"]);

    const entries = parseZipArchive(payload.text as Uint8Array);
    const project = buildReactExportProject(state, "Demo Canvas")!;
    expect(entries.map((e) => e.name)).toEqual(project.files.map((f) => f.path));
    const decoder = new TextDecoder();
    for (const entry of entries) {
      const file = project.files.find((f) => f.path === entry.name)!;
      expect(decoder.decode(entry.data)).toBe(file.text);
    }
  });

  it("is deterministic across two runs", () => {
    const state = createEditorStateFromFrameSeeds([DEMO_SEED]);
    const a = buildReactExportProject(state, "Demo")!;
    const b = buildReactExportProject(state, "Demo")!;
    expect(a.files).toEqual(b.files);
  });
});
