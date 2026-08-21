import {
  createEmptyBriefContent,
  DEFAULT_BRIEF_FRAME_NAME,
  DEFAULT_BRIEF_FRAME_SIZE,
  type BrainstormSessionState,
  type BriefContent,
  type BriefField,
  type BriefFieldUpdate,
  type BriefListField,
  type BriefReference,
  type BriefTextField,
  type ConfirmedDecision,
  type StartBrainstormSessionOptions,
  type BrainstormSessionTransitionTarget,
} from "./model";

export type BrainstormSessionAction =
  | { type: "session/start"; options: StartBrainstormSessionOptions; expectedRevision?: number }
  | { type: "session/brief-update"; update: BriefFieldUpdate; expectedRevision?: number }
  | { type: "session/reference-add"; reference: BriefReference; expectedRevision?: number }
  | {
      type: "session/reference-update";
      referenceId: string;
      patch: Partial<Pick<BriefReference, "label" | "url" | "note">>;
      expectedRevision?: number;
    }
  | { type: "session/reference-remove"; referenceId: string; expectedRevision?: number }
  | { type: "session/decision-add"; decision: ConfirmedDecision; expectedRevision?: number }
  | {
      type: "session/decision-update";
      decisionId: string;
      patch: Partial<Pick<ConfirmedDecision, "statement" | "rationale">>;
      expectedRevision?: number;
    }
  | { type: "session/decision-remove"; decisionId: string; expectedRevision?: number }
  | { type: "session/wireframe-created"; expectedRevision?: number }
  | { type: "session/lifecycle-transition"; to: BrainstormSessionTransitionTarget; expectedRevision?: number }
  | { type: "session/brief-select"; briefFrameId: string | null }
  | {
      type: "session/brief-move";
      position: { x: number; y: number };
      expectedRevision?: number;
    };

export type BrainstormSessionReducerErrorCode =
  | "invalid-revision"
  | "stale-revision"
  | "session-not-started"
  | "session-already-started"
  | "invalid-lifecycle-transition"
  | "brief-frame-not-found"
  | "reference-not-found"
  | "decision-not-found"
  | "duplicate-reference-id"
  | "duplicate-decision-id"
  | "invalid-input"
  | "session-state-invalid";

export class BrainstormSessionReducerError extends Error {
  readonly code: BrainstormSessionReducerErrorCode;

  constructor(code: BrainstormSessionReducerErrorCode, message: string) {
    super(message);
    this.name = "BrainstormSessionReducerError";
    this.code = code;
  }
}

export function createBrainstormSessionReducerError(
  code: BrainstormSessionReducerErrorCode,
  message: string,
): BrainstormSessionReducerError {
  return new BrainstormSessionReducerError(code, message);
}

function requireBrainstormSession(state: BrainstormSessionState): BrainstormSessionState {
  if (state.lifecycle === "not-started" || !state.sessionId) {
    throw new BrainstormSessionReducerError(
      "session-not-started",
      "Brainstorm session has not started",
    );
  }
  if (!state.briefFrame) {
    throw new BrainstormSessionReducerError(
      "session-state-invalid",
      "Brainstorm session has no Brief Frame",
    );
  }
  return state;
}

function requireBriefFrame(state: BrainstormSessionState): NonNullable<BrainstormSessionState["briefFrame"]> {
  const session = requireBrainstormSession(state);
  if (!session.briefFrame) {
    throw new BrainstormSessionReducerError(
      "session-state-invalid",
      "Brainstorm session has no Brief Frame",
    );
  }
  return session.briefFrame;
}

function requireStableId(id: string, label: string): void {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new BrainstormSessionReducerError(
      "invalid-input",
      `${label} must be a non-empty stable id`,
    );
  }
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new BrainstormSessionReducerError("invalid-input", `${label} must be a finite number`);
  }
}

function requirePositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new BrainstormSessionReducerError(
      "invalid-input",
      `${label} must be a positive finite number`,
    );
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new BrainstormSessionReducerError("invalid-input", `${label} must be a string`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BrainstormSessionReducerError(
      "invalid-input",
      `${label} must be an array of strings`,
    );
  }
  return value as readonly string[];
}

/** Matches the import contract: empty URLs are allowed, otherwise http(s) only. */
function requireReferenceUrl(value: unknown, label: string): string {
  const url = requireString(value, label);
  if (url && !/^https?:\/\//i.test(url)) {
    throw new BrainstormSessionReducerError(
      "invalid-input",
      `${label} must be an http:// or https:// URL`,
    );
  }
  return url;
}

