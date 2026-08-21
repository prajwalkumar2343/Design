import {
  MAX_BUFFERED_VOICE_BYTES,
  MAX_CONTEXT_NODE_IDS,
  MAX_VOICE_CHUNK_BYTES,
  VOICE_STREAM_PROTOCOL_VERSION,
  type CancelVoiceStreamRequest,
  type CodexVoiceStreamTransport,
  type UpdateVoiceContextRequest,
  type VoiceInteractionContext,
  type VoiceStreamLifecycleEvent,
  type VoiceStreamPhase,
} from "./voice-stream-protocol";

type QueuedVoiceEvent =
  | {
      type: "audio";
      sequence: number;
      capturedAtMs: number;
      bytes: Uint8Array;
      resolve: () => void;
      reject: (error: unknown) => void;
    }
  | {
      type: "context";
      sequence: number;
      context: VoiceInteractionContext;
      resolve: () => void;
      reject: (error: unknown) => void;
    };

export type ContinuousVoiceStreamErrorCode =
  | "already-active"
  | "buffer-overflow"
  | "chunk-too-large"
  | "empty-chunk"
  | "invalid-context"
  | "invalid-state"
  | "protocol-error"
  | "transport-error";

export class ContinuousVoiceStreamError extends Error {
  readonly code: ContinuousVoiceStreamErrorCode;

  constructor(code: ContinuousVoiceStreamErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContinuousVoiceStreamError";
    this.code = code;
  }
}

export interface ContinuousVoiceStreamOptions {
  transport: CodexVoiceStreamTransport;
  now?: () => number;
  createStreamId?: () => string;
  onLifecycleEvent?: (event: VoiceStreamLifecycleEvent) => void;
  maxBufferedBytes?: number;
}

export interface StartContinuousVoiceStreamOptions {
  mimeType: string;
  initialContext: VoiceInteractionContext;
  signal?: AbortSignal;
}

function validateContext(context: VoiceInteractionContext): void {
  if (
    !Number.isFinite(context.capturedAtMs) ||
    (context.documentRevision !== null &&
      (!Number.isSafeInteger(context.documentRevision) || context.documentRevision < 1)) ||
    context.selectedElementIds.length > MAX_CONTEXT_NODE_IDS ||
    context.selectedElementIds.some((id) => !id || id.length > 512) ||
    (context.pointer !== null &&
      (!Number.isFinite(context.pointer.x) ||
        !Number.isFinite(context.pointer.y) ||
        !context.pointer.frameId))
  ) {
    throw new ContinuousVoiceStreamError("invalid-context", "Voice context is invalid or exceeds its bounds");
  }
}

function defaultStreamId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Owns one ordered, bounded stream from Canvas to the Codex router.
 * Audio is never retained after acknowledgement and failed events are never replayed.
 */
export class ContinuousVoiceStream {
  private readonly transport: CodexVoiceStreamTransport;
  private readonly now: () => number;
  private readonly createStreamId: () => string;
  private readonly onLifecycleEvent?: (event: VoiceStreamLifecycleEvent) => void;
  private readonly maxBufferedBytes: number;
  private phase: VoiceStreamPhase = "idle";
  private streamId: string | null = null;
  private nextSequence = 1;
  private bufferedBytes = 0;
  private queue: QueuedVoiceEvent[] = [];
  private drainPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private cancelReason: CancelVoiceStreamRequest["reason"] | null = null;
  private lastError: unknown = null;
  /** Increments on every (re)start so stale async work cannot touch new state. */
  private generation = 0;

  constructor(options: ContinuousVoiceStreamOptions) {
    this.transport = options.transport;
    this.now = options.now ?? Date.now;
    this.createStreamId = options.createStreamId ?? defaultStreamId;
    this.onLifecycleEvent = options.onLifecycleEvent;
    this.maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_VOICE_BYTES;
  }

  getPhase(): VoiceStreamPhase {
    return this.phase;
  }

  getStreamId(): string | null {
    return this.streamId;
  }

  getBufferedBytes(): number {
    return this.bufferedBytes;
  }

