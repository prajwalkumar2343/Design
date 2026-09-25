import { describe, expect, it } from "vitest";

import {
  createEmptyBrainstormSession,
  createEmptyBriefContent,
  type BrainstormSessionState,
  type BriefContent,
  type BriefFieldUpdate,
} from "./model";
import {
  applyBrainstormSessionAction,
  BrainstormSessionReducerError,
  type BrainstormSessionAction,
  type BrainstormSessionReducerErrorCode,
} from "./reducer";

function act(state: BrainstormSessionState, action: BrainstormSessionAction): BrainstormSessionState {
  return applyBrainstormSessionAction(state, action);
}

function expectError(
  state: BrainstormSessionState,
  action: BrainstormSessionAction,
  code: BrainstormSessionReducerErrorCode,
): void {
  let caught: unknown;
  try {
    applyBrainstormSessionAction(state, action);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BrainstormSessionReducerError);
  expect((caught as BrainstormSessionReducerError).code).toBe(code);
}

function started(): BrainstormSessionState {
  return act(createEmptyBrainstormSession(), {
    type: "session/start",
    options: {
      sessionId: "session-1",
      briefFrameId: "brief-1",
      position: { x: 20, y: 30 },
    },
  });
}

describe("session/start", () => {
  it("creates the brief frame with defaults, selects it, and enters briefing", () => {
    const next = started();

    expect(next).toMatchObject({
      lifecycle: "briefing",
      sessionId: "session-1",
      revision: 1,
      selection: { type: "brief-frame", briefFrameId: "brief-1" },
    });
    expect(next.briefFrame).toEqual({
      id: "brief-1",
      kind: "brief",
      name: "Project brief",
      x: 20,
      y: 30,
      width: 520,
      height: 720,
      revision: 1,
      content: createEmptyBriefContent(),
    });
  });

  it("honors explicit name, size, and content while cloning the content payload", () => {
    const content: BriefContent = { ...createEmptyBriefContent(), goals: ["Ship it"] };
    const next = act(createEmptyBrainstormSession(), {
      type: "session/start",
      options: {
        sessionId: "session-1",
        briefFrameId: "brief-1",
        name: "  Launch plan  ",
        size: { width: 640, height: 480 },
        content,
      },
    });

    expect(next.briefFrame).toMatchObject({ name: "Launch plan", width: 640, height: 480, x: 0, y: 0 });
    expect(next.briefFrame?.content.goals).toEqual(["Ship it"]);
    expect(next.briefFrame?.content.goals).not.toBe(content.goals);
  });

  it("rejects invalid start payloads with typed error codes", () => {
    const empty = createEmptyBrainstormSession();
    const options = { sessionId: "session-1", briefFrameId: "brief-1" };

    expectError(empty, { type: "session/start", options: { ...options, sessionId: " " } }, "invalid-input");
    expectError(empty, { type: "session/start", options: { sessionId: "same", briefFrameId: "same" } }, "invalid-input");
    expectError(empty, {
      type: "session/start",
      options: { ...options, position: { x: Number.NaN, y: 0 } },
    }, "invalid-input");
    expectError(empty, {
      type: "session/start",
      options: { ...options, size: { width: 0, height: 100 } },
    }, "invalid-input");
    expectError(empty, {
      type: "session/start",
      options,
      expectedRevision: -1,
    }, "invalid-revision");
    expectError(empty, {
      type: "session/start",
      options,
      expectedRevision: 4,
    }, "stale-revision");
    expectError(started(), { type: "session/start", options }, "session-already-started");
  });
});

