/**
 * Static project emitters: everything outside `src/design/`. These files are
 * fixed templates pinned to this repo's majors (react ^19, vite ^8,
 * typescript ^7). The boundary contract: scaffold files may import design/,
 * and design/ never imports scaffold.
 */
import type { ExportNote } from "./react-export";

export interface ScaffoldPage {
  /** PascalCase component name; also the file stem under src/design/. */
  componentName: string;
  /** kebab slug used for the hash route and the dc-<slug> scope class. */
  slug: string;
  /** Human label for the switcher. */
  title: string;
}

export interface ScaffoldInput {
  projectName: string;
  projectSlug: string;
  pages: ScaffoldPage[];
  /** First document's head data, baked into index.html. */
  documentMeta: { charset?: string; viewport?: string; lang?: string };
  /** First document's head items, serialized as HTML into index.html. */
  head: ScaffoldHeadItem[];
  notes: ExportNote[];
}

export type ScaffoldHeadItem =
  | { kind: "title"; text: string }
  | { kind: "meta"; attributes: Record<string, string> }
  | { kind: "link"; attributes: Record<string, string> };

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function emitPackageJson(input: ScaffoldInput): string {
  return `${JSON.stringify(
    {
      name: input.projectSlug,
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^19.2.8",
        "react-dom": "^19.2.8",
      },
      devDependencies: {
        "@types/react": "^19.2.14",
        "@types/react-dom": "^19.2.3",
        "@vitejs/plugin-react": "^6.0.5",
        typescript: "^7.0.2",
        vite: "^8.2.1",
      },
    },
    null,
    2,
  )}\n`;
}

export function emitIndexHtml(input: ScaffoldInput): string {
  const charset = input.documentMeta.charset ?? "utf-8";
  const viewport = input.documentMeta.viewport ?? "width=device-width, initial-scale=1";
  const titleItem = input.head.find((item) => item.kind === "title");
  const title = titleItem && titleItem.kind === "title" ? titleItem.text : input.projectName;
  const lines: string[] = [
    `<meta charset="${escapeHtmlAttr(charset)}" />`,
    `<meta name="viewport" content="${escapeHtmlAttr(viewport)}" />`,
    `<title>${escapeHtmlText(title)}</title>`,
  ];
  for (const item of input.head) {
    if (item.kind === "meta") {
      const attrs = Object.entries(item.attributes)
        .map(([name, value]) => `${name}="${escapeHtmlAttr(value)}"`)
        .join(" ");
      lines.push(`<meta ${attrs} />`);
    } else if (item.kind === "link") {
      const attrs = Object.entries(item.attributes)
        .map(([name, value]) => `${name}="${escapeHtmlAttr(value)}"`)
        .join(" ");
      lines.push(`<link ${attrs} />`);
    }
  }
  const head = lines.join("\n    ");
  const lang = input.documentMeta.lang;
  return `<!doctype html>
<html${lang ? ` lang="${escapeHtmlAttr(lang)}"` : ""}>
  <head>
    ${head}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

export function emitTsConfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "react-jsx",
        strict: true,
        noUnusedLocals: false,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["src", "vite.config.ts"],
    },
    null,
    2,
  )}\n`;
}

export function emitViteConfig(): string {
  return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`;
}

export function emitMainTsx(): string {
  return `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;
}

/** One page renders directly; many pages get a hash switcher that mounts a
 *  single page at a time so page styles never overlap. */
export function emitAppTsx(input: ScaffoldInput): string {
  const imports = input.pages
    .map((page) => `import ${page.componentName} from "./design/${page.componentName}";`)
    .join("\n");
  if (input.pages.length === 1) {
    const page = input.pages[0]!;
    return `${imports}

export default function App() {
  return <${page.componentName} />;
}
`;
  }
  const table = input.pages
    .map(
      (page) =>
        `  { slug: ${JSON.stringify(page.slug)}, title: ${JSON.stringify(page.title)}, Component: ${page.componentName} },`,
    )
    .join("\n");
  return `import { useEffect, useState } from "react";
${imports}

const pages = [
${table}
];

function routeSlug(): string {
  return window.location.hash.replace(/^#\\/?/, "");
}

export default function App() {
  const [slug, setSlug] = useState(routeSlug);

  useEffect(() => {
    const onHashChange = () => setSlug(routeSlug());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const active = pages.find((page) => page.slug === slug) ?? pages[0];
  const ActivePage = active.Component;

  return (
    <>
      <ActivePage />
      <nav className="app-switcher" aria-label="Exported pages">
        {pages.map((page) => (
          <a
            key={page.slug}
            href={\`#/\${page.slug}\`}
            aria-current={page.slug === active.slug ? "page" : undefined}
          >
            {page.title}
          </a>
        ))}
      </nav>
    </>
  );
}
`;
}

