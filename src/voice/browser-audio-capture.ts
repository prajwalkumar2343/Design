const DEFAULT_CHUNK_INTERVAL_MS = 250;
const PREFERRED_AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Audio capture failed";
}

export type BrowserAudioCapturePhase =
  | "idle"
  | "preparing"
  | "ready"
  | "recording"
  | "stopping"
  | "stopped"
  | "failed";

export type BrowserAudioCaptureErrorCode =
  | "capture-failed"
  | "invalid-state"
  | "microphone-unavailable"
  | "recorder-unavailable";

export class BrowserAudioCaptureError extends Error {
  readonly code: BrowserAudioCaptureErrorCode;

  constructor(code: BrowserAudioCaptureErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserAudioCaptureError";
    this.code = code;
  }
}

interface AudioCaptureTrack {
  stop(): void;
}

interface AudioCaptureStream {
  getTracks(): AudioCaptureTrack[];
}

interface AudioCaptureRecorder {
  readonly mimeType: string;
  readonly state: "inactive" | "recording" | "paused";
  ondataavailable: ((event: BlobEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface BrowserAudioCaptureOptions {
  onChunk: (bytes: Uint8Array, capturedAtMs: number) => Promise<void>;
  onError?: (error: BrowserAudioCaptureError) => void;
  chunkIntervalMs?: number;
  now?: () => number;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<AudioCaptureStream>;
  createRecorder?: (stream: AudioCaptureStream, options: MediaRecorderOptions) => AudioCaptureRecorder;
  isMimeTypeSupported?: (mimeType: string) => boolean;
}

/** Browser microphone adapter. It captures chunks but owns no Codex or activation behavior. */
export class BrowserAudioCapture {
  private readonly onChunk: BrowserAudioCaptureOptions["onChunk"];
  private readonly onError?: BrowserAudioCaptureOptions["onError"];
  private readonly chunkIntervalMs: number;
  private readonly now: () => number;
  private readonly getUserMedia: NonNullable<BrowserAudioCaptureOptions["getUserMedia"]>;
  private readonly createRecorder: NonNullable<BrowserAudioCaptureOptions["createRecorder"]>;
  private readonly isMimeTypeSupported: NonNullable<BrowserAudioCaptureOptions["isMimeTypeSupported"]>;
  private phase: BrowserAudioCapturePhase = "idle";
  private stream: AudioCaptureStream | null = null;
  private recorder: AudioCaptureRecorder | null = null;
  private conversionLane: Promise<void> = Promise.resolve();
  private readonly pendingDeliveries = new Set<Promise<void>>();
  private stopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;
  private lastError: BrowserAudioCaptureError | null = null;

  constructor(options: BrowserAudioCaptureOptions) {
    this.onChunk = options.onChunk;
    this.onError = options.onError;
    this.chunkIntervalMs = options.chunkIntervalMs ?? DEFAULT_CHUNK_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.getUserMedia = options.getUserMedia ?? ((constraints) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new BrowserAudioCaptureError("microphone-unavailable", "Microphone capture is unavailable");
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    });
    this.createRecorder = options.createRecorder ?? ((stream, recorderOptions) => {
      if (typeof MediaRecorder === "undefined") {
        throw new BrowserAudioCaptureError("recorder-unavailable", "MediaRecorder is unavailable");
      }
      return new MediaRecorder(stream as MediaStream, recorderOptions);
    });
    this.isMimeTypeSupported = options.isMimeTypeSupported ?? ((mimeType) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType));
  }

  getPhase(): BrowserAudioCapturePhase {
    return this.phase;
  }

  getMimeType(): string | null {
    return this.recorder?.mimeType ?? null;
  }

  async prepare(): Promise<string> {
    if (this.phase !== "idle" && this.phase !== "stopped" && this.phase !== "failed") {
      throw new BrowserAudioCaptureError("invalid-state", "Audio capture is already prepared or active");
    }
    this.releaseMedia();
    this.lastError = null;
    this.phase = "preparing";
    try {
      const stream = await this.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      const mimeType = PREFERRED_AUDIO_MIME_TYPES.find(this.isMimeTypeSupported);
      const recorder = this.createRecorder(stream, mimeType ? { mimeType } : {});
      this.stream = stream;
      this.recorder = recorder;
      recorder.ondataavailable = (event) => this.handleChunk(event.data);
      recorder.onerror = (event) => this.fail(event.error ?? new Error("MediaRecorder failed"));
      recorder.onstop = () => this.resolveStop?.();
      this.phase = "ready";
      return recorder.mimeType || mimeType || "application/octet-stream";
    } catch (error) {
      this.releaseMedia();
      this.fail(error);
      throw error;
    }
  }

  start(): void {
    if (this.phase !== "ready" || !this.recorder) {
      throw new BrowserAudioCaptureError("invalid-state", "Audio capture must be prepared before it starts");
    }
    this.conversionLane = Promise.resolve();
    this.pendingDeliveries.clear();
    this.stopPromise = new Promise<void>((resolve) => { this.resolveStop = resolve; });
    this.recorder.start(this.chunkIntervalMs);
    this.phase = "recording";
  }

  async stop(): Promise<void> {
    if (this.phase !== "recording" || !this.recorder || !this.stopPromise) {
      throw new BrowserAudioCaptureError("invalid-state", "Audio capture is not recording");
    }
    this.phase = "stopping";
    const stopPromise = this.stopPromise;
    this.recorder.stop();
    await stopPromise;
    await this.conversionLane;
    await Promise.all(this.pendingDeliveries);
    if (this.lastError) throw this.lastError;
    this.releaseMedia();
    this.phase = "stopped";
  }

  cancel(): void {
    const resolveStop = this.resolveStop;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.releaseMedia();
    this.phase = "stopped";
    resolveStop?.();
  }

  private handleChunk(blob: Blob): void {
    if (blob.size === 0 || (this.phase !== "recording" && this.phase !== "stopping")) return;
    const capturedAtMs = this.now();
    this.conversionLane = this.conversionLane.then(async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let delivery: Promise<void>;
      delivery = Promise.resolve()
        .then(() => this.onChunk(bytes, capturedAtMs))
        .catch((error) => this.fail(error))
        .finally(() => this.pendingDeliveries.delete(delivery));
      this.pendingDeliveries.add(delivery);
    }).catch((error) => this.fail(error));
  }

  private fail(error: unknown): void {
    const resolveStop = this.resolveStop;
    this.releaseMedia();
    this.phase = "failed";
    const captureError = error instanceof BrowserAudioCaptureError
      ? error
      : new BrowserAudioCaptureError(
          "capture-failed",
          errorMessage(error),
          { cause: error },
        );
    this.lastError = captureError;
    this.onError?.(captureError);
    resolveStop?.();
  }

  private releaseMedia(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      this.recorder.onstop = null;
    }
    this.stream = null;
    this.recorder = null;
    this.stopPromise = null;
    this.resolveStop = null;
  }
}
