import { describe, expect, it } from "vitest";

import { MainAgentHarness, MainGenerationError } from "./agent";
import { ScriptedProvider, type ScriptedTurn } from "../provider/scripted";
import { DEFAULT_CONFIG } from "../config";
import { TraceLog } from "../trace";

export const VALID_WIREFRAME = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mobile pricing</title>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; }
    .pricing { display: flex; flex-direction: column; gap: 16px; padding: 24px; }
    h1 { font-size: 24px; line-height: 1.2; font-weight: 600; }
    p { font-size: 14px; line-height: 1.5; }
    @media (max-width: 480px) {
      .pricing { padding: 16px; }
    }
  </style>
</head>
<body>
  <main class="pricing">
    <h1>Pick a plan</h1>
    <p>Simple pricing for small teams.</p>
    <a href="#">Learn more</a>
  </main>
</body>
</html>`;

export const INVALID_WIREFRAME = `<!DOCTYPE html>
<html>
<head>
  <title>Bad</title>
  <style>
    body { color: red; background-color: #fff; }
  </style>
</head>
<body>
  <script>alert(1)</script>
  <img src="https://example.com/x.png" alt="x" />
</body>
</html>`;

function createMainAgent(turns: ScriptedTurn[]) {
  const provider = new ScriptedProvider({ turns });
  const trace = new TraceLog();
  return { agent: new MainAgentHarness({ provider, config: DEFAULT_CONFIG, trace }), provider, trace };
}

function input() {
  return {
    frame: {
      name: "Mobile pricing",
      width: 390,
      height: 844,
      intent: "A compact pricing section for phones",
      viewport: "mobile",
    },
    brief: "projectDescription: A small-team planning tool\naudience: Product teams",
    mode: "wireframe" as const,
  };
}

describe("MainAgentHarness", () => {
  it("generates and validates a wireframe in one attempt", async () => {
    const { agent, trace } = createMainAgent([
      { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
    ]);

    const result = await agent.generateWireframe(input());
    expect(result.mode).toBe("wireframe");
    expect(result.attempts).toBe(1);
    expect(result.repaired).toBe(false);
    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.htmlBytes).toBeGreaterThan(0);
    expect(trace.byType("main/provider-started")).toHaveLength(1);
    expect(trace.byType("main/admission-failed")).toHaveLength(0);
  });

  it("repairs admission failures with a bounded repair pass", async () => {
    const { agent, trace } = createMainAgent([
      { kind: "text", content: INVALID_WIREFRAME },
      { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
    ]);

    const result = await agent.generateWireframe(input());
    expect(result.repaired).toBe(true);
    expect(result.attempts).toBe(2);
    expect(trace.byType("main/repair")).toHaveLength(1);
    expect(trace.byType("main/admission-failed")).toHaveLength(1);
  });

  it("throws MainGenerationError when repairs are exhausted", async () => {
    const { agent, trace } = createMainAgent([
      { kind: "text", content: INVALID_WIREFRAME },
      { kind: "text", content: INVALID_WIREFRAME },
      { kind: "text", content: INVALID_WIREFRAME },
    ]);

    await expect(agent.generateWireframe(input())).rejects.toBeInstanceOf(MainGenerationError);
    expect(trace.byType("main/repair")).toHaveLength(2);
  });

  it("rejects oversized HTML before admission", async () => {
    const huge = `<!DOCTYPE html><html><head><title>big</title></head><body><p>${"x".repeat(250_000)}</p></body></html>`;
    const { agent } = createMainAgent([{ kind: "text", content: huge }]);
    await expect(agent.generateWireframe(input())).rejects.toBeInstanceOf(MainGenerationError);
  });

  it("propagates provider failures", async () => {
    const { agent } = createMainAgent([{ kind: "error", message: "provider down" }]);
    await expect(agent.generateWireframe(input())).rejects.toThrow("provider down");
  });

  it("uses the draft system prompt for draft quality", async () => {
    const { agent, provider } = createMainAgent([
      { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
    ]);

    const result = await agent.generateWireframe({ ...input(), quality: "draft" });
    expect(result.repaired).toBe(false);
    const system = provider.requests[0].messages.find((message) => message.role === "system");
    expect(system?.content).toContain("fast HTML wireframe drafter");
  });

  it("honors an explicit draft engine model override", async () => {
    const { agent, provider } = createMainAgent([
      { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
    ]);
    const draftAgent = new MainAgentHarness({
      provider,
      config: DEFAULT_CONFIG,
      model: "deepseek-v4-flash",
      maxRepairs: 1,
      maxHtmlChars: 200_000,
    });

    const result = await draftAgent.generateWireframe({ ...input(), quality: "draft" });
    expect(result.html).toContain("<!DOCTYPE html>");
    expect(provider.requestedModels()).toEqual(["deepseek-v4-flash"]);
  });

  it("passes the current HTML and edit instruction into edit prompts", async () => {
    const { agent } = createMainAgent([
      { kind: "text", content: `\`\`\`html\n${VALID_WIREFRAME}\n\`\`\`` },
    ]);

    const result = await agent.generateWireframe({
      ...input(),
      kind: "edit",
      currentHtml: VALID_WIREFRAME,
      editInstruction: "Tighten the spacing between sections",
    });
    expect(result.repaired).toBe(false);
    expect(result.html).toContain("Pick a plan");
  });
});
