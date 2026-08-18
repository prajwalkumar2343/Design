import type {
  ModelProvider,
  ModelProviderKind,
  ProviderRequest,
  ProviderResult,
} from "./types";

export type ScriptedTurn =
  | { kind: "text"; content: string; usage?: ProviderResult["usage"] }
  | { kind: "tool"; toolCalls: Array<{ name: string; arguments: string }>; content?: string; usage?: ProviderResult["usage"] }
  | { kind: "error"; message: string };

export interface ScriptedProviderOptions {
  /** Turns are consumed in order, then the final one repeats. */
  turns: ScriptedTurn[];
  model?: string;
}

/**
 * Deterministic provider that replays scripted turns. Used by harness tests
 * and scripted evals to exercise loop mechanics without a live model.
 */
export class ScriptedProvider implements ModelProvider {
  readonly kind: ModelProviderKind = "scripted";
  private readonly turns: ScriptedTurn[];
  private readonly model: string;
  private cursor = 0;
  readonly requests: ProviderRequest[] = [];

  constructor(options: ScriptedProviderOptions) {
    if (!options.turns || options.turns.length === 0) {
      throw new Error("ScriptedProvider requires at least one turn");
    }
    this.turns = options.turns;
    this.model = options.model ?? "scripted-model";
  }

  async complete(request: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(request);
    const turn = this.turns[Math.min(this.cursor, this.turns.length - 1)];
    this.cursor += 1;
    if (turn.kind === "error") {
      throw new Error(turn.message);
    }
    return {
      content: turn.content ?? "",
      toolCalls: turn.kind === "tool"
        ? turn.toolCalls.map((call, index) => ({
            id: `call-${this.cursor}-${index}`,
            name: call.name,
            arguments: call.arguments,
          }))
        : [],
      stopReason: turn.kind === "tool" ? "tool_calls" : "end_turn",
      model: this.model,
      usage: turn.usage ?? { inputTokens: 10, outputTokens: 5 },
    };
  }

  /** Assert the exact sequence of requested models for tight scripted tests. */
  requestedModels(): string[] {
    return this.requests.map((request) => request.model);
  }
}
