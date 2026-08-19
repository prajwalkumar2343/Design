import type {
  VoiceInteractionContext,
  VoicePointerContext,
} from "../router/voice-stream-protocol";
import type { PointerInteractionSnapshot } from "./types";

export interface VoiceContextBase {
  documentId: string | null;
  documentRevision: number | null;
  activeFrameId: string | null;
  selectedElementIds: string[];
}

/** Maps the recorder's current pointer into the router protocol's pointer. */
export function toVoicePointerContext(
  snapshot: PointerInteractionSnapshot,
): VoicePointerContext | null {
  const current = snapshot.current;
  if (!current || !current.frameId) return null;
  return {
    frameId: current.frameId,
    x: current.x,
    y: current.y,
    hoveredElementId: current.elementId,
  };
}

/**
 * Adapts a captured pointer-interaction snapshot into the voice-stream
 * protocol context so a dictation can carry "where the person was pointing".
 * The full {@link PointerInteractionSnapshot} (trail, strokes, fixes) is the
 * richer payload a future agent channel consumes; this adapter keeps the
 * existing protocol contract stable.
 */
export function toVoiceInteractionContext(
  snapshot: PointerInteractionSnapshot,
  base: VoiceContextBase,
): VoiceInteractionContext {
  return {
    capturedAtMs: snapshot.capturedAtMs,
    documentId: base.documentId,
    documentRevision: base.documentRevision,
    activeFrameId: base.activeFrameId ?? snapshot.current?.frameId ?? null,
    selectedElementIds: base.selectedElementIds,
    pointer: toVoicePointerContext(snapshot),
  };
}
