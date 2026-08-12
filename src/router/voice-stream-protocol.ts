export const VOICE_STREAM_PROTOCOL_VERSION = 1 as const;
export const MAX_VOICE_CHUNK_BYTES = 256 * 1024;
export const MAX_BUFFERED_VOICE_BYTES = 4 * 1024 * 1024;
export const MAX_CONTEXT_NODE_IDS = 128;

export type VoiceStreamPhase =
  | "idle"
  | "starting"
  | "streaming"
  | "stopping"
  | "stopped"
  | "failed";

export interface VoicePointerContext {
  frameId: string;
  x: number;
  y: number;
  hoveredElementId: string | null;
}

/** A bounded snapshot supplied by Canvas; activation semantics are intentionally out of scope. */
export interface VoiceInteractionContext {
  capturedAtMs: number;
  documentId: string | null;
  documentRevision: number | null;
  activeFrameId: string | null;
  selectedElementIds: string[];
  pointer: VoicePointerContext | null;
}

export interface StartVoiceStreamRequest {
  protocolVersion: typeof VOICE_STREAM_PROTOCOL_VERSION;
  streamId: string;
  mimeType: string;
  startedAtMs: number;
  initialContext: VoiceInteractionContext;
}

export interface StartVoiceStreamResult {
  streamId: string;
  acceptedMimeType: string;
}

export interface AppendVoiceAudioRequest {
  streamId: string;
  sequence: number;
  capturedAtMs: number;
  bytes: Uint8Array;
}

export interface UpdateVoiceContextRequest {
  streamId: string;
  sequence: number;
  context: VoiceInteractionContext;
}

export interface VoiceStreamEventResult {
  streamId: string;
  acceptedSequence: number;
}

export interface StopVoiceStreamRequest {
  streamId: string;
  finalSequence: number;
  stoppedAtMs: number;
}

export interface StopVoiceStreamResult {
  streamId: string;
  finalSequence: number;
}

export interface CancelVoiceStreamRequest {
  streamId: string;
  reason: "user" | "capture-error" | "transport-error" | "buffer-overflow";
}

/** Implemented by the eventual Codex router adapter. Calls are ordered and never auto-retried. */
export interface CodexVoiceStreamTransport {
  start(
    request: StartVoiceStreamRequest,
    options: { signal?: AbortSignal },
  ): Promise<StartVoiceStreamResult>;
  appendAudio(
    request: AppendVoiceAudioRequest,
    options: { signal?: AbortSignal },
  ): Promise<VoiceStreamEventResult>;
  updateContext(
    request: UpdateVoiceContextRequest,
    options: { signal?: AbortSignal },
  ): Promise<VoiceStreamEventResult>;
  stop(
    request: StopVoiceStreamRequest,
    options: { signal?: AbortSignal },
  ): Promise<StopVoiceStreamResult>;
  cancel(request: CancelVoiceStreamRequest): Promise<void>;
}

export type VoiceStreamLifecycleEvent =
  | { type: "starting"; streamId: string }
  | { type: "streaming"; streamId: string }
  | { type: "audio-sent"; streamId: string; sequence: number; byteLength: number }
  | { type: "context-sent"; streamId: string; sequence: number }
  | { type: "stopping"; streamId: string }
  | { type: "stopped"; streamId: string; finalSequence: number }
  | { type: "cancelled"; streamId: string; reason: CancelVoiceStreamRequest["reason"] }
  | { type: "failed"; streamId: string; message: string };

