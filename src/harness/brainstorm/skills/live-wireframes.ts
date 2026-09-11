import type { MainGenerationInput } from "../../main/prompts";
import {
  buildWireframeOutline,
  getWireframeElementHtml,
  renderWireframeOutline,
  alignReplacementToOriginal,
} from "./wireframe-outline";
import {
  createWireframeOnCanvas,
  requireFrame,
  boundResult,
  type HarnessTool,
  type HarnessToolContext,
} from "../tools";

export const LIVE_WIREFRAME_SKILL_NAME = "live-wireframes" as const;
export const LIVE_WIREFRAME_SKILL_VERSION = 1 as const;

export interface HarnessSkill {
  name: string;
  description: string;
  /** Extra system-prompt guidance injected while the skill is active. */
  prompt: string;
  tools: HarnessTool[];
}

export const LIVE_WIREFRAME_SKILL_PROMPT = `Live wireframe co-design is active. The canvas is your shared scratchpad: keep visible artifacts on it at all times and iterate on them with the user in real time.

Working style:
1. When the user wants to see options or you propose exploring "different kinds" of designs, call live.explore_variants once with 2-4 genuinely distinct directions (layout, density, navigation pattern, hierarchy). Never produce near-duplicates. Then compare the variants briefly, state which one you would pick and why, and ask which to keep.
2. Call live.list_wireframes whenever you are unsure what is already on the canvas. Always refer to frames by their frameId.
3. When the user pinpoints something ("this header", "the pricing card", "that button"), resolve it concretely before editing: call live.inspect_wireframe on the frame, find the element index that matches what they pointed at, then call live.pinpoint_edit with that elementIndex and their instruction. Pinpoint edits touch exactly one element; prefer them over redrafting.
4. Use brainstorm.edit_wireframe only when the user asks for a structural rethink of the whole frame, and main.generate_wireframe only for the final approved handoff.
5. After every visual change, say in one short line what changed and invite the next reaction ("keep going?", "want the nav condensed too?"). Keep the loop fast: draft -> react -> pinpoint -> repeat.

If the user's pinpoint description matches multiple elements, inspect first and either pick the closest match or ask one clarifying question.`;

function listWireframesTool(): HarnessTool {
  return {
    name: "live.list_wireframes",
    description: "List every wireframe frame currently on the brainstorm canvas with its frameId, name, size, and document revision. Use before referencing frames so you always cite real frameIds.",
    parameters: { type: "object", properties: {} },
    permission: "allow",
    async execute(_args, context) {
      const frames = context.listFrames().filter((frame) => frame.mode === "wireframe");
      if (frames.length === 0) {
        return "No wireframes on the canvas yet. Use live.explore_variants or brainstorm.draft_wireframe to create the first one.";
      }
      const lines = frames.map((frame) =>
        [
          `- ${frame.name}`,
          `frameId: ${frame.frameId}`,
          `${frame.width}x${frame.height} at (${frame.x}, ${frame.y})`,
          `documentRevision: ${frame.documentRevision}`,
        ].join(" | "),
      );
      return boundResult(lines.join("\n"), context.maxToolResultChars);
    },
  };
}

function inspectWireframeTool(): HarnessTool {
  return {
    name: "live.inspect_wireframe",
    description: "Inspect a wireframe frame's structure: a numbered element outline of its body. Each line shows [elementIndex] plus tag, id, classes, role, and direct text. Use the indexes with live.pinpoint_edit.",
    parameters: {
      type: "object",
      properties: {
        frameId: { type: "string", description: "Id of the frame to inspect" },
        maxElements: { type: "number", description: "Optional cap on outline lines (default 160)" },
      },
      required: ["frameId"],
    },
    permission: "allow",
    async execute(args, context) {
      const frameId = requireString(args, "frameId");
      const maxElements = typeof args["maxElements"] === "number" && Number.isFinite(args["maxElements"])
        ? Math.max(1, Math.min(400, Math.floor(args["maxElements"])))
        : undefined;
      const frame = requireFrame(context, frameId);
      const snapshot = context.documentExchange.getHtml(frame.documentId);
      const entries = buildWireframeOutline(snapshot.html, maxElements);
      const header = `Outline of "${frame.name}" (frameId: ${frame.frameId}, documentRevision: ${snapshot.revision})`;
      return boundResult(`${header}\n${renderWireframeOutline(entries)}`, context.maxToolResultChars);
    },
  };
}

