import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorStateFromFrameSeeds } from "../editor";
import { serializeWireCanvasProject } from "./wirecanvas";
import {
  clearAllLocalProjects,
  deleteLocalProject,
  duplicateLocalProject,
  getLocalProjectSummaries,
  loadEditorStateForProject,
  renameLocalProject,
  saveEditorStateToActiveProject,
  setActiveProjectId,
  upsertLocalProject,
  type LocalProjectRecord,
} from "./local-projects";

function record(overrides: Partial<LocalProjectRecord> = {}): LocalProjectRecord {
  const state = createEditorStateFromFrameSeeds([
    {
      id: "frame-1",
      name: "Frame",
      documentId: "document-1",
      pageId: "page-1",
      pageName: "Page",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      srcDoc: "<!doctype html><html><body><main>Hi</main></body></html>",
      mode: "design",
      background: "#ffffff",
    },
  ]);
  return {
    id: "p1",
    name: "Project One",
    kind: "blank",
    createdAt: 1,
    updatedAt: 1,
    frameCount: 1,
    lifecycle: "not-started",
    data: serializeWireCanvasProject(state),
    ...overrides,
  };
}

function nonEmptyState() {
  return createEditorStateFromFrameSeeds([
    {
      id: "frame-1",
      name: "Frame",
      documentId: "document-1",
      pageId: "page-1",
      pageName: "Page",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      srcDoc: "<!doctype html><html><body><main>Hi</main></body></html>",
      mode: "design",
      background: "#ffffff",
    },
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
  clearAllLocalProjects();
});

describe("local project persistence", () => {
  it("round-trips upsert, rename, duplicate and delete when storage works", () => {
    expect(upsertLocalProject(record())).toBe(true);
    expect(renameLocalProject("p1", "Renamed")).toBe(true);
    const dup = duplicateLocalProject("p1");
    expect(dup?.name).toBe("Copy of Renamed");
    expect(getLocalProjectSummaries()).toHaveLength(2);
    const remaining = deleteLocalProject("p1");
    expect(remaining?.map((p) => p.id)).toEqual([dup!.id]);
  });

  it("reports failure instead of pretending the write landed", () => {
    expect(upsertLocalProject(record())).toBe(true);
    setActiveProjectId("p1");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(renameLocalProject("p1", "Renamed")).toBe(false);
    expect(deleteLocalProject("p1")).toBeNull();
    expect(duplicateLocalProject("p1")).toBeNull();
    expect(upsertLocalProject(record({ id: "p2", name: "Two" }))).toBe(false);

    // The autosave path must not report success either.
    const saved = saveEditorStateToActiveProject(nonEmptyState(), { activeId: "p1" });
    expect(saved).toBeNull();

    vi.restoreAllMocks();
    // Nothing was lost: the stored index still holds the original record.
    expect(getLocalProjectSummaries().map((p) => p.name)).toEqual(["Project One"]);
    expect(loadEditorStateForProject("p1")).not.toBeNull();
  });
});
