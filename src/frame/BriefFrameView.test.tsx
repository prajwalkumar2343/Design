import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { BRAINSTORM_OPENING_PROMPT } from "../router/brainstorm-session";
import { createEmptyBriefContent, type BriefFrame } from "../session/model";
import { BriefFrameView } from "./BriefFrameView";

function createBriefFrame(): BriefFrame {
  return {
    id: "brief-1",
    kind: "brief",
    name: "Project brief",
    x: 0,
    y: 0,
    width: 520,
    height: 720,
    revision: 1,
    content: createEmptyBriefContent(),
  };
}

function renderBrief(overrides: Partial<ComponentProps<typeof BriefFrameView>> = {}) {
  const onUpdateBriefField = vi.fn();
  const onAddReference = vi.fn();
  const onAddDecision = vi.fn();
  render(
    <BriefFrameView
      briefFrame={createBriefFrame()}
      isSelected
      onSelect={vi.fn()}
      onStartMove={vi.fn()}
      onUpdateBriefField={onUpdateBriefField}
      onAddReference={onAddReference}
      onUpdateReference={vi.fn()}
      onRemoveReference={vi.fn()}
      onAddDecision={onAddDecision}
      onUpdateDecision={vi.fn()}
      onRemoveDecision={vi.fn()}
      {...overrides}
    />,
  );
  return { onUpdateBriefField, onAddReference, onAddDecision };
}

describe("BriefFrameView", () => {
  it("shows the protocol opening prompt and labels every approved brief field", () => {
    renderBrief();

    expect(screen.getByTestId("brief-opening-prompt").textContent).toContain(BRAINSTORM_OPENING_PROMPT);
    for (const label of [
      "Project description",
      "Audience",
      "Goals new entry",
      "Success criteria new entry",
      "Required features new entry",
      "Required content new entry",
      "Visual direction",
      "Constraints new entry",
      "New reference URL",
      "Open questions new entry",
      "New decision statement",
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("saves a text field on blur and validates references before adding them", () => {
    const { onUpdateBriefField, onAddReference } = renderBrief();
    const description = screen.getByTestId("brief-field-projectDescription");
    fireEvent.change(description, { target: { value: "A planning workspace" } });
    fireEvent.blur(description);
    expect(onUpdateBriefField).toHaveBeenCalledWith({
      field: "projectDescription",
      value: "A planning workspace",
    });

    fireEvent.change(screen.getByLabelText("New reference label"), { target: { value: "Unsafe" } });
    fireEvent.change(screen.getByLabelText("New reference URL"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    expect(onAddReference).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("http:// or https://");

    fireEvent.change(screen.getByLabelText("New reference URL"), { target: { value: "https://example.com/brief" } });
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    expect(onAddReference).toHaveBeenCalledWith(expect.objectContaining({
      label: "Unsafe",
      url: "https://example.com/brief",
    }));
  });

  it("adds list entries and decisions through explicit actions", () => {
    const { onUpdateBriefField, onAddDecision } = renderBrief();
    fireEvent.change(screen.getByLabelText("Goals new entry"), { target: { value: "Clarify the first release" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Goals" }));
    expect(onUpdateBriefField).toHaveBeenCalledWith({ field: "goals", value: ["Clarify the first release"] });

    fireEvent.change(screen.getByLabelText("New decision statement"), { target: { value: "Keep the brief on-canvas" } });
    fireEvent.change(screen.getByLabelText("New decision rationale"), { target: { value: "It keeps context visible" } });
    fireEvent.click(screen.getByRole("button", { name: "Add confirmed decision" }));
    expect(onAddDecision).toHaveBeenCalledWith(expect.objectContaining({
      statement: "Keep the brief on-canvas",
      rationale: "It keeps context visible",
    }));
  });
});