function pinpointEditTool(): HarnessTool {
  return {
    name: "live.pinpoint_edit",
    description: "Apply the user's pinpointed change to exactly one element of a wireframe. Get elementIndex from live.inspect_wireframe first. Only the targeted element is rewritten; the rest of the frame is preserved verbatim.",
    parameters: {
      type: "object",
      properties: {
        frameId: { type: "string", description: "Id of the frame containing the element" },
        elementIndex: { type: "number", description: "Element index from live.inspect_wireframe" },
        instruction: { type: "string", description: "What to change about this specific element" },
      },
      required: ["frameId", "elementIndex", "instruction"],
    },
    permission: "ask",
    async execute(args, context) {
      const frameId = requireString(args, "frameId");
      const instruction = requireString(args, "instruction");
      const elementIndex = args["elementIndex"];
      if (typeof elementIndex !== "number" || !Number.isSafeInteger(elementIndex) || elementIndex < 0) {
        throw new Error('Tool argument "elementIndex" must be a non-negative integer');
      }
      const frame = requireFrame(context, frameId);
      const snapshot = context.documentExchange.getHtml(frame.documentId);
      const currentTargetHtml = getWireframeElementHtml(snapshot.html, elementIndex);
      if (!currentTargetHtml) {
        const count = buildWireframeOutline(snapshot.html).length;
        throw new Error(
          `No element at index ${elementIndex} in "${frame.name}". Run live.inspect_wireframe again; the frame has ${count} elements.`,
        );
      }

      const input: MainGenerationInput = {
        frame: {
          name: frame.name,
          width: frame.width,
          height: frame.height,
          intent: instruction,
          viewport: "desktop",
        },
        brief: "",
        mode: "wireframe",
        kind: "edit",
        quality: "draft",
        currentHtml: snapshot.html,
        editInstruction: [
          "SURGICAL EDIT. Change ONLY this exact element:",
          currentTargetHtml,
          `Change requested: ${instruction}`,
          "Every other element, attribute, text node, and CSS rule must stay exactly as-is. Output the complete HTML document.",
        ].join("\n"),
      };

      const generation = await context.draftAgent.generateWireframe(input);
      const alignedHtml = alignReplacementToOriginal(snapshot.html, elementIndex, generation.html);
      const finalHtml = alignedHtml ?? generation.html;
      const replaced = context.documentExchange.replaceHtml({
        documentId: frame.documentId,
        expectedRevision: snapshot.revision,
        html: finalHtml,
        mode: "wireframe",
      });
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
          pinpoint: true,
          elementIndex,
          preservedOriginal: alignedHtml !== null,
        },
      });
      const summary = [
        `Pinpointed change applied to element [${elementIndex}] in "${frame.name}" (frameId: ${frame.frameId}).`,
        alignedHtml === null
          ? "Note: the engine output drifted from the original structure, so the full regenerated document was used."
          : "Rest of the frame preserved untouched.",
        `documentRevision: ${replaced.revision} (was ${replaced.previousRevision})`,
      ].join("\n");
      return boundResult(summary, context.maxToolResultChars);
    },
  };
}

const MAX_VARIANTS = 4;
const MIN_VARIANTS = 2;
const VARIANT_GAP_PX = 80;

