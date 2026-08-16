import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BRAINSTORM_OPENING_PROMPT } from "../router/brainstorm-session";
import { applyEditorCommand, createEmptyEditorState, startBrainstormSessionCommand } from "../editor";
import { serializeWireCanvasProject } from "../persistence";
import { CanvasSurface } from "./CanvasSurface";

describe("CanvasSurface brainstorming entry", () => {
  it("starts with no demo frames and creates the Brief Frame from the empty state", () => {
    render(<CanvasSurface frames={[]} />);

    expect(screen.getByTestId("empty-canvas-state")).toBeTruthy();
    expect(screen.queryByTestId("brief-frame")).toBeNull();
    expect(document.querySelectorAll("[data-frame-id]")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("start-brainstorming"));

    expect(screen.queryByTestId("empty-canvas-state")).toBeNull();
    expect(screen.getByTestId("brief-frame")).toBeTruthy();
    expect(screen.getByTestId("brief-opening-prompt").textContent).toContain(BRAINSTORM_OPENING_PROMPT);
    expect(document.querySelectorAll("[data-frame-id]")).toHaveLength(0);
  });

  it("exposes honest browser-file import/export actions and remounts the brief after import", async () => {
    const importedState = applyEditorCommand(
      createEmptyEditorState(),
      startBrainstormSessionCommand({
        sessionId: "imported-session",
        briefFrameId: "imported-brief",
        content: {
          projectDescription: "Imported project",
          audience: "A focused audience",
          goals: [],
          successCriteria: [],
          requiredFeatures: [],
          requiredContent: [],
          visualDirection: "",
          constraints: [],
          references: [],
          openQuestions: [],
          confirmedDecisions: [],
        },
      }),
    );
    const downloadProjectFile = vi.fn();
    const persistenceAdapter = {
      readProjectFile: vi.fn(async () => serializeWireCanvasProject(importedState)),
    };

    render(
      <CanvasSurface
        frames={[]}
        persistenceAdapter={persistenceAdapter}
        downloadAdapter={{ downloadProjectFile }}
      />,
    );

    expect(screen.getByTestId("import-project-button")).toBeTruthy();
    expect(screen.queryByTestId("export-project-button")).toBeNull();
    fireEvent.click(screen.getByTestId("start-brainstorming"));
    fireEvent.click(screen.getByTestId("export-project-button"));
    expect(downloadProjectFile).toHaveBeenCalledWith(expect.objectContaining({
      filename: "brainstorm-session.wirecanvas.json",
      mimeType: "application/json",
    }));

    fireEvent.change(screen.getByTestId("import-project-input"), {
      target: { files: [new File(["ignored"], "import.wirecanvas.json", { type: "application/json" })] },
    });
    await waitFor(() => expect((screen.getByTestId("brief-field-projectDescription") as HTMLTextAreaElement).value).toBe("Imported project"));
    expect(screen.getByTestId("persistence-feedback").textContent).toContain("imported successfully");
  });
});
