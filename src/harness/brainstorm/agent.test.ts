import { describe, expect, it } from "vitest";

import { BrainstormingAgentHarness, BrainstormingAgentError } from "./agent";
import { ScriptedProvider, type ScriptedTurn } from "../provider/scripted";
import { TraceLog } from "../trace";
import { MainAgentHarness } from "../main/agent";
import { DEFAULT_CONFIG } from "../config";
import { VALID_WIREFRAME } from "../main/agent.test";

function createHarness(turns: ScriptedTurn[], options: { denyAsk?: boolean } = {}) {
  const provider = new ScriptedProvider({ turns });
  const trace = new TraceLog();
  const harness = new BrainstormingAgentHarness({ provider, trace, denyAsk: options.denyAsk });
  return { harness, provider, trace };
}

function createHarnessWithMain(turns: ScriptedTurn[], mainTurns: ScriptedTurn[]) {
  const provider = new ScriptedProvider({ turns });
  const mainProvider = new ScriptedProvider({ turns: mainTurns });
  const trace = new TraceLog();
  const mainAgent = new MainAgentHarness({ provider: mainProvider, config: DEFAULT_CONFIG, trace });
  const harness = new BrainstormingAgentHarness({ provider, mainAgent, trace });
  return { harness, provider, mainProvider, trace };
}

