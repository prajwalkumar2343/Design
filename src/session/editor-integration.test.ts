import { describe, expect, it } from "vitest";

import {
  addBriefReferenceCommand,
  addConfirmedDecisionCommand,
  applyEditorCommand,
  createEmptyEditorState,
  createEditorStateFromFrameSeeds,
  createEditorStore,
  removeBriefReferenceCommand,
  removeConfirmedDecisionCommand,
  moveBriefFrameCommand,
  selectBriefFrameCommand,
  startBrainstormSessionCommand,
  updateBriefFieldCommand,
  updateBriefReferenceCommand,
  updateConfirmedDecisionCommand,
} from "../editor";
import { EditorReducerError } from "../editor/reducer";

const start = startBrainstormSessionCommand({
  sessionId: "session-1",
  briefFrameId: "brief-1",
  position: { x: 20, y: 30 },
});

function startedState() {
  return applyEditorCommand(createEmptyEditorState(), start);
}

describe("brainstorm session editor integration", () => {
  it("starts once, creates the canonical Brief Frame, and selects it", () => {
    const initial = createEmptyEditorState();
    const next = applyEditorCommand(initial, start);

    expect(initial.session.lifecycle).toBe("not-started");
    expect(next.session).toMatchObject({
      lifecycle: "briefing",
      sessionId: "session-1",
      revision: 1,
      selection: { type: "brief-frame", briefFrameId: "brief-1" },
    });
    expect(next.session.briefFrame).toMatchObject({
      id: "brief-1",
      kind: "brief",
      name: "Project brief",
      x: 20,
      y: 30,
      width: 520,
      height: 720,
      revision: 1,
    });
    expect(() => applyEditorCommand(next, start)).toThrowError(EditorReducerError);
  });

  it("updates brief fields immutably and increments both revisions", () => {
    const initial = startedState();
    const next = applyEditorCommand(initial, updateBriefFieldCommand({
      field: "projectDescription",
      value: "A planning tool for small teams.",
    }, 1));

    expect(next.session.revision).toBe(2);
    expect(next.session.briefFrame?.revision).toBe(2);
    expect(next.session.briefFrame?.content.projectDescription).toBe("A planning tool for small teams.");
    expect(initial.session.briefFrame?.content.projectDescription).toBe("");
    expect(applyEditorCommand(next, updateBriefFieldCommand({
      field: "projectDescription",
      value: "A planning tool for small teams.",
    }, 2))).toBe(next);

    const withCriteria = applyEditorCommand(next, updateBriefFieldCommand({
      field: "successCriteria",
      value: ["A user can finish the first brief in five minutes"],
    }, 2));
    const withFeatures = applyEditorCommand(withCriteria, updateBriefFieldCommand({
      field: "requiredFeatures",
      value: ["Collaborative notes"],
    }, 3));
    expect(withFeatures.session.briefFrame?.content).toMatchObject({
      successCriteria: ["A user can finish the first brief in five minutes"],
      requiredFeatures: ["Collaborative notes"],
      goals: [],
      requiredContent: [],
    });
  });

  it("adds, updates, and removes references and decisions", () => {
    let state = startedState();
    state = applyEditorCommand(state, addBriefReferenceCommand({ id: "ref-1", label: "Example", url: "https://example.com", note: "Tone" }, 1));
    state = applyEditorCommand(state, updateBriefReferenceCommand({ referenceId: "ref-1", patch: { note: "Updated" }, expectedRevision: 2 }));
    expect(state.session.briefFrame?.content.references).toEqual([
      { id: "ref-1", label: "Example", url: "https://example.com", note: "Updated" },
    ]);
    state = applyEditorCommand(state, removeBriefReferenceCommand("ref-1", 3));
    expect(state.session.briefFrame?.content.references).toEqual([]);

    state = applyEditorCommand(state, addConfirmedDecisionCommand({ id: "decision-1", statement: "Use a focused brief", rationale: "Keeps the first turn clear" }, 4));
    state = applyEditorCommand(state, updateConfirmedDecisionCommand({ decisionId: "decision-1", patch: { rationale: "Keeps the opening focused" }, expectedRevision: 5 }));
    expect(state.session.briefFrame?.content.confirmedDecisions).toEqual([
      { id: "decision-1", statement: "Use a focused brief", rationale: "Keeps the opening focused" },
    ]);
    state = applyEditorCommand(state, removeConfirmedDecisionCommand("decision-1", 6));
    expect(state.session.briefFrame?.content.confirmedDecisions).toEqual([]);
  });

  it("rejects stale updates and duplicate stable ids without changing state", () => {
    const initial = startedState();
    expect(() => applyEditorCommand(initial, updateBriefFieldCommand({ field: "audience", value: "Teams" }, 0)))
      .toThrow("Stale brainstorm session revision");

    const withReference = applyEditorCommand(initial, addBriefReferenceCommand({ id: "ref-1", label: "One", url: "https://one.example", note: "" }, 1));
    expect(() => applyEditorCommand(withReference, addBriefReferenceCommand({ id: "ref-1", label: "Two", url: "https://two.example", note: "" }, 2)))
      .toThrow("already exists");
    expect(withReference.session.revision).toBe(2);
    expect(() => applyEditorCommand(initial, selectBriefFrameCommand("missing"))).toThrow("Unknown Brief Frame");
  });

  it("rejects non-finite Brief Frame coordinates at session start", () => {
    expect(() => applyEditorCommand(createEmptyEditorState(), startBrainstormSessionCommand({
      sessionId: "session-1",
      briefFrameId: "brief-1",
      position: { x: Number.NaN, y: 0 },
    }))).toThrow("Brief Frame x must be a finite number");
    expect(() => applyEditorCommand(createEmptyEditorState(), startBrainstormSessionCommand({
      sessionId: "session-1",
      briefFrameId: "brief-1",
      position: { x: 0, y: Number.POSITIVE_INFINITY },
    }))).toThrow("Brief Frame y must be a finite number");
  });

  it("selects and clears the Brief Frame without affecting content revision", () => {
    const initial = startedState();
    const cleared = applyEditorCommand(initial, selectBriefFrameCommand(null));
    expect(cleared.session.selection).toEqual({ type: "none" });
    expect(cleared.session.revision).toBe(initial.session.revision);
    expect(applyEditorCommand(cleared, selectBriefFrameCommand(null))).toBe(cleared);
    const selected = applyEditorCommand(cleared, selectBriefFrameCommand("brief-1"));
    expect(selected.session.selection).toEqual({ type: "brief-frame", briefFrameId: "brief-1" });
  });

  it("moves the Brief Frame through a revisioned editor command", () => {
    const initial = startedState();
    const next = applyEditorCommand(initial, moveBriefFrameCommand({ position: { x: 140, y: 190 }, expectedRevision: 1 }));
    expect(next.session.briefFrame).toMatchObject({ x: 140, y: 190, revision: 2 });
    expect(next.session.revision).toBe(2);
    expect(applyEditorCommand(next, moveBriefFrameCommand({ position: { x: 140, y: 190 }, expectedRevision: 2 }))).toBe(next);
  });

  it("records session commands in editor history and restores them", () => {
    const store = createEditorStore(createEmptyEditorState());
    store.execute(start);
    store.execute(updateBriefFieldCommand({ field: "audience", value: "Founders" }, 1));
    expect(store.getState().session.briefFrame?.content.audience).toBe("Founders");
    expect(store.undo()).toBe(true);
    expect(store.getState().session.briefFrame?.content.audience).toBe("");
    expect(store.undo()).toBe(true);
    expect(store.getState().session.briefFrame).toBeNull();
    expect(store.redo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.getState().session.briefFrame?.content.audience).toBe("Founders");
  });

  it("keeps ordinary frame-seed compatibility while adding default session state", () => {
    const state = createEditorStateFromFrameSeeds([{
      id: "frame-1",
      name: "Frame 1",
      documentId: "document-1",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      srcDoc: "<html />",
      background: "#fff",
    }]);
    expect(state.session.lifecycle).toBe("not-started");
    expect(state.frames["frame-1"]).toBeDefined();
  });
});
