import { describe, expect, it } from "vitest";
import {
  emitAppCss,
  emitAppTsx,
  emitIndexHtml,
  emitMainTsx,
  emitPackageJson,
  emitReadme,
  emitScriptNodeTsx,
  emitTsConfig,
  emitViteConfig,
  type ScaffoldInput,
} from "./scaffold";

const PAGE = { componentName: "Home", slug: "home", title: "Home" };

function input(overrides: Partial<ScaffoldInput> = {}): ScaffoldInput {
  return {
    projectName: "My Site",
    projectSlug: "my-site",
    pages: [PAGE],
    documentMeta: {},
    head: [],
    usesScriptNode: false,
    notes: [],
    ...overrides,
  };
}

describe("emitPackageJson", () => {
  it("emits a runnable vite module package named after the project slug", () => {
    const pkg = JSON.parse(emitPackageJson(input())) as {
      name: string;
      type: string;
      private: boolean;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(pkg).toMatchObject({
      name: "my-site",
      private: true,
      type: "module",
      scripts: { dev: "vite", build: "tsc && vite build", preview: "vite preview" },
    });
    expect(pkg.dependencies.react).toMatch(/^\^19\./);
    expect(emitPackageJson(input()).endsWith("\n")).toBe(true);
  });
});

describe("emitIndexHtml", () => {
  it("bakes meta, title and head items into a mountable document", () => {
    const html = emitIndexHtml(
      input({
        documentMeta: { charset: "utf-8", viewport: "width=640", lang: "en" },
        head: [
          { kind: "title", text: "Fish & Chips" },
          { kind: "meta", attributes: { name: "description", content: 'say "hi" <now>' } },
          { kind: "link", attributes: { rel: "icon", href: "/f.png" } },
        ],
      }),
    );
    expect(html).toBe(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=640" />
    <title>Fish &amp; Chips</title>
    <meta name="description" content="say &quot;hi&quot; &lt;now&gt;" />
    <link rel="icon" href="/f.png" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`);
  });

  it("falls back to the project name and defaults when head data is sparse", () => {
    const html = emitIndexHtml(input({ projectName: "Plain <Site>" }));
    expect(html).toContain("<title>Plain &lt;Site&gt;</title>");
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
    expect(html).toContain("\n<html>\n");
  });
});

describe("emitTsConfig / emitViteConfig / emitMainTsx", () => {
  it("emits a strict bundler tsconfig covering src", () => {
    const tsconfig = JSON.parse(emitTsConfig()) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.moduleResolution).toBe("bundler");
    expect(tsconfig.include).toEqual(["src", "vite.config.ts"]);
  });

  it("emits the react plugin vite config", () => {
    expect(emitViteConfig()).toBe(`import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`);
  });

  it("emits a StrictMode root mount at #root", () => {
    const main = emitMainTsx();
    expect(main).toContain('import App from "./App";');
    expect(main).toContain('createRoot(document.getElementById("root")!).render(');
    expect(main).toContain("<StrictMode>");
  });
});

describe("emitAppTsx", () => {
  it("renders a single page directly, opting into scripts only when used", () => {
    expect(emitAppTsx(input())).toBe(`import Home from "./design/Home";

export default function App() {
  return <Home />;
}
`);
    expect(emitAppTsx(input({ usesScriptNode: true }))).toBe(`import Home from "./design/Home";
import { EnableScripts } from "./design/ScriptNode";

export default function App() {
  return <EnableScripts><Home /></EnableScripts>;
}
`);
  });

  it("emits a hash-route switcher for multiple pages", () => {
    const app = emitAppTsx(
      input({
        pages: [PAGE, { componentName: "About", slug: "about-us", title: "About Us" }],
      }),
    );
    expect(app).toContain('import { useEffect, useState } from "react";');
    expect(app).toContain('import Home from "./design/Home";');
    expect(app).toContain('import About from "./design/About";');
    expect(app).toContain(
      '  { slug: "home", title: "Home", Component: Home },\n' +
        '  { slug: "about-us", title: "About Us", Component: About },',
    );
    expect(app).toContain('window.addEventListener("hashchange", onHashChange)');
    expect(app).toContain("<ActivePage />");
    expect(app).toContain("app-switcher");
    expect(app).not.toContain("EnableScripts");
  });
});

describe("emitAppCss", () => {
  it("emits only the viewport reset for a single page", () => {
    expect(emitAppCss(1)).toBe(`html,
body {
  margin: 0;
}

#root {
  min-height: 100vh;
}

/* Browsers paint a body's background across the whole viewport; the scoped
   page root only reaches its own box, so stretch it to match. */
#root > * {
  min-height: 100vh;
}
`);
  });

  it("adds switcher chrome and exempts it from the root stretch for many pages", () => {
    const css = emitAppCss(3);
    expect(css).toContain("#root > *:not(.app-switcher) {");
    expect(css).toContain(".app-switcher a[aria-current=\"page\"] {");
    expect(css).toContain("position: fixed;");
  });
});

describe("emitScriptNodeTsx", () => {
  it("emits the opt-in script runner with its context gate", () => {
    const tsx = emitScriptNodeTsx();
    expect(tsx).toContain("export function EnableScripts");
    expect(tsx).toContain("createContext(false)");
    expect(tsx).toContain("data-script-node");
    expect(tsx).toContain('import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";');
  });
});

describe("emitReadme", () => {
  it("lists components and formats notes with scope and detail", () => {
    const readme = emitReadme(
      input({
        notes: [
          {
            code: "event-handler-omitted",
            severity: "warning",
            message: "Handler dropped.",
            componentName: "Home",
            detail: "onclick",
          },
          { code: "stylesheet-dropped", severity: "warning", message: "Sheet dropped." },
        ],
      }),
    );
    expect(readme).toContain("# My Site React export");
    expect(readme).toContain("- `Home`: Handler dropped. (onclick)");
    expect(readme).toContain("- Sheet dropped.");
    expect(readme).toContain("`Home`");
  });

  it("declares a clean export and the page switcher hint", () => {
    expect(emitReadme(input())).toContain("No adaptations were needed.");
    const multi = emitReadme(
      input({ pages: [PAGE, { componentName: "About", slug: "about", title: "About" }] }),
    );
    expect(multi).toContain("A switcher at the bottom right");
    expect(multi).toContain("`#/about`");
  });
});