function createHarnessWithEngines(
  turns: ScriptedTurn[],
  options: { mainTurns?: ScriptedTurn[]; draftTurns?: ScriptedTurn[] } = {},
) {
  const provider = new ScriptedProvider({ turns });
  const mainProvider = options.mainTurns ? new ScriptedProvider({ turns: options.mainTurns }) : null;
  const draftProvider = options.draftTurns ? new ScriptedProvider({ turns: options.draftTurns }) : null;
  const trace = new TraceLog();
  const counters: Record<string, number> = {};
  const createId = (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}-${counters[prefix]}`;
  };
  const harness = new BrainstormingAgentHarness({
    provider,
    trace,
    createId,
    mainAgent: mainProvider
      ? new MainAgentHarness({ provider: mainProvider, config: DEFAULT_CONFIG, trace })
      : undefined,
    draftAgent: draftProvider
      ? new MainAgentHarness({
          provider: draftProvider,
          config: DEFAULT_CONFIG,
          model: "deepseek-v4-flash",
          maxRepairs: 1,
          maxHtmlChars: 200_000,
          trace,
          traceId: "draft",
        })
      : undefined,
  });
  return { harness, provider, mainProvider, draftProvider, trace };
}

describe("BrainstormingAgentHarness", () => {
  it("auto-starts the session and replies on the first turn", async () => {
    const { harness, trace } = createHarness([
      { kind: "text", content: "Great — let’s understand it. What are you making?" },
    ]);

    const result = await harness.handleTurn("I want a landing page for a voice product");
    expect(result.startedSession).toBe(true);
    expect(harness.isSessionStarted()).toBe(true);
    expect(harness.getSession().getSnapshot().lifecycle).toBe("briefing");
    expect(result.assistantMessage).toContain("What are you making");
    expect(trace.byType("session/started")).toHaveLength(1);
    expect(trace.byType("session/input-admitted")).toHaveLength(1);
  });

  it("updates the brief through a tool and records the transcript", async () => {
    const { harness } = createHarness([
      {
        kind: "tool",
        toolCalls: [{ name: "brainstorm.update_brief", arguments: JSON.stringify({ field: "audience", value: "Product teams" }) }],
      },
      { kind: "text", content: "Got it. Who else should we keep in mind?" },
    ]);

    await harness.handleTurn("It’s for product teams");
    const session = harness.getSession().getSnapshot();
    expect(session.briefFrame?.content.audience).toBe("Product teams");
    expect(session.revision).toBeGreaterThan(1);

    const transcript = harness.getTranscript().getEntries();
    expect(transcript.some((entry) => entry.kind === "tool-call")).toBe(true);
    expect(transcript.some((entry) => entry.kind === "tool-result")).toBe(true);
  });

  it("records confirmed decisions and transitions lifecycle", async () => {
    const { harness } = createHarness([
      {
        kind: "tool",
        toolCalls: [
          { name: "brainstorm.add_decision", arguments: JSON.stringify({ statement: "Start with a brief", rationale: "Keeps focus" }) },
          { name: "brainstorm.transition", arguments: JSON.stringify({ to: "wireframing" }) },
        ],
      },
      { kind: "text", content: "Locked in — moving to wireframing." },
    ]);

    await harness.handleTurn("Confirmed: we start with a brief, then wireframes");
    const session = harness.getSession().getSnapshot();
    expect(session.lifecycle).toBe("wireframing");
    expect(session.briefFrame?.content.confirmedDecisions[0]?.statement).toBe("Start with a brief");
  });

  it("delegates wireframe generation to the Main Agent and places the frame", async () => {
    const { harness, trace, mainProvider } = createHarnessWithMain(
      [
        {
          kind: "tool",
          toolCalls: [{
            name: "main.generate_wireframe",
            arguments: JSON.stringify({
              frameName: "Mobile pricing",
              intent: "A compact pricing section for phones",
              viewport: "mobile",
              width: 390,
              height: 844,
              x: 0,
              y: 0,
              background: "#ffffff",
            }),
          }],
        },
        { kind: "text", content: "Wireframe is on the canvas." },
      ],
      [{ kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` }],
    );

    const result = await harness.handleTurn("Show me a mobile pricing section");
    expect(result.toolCallCount).toBe(1);
    expect(result.assistantMessage).toContain("Wireframe is on the canvas");
    expect(mainProvider.requestedModels()).toHaveLength(1);

    const session = harness.getSession().getSnapshot();
    expect(session.lifecycle).toBe("wireframing");
    expect(trace.byType("wireframe/created")).toHaveLength(1);
    expect(trace.byType("main/provider-started")).toHaveLength(1);
  });

  it("surfaces permission-ask denial for high-impact tools", async () => {
    const { harness } = createHarness([
      {
        kind: "tool",
        toolCalls: [{
          name: "main.generate_wireframe",
          arguments: JSON.stringify({
            frameName: "X",
            intent: "X",
            viewport: "desktop",
            width: 1024,
            height: 768,
            x: 0,
            y: 0,
            background: "#ffffff",
          }),
        }],
      },
      { kind: "text", content: "I’ll hold off on that." },
    ], { denyAsk: true });

    const result = await harness.handleTurn("Make a frame");
    expect(result.toolCallCount).toBe(1);
    expect(harness.getSession().getSnapshot().briefFrame?.content.goals ?? []).toEqual([]);
    expect(result.assistantMessage).toContain("hold off");
  });

  it("stops after a bounded step budget when the model keeps calling tools", async () => {
    const toolTurn = {
      kind: "tool" as const,
      toolCalls: [{ name: "brainstorm.update_brief", arguments: JSON.stringify({ field: "goals", value: ["more"] }) }],
    };
    const { harness } = createHarness(Array(9).fill(toolTurn));

    await expect(harness.handleTurn("ping")).rejects.toBeInstanceOf(BrainstormingAgentError);
  });

  it("propagates provider failures as typed errors", async () => {
    const { harness } = createHarness([{ kind: "error", message: "down" }]);
    await expect(harness.handleTurn("hello")).rejects.toMatchObject({ code: "provider-error" });
  });

  it("keeps tool-call/result pairs when the context budget forces trimming", async () => {
    const { harness, provider } = createHarness([
      {
        kind: "tool",
        toolCalls: [
          { name: "brainstorm.update_brief", arguments: JSON.stringify({ field: "goals", value: ["first"] }) },
          { name: "brainstorm.update_brief", arguments: JSON.stringify({ field: "goals", value: ["first", "second"] }) },
        ],
      },
      { kind: "text", content: "done" },
    ]);

    await harness.handleTurn("a short message");
    const lastRequest = provider.requests.at(-1);
    const toolMessages = lastRequest?.messages.filter((message) => message.role === "tool") ?? [];
    const callIds = new Set<string>();
    for (const message of lastRequest?.messages ?? []) {
      if (message.role === "assistant" && message.toolCalls?.length) {
        for (const call of message.toolCalls) callIds.add(call.id);
      }
    }
    expect(toolMessages.length).toBeGreaterThan(0);
    for (const toolMessage of toolMessages) {
      expect(callIds.has(toolMessage.toolCallId)).toBe(true);
    }
  });

  it("requires a fresh session when startSession is called twice", () => {
    const { harness } = createHarness([{ kind: "text", content: "ok" }]);
    harness.startSession();
    expect(() => harness.startSession()).toThrow(BrainstormingAgentError);
  });

  it("drafts a wireframe with the fast engine and creates the frame", async () => {
    const { harness, draftProvider, trace } = createHarnessWithEngines(
      [
        {
          kind: "tool",
          toolCalls: [{
            name: "brainstorm.draft_wireframe",
            arguments: JSON.stringify({
              frameName: "Mobile pricing draft",
              intent: "A quick pricing layout for phones",
              viewport: "mobile",
              width: 390,
              height: 844,
              x: 0,
              y: 0,
              background: "#ffffff",
            }),
          }],
        },
        { kind: "text", content: "Draft is on the canvas — want to iterate?" },
      ],
      { draftTurns: [{ kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` }] },
    );

    const result = await harness.handleTurn("Draft a quick mobile pricing section");
    expect(result.toolCallCount).toBe(1);
    expect(result.assistantMessage).toContain("Draft is on the canvas");
    expect(draftProvider?.requestedModels()).toEqual(["deepseek-v4-flash"]);
    expect(trace.byType("wireframe/created")).toHaveLength(1);
    const mainStarted = trace.byType("main/provider-started").filter((event) => event.traceId === "main");
    expect(mainStarted).toHaveLength(0);
    const draftStarted = trace.byType("main/provider-started").filter((event) => event.traceId === "draft");
    expect(draftStarted).toHaveLength(1);
  });

  it("edits an existing wireframe in place with the fast engine", async () => {
    const { harness, draftProvider, trace } = createHarnessWithEngines(
      [
        {
          kind: "tool",
          toolCalls: [{
            name: "brainstorm.draft_wireframe",
            arguments: JSON.stringify({
              frameName: "Pricing",
              intent: "A quick pricing layout",
              viewport: "mobile",
              width: 390,
              height: 844,
              x: 0,
              y: 0,
              background: "#ffffff",
            }),
          }],
        },
        {
          kind: "tool",
          toolCalls: [{
            name: "brainstorm.edit_wireframe",
            arguments: JSON.stringify({
              frameId: "frame-1",
              editInstruction: "Tighten the spacing between sections",
            }),
          }],
        },
        { kind: "text", content: "Edited." },
      ],
      { draftTurns: [
        { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
        { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
      ] },
    );

    const result = await harness.handleTurn("Draft it, then tighten the spacing");
    expect(result.toolCallCount).toBe(2);
    expect(result.assistantMessage).toContain("Edited.");
    expect(draftProvider?.requestedModels()).toEqual(["deepseek-v4-flash", "deepseek-v4-flash"]);
    expect(trace.byType("wireframe/created")).toHaveLength(1);
    expect(trace.byType("wireframe/edited")).toHaveLength(1);
  });

  it("hands the final design off to the Main Agent into an approved draft frame", async () => {
    const { harness, mainProvider, draftProvider, trace } = createHarnessWithEngines(
      [
        {
          kind: "tool",
          toolCalls: [{
            name: "brainstorm.draft_wireframe",
            arguments: JSON.stringify({
              frameName: "Pricing",
              intent: "A quick pricing layout",
              viewport: "mobile",
              width: 390,
              height: 844,
              x: 0,
              y: 0,
              background: "#ffffff",
            }),
          }],
        },
        {
          kind: "tool",
          toolCalls: [{
            name: "main.generate_wireframe",
            arguments: JSON.stringify({
              frameName: "Pricing final",
              intent: "Final polished pricing",
              viewport: "mobile",
              width: 390,
              height: 844,
              x: 0,
              y: 0,
              background: "#ffffff",
              frameId: "frame-1",
            }),
          }],
        },
        { kind: "text", content: "Final design placed." },
      ],
      {
        draftTurns: [{ kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` }],
        mainTurns: [{ kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` }],
      },
    );

    const result = await harness.handleTurn("Draft it, then make it final");
    expect(result.toolCallCount).toBe(2);
    expect(result.assistantMessage).toContain("Final design placed.");
    expect(mainProvider?.requestedModels()).toEqual(["gpt-5.6-luna"]);
    expect(draftProvider?.requestedModels()).toEqual(["deepseek-v4-flash"]);
    expect(trace.byType("wireframe/created")).toHaveLength(1);
    expect(trace.byType("wireframe/edited")).toHaveLength(1);
  });

  it("creates a final wireframe directly when no frameId is given", async () => {
    const { harness, mainProvider, trace } = createHarnessWithEngines(
      [
        {
          kind: "tool",
          toolCalls: [{
            name: "main.generate_wireframe",
            arguments: JSON.stringify({
              frameName: "Desktop hero",
              intent: "Polished hero for desktop",
              viewport: "desktop",
              width: 1440,
              height: 900,
              x: 0,
              y: 0,
              background: "#ffffff",
            }),
          }],
        },
        { kind: "text", content: "Final hero is on the canvas." },
      ],
      { mainTurns: [{ kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` }] },
    );

    const result = await harness.handleTurn("Make the final desktop hero");
    expect(result.toolCallCount).toBe(1);
    expect(mainProvider?.requestedModels()).toEqual(["gpt-5.6-luna"]);
    expect(trace.byType("wireframe/created")).toHaveLength(1);
    expect(harness.getSession().getSnapshot().lifecycle).toBe("wireframing");
  });
});

// Guard: the VALID_WIREFRAME fixture remains importable for other suites.
void VALID_WIREFRAME;