function exploreVariantsTool(): HarnessTool {
  return {
    name: "live.explore_variants",
    description: "Generate 2-4 genuinely different design directions for the same purpose as separate draft frames side by side on the canvas, for the user to compare and react to. Use when brainstorming what designs are possible.",
    parameters: {
      type: "object",
      properties: {
        frameName: { type: "string", description: "Short base name shared by the variants, e.g. Landing hero" },
        intent: { type: "string", description: "What each variant should accomplish in plain language" },
        viewport: { type: "string", description: "mobile, tablet, desktop, or similar" },
        width: { type: "number", description: "Variant frame width in px" },
        height: { type: "number", description: "Variant frame height in px" },
        x: { type: "number", description: "Canvas x position of the leftmost variant" },
        y: { type: "number", description: "Canvas y position (all variants share it)" },
        background: { type: "string", description: "Plain CSS background color, e.g. #ffffff" },
        directions: {
          type: "array",
          items: { type: "string" },
          description: "2-4 distinct design directions to compare, e.g. minimal single-column, bold split hero, card grid",
        },
      },
      required: ["frameName", "intent", "viewport", "width", "height", "x", "y", "background", "directions"],
    },
    permission: "ask",
    async execute(args, context) {
      const frameName = requireString(args, "frameName");
      const intent = requireString(args, "intent");
      const viewport = requireString(args, "viewport");
      const width = requireNumber(args, "width");
      const height = requireNumber(args, "height");
      const x = requireNumber(args, "x");
      const y = requireNumber(args, "y");
      const background = requireColor(args, "background");
      const directions = requireDirectionList(args);

      const created: Array<{ direction: string; frameId: string }> = [];
      for (const [variantIndex, direction] of directions.entries()) {
        const placement = {
          frameName: truncateName(`${frameName} v${variantIndex + 1} - ${direction}`),
          intent: `${intent}. Design direction to explore: ${direction}`,
          viewport,
          width,
          height,
          x: x + variantIndex * (width + VARIANT_GAP_PX),
          y,
          background,
        };
        const input: MainGenerationInput = {
          frame: {
            name: placement.frameName,
            width,
            height,
            intent: placement.intent,
            viewport,
          },
          brief: "",
          mode: "wireframe",
          kind: "create",
          quality: "draft",
        };
        const generation = await context.draftAgent.generateWireframe(input);
        const result = createWireframeOnCanvas(context, placement, generation.html);
        context.trace.push({
          traceId: context.traceId,
          type: "wireframe/created",
          at: Date.now(),
          data: {
            frameId: result.frameId,
            documentRevision: result.documentRevision,
            sessionRevision: result.sessionRevision,
            htmlBytes: result.htmlBytes,
            attempts: generation.attempts,
            variantIndex,
            variantTotal: directions.length,
            direction,
          },
        });
        created.push({ direction, frameId: result.frameId });
      }

      const summary = [
        `Explored ${created.length} design directions for "${frameName}" (${viewport}, ${width}x${height} each):`,
        ...created.map((variant) => `- ${variant.direction} -> frameId: ${variant.frameId}`),
        "Compare them for the user, say which you would pick and why, and ask which direction to keep refining.",
      ].join("\n");
      return boundResult(summary, context.maxToolResultChars);
    },
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
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

function requireDirectionList(args: Record<string, unknown>): string[] {
  const value = args["directions"];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error('Tool argument "directions" must be an array of strings');
  }
  const directions = value
    .map((item) => (item as string).trim())
    .filter((item) => item.length > 0);
  if (directions.length < MIN_VARIANTS || directions.length > MAX_VARIANTS) {
    throw new Error(`Provide between ${MIN_VARIANTS} and ${MAX_VARIANTS} distinct design directions`);
  }
  if (new Set(directions.map((direction) => direction.toLowerCase())).size !== directions.length) {
    throw new Error("Design directions must be distinct from each other");
  }
  return directions;
}

function truncateName(name: string): string {
  return name.length > 60 ? `${name.slice(0, 57)}...` : name;
}

export function createLiveWireframesSkill(): HarnessSkill {
  return {
    name: LIVE_WIREFRAME_SKILL_NAME,
    description: "Live wireframe co-design: put drafts on the canvas instantly, explore contrasting directions side by side, and apply pinpoint edits to whatever the user points at.",
    prompt: LIVE_WIREFRAME_SKILL_PROMPT,
    tools: [
      listWireframesTool(),
      inspectWireframeTool(),
      pinpointEditTool(),
      exploreVariantsTool(),
    ],
  };
}
