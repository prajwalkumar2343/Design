import { useCallback, type RefObject } from "react";
import {
  addBriefReferenceCommand,
  addConfirmedDecisionCommand,
  removeBriefReferenceCommand,
  removeConfirmedDecisionCommand,
  selectBriefFrameCommand,
  setSelectionCommand,
  startBrainstormSessionCommand,
  updateBriefFieldCommand,
  updateBriefReferenceCommand,
  updateConfirmedDecisionCommand,
} from "../editor/commands";
import type { EditorStore } from "../editor/store";
import type { Camera, Size } from "./types";
import { fitRect, screenToWorld } from "./camera";
import {
  DEFAULT_BRIEF_FRAME_SIZE,
  type BriefFieldUpdate,
  type BriefReference,
  type ConfirmedDecision,
} from "../session/model";

export interface BrainstormSessionControllerOptions {
  editorStore: EditorStore;
  surfaceRef: RefObject<HTMLDivElement | null>;
  viewport: Size;
  cameraRef: { current: Camera };
  setCamera: (camera: Camera) => void;
}

function createStableId(prefix: string): string {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

function getViewportSize(surface: HTMLDivElement | null, fallback: Size): Size {
  if (!surface) return fallback;
  const bounds = surface.getBoundingClientRect();
  return {
    width: surface.clientWidth || bounds.width || window.innerWidth,
    height: surface.clientHeight || bounds.height || window.innerHeight,
  };
}

export function useBrainstormSessionController({
  editorStore,
  surfaceRef,
  viewport,
  cameraRef,
  setCamera,
}: BrainstormSessionControllerOptions) {
  const selectBriefFrame = useCallback((briefFrameId: string) => {
    editorStore.execute(selectBriefFrameCommand(briefFrameId), { history: "skip" });
    editorStore.execute(
      setSelectionCommand({
        frameIds: [],
        nodeIds: [],
        primaryFrameId: null,
        primaryNodeId: null,
      }),
      { history: "skip" },
    );
  }, [editorStore]);

  const startBrainstorming = useCallback(() => {
    const measuredViewport = getViewportSize(surfaceRef.current, viewport);
    const usableViewport = measuredViewport.width > 0 && measuredViewport.height > 0
      ? measuredViewport
      : { width: Math.max(viewport.width, 1), height: Math.max(viewport.height, 1) };
    const size = DEFAULT_BRIEF_FRAME_SIZE;
    const center = screenToWorld(
      { x: usableViewport.width / 2, y: usableViewport.height / 2 },
      cameraRef.current,
    );
    const position = {
      x: center.x - size.width / 2,
      y: center.y - size.height / 2,
    };
    editorStore.execute(
      startBrainstormSessionCommand({
        sessionId: createStableId("brainstorm-session"),
        briefFrameId: createStableId("brief-frame"),
        position,
        size,
      }, 0),
      { label: "Start brainstorming" },
    );
    const nextCamera = fitRect({ ...position, ...size }, usableViewport, usableViewport.width < 760 ? 18 : 148);
    cameraRef.current = nextCamera;
    setCamera(nextCamera);
  }, [cameraRef, editorStore, setCamera, surfaceRef, viewport]);

  const executeMutation = useCallback(
    (command: Parameters<EditorStore["execute"]>[0], label: string) => {
      editorStore.execute(command, { label });
    },
    [editorStore],
  );

  const updateBriefField = useCallback((update: BriefFieldUpdate) => {
    executeMutation(updateBriefFieldCommand(update, editorStore.getState().session.revision), "Update brief field");
  }, [editorStore, executeMutation]);

  const addBriefReference = useCallback((reference: BriefReference) => {
    executeMutation(addBriefReferenceCommand(reference, editorStore.getState().session.revision), "Add brief reference");
  }, [editorStore, executeMutation]);

  const updateBriefReference = useCallback((options: {
    referenceId: string;
    patch: Partial<Pick<BriefReference, "label" | "url" | "note">>;
  }) => {
    executeMutation(updateBriefReferenceCommand({ ...options, expectedRevision: editorStore.getState().session.revision }), "Update brief reference");
  }, [editorStore, executeMutation]);

  const removeBriefReference = useCallback((referenceId: string) => {
    executeMutation(removeBriefReferenceCommand(referenceId, editorStore.getState().session.revision), "Remove brief reference");
  }, [editorStore, executeMutation]);

  const addConfirmedDecision = useCallback((decision: ConfirmedDecision) => {
    executeMutation(addConfirmedDecisionCommand(decision, editorStore.getState().session.revision), "Add confirmed decision");
  }, [editorStore, executeMutation]);

  const updateConfirmedDecision = useCallback((options: {
    decisionId: string;
    patch: Partial<Pick<ConfirmedDecision, "statement" | "rationale">>;
  }) => {
    executeMutation(updateConfirmedDecisionCommand({ ...options, expectedRevision: editorStore.getState().session.revision }), "Update confirmed decision");
  }, [editorStore, executeMutation]);

  const removeConfirmedDecision = useCallback((decisionId: string) => {
    executeMutation(removeConfirmedDecisionCommand(decisionId, editorStore.getState().session.revision), "Remove confirmed decision");
  }, [editorStore, executeMutation]);

  return {
    selectBriefFrame,
    startBrainstorming,
    updateBriefField,
    addBriefReference,
    updateBriefReference,
    removeBriefReference,
    addConfirmedDecision,
    updateConfirmedDecision,
    removeConfirmedDecision,
  };
}
