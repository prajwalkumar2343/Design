import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorStateFromFrameSeeds } from "../editor";
import { serializeWireCanvasProject } from "./wirecanvas";
import {
  clearAllLocalProjects,
  deleteLocalProject,
  duplicateLocalProject,
  getLocalProjectSummaries,
  loadEditorStateForProject,
  loadEditorStateForProjectDetailed,
  loadProjectIndex,
  readProjectData,
  renameLocalProject,
  saveEditorStateToActiveProject,
  saveProjectIndex,
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

  it("stores the payload under its own key, not inside the index", () => {
    expect(upsertLocalProject(record())).toBe(true);
    const indexRaw = window.localStorage.getItem("wirecanvas:projects:v2");
    expect(indexRaw).not.toBeNull();
    expect(indexRaw).not.toContain("<!doctype html>");
    expect(window.localStorage.getItem("wirecanvas:project-data:p1")).toContain("<!doctype html>");
    expect(window.localStorage.getItem("wirecanvas:project-backup:p1")).not.toBeNull();
  });

  it("migrates the legacy single-blob index into per-project keys", () => {
    const rec = record();
    window.localStorage.setItem(
      "wirecanvas:projects:v1",
      JSON.stringify([{ ...rec, data: rec.data }]),
    );
    expect(getLocalProjectSummaries().map((p) => p.id)).toEqual(["p1"]);
    expect(window.localStorage.getItem("wirecanvas:project-data:p1")).toBe(rec.data);
    expect(loadEditorStateForProject("p1")).not.toBeNull();
    expect(window.localStorage.getItem("wirecanvas:projects:v1")).toBeNull();
  });

  it("recovers the index from its backup when the primary index is corrupt", () => {
    expect(upsertLocalProject(record())).toBe(true);
    window.localStorage.setItem("wirecanvas:projects:v2", "{{{corrupt");
    const summaries = getLocalProjectSummaries();
    expect(summaries.map((p) => p.id)).toEqual(["p1"]);
    // Self-heals: the primary index is rewritten from the backup.
    expect(window.localStorage.getItem("wirecanvas:projects:v2")).toContain("p1");
  });

  it("opens the last-good backup when the primary payload is corrupt", () => {
    expect(upsertLocalProject(record())).toBe(true);
    window.localStorage.setItem("wirecanvas:project-data:p1", "not json at all {{{");
    const result = loadEditorStateForProjectDetailed("p1");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("backup");
    expect(result!.state.frames["frame-1"]).toBeDefined();
    // The healed copy is written back over the damaged primary.
    expect(window.localStorage.getItem("wirecanvas:project-data:p1")).toContain("wirecanvas-project");
  });

  it("repairs a damaged-but-parseable payload instead of refusing to open", () => {
    expect(upsertLocalProject(record())).toBe(true);
    const parsed = JSON.parse(readProjectData("p1")!) as Record<string, any>;
    // Simulate schema drift / partial damage: unknown field, missing selection,
    // a dangling selection reference.
    parsed.state.unknownFutureField = { anything: true };
    delete parsed.state.selection;
    window.localStorage.setItem("wirecanvas:project-data:p1", JSON.stringify(parsed));
    const result = loadEditorStateForProjectDetailed("p1");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("repaired");
    expect(result!.state.frames["frame-1"]).toBeDefined();
    expect(result!.state.selection.frameIds).toEqual([]);
  });

  it("keeps files listed when their index metadata uses an unknown kind", () => {
    expect(upsertLocalProject(record())).toBe(true);
    const index = JSON.parse(window.localStorage.getItem("wirecanvas:projects:v2")!) as any[];
    index[0].kind = "kind-from-a-future-build";
    window.localStorage.setItem("wirecanvas:projects:v2", JSON.stringify(index));
    const summaries = getLocalProjectSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.kind).toBe("blank");
  });

  it("preserves files written by another tab when saving a stale index", () => {
    expect(upsertLocalProject(record())).toBe(true);
    // Another tab writes p2 while this tab holds a stale index view.
    window.localStorage.setItem("wirecanvas:project-data:p2", record().data);
    const stored = JSON.parse(window.localStorage.getItem("wirecanvas:projects:v2")!) as any[];
    stored.unshift({ id: "p2", name: "Two", kind: "blank", createdAt: 2, updatedAt: 2, frameCount: 1, lifecycle: "not-started" });
    window.localStorage.setItem("wirecanvas:projects:v2", JSON.stringify(stored));
    expect(renameLocalProject("p1", "Renamed")).toBe(true);
    expect(getLocalProjectSummaries().map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("prunes index entries whose payload is gone entirely", () => {
    expect(upsertLocalProject(record())).toBe(true);
    const index = JSON.parse(window.localStorage.getItem("wirecanvas:projects:v2")!) as any[];
    index.push({ id: "ghost", name: "Ghost", kind: "blank", createdAt: 0, updatedAt: 0, frameCount: 0, lifecycle: "not-started" });
    window.localStorage.setItem("wirecanvas:projects:v2", JSON.stringify(index));
    expect(getLocalProjectSummaries().map((p) => p.id)).toEqual(["p1"]);
  });

  it("removes payload and backup keys on delete", () => {
    expect(upsertLocalProject(record())).toBe(true);
    expect(deleteLocalProject("p1")).not.toBeNull();
    expect(window.localStorage.getItem("wirecanvas:project-data:p1")).toBeNull();
    expect(window.localStorage.getItem("wirecanvas:project-backup:p1")).toBeNull();
  });

  it("re-lists an orphaned payload in the index when it is opened", () => {
    expect(upsertLocalProject(record())).toBe(true);
    // Simulate a lost index entry: data key intact, index missing the record.
    window.localStorage.setItem("wirecanvas:projects:v2", "[]");
    expect(getLocalProjectSummaries()).toHaveLength(0);
    const result = loadEditorStateForProjectDetailed("p1");
    expect(result).not.toBeNull();
    expect(getLocalProjectSummaries().map((p) => p.id)).toEqual(["p1"]);
  });
});
