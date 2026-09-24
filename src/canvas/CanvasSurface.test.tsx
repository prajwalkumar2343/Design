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
    expect(screen.getByTestId("lake-toggle-button").textContent).toContain("Workspace");
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

describe("CanvasSurface frame editing", () => {
  const seedHtml = `<!doctype html><html><body><h1>Seed</h1></body></html>`;
  const seed = (id: string, x: number, y: number) => ({
    id,
    name: id,
    documentId: `${id}-doc`,
    x,
    y,
    width: 400,
    height: 300,
    srcDoc: seedHtml,
    background: "#ffffff",
  });

  beforeEach(() => {
    try { window.localStorage.clear(); } catch {}
    // jsdom lacks pointer-capture APIs used by the surface's drag handling.
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => undefined;
      Element.prototype.releasePointerCapture = () => undefined;
      Element.prototype.hasPointerCapture = () => false;
    }
  });

  it("deletes the selected frame with Delete and restores it on undo", () => {
    render(<CanvasSurface frames={[seed("frame-1", 10, 20)]} disableLocalPersistence />);

    const frame = document.querySelector("[data-frame-id='frame-1']");
    expect(frame?.getAttribute("data-selected")).toBe("true");

    fireEvent.keyDown(window, { key: "Delete" });
    expect(document.querySelectorAll("[data-frame-id]")).toHaveLength(0);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(document.querySelectorAll("[data-frame-id='frame-1']")).toHaveLength(1);
  });

  it("moves an unselected frame by dragging its body", () => {
    render(
      <CanvasSurface
        frames={[seed("frame-1", 0, 0), seed("frame-2", 10, 20)]}
        disableLocalPersistence
      />,
    );

    const frame = document.querySelector("[data-frame-id='frame-2']") as HTMLElement;
    const before = frame.style.transform;

    const surface = screen.getByTestId("canvas-surface");
    const grabLayer = screen.getByRole("button", { name: "Select frame-2" });
    fireEvent.pointerDown(grabLayer, { button: 0, pointerId: 7, clientX: 500, clientY: 400 });
    fireEvent.pointerMove(surface, { pointerId: 7, clientX: 570, clientY: 445 });
    fireEvent.pointerUp(surface, { pointerId: 7, clientX: 570, clientY: 445 });

    expect(frame.getAttribute("data-selected")).toBe("true");
    expect(frame.style.transform).not.toBe(before);
  });
});

describe("CanvasSurface creation threshold", () => {
  const seedHtml = `<!doctype html><html><body><h1>Seed</h1></body></html>`;
  const seed = () => ({
    id: "frame-1",
    name: "frame-1",
    documentId: "frame-1-doc",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    srcDoc: seedHtml,
    background: "#ffffff",
  });

  beforeEach(() => {
    try { window.localStorage.clear(); } catch {}
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => undefined;
      Element.prototype.releasePointerCapture = () => undefined;
      Element.prototype.hasPointerCapture = () => false;
    }
  });

  // jsdom reports zero-size rects, so the creation layer maps client pixels to
  // world units at scaleX = frame.width — tiny client deltas still resolve to
  // distinct world points (clientX 0.01 → 4 world units here).
  const drag = (layer: Element, from: number, to: number) => {
    fireEvent.pointerDown(layer, { button: 0, isPrimary: true, pointerId: 3, clientX: from, clientY: 0 });
    fireEvent.pointerMove(layer, { isPrimary: true, pointerId: 3, clientX: to, clientY: 0 });
    fireEvent.pointerUp(layer, { isPrimary: true, pointerId: 3, clientX: to, clientY: 0 });
  };

  // Creation goes through the iframe bridge: the transport posts a
  // `create-element` command to the frame's contentWindow (never answered in
  // jsdom). Spying on postMessage observes the attempt directly.
  const createCommands = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls
      .map((call: unknown[]) => call[0])
      .filter((message: unknown) =>
        typeof message === "object" && message !== null &&
        (message as { type?: string }).type === "command" &&
        (message as { command?: { command?: string } }).command?.command === "create-element",
      );

  it("does not mint a shape on a sub-threshold (click-like) drag", async () => {
    render(<CanvasSurface frames={[seed()]} disableLocalPersistence />);
    fireEvent.keyDown(window, { key: "r" });
    const layer = await waitFor(() => screen.getByTestId("frame-creation-layer"));
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    // ~4 world units — under the 6-unit minimum. The drag must be treated as a
    // click: interaction cycles through "creating" but no element is created.
    drag(layer, 0, 0.01);
    expect(createCommands(postSpy)).toHaveLength(0);
    expect(screen.getByTestId("canvas-surface").getAttribute("data-interaction")).toBe("idle");
  });

  it("posts a create-element command on a real drag", async () => {
    render(<CanvasSurface frames={[seed()]} disableLocalPersistence />);
    fireEvent.keyDown(window, { key: "r" });
    const layer = await waitFor(() => screen.getByTestId("frame-creation-layer"));
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    // ~80 world units — over the threshold, so a creation must be attempted.
    drag(layer, 0, 0.2);
    expect(createCommands(postSpy)).toHaveLength(1);
  });

  it("still treats a click with the text tool as a placement gesture", async () => {
    render(<CanvasSurface frames={[seed()]} disableLocalPersistence />);
    fireEvent.keyDown(window, { key: "t" });
    const layer = await waitFor(() => screen.getByTestId("frame-creation-layer"));
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    // Text layers intentionally bypass the drag threshold — a click places a
    // text field at the pointer position.
    drag(layer, 0, 0.001);
    expect(createCommands(postSpy)).toHaveLength(1);
  });

  it("remaps the drag against the frame's moved rect when the canvas pans mid-gesture", async () => {
    render(<CanvasSurface frames={[seed()]} disableLocalPersistence />);
    fireEvent.keyDown(window, { key: "r" });
    const layer = await waitFor(() => screen.getByTestId("frame-creation-layer"));
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const postSpy = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    // jsdom rects are all-zero; pin the iframe's viewport rect so client pixels
    // map 1:1 to world units, then move it the way a wheel pan would.
    let frameLeft = 0;
    let frameTop = 0;
    vi.spyOn(iframe, "getBoundingClientRect").mockImplementation(
      () => ({ left: frameLeft, top: frameTop, width: 400, height: 300 }) as DOMRect,
    );

    fireEvent.pointerDown(layer, { button: 0, isPrimary: true, pointerId: 3, clientX: 10, clientY: 10 });

    // A wheel pan mid-drag rewrites the canvas world's transform imperatively,
    // which is what shifts the iframe's viewport rect under the cursor.
    fireEvent.wheel(screen.getByTestId("canvas-surface"), { deltaX: 40, deltaY: 40 });
    await Promise.resolve();
    frameLeft = -40;
    frameTop = -40;

    fireEvent.pointerMove(layer, { isPrimary: true, pointerId: 3, clientX: 70, clientY: 70 });
    fireEvent.pointerUp(layer, { isPrimary: true, pointerId: 3, clientX: 70, clientY: 70 });

    const commands = createCommands(postSpy);
    expect(commands).toHaveLength(1);
    const { bounds } = (commands[0] as { command: { bounds: { width: number; height: number } } }).command;
    // The pan moved the frame 40px up-left, so clientX/Y 70 lands 110 world
    // units into the frame. A stale rect would mint a 60-wide shape behind the cursor.
    expect(bounds.width).toBeCloseTo(100);
    expect(bounds.height).toBeCloseTo(100);
  });
});