  async start(options: StartContinuousVoiceStreamOptions): Promise<string> {
    if (this.phase === "starting" || this.phase === "streaming" || this.phase === "stopping") {
      throw new ContinuousVoiceStreamError("already-active", "A continuous voice stream is already active");
    }
    if (!options.mimeType.trim()) {
      throw new ContinuousVoiceStreamError("invalid-state", "A voice stream MIME type is required");
    }
    validateContext(options.initialContext);

    this.resetForStart();
    const streamId = this.createStreamId();
    this.streamId = streamId;
    this.phase = "starting";
    this.onLifecycleEvent?.({ type: "starting", streamId });

    try {
      // Cancel must be able to abort an in-progress start, so the internal
      // controller rides along with any caller-provided signal.
      const signals = [options.signal, this.abortController?.signal]
        .filter((signal): signal is AbortSignal => Boolean(signal));
      const signal = signals.length > 1 && typeof AbortSignal.any === "function"
        ? AbortSignal.any(signals)
        : signals[0];
      const result = await this.transport.start({
        protocolVersion: VOICE_STREAM_PROTOCOL_VERSION,
        streamId,
        mimeType: options.mimeType,
        startedAtMs: this.now(),
        initialContext: options.initialContext,
      }, { signal });
      if (result.streamId !== streamId || !result.acceptedMimeType) {
        throw new ContinuousVoiceStreamError("protocol-error", "Codex returned an invalid voice stream acknowledgement");
      }
      this.phase = "streaming";
      this.onLifecycleEvent?.({ type: "streaming", streamId });
      return streamId;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  appendAudio(bytes: Uint8Array, capturedAtMs = this.now()): Promise<void> {
    this.requireStreaming();
    if (bytes.byteLength === 0) {
      throw new ContinuousVoiceStreamError("empty-chunk", "Voice chunks cannot be empty");
    }
    if (bytes.byteLength > MAX_VOICE_CHUNK_BYTES) {
      throw new ContinuousVoiceStreamError(
        "chunk-too-large",
        `Voice chunk is ${bytes.byteLength} bytes; the limit is ${MAX_VOICE_CHUNK_BYTES}`,
      );
    }
    if (this.bufferedBytes + bytes.byteLength > this.maxBufferedBytes) {
      const error = new ContinuousVoiceStreamError("buffer-overflow", "Continuous voice buffer is full");
      void this.cancel("buffer-overflow").catch(() => undefined);
      throw error;
    }

    const copiedBytes = bytes.slice();
    this.bufferedBytes += copiedBytes.byteLength;
    return this.enqueue({ type: "audio", capturedAtMs, bytes: copiedBytes });
  }

  updateContext(context: VoiceInteractionContext): Promise<void> {
    this.requireStreaming();
    validateContext(context);
    return this.enqueue({ type: "context", context });
  }

  async stop(options: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.phase !== "streaming" || !this.streamId) {
      throw new ContinuousVoiceStreamError("invalid-state", "No continuous voice stream is active");
    }
    const streamId = this.streamId;
    this.phase = "stopping";
    this.onLifecycleEvent?.({ type: "stopping", streamId });
    await this.waitForQueueToDrain();
    if (this.getPhase() === "failed") throw this.lastError;

    try {
      const finalSequence = this.nextSequence - 1;
      const result = await this.transport.stop({
        streamId,
        finalSequence,
        stoppedAtMs: this.now(),
      }, { signal: options.signal });
      if (result.streamId !== streamId || result.finalSequence !== finalSequence) {
        throw new ContinuousVoiceStreamError("protocol-error", "Codex returned an invalid voice stop acknowledgement");
      }
      this.phase = "stopped";
      this.abortController = null;
      this.onLifecycleEvent?.({ type: "stopped", streamId, finalSequence });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async cancel(reason: CancelVoiceStreamRequest["reason"] = "user"): Promise<void> {
    const streamId = this.streamId;
    if (!streamId || this.phase === "idle" || this.phase === "stopped") return;
    this.cancelReason = reason;
    this.abortController?.abort();
    this.rejectQueue(new ContinuousVoiceStreamError("invalid-state", `Voice stream cancelled: ${reason}`));
    this.phase = "stopped";
    await this.transport.cancel({ streamId, reason });
    this.onLifecycleEvent?.({ type: "cancelled", streamId, reason });
  }

  private enqueue(
    event: Omit<Extract<QueuedVoiceEvent, { type: "audio" }>, "sequence" | "resolve" | "reject">
      | Omit<Extract<QueuedVoiceEvent, { type: "context" }>, "sequence" | "resolve" | "reject">,
  ): Promise<void> {
    const sequence = this.nextSequence++;
    const promise = new Promise<void>((resolve, reject) => {
      this.queue.push({ ...event, sequence, resolve, reject } as QueuedVoiceEvent);
    });
    this.ensureDrain();
    return promise;
  }

  private ensureDrain(): void {
    if (this.drainPromise) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      if (this.queue.length > 0 && (this.phase === "streaming" || this.phase === "stopping")) {
        this.ensureDrain();
      }
    });
  }

  private async waitForQueueToDrain(): Promise<void> {
    while (this.drainPromise || this.queue.length > 0) {
      this.ensureDrain();
      await this.drainPromise;
    }
  }

  private async drain(): Promise<void> {
    const generation = this.generation;
    while (this.queue.length > 0 && (this.phase === "streaming" || this.phase === "stopping")) {
      const event = this.queue.shift();
      if (!event || !this.streamId) return;
      try {
        const result = event.type === "audio"
          ? await this.transport.appendAudio({
              streamId: this.streamId,
              sequence: event.sequence,
              capturedAtMs: event.capturedAtMs,
              bytes: event.bytes,
            }, { signal: this.abortController?.signal })
          : await this.transport.updateContext({
              streamId: this.streamId,
              sequence: event.sequence,
              context: event.context,
            } satisfies UpdateVoiceContextRequest, { signal: this.abortController?.signal });
        if (result.streamId !== this.streamId || result.acceptedSequence !== event.sequence) {
          throw new ContinuousVoiceStreamError("protocol-error", `Invalid acknowledgement for voice event ${event.sequence}`);
        }
        if (event.type === "audio") {
          this.bufferedBytes -= event.bytes.byteLength;
          this.onLifecycleEvent?.({ type: "audio-sent", streamId: this.streamId, sequence: event.sequence, byteLength: event.bytes.byteLength });
        } else {
          this.onLifecycleEvent?.({ type: "context-sent", streamId: this.streamId, sequence: event.sequence });
        }
        event.resolve();
      } catch (error) {
        if (event.type === "audio") this.bufferedBytes -= event.bytes.byteLength;
        event.reject(error);
        // A restart replaced the stream state while this drain was in flight;
        // the failure belongs to the old generation and must not fail the new
        // stream or reject its queued events.
        if (generation !== this.generation) {
          return;
        }
        if (this.cancelReason !== null && this.abortController?.signal.aborted) {
          return;
        }
        this.fail(error);
        this.rejectQueue(error);
        void this.transport.cancel({ streamId: this.streamId, reason: "transport-error" }).catch(() => undefined);
        return;
      }
    }
  }

  private requireStreaming(): void {
    if (this.phase !== "streaming" || !this.streamId) {
      throw new ContinuousVoiceStreamError("invalid-state", "Continuous voice stream is not ready");
    }
  }

  private rejectQueue(error: unknown): void {
    for (const event of this.queue.splice(0)) {
      if (event.type === "audio") this.bufferedBytes -= event.bytes.byteLength;
      event.reject(error);
    }
  }

  private fail(error: unknown): void {
    // A deliberate cancel already resolved the lifecycle as `cancelled`/`stopped`;
    // late transport failures must not overwrite it with `failed`.
    if (this.cancelReason !== null || this.phase === "stopped") {
      return;
    }
    this.phase = "failed";
    this.lastError = error;
    const streamId = this.streamId ?? "unknown";
    const message = error instanceof Error ? error.message : "Continuous voice stream failed";
    this.onLifecycleEvent?.({ type: "failed", streamId, message });
  }

  private resetForStart(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.nextSequence = 1;
    this.bufferedBytes = 0;
    this.queue = [];
    this.drainPromise = null;
    this.cancelReason = null;
    this.lastError = null;
  }
}
