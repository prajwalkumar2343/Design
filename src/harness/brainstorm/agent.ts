import { createEditorStore, createEmptyEditorState } from "../../editor";
import { BrainstormSessionService } from "../../router/brainstorm-session";
import { DocumentExchangeService } from "../../router/document-exchange";
import { DEFAULT_BRIEF_FRAME_SIZE } from "../../session/model";
import type { EditorStore } from "../../editor/store";
import { TraceLog } from "../trace";
import { Transcript } from "../transcript";
import { MainAgentHarness } from "../main/agent";
import type { HarnessConfig } from "../config";
import type {
  ModelProvider,
  ProviderMessage,
  ProviderResult,
  ToolCall,
  ToolDefinition,
} from "../provider/types";
import { BRAINSTORM_OPENING_PROMPT, BRAINSTORM_SYSTEM_PROMPT } from "./prompts";
import {
  createBrainstormTools,
  type FrameResolution,
  type HarnessTool,
  type HarnessToolContext,
} from "./tools";
import { createConceptBrainstormSkill } from "./skills/concept-brainstorm";
import { createLiveWireframesSkill, type HarnessSkill } from "./skills/live-wireframes";

export interface BrainstormingAgentOptions {
  provider: ModelProvider;
  config?: Partial<HarnessConfig>;
  mainAgent?: MainAgentHarness;
  /** Fast drafting/editing engine; defaults to the config.draft engine. */
  draftAgent?: MainAgentHarness;
  /** Optional shared trace log; a new one is created otherwise. */
  trace?: TraceLog;
  /** When true, tools run in ask mode are auto-denied instead of running. */
  denyAsk?: boolean;
  /**
   * Skills extend the agent with extra system-prompt guidance and tools.
   * Defaults to the concept-brainstorming plus live wireframe co-design
   * skills; pass [] for base tools only.
   */
  skills?: HarnessSkill[];
  /** Called when a tool requires permission; resolves to allow/deny. */
  onPermissionRequest?: (toolName: string, args: Record<string, unknown>) => boolean | Promise<boolean>;
  /** Stable ID generator override (deterministic tests). */
  createId?: (prefix: string) => string;
}

export interface BrainstormTurnResult {
  assistantMessage: string;
  turnCount: number;
  toolCallCount: number;
  startedSession: boolean;
  usage: Array<ProviderResult["usage"]>;
}

export class BrainstormingAgentError extends Error {
  readonly code: "session-already-started" | "step-budget-exhausted" | "repeated-failure" | "provider-error";
  constructor(code: BrainstormingAgentError["code"], message: string) {
    super(message);
    this.name = "BrainstormingAgentError";
    this.code = code;
  }
}

