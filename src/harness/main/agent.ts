import { validateWireframeHtml } from "../../router/wireframe-admission";
import { TraceLog } from "../trace";
import type {
  ModelProvider,
  ProviderResult,
  ProviderMessage,
} from "../provider/types";
import type { HarnessConfig } from "../config";
import { extractHtmlFromOutput } from "./extract";
import {
  buildMainUserPrompt,
  buildWireframeRepairPrompt,
  DRAFT_SYSTEM_PROMPT,
  MAIN_SYSTEM_PROMPT,
  type MainGenerationInput,
} from "./prompts";

export interface MainAgentOptions {
  provider: ModelProvider;
  config: HarnessConfig;
  /** Overrides config.main.model (used for the draft-quality engine). */
  model?: string;
  /** Overrides config.main.maxRepairs. */
  maxRepairs?: number;
  /** Overrides config.main.maxHtmlChars. */
  maxHtmlChars?: number;
  trace?: TraceLog;
  traceId?: string;
}

export interface MainGenerationResult {
  html: string;
  htmlBytes: number;
  mode: "wireframe";
  attempts: number;
  repaired: boolean;
  providerResult: ProviderResult;
}

export class MainGenerationError extends Error {
  readonly violations: ReadonlyArray<{ code: string; message: string }>;
  readonly attempts: number;

  constructor(message: string, violations: ReadonlyArray<{ code: string; message: string }>, attempts: number) {
    super(message);
    this.name = "MainGenerationError";
    this.violations = violations;
    this.attempts = attempts;
  }
}

/**
 * Main Agent harness. This is a single-call generator, not a tool-using agent:
 * it assembles context (brief + frame dimensions + purpose), calls the model,
 * and returns HTML that has passed wireframe admission. A bounded repair pass
 * re-prompts only on objective admission failures.
 *
 * The same harness serves two engines: the quick "draft" engine (fast model,
 * rough structure) and the "final" Main Agent engine (polished handoff). Both
 * share the same deterministic admission boundary.
 */
export class MainAgentHarness {
  private readonly provider: ModelProvider;
  private readonly config: HarnessConfig;
  private readonly model: string;
  private readonly maxRepairs: number;
  private readonly maxHtmlChars: number;
  private readonly trace: TraceLog;
  private readonly traceId: string;

  constructor(options: MainAgentOptions) {
    this.provider = options.provider;
    this.config = options.config;
    this.model = options.model ?? options.config.main.model;
    this.maxRepairs = options.maxRepairs ?? options.config.main.maxRepairs;
    this.maxHtmlChars = options.maxHtmlChars ?? options.config.main.maxHtmlChars;
    this.trace = options.trace ?? new TraceLog();
    this.traceId = options.traceId ?? "main";
  }

  async generateWireframe(input: MainGenerationInput): Promise<MainGenerationResult> {
    const systemPrompt = input.quality === "draft" ? DRAFT_SYSTEM_PROMPT : MAIN_SYSTEM_PROMPT;
    const messages: ProviderMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildMainUserPrompt(input) },
    ];

    let lastResult: ProviderResult | null = null;
    let lastViolations: ReadonlyArray<{ code: string; message: string }> = [];

    for (let attempt = 0; attempt <= this.maxRepairs; attempt += 1) {
      if (attempt > 0) {
        const repair = buildWireframeRepairPrompt(
          lastViolations.map((violation) => violation.message).join("\n"),
        );
        messages.push({ role: "user", content: repair });
        this.trace.push({
          traceId: this.traceId,
          type: "main/repair",
          at: Date.now(),
          data: { attempt },
        });
      }

      this.trace.push({
        traceId: this.traceId,
        type: "main/provider-started",
        at: Date.now(),
        data: { attempt, model: this.model },
      });

      let result: ProviderResult;
      try {
        result = await this.provider.complete({
          model: this.model,
          messages,
        });
      } catch (error) {
        this.trace.push({
          traceId: this.traceId,
          type: "main/provider-failed",
          at: Date.now(),
          data: { attempt, message: error instanceof Error ? error.message : String(error) },
        });
        throw error;
      }

      this.trace.push({
        traceId: this.traceId,
        type: "main/provider-ended",
        at: Date.now(),
        data: {
          attempt,
          stopReason: result.stopReason,
          usage: result.usage,
          toolCalls: result.toolCalls.length,
        },
      });
      lastResult = result;

      const { html } = extractHtmlFromOutput(result.content);
      if (html.length > this.maxHtmlChars) {
        lastViolations = [{
          code: "html-too-large",
          message: `HTML is ${html.length} characters; the limit is ${this.maxHtmlChars}`,
        }];
        this.trace.push({
          traceId: this.traceId,
          type: "main/admission-failed",
          at: Date.now(),
          data: { attempt, code: "html-too-large" },
        });
        continue;
      }

      try {
        const validation = validateWireframeHtml(html);
        return {
          html,
          htmlBytes: validation.htmlBytes,
          mode: "wireframe",
          attempts: attempt + 1,
          repaired: attempt > 0,
          providerResult: result,
        };
      } catch (error) {
        const violations = error instanceof Error && "violations" in error && Array.isArray((error as { violations?: unknown }).violations)
          ? ((error as { violations: ReadonlyArray<{ code: string; message: string }> }).violations)
          : [{ code: "invalid-html", message: error instanceof Error ? error.message : "Invalid HTML" }];
        lastViolations = violations;
        this.trace.push({
          traceId: this.traceId,
          type: "main/admission-failed",
          at: Date.now(),
          data: {
            attempt,
            codes: violations.map((violation) => violation.code),
          },
        });
      }
    }

    throw new MainGenerationError(
      "Main Agent could not produce HTML that passes wireframe admission",
      lastViolations,
      this.maxRepairs + 1,
    );
  }
}
