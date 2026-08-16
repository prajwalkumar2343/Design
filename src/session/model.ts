export const BRAINSTORM_SESSION_SCHEMA_VERSION = 1 as const;
export const BRAINSTORM_SESSION_KIND = "brainstorm-session" as const;

export type BrainstormSessionLifecycle =
  | "not-started"
  | "briefing"
  | "wireframing"
  | "completed";

export type BrainstormSessionTransitionTarget = "wireframing" | "completed";

export type BriefTextField =
  | "projectDescription"
  | "audience"
  | "visualDirection";

export type BriefListField =
  | "goals"
  | "successCriteria"
  | "requiredFeatures"
  | "requiredContent"
  | "constraints"
  | "openQuestions";

export type BriefField = BriefTextField | BriefListField;

export interface BriefReference {
  id: string;
  label: string;
  url: string;
  note: string;
}

export interface ConfirmedDecision {
  id: string;
  statement: string;
  rationale: string;
}

export interface BriefContent {
  projectDescription: string;
  audience: string;
  goals: string[];
  successCriteria: string[];
  requiredFeatures: string[];
  requiredContent: string[];
  visualDirection: string;
  constraints: string[];
  references: BriefReference[];
  openQuestions: string[];
  confirmedDecisions: ConfirmedDecision[];
}

export type BriefFieldUpdate = {
  [Field in BriefField]: {
    field: Field;
    value: BriefContent[Field];
  };
}[BriefField];

export interface BriefFrame {
  id: string;
  kind: "brief";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  revision: number;
  content: BriefContent;
}

export type BrainstormSelection =
  | { type: "none" }
  | { type: "brief-frame"; briefFrameId: string };

export interface BrainstormSessionState {
  kind: typeof BRAINSTORM_SESSION_KIND;
  schemaVersion: typeof BRAINSTORM_SESSION_SCHEMA_VERSION;
  lifecycle: BrainstormSessionLifecycle;
  sessionId: string | null;
  /** Monotonically increases for every accepted session mutation. */
  revision: number;
  briefFrame: BriefFrame | null;
  selection: BrainstormSelection;
}

export interface StartBrainstormSessionOptions {
  sessionId: string;
  briefFrameId: string;
  name?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  content?: BriefContent;
}

export const DEFAULT_BRIEF_FRAME_NAME = "Project brief";
export const DEFAULT_BRIEF_FRAME_SIZE = { width: 520, height: 720 } as const;

export function createEmptyBriefContent(): BriefContent {
  return {
    projectDescription: "",
    audience: "",
    goals: [],
    successCriteria: [],
    requiredFeatures: [],
    requiredContent: [],
    visualDirection: "",
    constraints: [],
    references: [],
    openQuestions: [],
    confirmedDecisions: [],
  };
}

export function createEmptyBrainstormSession(): BrainstormSessionState {
  return {
    kind: BRAINSTORM_SESSION_KIND,
    schemaVersion: BRAINSTORM_SESSION_SCHEMA_VERSION,
    lifecycle: "not-started",
    sessionId: null,
    revision: 0,
    briefFrame: null,
    selection: { type: "none" },
  };
}
