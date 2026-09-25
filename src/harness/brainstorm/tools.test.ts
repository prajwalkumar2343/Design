import { describe, expect, it } from "vitest";

import { createEditorStore, createEmptyEditorState } from "../../editor";
import { BrainstormSessionService } from "../../router/brainstorm-session";
import { DocumentExchangeService } from "../../router/document-exchange";
import { DEFAULT_CONFIG } from "../config";
import { MainAgentHarness } from "../main/agent";
import { VALID_WIREFRAME } from "../main/agent.test";
import { ScriptedProvider, type ScriptedTurn } from "../provider/scripted";
import { TraceLog } from "../trace";
import {
  boundResult,
  createBrainstormTools,
  type FrameResolution,
  type HarnessToolContext,
} from "./tools";

const FENCED_WIREFRAME = `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\``;

const PLACEMENT = {
  frameName: "Mobile pricing",
  intent: "A compact pricing section for phones",
  viewport: "mobile",
  width: 390,
  height: 844,
  x: 0,
  y: 0,
  background: "#ffffff",
};

function createContext(options: { draftTurns?: ScriptedTurn[]; mainTurns?: ScriptedTurn[] } = {}) {
  const store = createEditorStore(createEmptyEditorState());
  const session = new BrainstormSessionService(store);
  const documentExchange = new DocumentExchangeService(store);
  const trace = new TraceLog();
  const counters: Record<string, number> = {};
  const createId = (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}-${counters[prefix]}`;
  };
  const draftProvider = new ScriptedProvider({
    turns: options.draftTurns ?? [{ kind: "text", content: FENCED_WIREFRAME }],
  });
  const mainProvider = new ScriptedProvider({
    turns: options.mainTurns ?? [{ kind: "text", content: FENCED_WIREFRAME }],
  });
  const resolveFrame = (frameId: string): FrameResolution | null => {
    const state = store.getState();
    const frame = state.frames[frameId];
    const document = frame ? state.documents[frame.documentId] : undefined;
    if (!frame || !document) return null;
    return {
      frameId: frame.id,
      documentId: document.id,
      documentRevision: document.revision,
      name: frame.name,
      width: frame.width,
      height: frame.height,
      mode: document.mode,
      x: frame.x,
      y: frame.y,
    };
  };
  const context: HarnessToolContext = {
    session,
    documentExchange,
    mainAgent: new MainAgentHarness({ provider: mainProvider, config: DEFAULT_CONFIG, trace }),
    draftAgent: new MainAgentHarness({
      provider: draftProvider,
      config: DEFAULT_CONFIG,
      model: "deepseek-v4-flash",
      maxRepairs: 1,
      maxHtmlChars: 200_000,
      trace,
      traceId: "draft",
    }),
    trace,
    traceId: "test-trace",
    maxToolResultChars: 6_000,
    createId,
    resolveFrame,
    listFrames: () =>
      Object.values(store.getState().frames)
        .map((frame) => resolveFrame(frame.id))
        .filter((frame): frame is FrameResolution => frame !== null)
        .sort((a, b) => a.y - b.y || a.x - b.x),
  };
  return { context, session, documentExchange, trace, store, draftProvider, mainProvider };
}

function startSession(context: HarnessToolContext) {
  context.session.startSession({
    expectedRevision: 0,
    sessionId: "session-1",
    briefFrameId: "brief-1",
  });
}

function tool(name: string) {
  const found = createBrainstormTools().find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
}

describe("createBrainstormTools", () => {
  it("registers the seven session and wireframe tools with the expected permissions", () => {
    const tools = createBrainstormTools();
    expect(tools.map((entry) => entry.name)).toEqual([
      "brainstorm.update_brief",
      "brainstorm.add_reference",
      "brainstorm.add_decision",
      "brainstorm.transition",
      "brainstorm.draft_wireframe",
      "brainstorm.edit_wireframe",
      "main.generate_wireframe",
    ]);
    expect(Object.fromEntries(tools.map((entry) => [entry.name, entry.permission]))).toEqual({
      "brainstorm.update_brief": "allow",
      "brainstorm.add_reference": "allow",
      "brainstorm.add_decision": "allow",
      "brainstorm.transition": "allow",
      "brainstorm.draft_wireframe": "ask",
      "brainstorm.edit_wireframe": "ask",
      "main.generate_wireframe": "ask",
    });
  });
});

describe("boundResult", () => {
  it("passes short results through and marks truncated ones", () => {
    expect(boundResult("short", 10)).toBe("short");
    expect(boundResult("0123456789abcdef", 5)).toBe("01234…(truncated)");
  });
});

describe("brief tools", () => {
  it("updates a text field and reports the new revision", async () => {
    const { context, session } = createContext();
    startSession(context);

    const result = await tool("brainstorm.update_brief").execute(
      { field: "audience", value: "Product teams" },
      context,
    );

    expect(result).toBe('Updated brief field "audience" (revision 2).');
    expect(session.getSnapshot().briefFrame?.content.audience).toBe("Product teams");
  });

  it("updates a list field from a string array", async () => {
    const { context, session } = createContext();
    startSession(context);

    await tool("brainstorm.update_brief").execute(
      { field: "goals", value: ["Align quickly", "Ship a draft"] },
      context,
    );

    expect(session.getSnapshot().briefFrame?.content.goals).toEqual(["Align quickly", "Ship a draft"]);
  });

  it("rejects unknown fields and mismatched value shapes", async () => {
    const { context } = createContext();
    startSession(context);
    const update = tool("brainstorm.update_brief");

    await expect(update.execute({ field: "secrets", value: "x" }, context))
      .rejects.toThrow("Unknown brief field: secrets");
    await expect(update.execute({ field: "goals", value: "not-an-array" }, context))
      .rejects.toThrow('Tool argument "value" must be an array of strings');
    await expect(update.execute({ field: "audience", value: ["a", "b"] }, context))
      .rejects.toThrow('Tool argument "value" must be a string');
  });

  it("records references and confirmed decisions with generated ids", async () => {
    const { context, session } = createContext();
    startSession(context);

    const referenceResult = await tool("brainstorm.add_reference").execute(
      { label: "Inspiration", url: "https://example.com", note: "Tone" },
      context,
    );
    expect(referenceResult).toBe('Added reference "Inspiration" (revision 2).');

    const decisionResult = await tool("brainstorm.add_decision").execute(
      { statement: "Start with a brief", rationale: "Keeps focus" },
      context,
    );
    expect(decisionResult).toBe("Recorded confirmed decision (revision 3).");

    const content = session.getSnapshot().briefFrame?.content;
    expect(content?.references).toEqual([
      { id: "ref-1", label: "Inspiration", url: "https://example.com", note: "Tone" },
    ]);
    expect(content?.confirmedDecisions).toEqual([
      { id: "decision-1", statement: "Start with a brief", rationale: "Keeps focus" },
    ]);
  });

  it("moves the session lifecycle forward", async () => {
    const { context, session } = createContext();
    startSession(context);

    const result = await tool("brainstorm.transition").execute({ to: "wireframing" }, context);

    expect(result).toBe("Brainstorm session moved to wireframing (revision 2).");
    expect(session.getSnapshot().lifecycle).toBe("wireframing");
  });
});

describe("wireframe tools", () => {
  it("drafts a wireframe with the fast engine and creates a canvas frame", async () => {
    const { context, documentExchange, trace, draftProvider } = createContext();
    startSession(context);

    const result = await tool("brainstorm.draft_wireframe").execute(PLACEMENT, context);

    expect(result).toContain('Drafted wireframe "Mobile pricing" (mobile, 390×844).');
    expect(result).toContain("frameId: frame-1");
    expect(result).toContain("documentId: doc-1");
    expect(documentExchange.getHtml("doc-1").html).toContain("Pick a plan");
    expect(draftProvider.requestedModels()).toEqual(["deepseek-v4-flash"]);
    expect(trace.byType("wireframe/created")).toHaveLength(1);
  });

  it("redrafts in place when draft_wireframe gets an existing frameId", async () => {
    const revised = VALID_WIREFRAME.replace("Pick a plan", "Choose a plan");
    const { context, documentExchange, trace } = createContext({
      draftTurns: [
        { kind: "text", content: FENCED_WIREFRAME },
        { kind: "text", content: `\`\`\`html\n${revised}\n\`\`\`` },
      ],
    });
    startSession(context);
    const draft = tool("brainstorm.draft_wireframe");
    await draft.execute(PLACEMENT, context);

    const result = await draft.execute({ ...PLACEMENT, frameId: "frame-1" }, context);

    expect(result).toContain('Redrafted wireframe "Mobile pricing" with the fast engine.');
    expect(result).toContain("frameId: frame-1");
    expect(result).toContain("documentRevision: 2 (was 1)");
    expect(documentExchange.getHtml("doc-1").html).toContain("Choose a plan");
    expect(trace.byType("wireframe/edited")).toHaveLength(1);
  });

  it("edits an existing wireframe through brainstorm.edit_wireframe", async () => {
    const revised = VALID_WIREFRAME.replace("Pick a plan", "Choose a plan");
    const { context, documentExchange, trace } = createContext({
      draftTurns: [
        { kind: "text", content: FENCED_WIREFRAME },
        { kind: "text", content: `\`\`\`html\n${revised}\n\`\`\`` },
      ],
    });
    startSession(context);
    await tool("brainstorm.draft_wireframe").execute(PLACEMENT, context);

    const result = await tool("brainstorm.edit_wireframe").execute(
      { frameId: "frame-1", editInstruction: "Tighten the spacing" },
      context,
    );

    expect(result).toContain('Edited wireframe "Mobile pricing" (frameId: frame-1).');
    expect(result).toContain("documentRevision: 2 (was 1)");
    expect(documentExchange.getHtml("doc-1").html).toContain("Choose a plan");
    expect(trace.byType("wireframe/edited")).toHaveLength(1);
  });

  it("fails edit_wireframe for an unknown frame", async () => {
    const { context } = createContext();
    startSession(context);

    await expect(
      tool("brainstorm.edit_wireframe").execute(
        { frameId: "missing", editInstruction: "Change it" },
        context,
      ),
    ).rejects.toThrow("Unknown frame: missing");
  });

  it("runs the final handoff through the Main Agent model", async () => {
    const { context, documentExchange, mainProvider, draftProvider, trace } = createContext();
    startSession(context);

    const result = await tool("main.generate_wireframe").execute(PLACEMENT, context);

    expect(result).toContain('Final wireframe "Mobile pricing" (mobile, 390×844).');
    expect(result).toContain("frameId: frame-1");
    expect(mainProvider.requestedModels()).toEqual(["gpt-5.6-luna"]);
    expect(draftProvider.requestedModels()).toEqual([]);
    expect(documentExchange.getHtml("doc-1").html).toContain("Pick a plan");
    expect(trace.byType("wireframe/created")).toHaveLength(1);
  });

  it("validates placement arguments before touching the canvas", async () => {
    const { context, draftProvider } = createContext();
    startSession(context);
    const draft = tool("brainstorm.draft_wireframe");

    await expect(draft.execute({ ...PLACEMENT, width: "wide" }, context))
      .rejects.toThrow('Tool argument "width" must be a finite number');
    await expect(draft.execute({ ...PLACEMENT, background: "url(https://evil)" }, context))
      .rejects.toThrow('Tool argument "background" must be a plain CSS color');
    await expect(draft.execute({ ...PLACEMENT, intent: 7 }, context))
      .rejects.toThrow('Tool argument "intent" must be a string');
    expect(draftProvider.requestedModels()).toEqual([]);
  });
});