function createStableId(prefix: string): string {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

function renderToolDefinition(tool: HarnessTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function messageSize(message: ProviderMessage): number {
  let size = message.content.length;
  if (message.role === "assistant") {
    for (const call of message.toolCalls ?? []) size += call.arguments.length;
  }
  return size;
}

function parseToolArguments(argumentsString: string, name: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsString);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Tool "${name}" received invalid JSON arguments: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Brainstorming Agent harness. This is the front-facing agent: the user always
 * interacts with it. It runs a bounded agent loop with narrow deterministic
 * tools and delegates HTML generation to the Main Agent. It owns no prompts
 * hidden in framework defaults; all prompts and tools are explicit and tested.
 */
export class BrainstormingAgentHarness {
  private readonly provider: ModelProvider;
  private readonly config: HarnessConfig;
  private readonly trace: TraceLog;
  private readonly denyAsk: boolean;
  private readonly onPermissionRequest?: BrainstormingAgentOptions["onPermissionRequest"];
  private readonly createId: (prefix: string) => string;
  private readonly store: EditorStore;
  private readonly session: BrainstormSessionService;
  private readonly documentExchange: DocumentExchangeService;
  private readonly mainAgent: MainAgentHarness;
  private readonly draftAgent: MainAgentHarness;
  private readonly tools: HarnessTool[];
  private readonly toolByName: Map<string, HarnessTool>;
  private readonly skills: HarnessSkill[];
  private readonly transcript = new Transcript();

  constructor(options: BrainstormingAgentOptions) {
    this.provider = options.provider;
    this.trace = options.trace ?? new TraceLog();
    this.denyAsk = options.denyAsk ?? false;
    this.onPermissionRequest = options.onPermissionRequest;
    this.createId = options.createId ?? createStableId;
    this.config = mergeConfig(options.config ?? {});
    this.store = createEditorStore(createEmptyEditorState());
    this.session = new BrainstormSessionService(this.store);
    this.documentExchange = new DocumentExchangeService(this.store);
    this.mainAgent = options.mainAgent
      ?? new MainAgentHarness({ provider: this.provider, config: this.config, trace: this.trace, traceId: "main" });
    this.draftAgent = options.draftAgent
      ?? new MainAgentHarness({
        provider: this.provider,
        config: this.config,
        model: this.config.draft.model,
        maxRepairs: this.config.draft.maxRepairs,
        maxHtmlChars: this.config.draft.maxHtmlChars,
        trace: this.trace,
        traceId: "draft",
      });
    this.skills = options.skills ?? [createConceptBrainstormSkill(), createLiveWireframesSkill()];
    this.tools = [...createBrainstormTools(), ...this.skills.flatMap((skill) => skill.tools)];
    this.toolByName = new Map(this.tools.map((tool) => [tool.name, tool]));
  }
  getSession(): BrainstormSessionService {
    return this.session;
  }

  getTranscript(): Transcript {
    return this.transcript;
  }

  isSessionStarted(): boolean {
    return this.session.getSnapshot().lifecycle !== "not-started";
  }

  /** Deterministically start the brainstorm session with stable IDs. */
  startSession(): boolean {
    const snapshot = this.session.getSnapshot();
    if (snapshot.lifecycle !== "not-started") {
      throw new BrainstormingAgentError(
        "session-already-started",
        `Brainstorm session already started (${snapshot.lifecycle})`,
      );
    }
    this.session.startSession({
      expectedRevision: 0,
      sessionId: createStableId("brainstorm-session"),
      briefFrameId: createStableId("brief-frame"),
      size: DEFAULT_BRIEF_FRAME_SIZE,
    });
    this.trace.push({
      traceId: "brainstorm",
      type: "session/started",
      at: Date.now(),
      data: { sessionId: this.session.getSnapshot().sessionId },
    });
    return true;
  }

  /** Run one user turn through the brainstorming agent loop. */
  async handleTurn(userInput: string): Promise<BrainstormTurnResult> {
    const traceId = `brainstorm-${createStableId("turn")}`;
    if (!this.isSessionStarted()) {
      this.startSession();
    }

    this.trace.push({
      traceId,
      type: "session/input-admitted",
      at: Date.now(),
      data: { characters: userInput.length },
    });
    this.transcript.append({ kind: "user", content: userInput });

    const context = this.buildToolContext(traceId);
    const toolDefinitions = this.tools.map(renderToolDefinition);
    const usage: Array<ProviderResult["usage"]> = [];
    let step = 0;
    let toolCallCount = 0;
    let repeatedFailure = 0;
    let lastFailureKey: string | null = null;

    while (step < this.config.brainstorm.maxSteps) {
      step += 1;
      const messages = this.assembleMessages();
      this.trace.push({
        traceId,
        type: "brainstorm/provider-started",
        at: Date.now(),
        data: { step, model: this.config.brainstorm.model },
      });

      let result: ProviderResult;
      try {
        result = await this.provider.complete({
          model: this.config.brainstorm.model,
          messages,
          tools: toolDefinitions,
        });
      } catch (error) {
        this.trace.push({
          traceId,
          type: "brainstorm/provider-failed",
          at: Date.now(),
          data: { step, message: error instanceof Error ? error.message : String(error) },
        });
        throw new BrainstormingAgentError(
          "provider-error",
          `Brainstorm provider call failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      usage.push(result.usage);
      this.trace.push({
        traceId,
        type: "brainstorm/provider-ended",
        at: Date.now(),
        data: { step, stopReason: result.stopReason, usage: result.usage },
      });

      if (result.toolCalls.length === 0) {
        this.transcript.append({ kind: "assistant", content: result.content });
        this.trace.push({
          traceId,
          type: "brainstorm/assistant-message",
          at: Date.now(),
          data: { step, characters: result.content.length },
        });
        this.trace.push({ traceId, type: "turn/ended", at: Date.now(), data: { step } });
        return {
          assistantMessage: result.content,
          turnCount: step,
          toolCallCount,
          startedSession: true,
          usage,
        };
      }

      for (const toolCall of result.toolCalls) {
        toolCallCount += 1;
        const outcome = await this.executeToolCall(toolCall, context, traceId);
        if (outcome === "failed") {
          const failureKey = `${toolCall.name}`;
          repeatedFailure = failureKey === lastFailureKey ? repeatedFailure + 1 : 1;
          lastFailureKey = failureKey;
          if (repeatedFailure >= 3) {
            throw new BrainstormingAgentError(
              "repeated-failure",
              `Tool "${toolCall.name}" failed repeatedly; stopping`,
            );
          }
        } else {
          repeatedFailure = 0;
          lastFailureKey = null;
        }
      }
    }

    this.trace.push({ traceId, type: "turn/ended", at: Date.now(), data: { step, exhausted: true } });
    throw new BrainstormingAgentError(
      "step-budget-exhausted",
      `Brainstorming agent exceeded ${this.config.brainstorm.maxSteps} steps for this turn`,
    );
  }

  private assembleMessages(): ProviderMessage[] {
    const windowed = this.transcript.window(this.config.brainstorm.maxSteps * 3 + 6);
    const messages: ProviderMessage[] = [
      { role: "system", content: BRAINSTORM_SYSTEM_PROMPT },
    ];
    const current = this.session.getSnapshot();
    if (current.briefFrame) {
      const brief = current.briefFrame.content;
      const briefLine = [
        `Current brief:`,
        `- projectDescription: ${brief.projectDescription || "(empty)"}`,
        `- audience: ${brief.audience || "(empty)"}`,
        `- goals: ${brief.goals.length ? brief.goals.join("; ") : "(empty)"}`,
        `- visualDirection: ${brief.visualDirection || "(empty)"}`,
        `- openQuestions: ${brief.openQuestions.length ? brief.openQuestions.join("; ") : "(none)"}`,
        `- confirmedDecisions: ${brief.confirmedDecisions.length ? brief.confirmedDecisions.map((d) => d.statement).join("; ") : "(none)"}`,
      ].join("\n");
      messages.push({ role: "system", content: briefLine });
    }
    if (this.skills.length > 0) {
      const skillBlock = [
        "Active skills:",
        ...this.skills.map((skill) => `[${skill.name}] ${skill.description}\n${skill.prompt.trim()}`),
      ].join("\n\n");
      messages.push({ role: "system", content: skillBlock });
    }
    for (const entry of windowed) {
      switch (entry.kind) {
        case "user":
          messages.push({ role: "user", content: entry.content });
          break;
        case "assistant":
          messages.push({ role: "assistant", content: entry.content });
          break;
        case "tool-call":
          messages.push({ role: "assistant", content: "", toolCalls: [entry.toolCall] });
          break;
        case "tool-result":
          messages.push({ role: "tool", toolCallId: entry.toolCallId, content: entry.content });
          break;
        case "system":
          messages.push({ role: "system", content: entry.content });
          break;
      }
    }
    return this.trimToBudget(messages, this.config.brainstorm.maxContextChars);
  }

  /**
   * Enforce the context budget without ever leaving a tool-result without its
   * tool-call. Drops whole leading messages, pairing each tool result with the
   * tool call that preceded it so provider-visible messages stay valid.
   */
  private trimToBudget(messages: ProviderMessage[], maxChars: number): ProviderMessage[] {
    const total = messages.reduce((sum, message) => sum + messageSize(message), 0);
    if (total <= maxChars) return messages;

    const kept: ProviderMessage[] = [];
    let used = 0;
    const callIds = new Set<string>();
    for (const message of messages) {
      if (message.role === "tool") {
        if (!callIds.has(message.toolCallId)) continue;
      } else if (message.role === "assistant" && message.toolCalls?.length) {
        for (const call of message.toolCalls) callIds.add(call.id);
      }
      if (used + messageSize(message) > maxChars && kept.length > 0) break;
      kept.push(message);
      used += messageSize(message);
    }
    // The budget break can strand a tool-call without its result (and, after
    // dropping the call, a result without its call). Providers reject
    // unpaired tool messages, so drop them until every pair is complete.
    for (;;) {
      const calls = new Set<string>();
      const results = new Set<string>();
      for (const message of kept) {
        if (message.role === "assistant") {
          for (const call of message.toolCalls ?? []) calls.add(call.id);
        } else if (message.role === "tool") {
          results.add(message.toolCallId);
        }
      }
      const unpaired = kept.findIndex((message) =>
        (message.role === "assistant" &&
          (message.toolCalls ?? []).some((call) => !results.has(call.id))) ||
        (message.role === "tool" && !calls.has(message.toolCallId)));
      if (unpaired === -1) return kept;
      kept.splice(unpaired, 1);
    }
  }

  private buildToolContext(traceId: string): HarnessToolContext {
    return {
      session: this.session,
      documentExchange: this.documentExchange,
      mainAgent: this.mainAgent,
      draftAgent: this.draftAgent,
      trace: this.trace,
      traceId,
      maxToolResultChars: this.config.brainstorm.maxToolResultChars,
      createId: this.createId,
      resolveFrame: (frameId) => this.resolveFrame(frameId),
      listFrames: () => this.listFrames(),
    };
  }

  private listFrames(): FrameResolution[] {
    const state = this.store.getState();
    return Object.values(state.frames)
      .map((frame) => this.resolveFrame(frame.id))
      .filter((frame): frame is FrameResolution => frame !== null)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }

  private resolveFrame(frameId: string): FrameResolution | null {
    const state = this.store.getState();
    const frame = state.frames[frameId];
    if (!frame) return null;
    const document = state.documents[frame.documentId];
    if (!document) return null;
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
  }

  private async executeToolCall(
    toolCall: ToolCall,
    context: HarnessToolContext,
    traceId: string,
  ): Promise<"ok" | "failed"> {
    const tool = this.toolByName.get(toolCall.name);
    if (!tool) {
      this.transcript.append({
        kind: "tool-result",
        toolCallId: toolCall.id,
        content: `Unknown tool: ${toolCall.name}`,
      });
      this.trace.push({
        traceId,
        type: "brainstorm/tool-failed",
        at: Date.now(),
        data: { tool: toolCall.name, reason: "unknown-tool" },
      });
      return "failed";
    }

    this.trace.push({
      traceId,
      type: "brainstorm/tool-call",
      at: Date.now(),
      data: { tool: toolCall.name, arguments: toolCall.arguments },
    });
    this.transcript.append({ kind: "tool-call", toolCall });

    let args: Record<string, unknown>;
    try {
      args = parseToolArguments(toolCall.arguments, toolCall.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid tool arguments";
      this.transcript.append({ kind: "tool-result", toolCallId: toolCall.id, content: message });
      this.trace.push({
        traceId,
        type: "brainstorm/tool-failed",
        at: Date.now(),
        data: { tool: toolCall.name, reason: "invalid-arguments", message },
      });
      return "failed";
    }

    if (tool.permission !== "allow") {
      let allowed = false;
      if (tool.permission === "ask" && !this.denyAsk) {
        allowed = this.onPermissionRequest
          ? await this.onPermissionRequest(toolCall.name, args)
          : true;
      }
      if (!allowed) {
        const content = `Permission denied for tool ${toolCall.name}`;
        this.transcript.append({ kind: "tool-result", toolCallId: toolCall.id, content });
        this.trace.push({
          traceId,
          type: "brainstorm/tool-failed",
          at: Date.now(),
          data: { tool: toolCall.name, reason: "permission-denied" },
        });
        return "failed";
      }
    }

    try {
      const content = await tool.execute(args, context);
      this.transcript.append({ kind: "tool-result", toolCallId: toolCall.id, content });
      this.trace.push({
        traceId,
        type: "brainstorm/tool-result",
        at: Date.now(),
        data: { tool: toolCall.name },
      });
      return "ok";
    } catch (error) {
      const content = `Tool "${toolCall.name}" failed: ${error instanceof Error ? error.message : String(error)}`;
      this.transcript.append({ kind: "tool-result", toolCallId: toolCall.id, content });
      this.trace.push({
        traceId,
        type: "brainstorm/tool-failed",
        at: Date.now(),
        data: { tool: toolCall.name, message: content },
      });
      return "failed";
    }
  }
}

function defaultConfig(): HarnessConfig {
  return {
    brainstorm: {
      model: "deepseek-v4-flash",
      maxSteps: 8,
      maxContextChars: 24_000,
      maxToolResultChars: 6_000,
    },
    draft: {
      model: "deepseek-v4-flash",
      maxRepairs: 1,
      maxHtmlChars: 200_000,
    },
    main: {
      model: "gpt-5.6-luna",
      maxRepairs: 2,
      maxHtmlChars: 200_000,
    },
  };
}

function mergeConfig(partial: Partial<HarnessConfig>): HarnessConfig {
  const base = defaultConfig();
  return {
    brainstorm: { ...base.brainstorm, ...(partial.brainstorm ?? {}) },
    draft: { ...base.draft, ...(partial.draft ?? {}) },
    main: { ...base.main, ...(partial.main ?? {}) },
  };
}

export { BRAINSTORM_OPENING_PROMPT };