describe("session/brief-update", () => {
  it("writes text and list fields immutably and bumps both revisions", () => {
    const initial = started();
    const next = act(initial, {
      type: "session/brief-update",
      update: { field: "projectDescription", value: "A tool for notes" },
      expectedRevision: 1,
    });

    expect(next.revision).toBe(2);
    expect(next.briefFrame?.revision).toBe(2);
    expect(next.briefFrame?.content.projectDescription).toBe("A tool for notes");
    expect(initial.briefFrame?.content.projectDescription).toBe("");

    const listed = act(next, {
      type: "session/brief-update",
      update: { field: "goals", value: ["Goal A", "Goal B"] },
      expectedRevision: 2,
    });
    expect(listed.briefFrame?.content.goals).toEqual(["Goal A", "Goal B"]);
  });

  it("returns the same state for an unchanged value and rejects bad inputs", () => {
    const initial = started();
    const same = act(initial, {
      type: "session/brief-update",
      update: { field: "audience", value: "" },
    });
    expect(same).toBe(initial);

    expectError(initial, {
      type: "session/brief-update",
      update: { field: "mystery", value: "x" } as unknown as BriefFieldUpdate,
    }, "invalid-input");
    expectError(initial, {
      type: "session/brief-update",
      update: { field: "goals", value: "not-an-array" } as unknown as BriefFieldUpdate,
    }, "invalid-input");
    expectError(initial, {
      type: "session/brief-update",
      update: { field: "audience", value: "Teams" },
      expectedRevision: 0,
    }, "stale-revision");
  });
});

describe("session references", () => {
  const reference = { id: "ref-1", label: "Spec", url: "https://example.com/spec", note: "Tone" };

  it("adds, patches, and removes references", () => {
    let state = started();
    state = act(state, { type: "session/reference-add", reference, expectedRevision: 1 });
    expect(state.briefFrame?.content.references).toEqual([reference]);

    state = act(state, {
      type: "session/reference-update",
      referenceId: "ref-1",
      patch: { note: "Updated" },
      expectedRevision: 2,
    });
    expect(state.briefFrame?.content.references).toEqual([
      { id: "ref-1", label: "Spec", url: "https://example.com/spec", note: "Updated" },
    ]);

    const unchanged = act(state, {
      type: "session/reference-update",
      referenceId: "ref-1",
      patch: { note: "Updated" },
      expectedRevision: 3,
    });
    expect(unchanged).toBe(state);

    state = act(state, { type: "session/reference-remove", referenceId: "ref-1", expectedRevision: 3 });
    expect(state.briefFrame?.content.references).toEqual([]);

    expect(act(state, { type: "session/reference-remove", referenceId: "missing" })).toBe(state);
  });

  it("rejects duplicates, unknown ids, and non-http URLs", () => {
    const withRef = act(started(), { type: "session/reference-add", reference });

    expectError(withRef, { type: "session/reference-add", reference }, "duplicate-reference-id");
    expectError(withRef, {
      type: "session/reference-update",
      referenceId: "missing",
      patch: { note: "x" },
    }, "reference-not-found");
    expectError(started(), {
      type: "session/reference-add",
      reference: { ...reference, url: "ftp://files.example" },
    }, "invalid-input");
    expectError(withRef, {
      type: "session/reference-update",
      referenceId: "ref-1",
      patch: { url: "javascript:alert(1)" },
    }, "invalid-input");
    expectError(started(), {
      type: "session/reference-add",
      reference: { ...reference, id: "" },
    }, "invalid-input");
  });
});

describe("session decisions", () => {
  const decision = { id: "decision-1", statement: "Use a single page", rationale: "Keeps scope small" };

  it("adds, patches, and removes confirmed decisions", () => {
    let state = started();
    state = act(state, { type: "session/decision-add", decision, expectedRevision: 1 });
    expect(state.briefFrame?.content.confirmedDecisions).toEqual([decision]);

    state = act(state, {
      type: "session/decision-update",
      decisionId: "decision-1",
      patch: { rationale: "Focus" },
      expectedRevision: 2,
    });
    expect(state.briefFrame?.content.confirmedDecisions).toEqual([
      { id: "decision-1", statement: "Use a single page", rationale: "Focus" },
    ]);

    const unchanged = act(state, {
      type: "session/decision-update",
      decisionId: "decision-1",
      patch: { rationale: "Focus" },
      expectedRevision: 3,
    });
    expect(unchanged).toBe(state);

    state = act(state, { type: "session/decision-remove", decisionId: "decision-1", expectedRevision: 3 });
    expect(state.briefFrame?.content.confirmedDecisions).toEqual([]);

    expect(act(state, { type: "session/decision-remove", decisionId: "missing" })).toBe(state);
  });

  it("rejects duplicates and unknown ids", () => {
    const withDecision = act(started(), { type: "session/decision-add", decision });

    expectError(withDecision, { type: "session/decision-add", decision }, "duplicate-decision-id");
    expectError(withDecision, {
      type: "session/decision-update",
      decisionId: "missing",
      patch: { rationale: "x" },
    }, "decision-not-found");
  });
});

