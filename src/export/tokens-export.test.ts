import { describe, expect, it } from "vitest";
import {
  createEmptyEditorState,
  createEditorStateFromFrameSeeds,
  switchTokenThemeCommand,
  applyEditorCommand,
} from "../editor";
import { buildCodeExportPayload } from "./code-export";
import {
  buildDTCGExportFile,
  buildTokenCssExportFile,
  hasExportableTokens,
} from "./tokens-export";

const designHtml = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><main>Tokens</main></body></html>";

function twoPageState() {
  return createEditorStateFromFrameSeeds([
    {
      id: "frame-a", name: "Home", documentId: "document-1", pageId: "page-1",
      x: 0, y: 0, width: 800, height: 600, srcDoc: designHtml, mode: "design", background: "#ffffff",
    },
    {
      id: "frame-b", name: "About", documentId: "document-2", pageId: "page-2",
      x: 900, y: 0, width: 800, height: 600, srcDoc: designHtml, mode: "design", background: "#ffffff",
    },
  ]);
}

describe("token file exports", () => {
  it("builds DTCG JSON and CSS variable files", () => {
    let state = createEmptyEditorState();
    state = applyEditorCommand(state, switchTokenThemeCommand("brand"));
    const dtcg = buildDTCGExportFile(state.tokens);
    expect(dtcg.filename).toBe("tokens.json");
    expect(dtcg.mimeType).toBe("application/json");
    const parsed = JSON.parse(dtcg.text) as Record<string, unknown>;
    expect(parsed.$meta).toMatchObject({ theme: "Brand" });
    const css = buildTokenCssExportFile(state.tokens);
    expect(css.filename).toBe("tokens.css");
    expect(css.text).toContain("--color-accent-primary: #e5484d;");
  });

  it("reports exportability", () => {
    expect(hasExportableTokens(createEmptyEditorState().tokens)).toBe(true);
  });
});

describe("code export token bundle", () => {
  it("keeps the single-file contract to exactly one .html file", () => {
    const single = createEditorStateFromFrameSeeds([
      {
        id: "frame-a", name: "Home", documentId: "document-1", pageId: "page-1",
        x: 0, y: 0, width: 800, height: 600, srcDoc: designHtml, mode: "design", background: "#ffffff",
      },
    ]);
    const payload = buildCodeExportPayload(single, "Site");
    expect(payload?.filename).toBe("site.html");
    expect(payload?.fileCount).toBe(1);
  });

  it("bundles tokens.json and tokens.css into multi-page zips", () => {
    const payload = buildCodeExportPayload(twoPageState(), "Site");
    expect(payload?.mimeType).toBe("application/zip");
    expect(payload?.fileCount).toBe(2);
    const text = new TextDecoder().decode(payload?.text as Uint8Array);
    expect(text).toContain("tokens.json");
    expect(text).toContain("tokens.css");
    expect(text).toContain("--color-accent-primary: #3b74c2;");
    expect(text).toContain("$value");
  });
});