/** Reset plus switcher chrome. Deliberately outside any design scope class. */
export function emitAppCss(pages: number): string {
  const base = `html,
body {
  margin: 0;
}

#root {
  min-height: 100vh;
}

/* Browsers paint a body's background across the whole viewport; the scoped
   page root only reaches its own box, so stretch it to match. */
#root > *${pages > 1 ? ":not(.app-switcher)" : ""} {
  min-height: 100vh;
}
`;
  if (pages <= 1) return base;
  return `${base}
.app-switcher {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 10;
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(18, 18, 18, 0.92);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
}

.app-switcher a {
  padding: 7px 13px;
  border-radius: 999px;
  color: #cfcfcf;
  text-decoration: none;
  white-space: nowrap;
}

.app-switcher a:hover {
  color: #ffffff;
}

.app-switcher a[aria-current="page"] {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.16);
}
`;
}

/** design/ScriptNode.tsx — emitted only when a document has <script>. */
export function emitScriptNodeTsx(): string {
  return `import { useEffect, useRef } from "react";

export interface ScriptNodeProps {
  /** Attributes copied onto the created <script> (src, type, async, defer…). */
  attributes?: Record<string, string>;
  /** Inline script source. */
  code?: string;
}

/**
 * Marks the DOM position where a <script> lived in the source document. On
 * mount a real script element is created next to the marker so authored
 * scripts still execute. The script is removed on unmount, which keeps
 * StrictMode remounts honest. Props are read on every effect run keyed by
 * their serialized value.
 */
export function ScriptNode({ attributes = {}, code }: ScriptNodeProps) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const propsKey = JSON.stringify([attributes, code]);

  useEffect(() => {
    const marker = markerRef.current;
    if (marker === null) return;
    const script = document.createElement("script");
    for (const [name, value] of Object.entries(attributes)) {
      script.setAttribute(name, value);
    }
    if (code !== undefined) script.textContent = code;
    marker.after(script);
    return () => {
      script.remove();
    };
    // propsKey captures the props; they are fixed at export time.
  }, [propsKey]);

  return <span ref={markerRef} data-script-node="" style={{ display: "contents" }} />;
}
`;
}

/** design/useDocumentAttributes.ts — emitted when any document carries
 *  <html>/<body> attributes so scoped selectors like html[lang] and
 *  body.dark keep working for real. */
export function emitUseDocumentAttributesTs(): string {
  return `import { useEffect } from "react";

/**
 * Copies the source document's <html> and <body> attributes onto the real
 * documentElement and body while the component is mounted. Previous values
 * are restored on unmount. A scoped wrapper div cannot make selectors like
 * html[lang] or document-level behavior (dir, scroll-behavior) work — this
 * hook does.
 */
export function useDocumentAttributes(
  htmlAttributes: Record<string, string>,
  bodyAttributes: Record<string, string>,
): void {
  const key = JSON.stringify([htmlAttributes, bodyAttributes]);

  useEffect(() => {
    const applied: Array<[Element, string, string | null]> = [];
    const apply = (target: Element, attributes: Record<string, string>) => {
      for (const [name, value] of Object.entries(attributes)) {
        applied.push([target, name, target.getAttribute(name)]);
        target.setAttribute(name, value);
      }
    };
    apply(document.documentElement, htmlAttributes);
    apply(document.body, bodyAttributes);
    return () => {
      for (const [target, name, previous] of applied.reverse()) {
        if (previous === null) target.removeAttribute(name);
        else target.setAttribute(name, previous);
      }
    };
    // key captures the attribute records; they are fixed at export time.
  }, [key]);
}
`;
}

function formatNoteLine(note: ExportNote): string {
  const scope = note.componentName ? `\`${note.componentName}\`: ` : "";
  const detail = note.detail ? ` (${note.detail})` : "";
  return `- ${scope}${note.message}${detail}`;
}

/** README: what this is, how to run it, the drop-in recipe, fidelity notes. */
export function emitReadme(input: ScaffoldInput): string {
  const names = input.pages.map((page) => page.componentName);
  const noteLines =
    input.notes.length === 0
      ? "No adaptations were needed."
      : input.notes.map(formatNoteLine).join("\n");
  return `# ${input.projectName} React export

This project was exported from a design canvas. It is a runnable Vite, React, and TypeScript app.

## Run it

    npm install
    npm run dev

Open the printed URL.${input.pages.length > 1 ? " A switcher at the bottom right moves between pages. Hash links like `#/" + input.pages[1]!.slug + "` also work." : ""}

## The design folder

Everything under \`src/design/\` is the deliverable. Each canvas document became one component plus a stylesheet scoped under a \`dc-*\` class, so a page cannot restyle its host app. Copy the whole \`src/design/\` folder into any React 19 app and render the component you need. Nothing inside \`src/design/\` imports from outside \`src/design/\` except \`react\`.

Components in this export: ${names.map((name) => `\`${name}\``).join(", ")}.

- \`tokens.css\` and \`tokens.json\` record the active theme for tooling. Components do not import them; the same variables are already materialized into each scoped stylesheet.
- \`fonts.css\`, when present, carries the bundled font faces the documents named, as data URIs.
- \`ScriptNode.tsx\`, when present, re-creates authored \`<script>\` elements at their original DOM position.
- \`useDocumentAttributes.ts\`, when present, applies the source \`<html>\` and \`<body>\` attributes to the real document while a page is mounted.
- \`export-manifest.json\` lists pages and adaptations for tooling.

## Fidelity notes

${noteLines}
`;
}
