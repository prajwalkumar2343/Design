import type { ProviderMessage, ToolCall } from "./provider/types";

export type TranscriptEntry =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string }
  | { kind: "tool-call"; toolCall: ToolCall }
  | { kind: "tool-result"; toolCallId: string; content: string }
  | { kind: "system"; content: string };

/**
 * Durable, replayable transcript of accepted user input, assistant output,
 * tool calls, and tool results. It is richer than the next provider prompt;
 * the provider-visible context is a bounded derivation of this.
 */
export class Transcript {
  private entries: TranscriptEntry[] = [];

  append(entry: TranscriptEntry): void {
    this.entries.push(entry);
  }

  getEntries(): readonly TranscriptEntry[] {
    return this.entries;
  }

  /**
   * Produce provider messages, skipping tool-result entries whose calls are
   * outside the window so assistant tool calls always pair with a result.
   */
  toProviderMessages(options: { maxChars?: number } = {}): ProviderMessage[] {
    const messages: ProviderMessage[] = [];
    let total = 0;
    for (const entry of this.entries) {
      switch (entry.kind) {
        case "user":
          messages.push({ role: "user", content: entry.content });
          total += entry.content.length;
          break;
        case "assistant":
          messages.push({ role: "assistant", content: entry.content });
          total += entry.content.length;
          break;
        case "tool-call":
          messages.push({
            role: "assistant",
            content: "",
            toolCalls: [entry.toolCall],
          });
          break;
        case "tool-result":
          messages.push({
            role: "tool",
            toolCallId: entry.toolCallId,
            content: entry.content,
          });
          total += entry.content.length;
          break;
        case "system":
          messages.push({ role: "system", content: entry.content });
          total += entry.content.length;
          break;
      }
      if (options.maxChars !== undefined && total > options.maxChars) {
        throw new Error("Transcript exceeds max context characters");
      }
    }
    return messages;
  }

  /** Windowed view: last N entries, enough to keep tool-call/result pairs. */
  window(count: number): readonly TranscriptEntry[] {
    if (count >= this.entries.length) return this.entries;
    const start = this.entries.length - count;
    const selected = this.entries.slice(start);
    return selected;
  }

  clear(): void {
    this.entries = [];
  }
}
