import { describe, expect, it } from "vitest";

import { BrainstormingAgentHarness } from "../agent";
import { ScriptedProvider, type ScriptedTurn } from "../../provider/scripted";
import { TraceLog } from "../../trace";
import { MainAgentHarness } from "../../main/agent";
import { DEFAULT_CONFIG } from "../../config";
import type { HarnessSkill } from "./live-wireframes";

interface HarnessOptions {
  brainstormTurns: ScriptedTurn[];
  skills?: HarnessSkill[];
}

function createHarness(options: HarnessOptions) {
  const provider = new ScriptedProvider({ turns: options.brainstormTurns });
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
    skills: options.skills,
    draftAgent: new MainAgentHarness({
      provider: new ScriptedProvider({ turns: [{ kind: "text", content: "unused draft stub" }] }),
      config: DEFAULT_CONFIG,
      model: "deepseek-v4-flash",
      maxRepairs: 1,
      maxHtmlChars: 200_000,
      trace,
      traceId: "draft",
    }),
  });
  return {
    harness,
    provider,
    trace,
    toolResults(): string[] {
      return harness
        .getTranscript()
        .getEntries()
        .filter((entry) => entry.kind === "tool-result")
        .map((entry) => (entry as { content: string }).content);
    },
  };
}

function toolTurn(name: string, args: Record<string, unknown>): ScriptedTurn {
  return { kind: "tool", toolCalls: [{ name, arguments: JSON.stringify(args) }] };
}

function sampleConcepts() {
  return [
    {
      name: "Guided checklist",
      summary: "A step-by-step checklist that walks first-time hosts through launch",
      audienceFit: "New hosts who need confidence more than flexibility",
      keyMoments: ["template pick", "first publish"],
      differentiator: "Opinionated path with one clear next step",
      tradeoff: "Power users may feel constrained",
    },
    {
      name: "Open studio",
      summary: "A freeform studio canvas with building blocks for the landing experience",
      audienceFit: "Experienced creators who want full control",
      keyMoments: ["block remix", "live preview"],
      differentiator: "Total compositional freedom from a blank page",
      tradeoff: "Blank-page paralysis for newcomers",
    },
    {
      name: "Concierge brief",
      summary: "A short interview that turns answers into a ready first draft",
      audienceFit: "Busy founders who want an 80 percent draft fast",
      keyMoments: ["three-question interview", "draft reveal"],
      differentiator: "Zero authoring; the draft arrives assembled",
      tradeoff: "Draft quality depends on answer quality",
    },
  ];
}

describe("concept-brainstorm skill", () => {
  it("proposes distinct concepts and records them in trace", async () => {
    const concepts = sampleConcepts();
    const { harness, trace, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("concept.propose_concepts", { concepts }),
        { kind: "text", content: "Three directions are on the table — which speaks to you?" },
      ],
    });

    const result = await harness.handleTurn("What could this be?");
    expect(result.toolCallCount).toBe(1);
    expect(trace.byType("concept/proposed")).toHaveLength(1);

    const output = toolResults().join("\n");
    for (const concept of concepts) {
      expect(output).toContain(concept.name);
    }
    expect(output).toContain("which to keep or combine");
  });

  it("rejects proposals with fewer than two concepts", async () => {
    const { harness, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("concept.propose_concepts", { concepts: sampleConcepts().slice(0, 1) }),
        { kind: "text", content: "Need more options." },
      ],
    });

    await harness.handleTurn("Give me ideas");
    expect(toolResults().join("\n")).toContain("between 2 and 4 distinct concepts");
  });

  it("rejects near-duplicate concept names", async () => {
    const concepts = sampleConcepts();
    const duplicate = { ...concepts[1], name: concepts[0].name.toUpperCase() };
    const { harness, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("concept.propose_concepts", { concepts: [concepts[0], duplicate] }),
        { kind: "text", content: "Those overlap." },
      ],
    });

    await harness.handleTurn("Give me ideas");
    expect(toolResults().join("\n")).toContain("distinct names");
  });

  it("lists proposed concepts and selects one as a confirmed decision", async () => {
    const concepts = sampleConcepts();
    const { harness, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("concept.propose_concepts", { concepts }),
        toolTurn("concept.select_concept", {
          name: "Open studio",
          rationale: "Control matters most to this audience",
          whatToShow: "The block remix moment on desktop",
        }),
        toolTurn("concept.list_concepts", {}),
        { kind: "text", content: "Locked in — showing it next." },
      ],
    });

    const result = await harness.handleTurn("Let's explore, then commit");
    expect(result.toolCallCount).toBe(3);

    const listing = toolResults().at(-1)!;
    expect(listing).toContain("Guided checklist");
    expect(listing).toContain("Open studio (selected)");

    const session = harness.getSession().getSnapshot();
    expect(
      session.briefFrame?.content.confirmedDecisions.map((decision) => decision.statement),
    ).toContain("Selected brainstorm concept: Open studio");
  });

  it("fails selection of an unknown concept with guidance", async () => {
    const { harness, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("concept.propose_concepts", { concepts: sampleConcepts().slice(0, 2) }),
        toolTurn("concept.select_concept", {
          name: "Mystery mode",
          rationale: "Sounds fun",
          whatToShow: "Something",
        }),
        { kind: "text", content: "That name was wrong." },
      ],
    });

    await harness.handleTurn("Pick something else");
    expect(toolResults().join("\n")).toContain('Unknown concept "Mystery mode"');
  });

  it("says there is nothing to list before any proposal", async () => {
    const { harness, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("concept.list_concepts", {}),
        { kind: "text", content: "No concepts yet." },
      ],
    });

    await harness.handleTurn("What have we got?");
    expect(toolResults().join("\n")).toContain("No concepts on the table yet");
  });

  it("registers its tools and prompt guidance on every provider request by default", async () => {
    const { harness, provider } = createHarness({
      brainstormTurns: [{ kind: "text", content: "Ready when you are." }],
    });
    await harness.handleTurn("Hello");

    const request = provider.requests[0];
    const toolNames = (request.tools ?? []).map((tool) => tool.name);
    for (const expected of ["concept.propose_concepts", "concept.list_concepts", "concept.select_concept"]) {
      expect(toolNames).toContain(expected);
    }
    // Live wireframe co-design stays on by default alongside concept brainstorming.
    for (const expected of ["live.list_wireframes", "live.explore_variants"]) {
      expect(toolNames).toContain(expected);
    }
    const systemContent = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    expect(systemContent).toContain("[concept-brainstorm]");
    expect(systemContent).toContain("use wireframes as the way to show them");
  });
});
