import { describe, expect, it } from "vitest";
import { initialFrames } from "./documents";
import { luminaStationDocument } from "./lumina-station";
import { createEditorStateFromFrameSeeds } from "../editor/model";

describe("Lumina Station screen document", () => {
  it("embeds the local product asset and keeps the screen self-contained", () => {
    expect(luminaStationDocument).toContain('id="hero-title"');
    expect(luminaStationDocument).toContain('id="features"');
    expect(luminaStationDocument).toContain('src="data:image/png;base64,');
    expect(luminaStationDocument).not.toMatch(/https?:\/\//);
  });

  it("includes accessible navigation, responsive composition, and reduced motion support", () => {
    expect(luminaStationDocument).toContain('aria-label="Primary navigation"');
    expect(luminaStationDocument).toContain("@media (max-width: 640px)");
    expect(luminaStationDocument).toContain("@media (prefers-reduced-motion: reduce)");
    expect(luminaStationDocument).toContain('href="#main-content"');
  });

  it("keeps the new document on its own canvas page while preserving Fieldwork", () => {
    const state = createEditorStateFromFrameSeeds(initialFrames);

    expect(state.pages["page-1"].frameIds).toEqual(["desktop", "tablet", "mobile", "mobile-large"]);
    expect(state.pages["lumina-page"].frameIds).toEqual(["lumina-desktop"]);
    expect(state.documents.fieldwork.srcDoc).toContain("Make room for better ideas.");
    expect(state.documents["lumina-station"].srcDoc).toContain("Quiet power, clearly arranged.");
  });
});