describe("session lifecycle", () => {
  it("walks briefing → wireframing → completed in order", () => {
    let state = started();
    state = act(state, { type: "session/lifecycle-transition", to: "wireframing", expectedRevision: 1 });
    expect(state.lifecycle).toBe("wireframing");
    expect(state.revision).toBe(2);

    state = act(state, { type: "session/lifecycle-transition", to: "completed", expectedRevision: 2 });
    expect(state.lifecycle).toBe("completed");
    expect(state.revision).toBe(3);
  });

  it("rejects out-of-order transitions and wireframes on a completed session", () => {
    expectError(started(), {
      type: "session/lifecycle-transition",
      to: "completed",
    }, "invalid-lifecycle-transition");

    const completed = act(
      act(started(), { type: "session/lifecycle-transition", to: "wireframing" }),
      { type: "session/lifecycle-transition", to: "completed" },
    );
    expectError(completed, { type: "session/wireframe-created" }, "invalid-lifecycle-transition");
    expectError(completed, {
      type: "session/lifecycle-transition",
      to: "wireframing",
    }, "invalid-lifecycle-transition");
  });

  it("marks the session wireframing on wireframe-created during briefing", () => {
    const next = act(started(), { type: "session/wireframe-created", expectedRevision: 1 });
    expect(next.lifecycle).toBe("wireframing");
    expect(next.revision).toBe(2);
  });
});

describe("session brief selection and movement", () => {
  it("selects, re-selects, and clears the brief frame", () => {
    const initial = started();
    const cleared = act(initial, { type: "session/brief-select", briefFrameId: null });
    expect(cleared.selection).toEqual({ type: "none" });
    expect(act(cleared, { type: "session/brief-select", briefFrameId: null })).toBe(cleared);

    const selected = act(cleared, { type: "session/brief-select", briefFrameId: "brief-1" });
    expect(selected.selection).toEqual({ type: "brief-frame", briefFrameId: "brief-1" });
    expect(act(selected, { type: "session/brief-select", briefFrameId: "brief-1" })).toBe(selected);

    expectError(selected, { type: "session/brief-select", briefFrameId: "other" }, "brief-frame-not-found");
  });

  it("moves the brief frame with finite coordinates and revision bumps", () => {
    const initial = started();
    const next = act(initial, {
      type: "session/brief-move",
      position: { x: 140, y: 190 },
      expectedRevision: 1,
    });

    expect(next.briefFrame).toMatchObject({ x: 140, y: 190, revision: 2 });
    expect(next.revision).toBe(2);
    expect(act(next, {
      type: "session/brief-move",
      position: { x: 140, y: 190 },
      expectedRevision: 2,
    })).toBe(next);
    expectError(initial, {
      type: "session/brief-move",
      position: { x: Number.POSITIVE_INFINITY, y: 0 },
    }, "invalid-input");
  });
});

describe("guards on a not-started session", () => {
  it("throws session-not-started for every mutating action", () => {
    const empty = createEmptyBrainstormSession();

    expectError(empty, {
      type: "session/brief-update",
      update: { field: "audience", value: "x" },
    }, "session-not-started");
    expectError(empty, { type: "session/reference-remove", referenceId: "ref" }, "session-not-started");
    expectError(empty, {
      type: "session/decision-add",
      decision: { id: "d", statement: "s", rationale: "r" },
    }, "session-not-started");
    expectError(empty, { type: "session/wireframe-created" }, "session-not-started");
    expectError(empty, { type: "session/lifecycle-transition", to: "wireframing" }, "session-not-started");
    expectError(empty, { type: "session/brief-select", briefFrameId: "brief-1" }, "session-not-started");
    expectError(empty, { type: "session/brief-move", position: { x: 1, y: 1 } }, "session-not-started");

    expect(act(empty, { type: "session/brief-select", briefFrameId: null })).toBe(empty);
  });
});
