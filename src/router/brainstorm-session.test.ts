import { describe, expect, it } from "vitest";

import { createEmptyEditorState, createEditorStore } from "../editor";
import { EditorReducerError } from "../editor/reducer";
import {
  BRAINSTORM_OPENING_PROMPT,
  BrainstormSessionService,
  BrainstormSessionServiceError,
} from "./brainstorm-session";
import { BrainstormSessionReducerError } from "../session/reducer";

function createService() {
  const store = createEditorStore(createEmptyEditorState());
  return { store, service: new BrainstormSessionService(store) };
}

function start(service: BrainstormSessionService) {
  return service.startSession({
    expectedRevision: 0,
    sessionId: "session-1",
    briefFrameId: "brief-1",
    position: { x: 32, y: -14 },
    content: {
      projectDescription: "A small-team planning tool",
      audience: "Product teams",
      goals: ["Align quickly"],
      successCriteria: ["A brief is ready in one session"],
      requiredFeatures: ["Editable brief"],
      requiredContent: ["Project context"],
      visualDirection: "Quiet and structured",
      constraints: ["Browser-first"],
      references: [],
      openQuestions: ["Which teams go first?"],
      confirmedDecisions: [],
    },
  });
}

function expectServiceError(callback: () => unknown, code: BrainstormSessionServiceError["code"]) {
  expect(callback).toThrowError(expect.objectContaining({ code }));
}

