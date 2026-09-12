import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEditorStore } from "../editor/store";
import { createEmptyEditorState } from "../editor/model";
import { useBrainstormSessionController } from "./brainstorm-session-controller";
import type { Camera, Size } from "./types";

function setup(viewport: Size = { width: 1280, height: 800 }, camera: Camera = { x: 0, y: 0, zoom: 1 }) {
  const editorStore = createEditorStore(createEmptyEditorState());
  const surfaceRef = { current: null };
  const cameraRef = { current: camera };
  const setCamera = vi.fn((next: Camera) => { cameraRef.current = next; });
  const utils = renderHook(() =>
    useBrainstormSessionController({ editorStore, surfaceRef, viewport, cameraRef, setCamera }),
  );
  return { editorStore, cameraRef, setCamera, ...utils };
}

describe("useBrainstormSessionController", () => {
  it("starts a session centered on the viewport and fits the camera", () => {
    const { editorStore, setCamera, result } = setup();
    expect(editorStore.getState().session.lifecycle).toBe("not-started");

    result.current.startBrainstorming();

    const session = editorStore.getState().session;
    expect(session.lifecycle).toBe("briefing");
    expect(session.briefFrame).not.toBeNull();
    expect(session.sessionId).toMatch(/^brainstorm-session-/);
    // The camera was retargeted to frame the new Brief Frame.
    expect(setCamera).toHaveBeenCalledTimes(1);
    const nextCamera = setCamera.mock.calls[0]![0] as Camera;
    expect(Number.isFinite(nextCamera.zoom)).toBe(true);
    expect(nextCamera.zoom).toBeGreaterThan(0);
  });

  it("threads the live session revision into brief updates", () => {
    const { editorStore, result } = setup();
    result.current.startBrainstorming();

    // A second start must not wedge or corrupt — the reducer rejects it.
    expect(() =>
      result.current.updateBriefField({ field: "projectDescription", value: "A notes app" }),
    ).not.toThrow();

    const brief = editorStore.getState().session.briefFrame;
    expect(brief?.content.projectDescription).toBe("A notes app");
  });

  it("adds and removes references and decisions through the store", () => {
    const { editorStore, result } = setup();
    result.current.startBrainstorming();

    result.current.addBriefReference({ id: "ref-1", label: "Moodboard", url: "https://example.com", note: "" });
    result.current.addConfirmedDecision({ id: "dec-1", statement: "Use dark mode", rationale: "" });
    let content = editorStore.getState().session.briefFrame?.content;
    expect(content?.references).toHaveLength(1);
    expect(content?.confirmedDecisions).toHaveLength(1);

    result.current.removeBriefReference("ref-1");
    result.current.removeConfirmedDecision("dec-1");
    content = editorStore.getState().session.briefFrame?.content;
    expect(content?.references).toHaveLength(0);
    expect(content?.confirmedDecisions).toHaveLength(0);
  });

  it("rejects non-http reference URLs rather than storing them", () => {
    const { editorStore, result } = setup();
    result.current.startBrainstorming();
    expect(() =>
      result.current.addBriefReference({ id: "ref-x", label: "x", url: "javascript:alert(1)", note: "" }),
    ).toThrowError(/http/);
    expect(editorStore.getState().session.briefFrame?.content.references).toHaveLength(0);
  });
});
