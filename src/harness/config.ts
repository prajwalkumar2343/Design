import type { ModelProvider } from "./provider/types";

export type MainModelId =
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "gpt-5.6-luna"
  | "gpt-5.6-terra"
  | "gpt-5.6-sol";

export type BrainstormModelId = MainModelId;

export interface ModelSelection {
  provider: ModelProvider;
  model: string;
}

export interface EngineSettings {
  model: string;
  /** Maximum regeneration attempts on wireframe admission failure. */
  maxRepairs: number;
  /** Hard output cap for generated HTML before admission. */
  maxHtmlChars: number;
}

export interface HarnessConfig {
  brainstorm: {
    model: string;
    /** Maximum provider steps per user turn. */
    maxSteps: number;
    /** Maximum characters of transcript fed to the model per turn. */
    maxContextChars: number;
    /** Maximum characters of a single tool result fed back to the model. */
    maxToolResultChars: number;
  };
  /**
   * Quick drafting engine used by the brainstorming agent for fast
   * wireframes and edits. Defaults to a fast, cheap model.
   */
  draft: EngineSettings;
  /**
   * Final handoff engine. The Main Agent only outputs HTML; this model is
   * reserved for the polished final pass on approved frames.
   */
  main: EngineSettings;
}

export const DEFAULT_MODEL: MainModelId = "deepseek-v4-flash";

export const DEFAULT_CONFIG: HarnessConfig = {
  brainstorm: {
    model: DEFAULT_MODEL,
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
