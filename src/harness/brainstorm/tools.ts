import { BrainstormSessionService } from "../../router/brainstorm-session";
import { DocumentExchangeService } from "../../router/document-exchange";
import type {
  BriefContent,
  BriefField,
  BriefFieldUpdate,
  ConfirmedDecision,
  BriefReference,
} from "../../session/model";
import { MainAgentHarness } from "../main/agent";
import type { MainGenerationInput } from "../main/prompts";
import { TraceLog } from "../trace";

export interface FrameResolution {
  frameId: string;
  documentId: string;
  documentRevision: number;
  name: string;
  width: number;
  height: number;
}

export interface HarnessToolContext {
  session: BrainstormSessionService;
  documentExchange: DocumentExchangeService;
  /** Final-quality engine; owns the polished handoff. */
  mainAgent: MainAgentHarness;
  /** Fast drafting/editing engine for quick brainstorming iteration. */
  draftAgent: MainAgentHarness;
  trace: TraceLog;
  traceId: string;
  maxToolResultChars: number;
  createId(prefix: string): string;
  /** Resolve a canvas frame to its document and dimensions, or null. */
  resolveFrame(frameId: string): FrameResolution | null;
}

export interface HarnessTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  permission: "allow" | "ask" | "deny";
  execute(args: Record<string, unknown>, context: HarnessToolContext): Promise<string>;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
  }
  return value;
}

function requireOptionalString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
  }
  return value;
}

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Tool argument "${key}" must be an array of strings`);
  }
  return value;
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Tool argument "${key}" must be a finite number`);
  }
  return value;
}

function requireColor(args: Record<string, unknown>, key: string): string {
  const value = requireString(args, key);
  if (!/^#[0-9a-f]{3,8}$|^[a-zA-Z]+$/i.test(value.trim())) {
    throw new Error(`Tool argument "${key}" must be a plain CSS color`);
  }
  return value.trim();
}

function briefSnapshot(content: BriefContent | null | undefined): BriefContent {
  return content ?? {
    projectDescription: "",
    audience: "",
    goals: [],
    successCriteria: [],
    requiredFeatures: [],
    requiredContent: [],
    visualDirection: "",
    constraints: [],
    references: [],
    openQuestions: [],
    confirmedDecisions: [],
  };
}

const BRIEF_TEXT_FIELDS = new Set(["projectDescription", "audience", "visualDirection"]);
const BRIEF_LIST_FIELDS = new Set([
  "goals",
  "successCriteria",
  "requiredFeatures",
  "requiredContent",
  "constraints",
  "openQuestions",
]);

function requireBriefField(args: Record<string, unknown>): BriefField {
  const field = requireString(args, "field");
  if (!BRIEF_TEXT_FIELDS.has(field) && !BRIEF_LIST_FIELDS.has(field)) {
    throw new Error(`Unknown brief field: ${field}`);
  }
  return field as BriefField;
}

function buildBriefFieldUpdate(
  field: BriefField,
  rawValue: unknown,
): BriefFieldUpdate {
  if (BRIEF_TEXT_FIELDS.has(field)) {
    const value = requireString({ value: rawValue }, "value");
    return { field: field as "projectDescription" | "audience" | "visualDirection", value };
  }
  const value = requireStringArray({ value: rawValue }, "value");
  return { field: field as Exclude<BriefField, "projectDescription" | "audience" | "visualDirection">, value };
}