describe("Codex Brainstorm Session service", () => {
  it("returns a bounded canonical snapshot and starts with caller-provided IDs", () => {
    const { service } = createService();

    expect(BRAINSTORM_OPENING_PROMPT).toBe(
      "Alright—let’s understand the project first. What are you making, who is it for, and what should it help them do?",
    );
    expect(service.getSnapshot()).toEqual({
      kind: "brainstorm-session",
      schemaVersion: 1,
      lifecycle: "not-started",
      sessionId: null,
      revision: 0,
      briefFrame: null,
    });

    const result = start(service);
    expect(result).toMatchObject({ previousRevision: 0, revision: 1, changed: true });
    expect(result.snapshot).toMatchObject({
      sessionId: "session-1",
      lifecycle: "briefing",
      revision: 1,
      briefFrame: {
        id: "brief-1",
        x: 32,
        y: -14,
        revision: 1,
        content: expect.objectContaining({
          successCriteria: ["A brief is ready in one session"],
          requiredFeatures: ["Editable brief"],
        }),
      },
    });
    expect(result.snapshot).not.toHaveProperty("selection");
    expect(result.snapshot).not.toHaveProperty("history");
  });

  it("requires a valid expected revision and translates stale writes", () => {
    const { service } = createService();

    expectServiceError(
      () => service.startSession({ expectedRevision: -1, sessionId: "s", briefFrameId: "b" }),
      "invalid-revision",
    );
    expectServiceError(
      () => service.startSession({ expectedRevision: 1, sessionId: "s", briefFrameId: "b" }),
      "stale-revision",
    );
    start(service);
    expectServiceError(
      () => service.updateBriefField({ expectedRevision: 0, field: "audience", value: "Designers" }),
      "stale-revision",
    );
    expect(service.getSnapshot().revision).toBe(1);
  });

  it("updates each brief field through one revisioned mutation and no-ops identical values", () => {
    const { service, store } = createService();
    start(service);

    const changed = service.updateBriefField({
      expectedRevision: 1,
      field: "successCriteria",
      value: ["Teams can agree on the first release"],
    });
    expect(changed).toMatchObject({ previousRevision: 1, revision: 2, changed: true });
    const noOp = service.updateBriefField({
      expectedRevision: 2,
      field: "successCriteria",
      value: ["Teams can agree on the first release"],
    });
    expect(noOp).toMatchObject({ previousRevision: 2, revision: 2, changed: false });
    expect(store.getHistory().past).toHaveLength(2);
  });

  it("round-trips reference mutations with stable IDs and typed failures", () => {
    const { service } = createService();
    start(service);

    const added = service.addReference({
      expectedRevision: 1,
      reference: { id: "ref-1", label: "Inspiration", url: "https://example.com", note: "Tone" },
    });
    expect(added).toMatchObject({ previousRevision: 1, revision: 2, changed: true });

    const updated = service.updateReference({
      expectedRevision: 2,
      referenceId: "ref-1",
      patch: { note: "Updated tone" },
    });
    expect(updated.snapshot.briefFrame?.content.references).toEqual([
      { id: "ref-1", label: "Inspiration", url: "https://example.com", note: "Updated tone" },
    ]);

    const noOp = service.updateReference({
      expectedRevision: 3,
      referenceId: "ref-1",
      patch: { note: "Updated tone" },
    });
    expect(noOp.changed).toBe(false);
    expect(noOp.revision).toBe(3);

    const removed = service.removeReference({ expectedRevision: 3, referenceId: "ref-1" });
    expect(removed).toMatchObject({ previousRevision: 3, revision: 4, changed: true });
    expectServiceError(
      () => service.updateReference({ expectedRevision: 4, referenceId: "missing", patch: { note: "Nope" } }),
      "reference-not-found",
    );
  });

  it("round-trips confirmed decision mutations with stable IDs and typed failures", () => {
    const { service } = createService();
    start(service);

    const added = service.addDecision({
      expectedRevision: 1,
      decision: { id: "decision-1", statement: "Start with a brief", rationale: "Keeps the first turn focused" },
    });
    expect(added.revision).toBe(2);
    const updated = service.updateDecision({
      expectedRevision: 2,
      decisionId: "decision-1",
      patch: { rationale: "Makes the opening actionable" },
    });
    expect(updated.snapshot.briefFrame?.content.confirmedDecisions).toEqual([
      { id: "decision-1", statement: "Start with a brief", rationale: "Makes the opening actionable" },
    ]);
    const removed = service.removeDecision({ expectedRevision: 3, decisionId: "decision-1" });
    expect(removed).toMatchObject({ previousRevision: 3, revision: 4, changed: true });
    expectServiceError(
      () => service.updateDecision({ expectedRevision: 4, decisionId: "missing", patch: { statement: "Nope" } }),
      "decision-not-found",
    );
  });

  it("translates duplicate and invalid-input reducer failures into stable service errors", () => {
    const { service } = createService();
    start(service);
    service.addReference({ expectedRevision: 1, reference: { id: "ref-1", label: "One", url: "", note: "" } });
    expectServiceError(
      () => service.addReference({ expectedRevision: 2, reference: { id: "ref-1", label: "Two", url: "", note: "" } }),
      "duplicate-reference-id",
    );
    expectServiceError(
      () => service.startSession({ expectedRevision: 2, sessionId: "session-2", briefFrameId: "brief-2" }),
      "session-already-started",
    );
  });

  it("rejects untrusted brief payloads with typed errors and without corrupting state", () => {
    const { service, store } = createService();
    start(service);

    // Inherited keys must not pass the field allowlist or pollute content.
    expectServiceError(
      () => service.updateBriefField({ expectedRevision: 1, field: "__proto__" as never, value: { polluted: true } as never }),
      "invalid-input",
    );
    expect({ ...Object.getOwnPropertyNames(store.getState().session.briefFrame!.content) }).not.toContain("__proto__");

    // List fields reject strings (which would otherwise be char-split) and
    // non-iterable values (which would otherwise escape as raw TypeErrors).
    expectServiceError(
      () => service.updateBriefField({ expectedRevision: 1, field: "goals", value: "not-an-array" as never }),
      "invalid-input",
    );
    expectServiceError(
      () => service.updateBriefField({ expectedRevision: 1, field: "goals", value: 5 as never }),
      "invalid-input",
    );
    expectServiceError(
      () => service.updateBriefField({ expectedRevision: 1, field: "projectDescription", value: 42 as never }),
      "invalid-input",
    );

    const snapshot = service.getSnapshot();
    expect(snapshot.revision).toBe(1);
    expect(snapshot.briefFrame?.content.goals).toEqual(["Align quickly"]);
    expect(store.getHistory().past).toHaveLength(1);
  });

  it("enforces the http(s)-only reference URL contract on the live path", () => {
    const { service, store } = createService();
    start(service);

    expectServiceError(
      () => service.addReference({ expectedRevision: 1, reference: { id: "ref-x", label: "Evil", url: "javascript:alert(1)", note: "" } }),
      "invalid-input",
    );
    expectServiceError(
      () => service.addReference({ expectedRevision: 1, reference: { id: "ref-y", label: 42 as never, url: "", note: "" } }),
      "invalid-input",
    );
    const fresh = createService();
    expectServiceError(
      () => fresh.service.startSession({
        expectedRevision: 0,
        sessionId: "session-9",
        briefFrameId: "brief-9",
        content: { references: [{ id: "r", label: "l", url: "data:text/html,x", note: "" }] } as never,
      }),
      "invalid-input",
    );

    // Empty URLs stay legal, matching the import contract.
    const added = service.addReference({ expectedRevision: 1, reference: { id: "ref-ok", label: "Later", url: "", note: "" } });
    expect(added.changed).toBe(true);
    expect(service.getSnapshot().revision).toBe(2);
    expect(store.getState().session.briefFrame!.content.references).toHaveLength(1);
  });

  it("allows only briefing to wireframing to completed transitions", () => {
    const { service, store } = createService();
    start(service);

    const wireframing = service.transitionLifecycle({ expectedRevision: 1, to: "wireframing" });
    expect(wireframing).toMatchObject({ previousRevision: 1, revision: 2, changed: true, snapshot: { lifecycle: "wireframing" } });
    const completed = service.transitionLifecycle({ expectedRevision: 2, to: "completed" });
    expect(completed).toMatchObject({ previousRevision: 2, revision: 3, changed: true, snapshot: { lifecycle: "completed" } });
    expect(store.getHistory().past).toHaveLength(3);

    expectServiceError(
      () => service.transitionLifecycle({ expectedRevision: 3, to: "wireframing" }),
      "invalid-lifecycle-transition",
    );
    expectServiceError(
      () => service.transitionLifecycle({ expectedRevision: 3, to: "completed" }),
      "invalid-lifecycle-transition",
    );
  });

  it("reports a typed not-started error without changing the store", () => {
    const { service, store } = createService();
    expectServiceError(
      () => service.updateBriefField({ expectedRevision: 0, field: "projectDescription", value: "Anything" }),
      "session-not-started",
    );
    expect(store.getHistory().past).toHaveLength(0);
    expect(service.getSnapshot().revision).toBe(0);
  });

  it("maps reducer causes structurally rather than by human-readable wording", () => {
    const { service } = createService();
    const reducerCause = new BrainstormSessionReducerError(
      "reference-not-found",
      "A deliberately different diagnostic wording",
    );
    const store = createEditorStore(createEmptyEditorState());
    const originalExecute = store.execute;
    store.execute = (() => {
      throw new EditorReducerError("adapter wording", { cause: reducerCause });
    }) as typeof originalExecute;
    const adaptedService = new BrainstormSessionService(store);

    expectServiceError(
      () => adaptedService.updateBriefField({ expectedRevision: 0, field: "audience", value: "Teams" }),
      "reference-not-found",
    );
  });
});
