import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRAINSTORM_OPENING_PROMPT } from "../router/brainstorm-session";
import { applyEditorCommand, createEmptyEditorState, startBrainstormSessionCommand } from "../editor";
import { createFrameCommand } from "../editor/commands";
import { serializeWireCanvasProject } from "../persistence";
import { CanvasSurface } from "./CanvasSurface";

describe("CanvasSurface brainstorming entry", () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch {}
  });

  it("starts with no demo frames and creates the Brief Frame from the empty state", () => {
    render(<CanvasSurface frames={[]} disableLocalPersistence />);

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
        disableLocalPersistence
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

  it("shows the lake with different project kinds and continues from local memory", async () => {
    render(<CanvasSurface frames={[]} />);

    expect(screen.getByTestId("project-lake")).toBeTruthy();
    expect(screen.getByTestId("create-kind-landing")).toBeTruthy();
    expect(screen.getByTestId("create-kind-dashboard")).toBeTruthy();
    expect(screen.getByTestId("start-brainstorming")).toBeTruthy();

    fireEvent.click(screen.getByTestId("create-kind-landing"));
    await waitFor(() => expect(screen.queryByTestId("project-lake")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("brief-frame")).toBeTruthy());
    // landing preset should have prefilled description
    await waitFor(() => expect((screen.getByTestId("brief-field-projectDescription") as HTMLTextAreaElement).value).toContain("Premium landing page"));
    // URL should now be a per-project design URL and survive refresh
    expect(window.location.pathname).toMatch(/^\/design\//);
    const projectUrl = window.location.pathname;

    // Lake toggle should now navigate to home and show the persisted project
    expect(screen.getByTestId("lake-toggle-button").textContent).toContain("Lake");
    fireEvent.click(screen.getByTestId("lake-toggle-button"));
    await waitFor(() => expect(screen.getByTestId("project-lake")).toBeTruthy());
    expect(window.location.pathname).toBe("/");
    expect(screen.getByTestId("project-card")).toBeTruthy();

    // projectUrl is the per-project design URL — refresh on that URL would stay on the design page
    expect(projectUrl).toMatch(/^\/design\//);
  });

  it("exports the designed canvas as working code via Export Code", () => {
    const downloadProjectFile = vi.fn();
    const seedHtml = `<!doctype html><html><head><title>Fieldwork</title></head><body><h1>Make room for better ideas.</h1></body></html>`;
    let state = applyEditorCommand(
      createEmptyEditorState(),
      startBrainstormSessionCommand({
        sessionId: "export-session",
        briefFrameId: "export-brief",
        content: {
          projectDescription: "Fieldwork site",
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
        },
      }),
    );
    state = applyEditorCommand(state, createFrameCommand({
      id: "desktop",
      name: "Desktop · 1440 × 900",
      documentId: "fieldwork",
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      srcDoc: seedHtml,
      background: "#f3f0e9",
    }));

    window.localStorage.setItem("wirecanvas:projects:v1", JSON.stringify([{
      id: "project-export-1",
      name: "Fieldwork site",
      kind: "blank",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      frameCount: 1,
      lifecycle: "briefing",
      data: serializeWireCanvasProject(state),
    }]));
    window.localStorage.setItem("wirecanvas:activeProjectId:v1", "project-export-1");
    window.history.replaceState(null, "", "/design/project-export-1");
    try {
      render(<CanvasSurface downloadAdapter={{ downloadProjectFile }} />);

      expect(screen.getByTestId("export-code-button")).toBeTruthy();
      fireEvent.click(screen.getByTestId("export-code-button"));

      expect(downloadProjectFile).toHaveBeenCalledTimes(1);
      const payload = downloadProjectFile.mock.calls[0]![0]!;
      expect(payload.filename).toBe("fieldwork-site.html");
      expect(payload.mimeType).toBe("text/html;charset=utf-8");
      expect(String(payload.text)).toContain("<h1>Make room for better ideas.</h1>");
      expect(String(payload.text)).not.toContain("data-design-tool-iframe-bridge");
      expect(screen.getByTestId("persistence-feedback").textContent).toContain("Exported your design as fieldwork-site.html");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("reports honestly when Export Code is pressed before any page exists", () => {
    const downloadProjectFile = vi.fn();
    render(<CanvasSurface frames={[]} downloadAdapter={{ downloadProjectFile }} disableLocalPersistence />);

    fireEvent.click(screen.getByTestId("start-brainstorming"));
    fireEvent.click(screen.getByTestId("export-code-button"));

    expect(downloadProjectFile).not.toHaveBeenCalled();
    expect(screen.getByTestId("persistence-feedback").textContent).toContain("no page code to export yet");
  });
});