function validateReferencePayload(reference: BriefReference, label: string): void {
  requireStableId(reference.id, `${label} id`);
  requireString(reference.label, `${label} label`);
  requireReferenceUrl(reference.url, `${label} url`);
  requireString(reference.note, `${label} note`);
}

function validateDecisionPayload(decision: ConfirmedDecision, label: string): void {
  requireStableId(decision.id, `${label} id`);
  requireString(decision.statement, `${label} statement`);
  requireString(decision.rationale, `${label} rationale`);
}

const BRIEF_TEXT_FIELDS: readonly BriefTextField[] = [
  "projectDescription",
  "audience",
  "visualDirection",
];

const BRIEF_LIST_FIELDS: readonly BriefListField[] = [
  "goals",
  "successCriteria",
  "requiredFeatures",
  "requiredContent",
  "constraints",
  "openQuestions",
];

function isBriefTextField(field: BriefField): field is BriefTextField {
  return (BRIEF_TEXT_FIELDS as readonly string[]).includes(field);
}

function isBriefListField(field: BriefField): field is BriefListField {
  return (BRIEF_LIST_FIELDS as readonly string[]).includes(field);
}

/**
 * Validates untrusted brief content against the canonical field set. Explicit
 * allowlists keep inherited keys such as `__proto__` from passing through
 * object spreads, and type checks keep malformed payloads from corrupting
 * session state mid-mutation.
 */
function validateBriefContent(content: BriefContent): void {
  for (const field of BRIEF_TEXT_FIELDS) {
    requireString(content[field], `Brief field ${field}`);
  }
  for (const field of BRIEF_LIST_FIELDS) {
    requireStringArray(content[field], `Brief field ${field}`);
  }
  content.references.forEach((reference, index) =>
    validateReferencePayload(reference, `Brief reference ${index}`),
  );
  content.confirmedDecisions.forEach((decision, index) =>
    validateDecisionPayload(decision, `Confirmed decision ${index}`),
  );
}

function checkBrainstormRevision(
  session: BrainstormSessionState,
  expectedRevision: number | undefined,
): void {
  if (expectedRevision === undefined) return;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new BrainstormSessionReducerError(
      "invalid-revision",
      "Expected brainstorm session revision must be a non-negative safe integer",
    );
  }
  if (session.revision !== expectedRevision) {
    throw new BrainstormSessionReducerError(
      "stale-revision",
      `Stale brainstorm session revision: expected ${expectedRevision}, current ${session.revision}`,
    );
  }
}

function cloneBriefContent(content: BriefContent): BriefContent {
  return {
    ...content,
    goals: [...content.goals],
    successCriteria: [...content.successCriteria],
    requiredFeatures: [...content.requiredFeatures],
    requiredContent: [...content.requiredContent],
    constraints: [...content.constraints],
    references: content.references.map((reference) => ({ ...reference })),
    openQuestions: [...content.openQuestions],
    confirmedDecisions: content.confirmedDecisions.map((decision) => ({ ...decision })),
  };
}

function briefValuesEqual(
  current: string | readonly string[],
  next: string | readonly string[],
): boolean {
  if (Array.isArray(current) && Array.isArray(next)) {
    return current.length === next.length && current.every((value, index) => value === next[index]);
  }
  return current === next;
}

function updateBriefContent(
  state: BrainstormSessionState,
  content: BriefContent,
): BrainstormSessionState {
  const session = requireBrainstormSession(state);
  const briefFrame = session.briefFrame;
  if (!briefFrame) {
    throw new BrainstormSessionReducerError(
      "session-state-invalid",
      "Brainstorm session has no Brief Frame",
    );
  }
  return {
    ...session,
    revision: session.revision + 1,
    briefFrame: {
      ...briefFrame,
      revision: briefFrame.revision + 1,
      content: cloneBriefContent(content),
    },
  };
}