function renderBrief(content: BriefContent): string {
  const lines: string[] = [];
  const textField = (label: string, value: string) => {
    if (value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  const listField = (label: string, value: string[]) => {
    if (value.length > 0) lines.push(`${label}: ${value.join("; ")}`);
  };
  const referenceField = (value: BriefReference[]) => {
    if (value.length > 0) {
      lines.push(`references: ${value.map((r) => r.label || r.url).join("; ")}`);
    }
  };
  const decisionField = (value: ConfirmedDecision[]) => {
    if (value.length > 0) {
      lines.push(`confirmed decisions: ${value.map((d) => d.statement).join("; ")}`);
    }
  };
  textField("projectDescription", content.projectDescription);
  textField("audience", content.audience);
  listField("goals", content.goals);
  listField("successCriteria", content.successCriteria);
  listField("requiredFeatures", content.requiredFeatures);
  listField("requiredContent", content.requiredContent);
  textField("visualDirection", content.visualDirection);
  listField("constraints", content.constraints);
  referenceField(content.references);
  listField("openQuestions", content.openQuestions);
  decisionField(content.confirmedDecisions);
  return lines.join("\n").trim();
}

function boundResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}…(truncated)`;
}

function currentRevision(context: HarnessToolContext): number {
  return context.session.getSnapshot().revision;
}

function requireFrame(context: HarnessToolContext, frameId: string): FrameResolution {
  const frame = context.resolveFrame(frameId);
  if (!frame) {
    throw new Error(`Unknown frame: ${frameId}`);
  }
  return frame;
}

interface WireframePlacementArgs {
  frameName: string;
  intent: string;
  viewport: string;
  width: number;
  height: number;
  x: number;
  y: number;
  background: string;
}

function parsePlacementArgs(args: Record<string, unknown>): WireframePlacementArgs {
  return {
    frameName: requireString(args, "frameName"),
    intent: requireString(args, "intent"),
    viewport: requireString(args, "viewport"),
    width: requireNumber(args, "width"),
    height: requireNumber(args, "height"),
    x: requireNumber(args, "x"),
    y: requireNumber(args, "y"),
    background: requireColor(args, "background"),
  };
}

function buildGenerationInput(
  context: HarnessToolContext,
  placement: WireframePlacementArgs,
  options: { kind?: "create" | "edit"; quality: "draft" | "final"; currentHtml?: string; editInstruction?: string },
): MainGenerationInput {
  const content = briefSnapshot(context.session.getSnapshot().briefFrame?.content);
  return {
    frame: {
      name: placement.frameName,
      width: placement.width,
      height: placement.height,
      intent: placement.intent,
      viewport: placement.viewport,
    },
    brief: renderBrief(content),
    mode: "wireframe",
    kind: options.kind,
    quality: options.quality,
    currentHtml: options.currentHtml,
    editInstruction: options.editInstruction,
  };
}

function updateBriefFieldTool(): HarnessTool {
  return {
    name: "brainstorm.update_brief",
    description: "Update one brief field with the current conversation understanding. Use for projectDescription, audience, visualDirection, and the list fields goals, successCriteria, requiredFeatures, requiredContent, constraints, openQuestions.",
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: [
            "projectDescription",
            "audience",
            "goals",
            "successCriteria",
            "requiredFeatures",
            "requiredContent",
            "visualDirection",
            "constraints",
            "openQuestions",
          ],
        },
        value: { type: ["string", "array"], items: { type: "string" }, description: "New value for the field. Arrays for list fields, strings for text fields." },
      },
      required: ["field", "value"],
    },
    permission: "allow",
    async execute(args, context) {
      const field = requireBriefField(args);
      const update = buildBriefFieldUpdate(field, args["value"]);
      const revision = currentRevision(context);
      const result = context.session.updateBriefField({ expectedRevision: revision, ...update });
      return `Updated brief field "${field}" (revision ${result.revision}).`;
    },
  };
}

function addReferenceTool(): HarnessTool {
  return {
    name: "brainstorm.add_reference",
    description: "Record an inspiration reference for the project. url must be a valid http(s) link.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Short label for the reference" },
        url: { type: "string", description: "http(s) URL of the reference" },
        note: { type: "string", description: "What to take from it" },
      },
      required: ["label", "url", "note"],
    },
    permission: "allow",
    async execute(args, context) {
      const label = requireString(args, "label");
      const url = requireString(args, "url");
      const note = requireString(args, "note");
      const revision = currentRevision(context);
      const reference: BriefReference = { id: context.createId("ref"), label, url, note };
      const result = context.session.addReference({ expectedRevision: revision, reference });
      return `Added reference "${label}" (revision ${result.revision}).`;
    },
  };
}

function addDecisionTool(): HarnessTool {
  return {
    name: "brainstorm.add_decision",
    description: "Record a confirmed design decision the user has agreed to.",
    parameters: {
      type: "object",
      properties: {
        statement: { type: "string", description: "The confirmed decision" },
        rationale: { type: "string", description: "Why it was chosen" },
      },
      required: ["statement", "rationale"],
    },
    permission: "allow",
    async execute(args, context) {
      const statement = requireString(args, "statement");
      const rationale = requireString(args, "rationale");
      const revision = currentRevision(context);
      const decision: ConfirmedDecision = { id: context.createId("decision"), statement, rationale };
      const result = context.session.addDecision({ expectedRevision: revision, decision });
      return `Recorded confirmed decision (revision ${result.revision}).`;
    },
  };
}

function transitionTool(): HarnessTool {
  return {
    name: "brainstorm.transition",
    description: "Move the brainstorm session to the next lifecycle stage. Only use when the user is satisfied with the brief and ready to build.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", enum: ["wireframing", "completed"] },
      },
      required: ["to"],
    },
    permission: "allow",
    async execute(args, context) {
      const to = requireString(args, "to") as "wireframing" | "completed";
      const revision = currentRevision(context);
      const result = context.session.transitionLifecycle({ expectedRevision: revision, to });
      return `Brainstorm session moved to ${to} (revision ${result.revision}).`;
    },
  };
}

function createWireframeOnCanvas(
  context: HarnessToolContext,
  placement: WireframePlacementArgs,
  html: string,
): { frameId: string; documentId: string; pageId: string; documentRevision: number; sessionRevision: number; htmlBytes: number } {
  const sessionRevision = context.session.getSnapshot().revision;
  const documentId = context.createId("doc");
  const pageId = context.createId("page");
  const frameId = context.createId("frame");
  const created = context.documentExchange.createWireframe({
    mode: "wireframe",
    expectedSessionRevision: sessionRevision,
    documentId,
    pageId,
    frameId,
    documentName: placement.frameName,
    pageName: placement.frameName,
    frameName: placement.frameName,
    html,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    background: placement.background,
  });
  return {
    frameId,
    documentId,
    pageId,
    documentRevision: created.documentRevision,
    sessionRevision: created.sessionRevision,
    htmlBytes: created.htmlBytes,
  };
}

function replaceFrameHtml(
  context: HarnessToolContext,
  frame: FrameResolution,
  html: string,
): { documentId: string; previousRevision: number; revision: number; htmlBytes: number } {
  const replaced = context.documentExchange.replaceHtml({
    documentId: frame.documentId,
    expectedRevision: frame.documentRevision,
    html,
    mode: "wireframe",
  });
  return {
    documentId: frame.documentId,
    previousRevision: replaced.previousRevision,
    revision: replaced.revision,
    htmlBytes: replaced.htmlBytes,
  };
}

/**
 * Quick draft: generate a rough wireframe with the fast drafting engine.
 * Creates a new frame, or replaces an existing frame when frameId is given.
 */
function draftWireframeTool(): HarnessTool {
  return {
    name: "brainstorm.draft_wireframe",
    description: "Quickly draft a rough wireframe HTML for one frame from the current brief. Use for fast brainstorming exploration. Creates a new frame, or pass frameId to replace an existing frame. The fast drafting engine runs; polish comes later.",
    parameters: {
      type: "object",
      properties: {
        frameName: { type: "string", description: "Short name, e.g. Mobile pricing" },
        intent: { type: "string", description: "What the frame should accomplish in plain language" },
        viewport: { type: "string", description: "mobile, tablet, desktop, or similar" },
        width: { type: "number", description: "Frame width in px" },
        height: { type: "number", description: "Frame height in px" },
        x: { type: "number", description: "Canvas x position" },
        y: { type: "number", description: "Canvas y position" },
        background: { type: "string", description: "Plain CSS background color, e.g. #ffffff" },
        frameId: { type: "string", description: "Optional existing frame id to replace with this draft" },
      },
      required: ["frameName", "intent", "viewport", "width", "height", "x", "y", "background"],
    },
    permission: "ask",
    async execute(args, context) {
      const placement = parsePlacementArgs(args);
      const frameId = requireOptionalString(args, "frameId");
      const target = frameId ? requireFrame(context, frameId) : null;
      const input = buildGenerationInput(context, placement, {
        kind: target ? "edit" : "create",
        quality: "draft",
        currentHtml: target
          ? context.documentExchange.getHtml(target.documentId).html
          : undefined,
        editInstruction: target
          ? "Roughly redraft this frame to better serve its purpose. Keep what works, restructure freely."
          : undefined,
      });

      const generation = await context.draftAgent.generateWireframe(input);

      if (target) {
        const replaced = replaceFrameHtml(context, target, generation.html);
        context.trace.push({
          traceId: context.traceId,
          type: "wireframe/edited",
          at: Date.now(),
          data: {
            frameId: target.frameId,
            previousRevision: replaced.previousRevision,
            documentRevision: replaced.revision,
            htmlBytes: replaced.htmlBytes,
            attempts: generation.attempts,
          },
        });
        const summary = [
          `Redrafted wireframe "${placement.frameName}" with the fast engine.`,
          `frameId: ${target.frameId}`,
          `documentRevision: ${replaced.revision} (was ${replaced.previousRevision})`,
          `htmlBytes: ${replaced.htmlBytes}`,
        ].join("\n");
        return boundResult(summary, context.maxToolResultChars);
      }

      const created = createWireframeOnCanvas(context, placement, generation.html);
      context.trace.push({
        traceId: context.traceId,
        type: "wireframe/created",
        at: Date.now(),
        data: {
          frameId: created.frameId,
          documentRevision: created.documentRevision,
          sessionRevision: created.sessionRevision,
          htmlBytes: created.htmlBytes,
          attempts: generation.attempts,
        },
      });
      const summary = [
        `Drafted wireframe "${placement.frameName}" (${placement.viewport}, ${placement.width}×${placement.height}).`,
        `frameId: ${created.frameId}`,
        `documentId: ${created.documentId}`,
        `pageId: ${created.pageId}`,
        `documentRevision: ${created.documentRevision}`,
        `sessionRevision: ${created.sessionRevision}`,
        `htmlBytes: ${created.htmlBytes}`,
        `generation attempts: ${generation.attempts}`,
      ].join("\n");
      return boundResult(summary, context.maxToolResultChars);
    },
  };
}

/**
 * Edit an existing wireframe: the fast engine revises the current HTML in
 * place per a natural-language instruction. Frames remain untouched unless
 * the revised HTML passes wireframe admission.
 */
function editWireframeTool(): HarnessTool {
  return {
    name: "brainstorm.edit_wireframe",
    description: "Edit an existing wireframe frame with the fast drafting engine. Reads the frame's current HTML, applies your natural-language edit instruction, validates the result, and replaces the frame HTML in place.",
    parameters: {
      type: "object",
      properties: {
        frameId: { type: "string", description: "Id of the existing frame to edit" },
        editInstruction: { type: "string", description: "What to change in plain language" },
        frameName: { type: "string", description: "Optional updated frame name" },
        viewport: { type: "string", description: "Optional updated viewport context" },
      },
      required: ["frameId", "editInstruction"],
    },
    permission: "ask",
    async execute(args, context) {
      const frameId = requireString(args, "frameId");
      const editInstruction = requireString(args, "editInstruction");
      const frameName = requireOptionalString(args, "frameName") ?? null;
      const viewport = requireOptionalString(args, "viewport") ?? "desktop";
      const frame = requireFrame(context, frameId);
      const currentHtml = context.documentExchange.getHtml(frame.documentId).html;
      const placement: WireframePlacementArgs = {
        frameName: frameName ?? frame.name,
        intent: editInstruction,
        viewport,
        width: frame.width,
        height: frame.height,
        x: 0,
        y: 0,
        background: "#ffffff",
      };
      const input = buildGenerationInput(context, placement, {
        kind: "edit",
        quality: "draft",
        currentHtml,
        editInstruction,
      });

      const generation = await context.draftAgent.generateWireframe(input);
      const replaced = replaceFrameHtml(context, frame, generation.html);
      context.trace.push({
        traceId: context.traceId,
        type: "wireframe/edited",
        at: Date.now(),
        data: {
          frameId: frame.frameId,
          previousRevision: replaced.previousRevision,
          documentRevision: replaced.revision,
          htmlBytes: replaced.htmlBytes,
          attempts: generation.attempts,
        },
      });
      const summary = [
        `Edited wireframe "${frame.name}" (frameId: ${frame.frameId}).`,
        `documentRevision: ${replaced.revision} (was ${replaced.previousRevision})`,
        `htmlBytes: ${replaced.htmlBytes}`,
        `generation attempts: ${generation.attempts}`,
      ].join("\n");
      return boundResult(summary, context.maxToolResultChars);
    },
  };
}

/**
 * Final handoff: the Main Agent produces the polished final HTML for an
 * approved frame. Creates a new frame, or replaces an existing one when
 * frameId is given (the handover target).
 */
function generateWireframeTool(): HarnessTool {
  return {
    name: "main.generate_wireframe",
    description: "Final design handoff: the Main Agent produces the polished, final HTML wireframe for an approved frame from the current brief. Creates a new frame, or pass frameId to hand off into an existing draft frame.",
    parameters: {
      type: "object",
      properties: {
        frameName: { type: "string", description: "Short name, e.g. Mobile pricing" },
        intent: { type: "string", description: "What the frame should accomplish in plain language" },
        viewport: { type: "string", description: "mobile, tablet, desktop, or similar" },
        width: { type: "number", description: "Frame width in px" },
        height: { type: "number", description: "Frame height in px" },
        x: { type: "number", description: "Canvas x position" },
        y: { type: "number", description: "Canvas y position" },
        background: { type: "string", description: "Plain CSS background color, e.g. #ffffff" },
        frameId: { type: "string", description: "Optional existing frame id to replace with the final design" },
      },
      required: ["frameName", "intent", "viewport", "width", "height", "x", "y", "background"],
    },
    permission: "ask",
    async execute(args, context) {
      const placement = parsePlacementArgs(args);
      const frameId = requireOptionalString(args, "frameId");
      const target = frameId ? requireFrame(context, frameId) : null;
      const input = buildGenerationInput(context, placement, {
        kind: target ? "edit" : "create",
        quality: "final",
        currentHtml: target
          ? context.documentExchange.getHtml(target.documentId).html
          : undefined,
        editInstruction: target
          ? "Finalize this frame: polish the structure, spacing, hierarchy, and copy. Keep the approved direction; make it production-quality."
          : undefined,
      });

      const generation = await context.mainAgent.generateWireframe(input);

      if (target) {
        const replaced = replaceFrameHtml(context, target, generation.html);
        context.trace.push({
          traceId: context.traceId,
          type: "wireframe/edited",
          at: Date.now(),
          data: {
            frameId: target.frameId,
            previousRevision: replaced.previousRevision,
            documentRevision: replaced.revision,
            htmlBytes: replaced.htmlBytes,
            attempts: generation.attempts,
            quality: "final",
          },
        });
        const summary = [
          `Final design placed into frame "${target.name}" (frameId: ${target.frameId}).`,
          `documentRevision: ${replaced.revision} (was ${replaced.previousRevision})`,
          `htmlBytes: ${replaced.htmlBytes}`,
          `generation attempts: ${generation.attempts}`,
        ].join("\n");
        return boundResult(summary, context.maxToolResultChars);
      }

      const created = createWireframeOnCanvas(context, placement, generation.html);
      context.trace.push({
        traceId: context.traceId,
        type: "wireframe/created",
        at: Date.now(),
        data: {
          frameId: created.frameId,
          documentRevision: created.documentRevision,
          sessionRevision: created.sessionRevision,
          htmlBytes: created.htmlBytes,
          attempts: generation.attempts,
          quality: "final",
        },
      });
      const summary = [
        `Final wireframe "${placement.frameName}" (${placement.viewport}, ${placement.width}×${placement.height}).`,
        `frameId: ${created.frameId}`,
        `documentId: ${created.documentId}`,
        `pageId: ${created.pageId}`,
        `documentRevision: ${created.documentRevision}`,
        `sessionRevision: ${created.sessionRevision}`,
        `htmlBytes: ${created.htmlBytes}`,
        `generation attempts: ${generation.attempts}`,
      ].join("\n");
      return boundResult(summary, context.maxToolResultChars);
    },
  };
}

export function createBrainstormTools(): HarnessTool[] {
  return [
    updateBriefFieldTool(),
    addReferenceTool(),
    addDecisionTool(),
    transitionTool(),
    draftWireframeTool(),
    editWireframeTool(),
    generateWireframeTool(),
  ];
}
