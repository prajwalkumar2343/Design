import { describe, expect, it } from "vitest";

import { Transcript } from "./transcript";

describe("Transcript", () => {
  it("produces provider messages from durable entries", () => {
    const transcript = new Transcript();
    transcript.append({ kind: "system", content: "sys" });
    transcript.append({ kind: "user", content: "hello" });
    transcript.append({
      kind: "tool-call",
      toolCall: { id: "c1", name: "t", arguments: "{}" },
    });
    transcript.append({ kind: "tool-result", toolCallId: "c1", content: "result" });
    transcript.append({ kind: "assistant", content: "done" });

    expect(transcript.toProviderMessages()).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "t", arguments: "{}" }] },
      { role: "tool", toolCallId: "c1", content: "result" },
      { role: "assistant", content: "done" },
    ]);
  });

  it("throws when the provider-visible context exceeds max chars", () => {
    const transcript = new Transcript();
    transcript.append({ kind: "user", content: "a".repeat(100) });
    expect(() => transcript.toProviderMessages({ maxChars: 50 })).toThrow(/max context/);
  });

  it("windows to the last N entries", () => {
    const transcript = new Transcript();
    for (let index = 0; index < 5; index += 1) {
      transcript.append({ kind: "user", content: `m${index}` });
    }
    const windowed = transcript.window(2);
    expect(windowed.map((entry) => (entry.kind === "user" ? entry.content : ""))).toEqual(["m3", "m4"]);
  });
});
