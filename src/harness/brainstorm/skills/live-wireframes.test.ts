import { describe, expect, it } from "vitest";

import { BrainstormingAgentHarness } from "../agent";
import { ScriptedProvider, type ScriptedTurn } from "../../provider/scripted";
import { TraceLog } from "../../trace";
import { MainAgentHarness } from "../../main/agent";
import { DEFAULT_CONFIG } from "../../config";
import { VALID_WIREFRAME } from "../../main/agent.test";
import { buildWireframeOutline } from "./wireframe-outline";
import type { HarnessSkill } from "./live-wireframes";

const CHANGED_HEADLINE = VALID_WIREFRAME.replace("Pick a plan", "Choose a plan");

const DRIFTED_STRUCTURE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Drifted</title>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; }
    .wrap { display: flex; flex-direction: column; gap: 12px; padding: 24px; }
    h2 { font-size: 20px; }
  </style>
</head>
<body>
  <main class="wrap">
    <h2>Sections only</h2>
    <p>The headline is gone entirely.</p>
  </main>
</body>
</html>`;

interface HarnessOptions {
  brainstormTurns: ScriptedTurn[];
  draftTurns?: ScriptedTurn[];
  mainTurns?: ScriptedTurn[];
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
      provider: new ScriptedProvider({ turns: options.draftTurns ?? [{ kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` }] }),
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

function headingIndex(html: string): number {
  return buildWireframeOutline(html).find((entry) => entry.tag === "h1")!.index;
}

