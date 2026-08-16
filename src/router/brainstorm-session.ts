import {
  addBriefReferenceCommand,
  addConfirmedDecisionCommand,
  removeBriefReferenceCommand,
  removeConfirmedDecisionCommand,
  startBrainstormSessionCommand,
  transitionBrainstormSessionCommand,
  updateBriefFieldCommand,
  updateBriefReferenceCommand,
  updateConfirmedDecisionCommand,
} from "../editor/commands";
import { EditorReducerError } from "../editor/reducer";
import type { EditorStore } from "../editor/store";
import {
  BrainstormSessionReducerError,
  type BrainstormSessionReducerErrorCode,
} from "../session/reducer";
import type {
  BrainstormSessionLifecycle,
  BrainstormSessionState,
  BrainstormSessionTransitionTarget,
  BriefFieldUpdate,
  BriefFrame,
  BriefReference,
  ConfirmedDecision,
  StartBrainstormSessionOptions,
} from "../session/model";

export const BRAINSTORM_OPENING_PROMPT =
  "Alright—let’s understand the project first. What are you making, who is it for, and what should it help them do?";

export type BrainstormSessionErrorCode =
  | "invalid-revision"
  | "stale-revision"
  | "session-not-started"
  | "session-already-started"
  | "invalid-lifecycle-transition"
  | "reference-not-found"
  | "decision-not-found"
  | "duplicate-reference-id"
  | "duplicate-decision-id"
  | "invalid-input"
  | "reducer-failure";

export interface BrainstormSessionSnapshot {
  kind: BrainstormSessionState["kind"];
  schemaVersion: BrainstormSessionState["schemaVersion"];
  lifecycle: BrainstormSessionLifecycle;
  sessionId: string | null;
  revision: number;
  briefFrame: BriefFrame | null;
}

export interface BrainstormSessionMutationResult {
  previousRevision: number;
  revision: number;
  changed: boolean;
  snapshot: BrainstormSessionSnapshot;
}

export interface StartBrainstormSessionInput extends StartBrainstormSessionOptions {
  expectedRevision: number;
}

export type UpdateBriefFieldInput = BriefFieldUpdate & {
  expectedRevision: number;
};

export interface AddBriefReferenceInput {
  expectedRevision: number;
  reference: BriefReference;
}

export interface UpdateBriefReferenceInput {
  expectedRevision: number;
  referenceId: string;
  patch: Partial<Pick<BriefReference, "label" | "url" | "note">>;
}

export interface RemoveBriefReferenceInput {
  expectedRevision: number;
  referenceId: string;
}

export interface AddConfirmedDecisionInput {
  expectedRevision: number;
  decision: ConfirmedDecision;
}

export interface UpdateConfirmedDecisionInput {
  expectedRevision: number;
  decisionId: string;
  patch: Partial<Pick<ConfirmedDecision, "statement" | "rationale">>;
}

export interface RemoveConfirmedDecisionInput {
  expectedRevision: number;
  decisionId: string;
}

export interface TransitionBrainstormSessionInput {
  expectedRevision: number;
  to: BrainstormSessionTransitionTarget;
}

export class BrainstormSessionServiceError extends Error {
  readonly code: BrainstormSessionErrorCode;

  constructor(code: BrainstormSessionErrorCode, message: string) {
    super(message);
    this.name = "BrainstormSessionServiceError";
    this.code = code;
  }
}

function cloneBriefFrame(briefFrame: BriefFrame | null): BriefFrame | null {
  if (!briefFrame) return null;
  return {
    ...briefFrame,
    content: {
      ...briefFrame.content,
      goals: [...briefFrame.content.goals],
      successCriteria: [...briefFrame.content.successCriteria],
      requiredFeatures: [...briefFrame.content.requiredFeatures],
      requiredContent: [...briefFrame.content.requiredContent],
      constraints: [...briefFrame.content.constraints],
      references: briefFrame.content.references.map((reference) => ({ ...reference })),
      openQuestions: [...briefFrame.content.openQuestions],
      confirmedDecisions: briefFrame.content.confirmedDecisions.map((decision) => ({ ...decision })),
    },
  };
}

function createSnapshot(session: BrainstormSessionState): BrainstormSessionSnapshot {
  return {
    kind: session.kind,
    schemaVersion: session.schemaVersion,
    lifecycle: session.lifecycle,
    sessionId: session.sessionId,
    revision: session.revision,
    briefFrame: cloneBriefFrame(session.briefFrame),
  };
}

function validateExpectedRevision(expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new BrainstormSessionServiceError(
      "invalid-revision",
      "Expected brainstorm session revision must be a non-negative safe integer",
    );
  }
}

