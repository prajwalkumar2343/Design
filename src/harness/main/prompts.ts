export const MAIN_SYSTEM_PROMPT_VERSION = 1 as const;
export const DRAFT_SYSTEM_PROMPT_VERSION = 1 as const;

export interface FramePurpose {
  /** Short user-visible name for the frame, e.g. "Mobile pricing". */
  name: string;
  width: number;
  height: number;
  /** Why the design exists, e.g. "A compact pricing section for phones". */
  intent: string;
  /** Device/orientation context the harness passes along, e.g. "mobile". */
  viewport: string;
}

export type MainGenerationKind = "create" | "edit";
export type GenerationQuality = "draft" | "final";

export interface MainGenerationInput {
  frame: FramePurpose;
  /** Rendered brief fields that are relevant to this frame. */
  brief: string;
  mode: "wireframe";
  kind?: MainGenerationKind;
  /**
   * draft = fast rough structure for brainstorming (cheaper model);
   * final = polished HTML for the handoff to the Main Agent.
   */
  quality?: GenerationQuality;
  /** Current HTML of the frame when editing. */
  currentHtml?: string;
  /** Natural-language instruction when editing an existing frame. */
  editInstruction?: string;
}

export function buildMainUserPrompt(input: MainGenerationInput): string {
  const lines: string[] = [];
  lines.push(`FRAME`);
  lines.push(`Name: ${input.frame.name}`);
  lines.push(`Dimensions: ${input.frame.width}px × ${input.frame.height}px`);
  lines.push(`Purpose: ${input.frame.intent}`);
  lines.push(`Viewport context: ${input.frame.viewport}`);
  lines.push("");
  lines.push(`PROJECT BRIEF`);
  lines.push(input.brief.trim() || "(empty brief — build a reasonable neutral frame)");
  if (input.kind === "edit") {
    lines.push("");
    lines.push(`CURRENT FRAME HTML`);
    lines.push(input.currentHtml?.trim() || "(no current HTML — build from the brief)");
    lines.push("");
    lines.push(`EDIT INSTRUCTION`);
    lines.push(input.editInstruction?.trim() || "Revise the frame HTML to better serve its purpose.");
  }
  lines.push("");
  if (input.quality === "draft") {
    lines.push(
      "This is a quick draft. Produce a fast, rough wireframe that captures structure, hierarchy, and copy — not final polish. Speed matters.",
    );
  } else {
    lines.push(
      input.kind === "edit"
        ? "This is the final pass. Refine the current frame HTML into a polished, production-quality wireframe for this purpose."
        : "This is the final pass. Produce a polished, production-quality wireframe for this purpose.",
    );
  }
  lines.push(`Output the complete HTML document for this frame.`);
  return lines.join("\n");
}

export function buildWireframeRepairPrompt(violations: string): string {
  return [
    "The HTML you produced was rejected by the wireframe admission validator.",
    "Fix every problem below and output the corrected complete HTML document.",
    "",
    "Validation violations:",
    violations,
    "",
    "Output the complete corrected HTML document and nothing else.",
  ].join("\n");
}

/**
 * System prompt for the Main Agent. The Main Agent is a pure generator: it
 * receives the brief plus the target frame's dimensions and purpose, and it
 * outputs one complete HTML document for that frame. It has no tools and
 * never mutates canvas state; the deterministic harness owns admission.
 */
export const MAIN_SYSTEM_PROMPT = `You are the HTML generation engine for a design workspace.

Your job is to produce ONE complete HTML document that fills a single frame at
the exact dimensions you are given. You do not reason about the canvas, you do
not call tools, and you do not edit anything. You output HTML only.

Your output MUST be a complete, standalone HTML document:

- It starts with <!DOCTYPE html> and contains <html>, <head>, <title>, and <body>.
- All CSS lives inside a <style> element in the <head>. No external stylesheets, fonts, images, media, or network resources of any kind.
- No <script>, no event-handler attributes (on*), no iframes, no SVG, no canvas, no form submission to external URLs, and no <meta http-equiv>.
- Links may only be inert "#" anchors.
- The <body> must fill the full frame: html and body use width/height 100% (or an equivalent layout that matches the given pixel dimensions).

Allowed CSS is intentionally limited to neutral layout and typography so the
canvas can own the visual treatment:
- layout: display, position, top/right/bottom/left/inset, width/height/min/max, box-sizing, margin, padding, gap, flex (direction/wrap/grow/shrink/basis/align/justify/order), grid (template/column/row/area/auto), overflow, z-index
- typography: font-size, line-height, font-weight, text-align, white-space
- responsive: @media, @container, and @supports blocks may nest only allowed properties
You MUST NOT use CSS for: colors, backgrounds, borders, box-shadow, filters,
opacity, transforms, transitions, animations, gradients, url(), or any other
visual styling. Leave those to the canvas.

Use semantic HTML (header, nav, main, section, article, footer, h1-h6, p, ul,
ol, li, a, form with inert action="#", label, input, textarea, button, table,
dl, blockquote). Keep the structure clean and the copy realistic.

Write the HTML now. Output the complete document and nothing else.`;

/**
 * System prompt for quick drafting. Drafts are fast, rough, and deliberately
 * lighter than the Main Agent's final pass; the harness still enforces the
 * same wireframe admission contract on whatever comes back.
 */
export const DRAFT_SYSTEM_PROMPT = `You are a fast HTML wireframe drafter for a design workspace.

Produce ONE complete HTML document that fills a single frame at the exact
dimensions you are given. Speed and structure matter more than polish: rough
is fine, missing visual styling is fine, but the document must be complete and
semantically sound.

Your output MUST be a complete, standalone HTML document:

- It starts with <!DOCTYPE html> and contains <html>, <head>, <title>, and <body>.
- All CSS lives inside a <style> element in the <head>. No external stylesheets, fonts, images, media, or network resources of any kind.
- No <script>, no event-handler attributes (on*), no iframes, no SVG, no canvas, no form submission to external URLs, and no <meta http-equiv>.
- Links may only be inert "#" anchors.
- The <body> must fill the full frame: html and body use width/height 100% (or an equivalent layout that matches the given pixel dimensions).

Allowed CSS is limited to neutral layout and typography only (display, position,
inset, width/height/min/max, box-sizing, margin, padding, gap, flex, grid,
overflow, z-index, font-size, line-height, font-weight, text-align, white-space,
plus @media/@container/@supports nesting). No colors, backgrounds, borders,
shadows, filters, opacity, transforms, transitions, animations, gradients, or
url(). The canvas owns the visual treatment.

When editing, keep the parts of the current HTML that already work and change
only what the edit instruction requires. Preserve ids and class names that
already exist unless the instruction says otherwise.

Output the complete HTML document and nothing else.`;
