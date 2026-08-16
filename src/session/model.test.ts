import { describe, expect, it } from "vitest";

import {
  BRAINSTORM_SESSION_KIND,
  BRAINSTORM_SESSION_SCHEMA_VERSION,
  createEmptyBriefContent,
  createEmptyBrainstormSession,
} from "./model";

describe("brainstorm session model", () => {
  it("creates a stable, not-started session with an empty brief shape", () => {
    expect(createEmptyBrainstormSession()).toEqual({
      kind: BRAINSTORM_SESSION_KIND,
      schemaVersion: BRAINSTORM_SESSION_SCHEMA_VERSION,
      lifecycle: "not-started",
      sessionId: null,
      revision: 0,
      briefFrame: null,
      selection: { type: "none" },
    });
    expect(createEmptyBriefContent()).toEqual({
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
    });
  });
});