describe("live-wireframes skill", () => {
  it("explores multiple design directions side by side on the canvas", async () => {
    const { harness, provider, trace, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("live.explore_variants", {
          frameName: "Landing hero",
          intent: "A hero section for a voice product landing page",
          viewport: "desktop",
          width: 720,
          height: 480,
          x: 0,
          y: 0,
          background: "#ffffff",
          directions: ["minimal single column", "split hero with side panel", "card grid"],
        }),
        toolTurn("live.list_wireframes", {}),
        { kind: "text", content: "Three directions are on the canvas — which one should we push?" },
      ],
      draftTurns: [
        { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
        { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
        { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
      ],
    });

    const result = await harness.handleTurn("Show me different kinds of heroes");
    expect(result.toolCallCount).toBe(2);
    expect(trace.byType("wireframe/created")).toHaveLength(3);

    const listing = toolResults().at(-1)!;
    expect(listing).toContain("minimal single column");
    expect(listing).toContain("(0, 0)");
    expect(listing).toContain("(800, 0)");
    expect(listing).toContain("(1600, 0)");

    const lastRequest = provider.requests.at(-1)!;
    const exploreCall = lastRequest.messages.find(
      (message) => message.role === "assistant" && message.toolCalls?.some((call) => call.name === "live.explore_variants"),
    );
    expect(exploreCall).toBeDefined();
  });

  it("rejects invalid direction lists without touching the canvas", async () => {
    const { harness, trace, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("live.explore_variants", {
          frameName: "Hero",
          intent: "Hero",
          viewport: "desktop",
          width: 720,
          height: 480,
          x: 0,
          y: 0,
          background: "#ffffff",
          directions: ["only one direction"],
        }),
        { kind: "text", content: "Let me try that again." },
      ],
    });

    await harness.handleTurn("Give me one variant");
    expect(toolResults().join("\n")).toContain("between 2 and 4");
    expect(trace.byType("wireframe/created")).toHaveLength(0);
  });

  it("applies pinpoint edits to exactly the element the user pointed at", async () => {
    const h1Index = headingIndex(VALID_WIREFRAME);
    const { harness, trace, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("brainstorm.draft_wireframe", {
          frameName: "Pricing",
          intent: "Quick pricing layout",
          viewport: "mobile",
          width: 390,
          height: 844,
          x: 0,
          y: 0,
          background: "#ffffff",
        }),
        toolTurn("live.inspect_wireframe", { frameId: "frame-1" }),
        toolTurn("live.pinpoint_edit", {
          frameId: "frame-1",
          elementIndex: h1Index,
          instruction: "Rewrite this headline to say Choose a plan",
        }),
        toolTurn("live.inspect_wireframe", { frameId: "frame-1" }),
        { kind: "text", content: "Headline updated." },
      ],
      draftTurns: [
        { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
        { kind: "text", content: `\`\`\`html\n${CHANGED_HEADLINE}\n\`\`\`` },
        { kind: "text", content: `\`\`\`html\n${CHANGED_HEADLINE}\n\`\`\`` },
      ],
    });

    await harness.handleTurn("Draft pricing, then change the headline only");
    const results = toolResults();
    const pinpointResult = results.find((content) => content.includes("Pinpointed change applied"))!;
    expect(pinpointResult).toContain("Rest of the frame preserved untouched.");

    const finalInspect = results.filter((content) => content.includes("Outline of")).at(-1)!;
    expect(finalInspect).toContain("Choose a plan");
    expect(finalInspect).not.toContain("Pick a plan");

    const edited = trace.byType("wireframe/edited").at(-1);
    expect(edited?.data.pinpoint).toBe(true);
    expect(edited?.data.elementIndex).toBe(h1Index);
    expect(edited?.data.preservedOriginal).toBe(true);
  });

  it("falls back to the regenerated document when the engine output drifts structurally", async () => {
    const h1Index = headingIndex(VALID_WIREFRAME);
    const { harness, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("brainstorm.draft_wireframe", {
          frameName: "Pricing",
          intent: "Quick pricing layout",
          viewport: "mobile",
          width: 390,
          height: 844,
          x: 0,
          y: 0,
          background: "#ffffff",
        }),
        toolTurn("live.pinpoint_edit", {
          frameId: "frame-1",
          elementIndex: h1Index,
          instruction: "Restructure into sections with no headline",
        }),
        toolTurn("live.inspect_wireframe", { frameId: "frame-1" }),
        { kind: "text", content: "Restructured." },
      ],
      draftTurns: [
        { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
        { kind: "text", content: `\`\`\`html\n${DRIFTED_STRUCTURE}\n\`\`\`` },
        { kind: "text", content: `\`\`\`html\n${DRIFTED_STRUCTURE}\n\`\`\`` },
      ],
    });

    await harness.handleTurn("Rework the headline area completely");
    const pinpointResult = toolResults().find((content) => content.includes("Pinpointed change applied"))!;
    expect(pinpointResult).toContain("drifted");
    const finalInspect = toolResults().filter((content) => content.includes("Outline of")).at(-1)!;
    expect(finalInspect).toContain("Sections only");
    expect(finalInspect).not.toContain("h1");
  });

  it("surfaces out-of-range element indexes as recoverable tool failures", async () => {
    const { harness, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("brainstorm.draft_wireframe", {
          frameName: "Pricing",
          intent: "Quick pricing layout",
          viewport: "mobile",
          width: 390,
          height: 844,
          x: 0,
          y: 0,
          background: "#ffffff",
        }),
        toolTurn("live.pinpoint_edit", {
          frameId: "frame-1",
          elementIndex: 9999,
          instruction: "Change something",
        }),
        { kind: "text", content: "That index was wrong." },
      ],
    });

    const result = await harness.handleTurn("Nudge that thing");
    expect(result.assistantMessage).toContain("wrong");
    expect(toolResults().join("\n")).toContain("No element at index 9999");
  });

  it("registers its tools and prompt guidance on every provider request by default", async () => {
    const { harness, provider } = createHarness({
      brainstormTurns: [{ kind: "text", content: "Ready when you are." }],
    });
    await harness.handleTurn("Hello");

    const request = provider.requests[0];
    const toolNames = (request.tools ?? []).map((tool) => tool.name);
    for (const expected of ["live.list_wireframes", "live.inspect_wireframe", "live.pinpoint_edit", "live.explore_variants"]) {
      expect(toolNames).toContain(expected);
    }
    const systemContent = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    expect(systemContent).toContain("[live-wireframes]");
    expect(systemContent).toContain("Pinpoint edits touch exactly one element");
  });

  it("can be disabled by passing an empty skill list", async () => {
    const { harness, provider, toolResults } = createHarness({
      brainstormTurns: [
        toolTurn("live.list_wireframes", {}),
        { kind: "text", content: "The live tools are unavailable." },
      ],
      skills: [],
    });

    const result = await harness.handleTurn("List my wireframes");
    expect(result.toolCallCount).toBe(1);
    expect(toolResults().join("\n")).toContain("Unknown tool: live.list_wireframes");

    const request = provider.requests[0];
    expect((request.tools ?? []).map((tool) => tool.name)).not.toContain("live.list_wireframes");
    const systemContent = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    expect(systemContent).not.toContain("Active skills:");
  });
});
