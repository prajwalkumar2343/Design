import { describe, expect, it } from "vitest";

import { ScriptedProvider } from "./scripted";

describe("ScriptedProvider", () => {
  it("replays turns in order and repeats the final one", async () => {
    const provider = new ScriptedProvider({
      turns: [
        { kind: "text", content: "first" },
        { kind: "tool", toolCalls: [{ name: "t", arguments: "{}" }] },
        { kind: "text", content: "second" },
      ],
    });

    const r1 = await provider.complete({ model: "m", messages: [] });
    expect(r1.content).toBe("first");
    const r2 = await provider.complete({ model: "m", messages: [] });
    expect(r2.toolCalls).toEqual([{ id: "call-2-0", name: "t", arguments: "{}" }]);
    expect(r2.stopReason).toBe("tool_calls");
    const r3 = await provider.complete({ model: "m", messages: [] });
    expect(r3.content).toBe("second");
    const r4 = await provider.complete({ model: "m", messages: [] });
    expect(r4.content).toBe("second");
  });

  it("throws on scripted error turns", async () => {
    const provider = new ScriptedProvider({ turns: [{ kind: "error", message: "boom" }] });
    await expect(provider.complete({ model: "m", messages: [] })).rejects.toThrow("boom");
  });

  it("records requests for assertions", async () => {
    const provider = new ScriptedProvider({ turns: [{ kind: "text", content: "x" }] });
    await provider.complete({ model: "gpt-5.6-luna", messages: [] });
    await provider.complete({ model: "deepseek-v4-flash", messages: [] });
    expect(provider.requestedModels()).toEqual(["gpt-5.6-luna", "deepseek-v4-flash"]);
  });

  it("requires at least one turn", () => {
    expect(() => new ScriptedProvider({ turns: [] })).toThrow();
  });
});