function mapReducerError(error: unknown): BrainstormSessionServiceError {
  const reducerError = error instanceof BrainstormSessionReducerError
    ? error
    : error instanceof EditorReducerError && error.cause instanceof BrainstormSessionReducerError
      ? error.cause
      : null;
  if (!reducerError) {
    const message = error instanceof Error ? error.message : "Brainstorm session mutation failed";
    return new BrainstormSessionServiceError("reducer-failure", message);
  }
  const codeMap: Record<BrainstormSessionReducerErrorCode, BrainstormSessionErrorCode> = {
    "invalid-revision": "invalid-revision",
    "stale-revision": "stale-revision",
    "session-not-started": "session-not-started",
    "session-already-started": "session-already-started",
    "invalid-lifecycle-transition": "invalid-lifecycle-transition",
    "brief-frame-not-found": "invalid-input",
    "reference-not-found": "reference-not-found",
    "decision-not-found": "decision-not-found",
    "duplicate-reference-id": "duplicate-reference-id",
    "duplicate-decision-id": "duplicate-decision-id",
    "invalid-input": "invalid-input",
    "session-state-invalid": "reducer-failure",
  };
  return new BrainstormSessionServiceError(codeMap[reducerError.code], reducerError.message);
}

function requireLifecycleTarget(target: string): asserts target is BrainstormSessionTransitionTarget {
  if (target !== "wireframing" && target !== "completed") {
    throw new BrainstormSessionServiceError(
      "invalid-lifecycle-transition",
      `Unsupported brainstorm lifecycle target: ${target}`,
    );
  }
}

/**
 * Transport-independent Codex boundary for Brainstorming Mode.
 * This service performs no model calls and does not expose UI, DOM, or history state.
 */
export class BrainstormSessionService {
  constructor(private readonly store: EditorStore) {}

  getSnapshot(): BrainstormSessionSnapshot {
    return createSnapshot(this.store.getState().session);
  }

  startSession(input: StartBrainstormSessionInput): BrainstormSessionMutationResult {
    return this.mutate({
      expectedRevision: input.expectedRevision,
      label: "Start Brainstorm session",
      command: startBrainstormSessionCommand({
        sessionId: input.sessionId,
        briefFrameId: input.briefFrameId,
        name: input.name,
        position: input.position,
        size: input.size,
        content: input.content,
      }, input.expectedRevision),
    });
  }

  updateBriefField(input: UpdateBriefFieldInput): BrainstormSessionMutationResult {
    return this.mutate({
      expectedRevision: input.expectedRevision,
      label: `Update brief field ${input.field}`,
      command: updateBriefFieldCommand(
        { field: input.field, value: input.value } as BriefFieldUpdate,
        input.expectedRevision,
      ),
    });
  }

  addReference(input: AddBriefReferenceInput): BrainstormSessionMutationResult {
    return this.mutate({
      expectedRevision: input.expectedRevision,
      label: "Add brief reference",
      command: addBriefReferenceCommand(input.reference, input.expectedRevision),
    });
  }

  updateReference(input: UpdateBriefReferenceInput): BrainstormSessionMutationResult {
    return this.mutate({
      expectedRevision: input.expectedRevision,
      label: "Update brief reference",
      command: updateBriefReferenceCommand(input),
    });
  }

  removeReference(input: RemoveBriefReferenceInput): BrainstormSessionMutationResult {
    return this.mutate({
      expectedRevision: input.expectedRevision,
      label: "Remove brief reference",
      command: removeBriefReferenceCommand(input.referenceId, input.expectedRevision),
    });
  }

  addDecision(input: AddConfirmedDecisionInput): BrainstormSessionMutationResult {
    return this.mutate({
      expectedRevision: input.expectedRevision,
      label: "Add confirmed decision",
      command: addConfirmedDecisionCommand(input.decision, input.expectedRevision),
    });
  }

  updateDecision(input: UpdateConfirmedDecisionInput): BrainstormSessionMutationResult {
    return this.mutate({
      expectedRevision: input.expectedRevision,
      label: "Update confirmed decision",
      command: updateConfirmedDecisionCommand(input),
    });
  }

  removeDecision(input: RemoveConfirmedDecisionInput): BrainstormSessionMutationResult {
    return this.mutate({
      expectedRevision: input.expectedRevision,
      label: "Remove confirmed decision",
      command: removeConfirmedDecisionCommand(input.decisionId, input.expectedRevision),
    });
  }

  transitionLifecycle(input: TransitionBrainstormSessionInput): BrainstormSessionMutationResult {
    requireLifecycleTarget(input.to);
    return this.mutate({
      expectedRevision: input.expectedRevision,
      label: `Transition Brainstorm session to ${input.to}`,
      command: transitionBrainstormSessionCommand(input.to, input.expectedRevision),
    });
  }

  private mutate(options: {
    expectedRevision: number;
    label: string;
    command: Parameters<EditorStore["execute"]>[0];
  }): BrainstormSessionMutationResult {
    const before = this.store.getState().session;
    validateExpectedRevision(options.expectedRevision);
    if (before.revision !== options.expectedRevision) {
      throw new BrainstormSessionServiceError(
        "stale-revision",
        `Brainstorm session is at revision ${before.revision}, not ${options.expectedRevision}`,
      );
    }

    let changed: boolean;
    try {
      changed = this.store.execute(options.command, { label: options.label });
    } catch (error) {
      if (error instanceof EditorReducerError) throw mapReducerError(error);
      throw error;
    }
    const after = this.store.getState().session;
    return {
      previousRevision: before.revision,
      revision: after.revision,
      changed,
      snapshot: createSnapshot(after),
    };
  }
}
