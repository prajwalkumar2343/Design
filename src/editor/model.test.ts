import { describe, expect, it } from "vitest";

import {
  createEditorStateFromFrameSeeds,
  selectFrameRenderModels,
  type FrameSeed,
} from "./model";

const srcDoc = "<!doctype html><html><body><main /></body></html>";

function seed(overrides: Partial<FrameSeed> = {}): FrameSeed {
  return {
    id: "desktop",
    name: "Desktop",
    documentId: "document-1",
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    srcDoc,
    background: "#fff",
    ...overrides,
  };
}

describe("normalized editor model", () => {
  it("normalizes shared iframe source into one document with linked frames", () => {
    const state = createEditorStateFromFrameSeeds([
      seed(),
      seed({ id: "mobile", name: "Mobile", width: 390, height: 844, x: 1600 }),
    ]);

    expect(Object.keys(state.documents)).toEqual(["document-1"]);
    expect(state.documents["document-1"].srcDoc).toBe(srcDoc);
    expect(state.documents["document-1"].mode).toBe("design");
    expect(state.documents["document-1"].pageIds).toEqual(["page-1"]);
    expect(state.pages["page-1"].frameIds).toEqual(["desktop", "mobile"]);
    expect(state.frames.mobile).not.toHaveProperty("srcDoc");
    expect(state.selection.primaryFrameId).toBe("desktop");
  });

  it("derives iframe-compatible render frames from normalized state", () => {
    const state = createEditorStateFromFrameSeeds([seed()]);

    expect(selectFrameRenderModels(state)).toEqual([
      expect.objectContaining({
        id: "desktop",
        documentId: "document-1",
        mode: "design",
        srcDoc,
      }),
    ]);
  });

  it("rejects inconsistent source documents for linked frames", () => {
    expect(() =>
      createEditorStateFromFrameSeeds([seed(), seed({ id: "other", srcDoc: "different" })]),
    ).toThrow("inconsistent iframe source documents");
  });

  it("preserves an explicit wireframe mode and rejects mixed linked document modes", () => {
    const state = createEditorStateFromFrameSeeds([seed({ mode: "wireframe" })]);
    expect(state.documents["document-1"].mode).toBe("wireframe");
    expect(selectFrameRenderModels(state)[0]).toMatchObject({ mode: "wireframe" });
    expect(() => createEditorStateFromFrameSeeds([
      seed({ mode: "wireframe" }),
      seed({ id: "other", mode: "design" }),
    ])).toThrow("inconsistent document modes");
  });
});
