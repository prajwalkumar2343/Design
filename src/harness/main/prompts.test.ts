import { describe, expect, it } from "vitest";

import { buildMainUserPrompt, buildWireframeRepairPrompt, type MainGenerationInput } from "./prompts";

function input(overrides: Partial<MainGenerationInput> = {}): MainGenerationInput {
  return {
    frame: {
      name: "Mobile pricing",
      width: 390,
      height: 844,
      intent: "A compact pricing section for phones",
      viewport: "mobile",
    },
    brief: "projectDescription: A planning tool",
    mode: "wireframe",
    ...overrides,
  };
}

describe("buildMainUserPrompt", () => {
  it("lays out the frame, brief, and final-pass instruction for a create", () => {
    const prompt = buildMainUserPrompt(input());

    expect(prompt).toContain("Name: Mobile pricing");
    expect(prompt).toContain("Dimensions: 390px × 844px");
    expect(prompt).toContain("Purpose: A compact pricing section for phones");
    expect(prompt).toContain("Viewport context: mobile");
    expect(prompt).toContain("projectDescription: A planning tool");
    expect(prompt).toContain(
      "This is the final pass. Produce a polished, production-quality wireframe for this purpose.",
    );
    expect(prompt).toContain("Output the complete HTML document for this frame.");
    expect(prompt).not.toContain("CURRENT FRAME HTML");
    expect(prompt).not.toContain("EDIT INSTRUCTION");
  });

  it("marks empty briefs and draft quality explicitly", () => {
    const prompt = buildMainUserPrompt(input({ brief: "   ", quality: "draft" }));

    expect(prompt).toContain("(empty brief — build a reasonable neutral frame)");
    expect(prompt).toContain("This is a quick draft.");
    expect(prompt).not.toContain("final pass");
  });

  it("threads the current HTML and edit instruction into an edit prompt", () => {
    const prompt = buildMainUserPrompt(input({
      kind: "edit",
      currentHtml: "<!DOCTYPE html><html><body><h1>Old</h1></body></html>",
      editInstruction: "Tighten the spacing",
    }));

    expect(prompt).toContain("CURRENT FRAME HTML");
    expect(prompt).toContain("<h1>Old</h1>");
    expect(prompt).toContain("EDIT INSTRUCTION");
    expect(prompt).toContain("Tighten the spacing");
    expect(prompt).toContain(
      "This is the final pass. Refine the current frame HTML into a polished, production-quality wireframe",
    );
  });

  it("falls back to defaults when an edit ships without html or instruction", () => {
    const prompt = buildMainUserPrompt(input({ kind: "edit", currentHtml: "  ", editInstruction: "" }));

    expect(prompt).toContain("(no current HTML — build from the brief)");
    expect(prompt).toContain("Revise the frame HTML to better serve its purpose.");
  });
});

describe("buildWireframeRepairPrompt", () => {
  it("embeds the violations and demands a complete corrected document", () => {
    const prompt = buildWireframeRepairPrompt("css-property: color is not allowed\nscript: no scripts");

    expect(prompt).toContain("css-property: color is not allowed");
    expect(prompt).toContain("script: no scripts");
    expect(prompt).toContain("Output the complete corrected HTML document and nothing else.");
  });
});