export function applyBrainstormSessionAction(
  state: BrainstormSessionState,
  action: BrainstormSessionAction,
): BrainstormSessionState {
  switch (action.type) {
    case "session/start": {
      const { options } = action;
      requireStableId(options.sessionId, "Brainstorm session id");
      requireStableId(options.briefFrameId, "Brief Frame id");
      if (options.sessionId === options.briefFrameId) {
        throw new BrainstormSessionReducerError(
          "invalid-input",
          "Brainstorm session id and Brief Frame id must differ",
        );
      }
      if (state.lifecycle !== "not-started") {
        throw new BrainstormSessionReducerError(
          "session-already-started",
          "A Brainstorm session has already started",
        );
      }
      checkBrainstormRevision(state, action.expectedRevision);
      const position = options.position ?? { x: 0, y: 0 };
      const size = options.size ?? DEFAULT_BRIEF_FRAME_SIZE;
      requireFinite(position.x, "Brief Frame x");
      requireFinite(position.y, "Brief Frame y");
      requirePositiveFinite(size.width, "Brief Frame width");
      requirePositiveFinite(size.height, "Brief Frame height");
      if (options.name !== undefined) requireString(options.name, "Brief Frame name");
      if (options.content) validateBriefContent(options.content);
      const content = options.content ? cloneBriefContent(options.content) : createEmptyBriefContent();
      const briefFrame = {
        id: options.briefFrameId,
        kind: "brief" as const,
        name: options.name?.trim() || DEFAULT_BRIEF_FRAME_NAME,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        revision: 1,
        content,
      };
      return {
        ...state,
        lifecycle: "briefing",
        sessionId: options.sessionId,
        revision: 1,
        briefFrame,
        selection: { type: "brief-frame", briefFrameId: briefFrame.id },
      };
    }

    case "session/brief-update": {
      const session = requireBrainstormSession(state);
      const briefFrame = requireBriefFrame(state);
      checkBrainstormRevision(session, action.expectedRevision);
      const update = action.update;
      // Explicit field allowlists reject unknown and inherited keys (e.g.
      // `__proto__`) before any spread can turn them into own properties.
      if (isBriefTextField(update.field)) {
        requireString(update.value, `Brief field ${update.field}`);
      } else if (isBriefListField(update.field)) {
        requireStringArray(update.value, `Brief field ${update.field}`);
      } else {
        throw new BrainstormSessionReducerError(
          "invalid-input",
          `Unknown Brief field: ${String(update.field)}`,
        );
      }
      const current = briefFrame.content[update.field];
      if (briefValuesEqual(current, update.value)) return state;
      const content = {
        ...briefFrame.content,
        [update.field]: Array.isArray(update.value)
          ? [...update.value]
          : update.value,
      } as BriefContent;
      return updateBriefContent(state, content);
    }

    case "session/reference-add": {
      const session = requireBrainstormSession(state);
      const briefFrame = requireBriefFrame(state);
      checkBrainstormRevision(session, action.expectedRevision);
      validateReferencePayload(action.reference, "Brief reference");
      if (briefFrame.content.references.some((reference) => reference.id === action.reference.id)) {
        throw new BrainstormSessionReducerError(
          "duplicate-reference-id",
          `Brief reference already exists: ${action.reference.id}`,
        );
      }
      return updateBriefContent(state, {
        ...briefFrame.content,
        references: [...briefFrame.content.references, { ...action.reference }],
      });
    }

    case "session/reference-update": {
      const session = requireBrainstormSession(state);
      const briefFrame = requireBriefFrame(state);
      checkBrainstormRevision(session, action.expectedRevision);
      const reference = briefFrame.content.references.find((item) => item.id === action.referenceId);
      if (!reference) {
        throw new BrainstormSessionReducerError(
          "reference-not-found",
          `Unknown brief reference: ${action.referenceId}`,
        );
      }
      if (action.patch.label !== undefined) requireString(action.patch.label, "Brief reference label");
      if (action.patch.url !== undefined) requireReferenceUrl(action.patch.url, "Brief reference url");
      if (action.patch.note !== undefined) requireString(action.patch.note, "Brief reference note");
      const nextReference = { ...reference, ...action.patch };
      if (nextReference.label === reference.label && nextReference.url === reference.url && nextReference.note === reference.note) return state;
      return updateBriefContent(state, {
        ...briefFrame.content,
        references: briefFrame.content.references.map((item) => item.id === reference.id ? nextReference : item),
      });
    }

    case "session/reference-remove": {
      const session = requireBrainstormSession(state);
      const briefFrame = requireBriefFrame(state);
      checkBrainstormRevision(session, action.expectedRevision);
      if (!briefFrame.content.references.some((reference) => reference.id === action.referenceId)) return state;
      return updateBriefContent(state, {
        ...briefFrame.content,
        references: briefFrame.content.references.filter((reference) => reference.id !== action.referenceId),
      });
    }

    case "session/decision-add": {
      const session = requireBrainstormSession(state);
      const briefFrame = requireBriefFrame(state);
      checkBrainstormRevision(session, action.expectedRevision);
      validateDecisionPayload(action.decision, "Confirmed decision");
      if (briefFrame.content.confirmedDecisions.some((decision) => decision.id === action.decision.id)) {
        throw new BrainstormSessionReducerError(
          "duplicate-decision-id",
          `Confirmed decision already exists: ${action.decision.id}`,
        );
      }
      return updateBriefContent(state, {
        ...briefFrame.content,
        confirmedDecisions: [...briefFrame.content.confirmedDecisions, { ...action.decision }],
      });
    }

    case "session/decision-update": {
      const session = requireBrainstormSession(state);
      const briefFrame = requireBriefFrame(state);
      checkBrainstormRevision(session, action.expectedRevision);
      const decision = briefFrame.content.confirmedDecisions.find((item) => item.id === action.decisionId);
      if (!decision) {
        throw new BrainstormSessionReducerError(
          "decision-not-found",
          `Unknown confirmed decision: ${action.decisionId}`,
        );
      }
      if (action.patch.statement !== undefined) requireString(action.patch.statement, "Confirmed decision statement");
      if (action.patch.rationale !== undefined) requireString(action.patch.rationale, "Confirmed decision rationale");
      const nextDecision = { ...decision, ...action.patch };
      if (nextDecision.statement === decision.statement && nextDecision.rationale === decision.rationale) return state;
      return updateBriefContent(state, {
        ...briefFrame.content,
        confirmedDecisions: briefFrame.content.confirmedDecisions.map((item) => item.id === decision.id ? nextDecision : item),
      });
    }

    case "session/decision-remove": {
      const session = requireBrainstormSession(state);
      const briefFrame = requireBriefFrame(state);
      checkBrainstormRevision(session, action.expectedRevision);
      if (!briefFrame.content.confirmedDecisions.some((decision) => decision.id === action.decisionId)) return state;
      return updateBriefContent(state, {
        ...briefFrame.content,
        confirmedDecisions: briefFrame.content.confirmedDecisions.filter((decision) => decision.id !== action.decisionId),
      });
    }

    case "session/wireframe-created": {
      const session = requireBrainstormSession(state);
      checkBrainstormRevision(session, action.expectedRevision);
      if (session.lifecycle !== "briefing" && session.lifecycle !== "wireframing") {
        throw new BrainstormSessionReducerError(
          "invalid-lifecycle-transition",
          `Cannot create a wireframe during the ${session.lifecycle} lifecycle`,
        );
      }
      return {
        ...session,
        lifecycle: "wireframing",
        revision: session.revision + 1,
      };
    }

    case "session/lifecycle-transition": {
      const session = requireBrainstormSession(state);
      checkBrainstormRevision(session, action.expectedRevision);
      const expectedFrom = action.to === "wireframing" ? "briefing" : "wireframing";
      if (session.lifecycle !== expectedFrom) {
        throw new BrainstormSessionReducerError(
          "invalid-lifecycle-transition",
          `Invalid brainstorm lifecycle transition from ${session.lifecycle} to ${action.to}`,
        );
      }
      return {
        ...session,
        lifecycle: action.to,
        revision: session.revision + 1,
      };
    }

    case "session/brief-select": {
      if (action.briefFrameId === null) {
        return state.selection.type === "none"
          ? state
          : { ...state, selection: { type: "none" } };
      }
      const session = requireBrainstormSession(state);
      const briefFrame = requireBriefFrame(state);
      if (briefFrame.id !== action.briefFrameId) {
        throw new BrainstormSessionReducerError(
          "brief-frame-not-found",
          `Unknown Brief Frame: ${action.briefFrameId}`,
        );
      }
      if (session.selection.type === "brief-frame" && session.selection.briefFrameId === action.briefFrameId) return state;
      return { ...session, selection: { type: "brief-frame", briefFrameId: action.briefFrameId } };
    }

    case "session/brief-move": {
      const session = requireBrainstormSession(state);
      const briefFrame = requireBriefFrame(state);
      checkBrainstormRevision(session, action.expectedRevision);
      requireFinite(action.position.x, "Brief Frame x");
      requireFinite(action.position.y, "Brief Frame y");
      if (briefFrame.x === action.position.x && briefFrame.y === action.position.y) return state;
      return {
        ...session,
        revision: session.revision + 1,
        briefFrame: {
          ...briefFrame,
          x: action.position.x,
          y: action.position.y,
          revision: briefFrame.revision + 1,
        },
      };
    }
  }
}
