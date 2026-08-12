import { describe, expect, it } from "vitest";

import {
  BrowserAudioCapture,
  BrowserAudioCaptureError,
} from "./browser-audio-capture";

class FakeTrack {
  stopped = false;
  stop() { this.stopped = true; }
}

class FakeRecorder {
  readonly mimeType: string;
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  startedWith: number | undefined;

  constructor(mimeType: string) {
    this.mimeType = mimeType;
  }

  start(timeslice?: number) {
    this.startedWith = timeslice;
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.onstop?.(new Event("stop"));
  }

  emit(bytes: number[]) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) } as BlobEvent);
  }
}

describe("browser continuous audio capture", () => {
  it("prepares the microphone and emits ordered recorder chunks", async () => {
    const track = new FakeTrack();
    const recorder = new FakeRecorder("audio/webm;codecs=opus");
    const chunks: number[][] = [];
    const capture = new BrowserAudioCapture({
      getUserMedia: async () => ({ getTracks: () => [track] }),
      createRecorder: () => recorder,
      isMimeTypeSupported: (mimeType) => mimeType === "audio/webm;codecs=opus",
      now: () => 800,
      onChunk: async (bytes) => { chunks.push([...bytes]); },
    });

    await expect(capture.prepare()).resolves.toBe("audio/webm;codecs=opus");
    capture.start();
    recorder.emit([1, 2]);
    recorder.emit([3, 4]);
    await capture.stop();

    expect(recorder.startedWith).toBe(250);
    expect(chunks).toEqual([[1, 2], [3, 4]]);
    expect(track.stopped).toBe(true);
    expect(capture.getPhase()).toBe("stopped");
  });

  it("surfaces microphone permission failures", async () => {
    const errors: BrowserAudioCaptureError[] = [];
    const capture = new BrowserAudioCapture({
      getUserMedia: async () => { throw new DOMException("Permission denied", "NotAllowedError"); },
      onChunk: async () => undefined,
      onError: (error) => errors.push(error),
    });

    await expect(capture.prepare()).rejects.toThrow("Permission denied");
    expect(capture.getPhase()).toBe("failed");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "capture-failed", message: "Permission denied" });
  });

  it("forwards later chunks into the bounded router lane without awaiting earlier acknowledgements", async () => {
    const track = new FakeTrack();
    const recorder = new FakeRecorder("audio/webm");
    const chunks: number[][] = [];
    let releaseFirst: () => void = () => {};
    const firstAcknowledgement = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let markSecondSeen: () => void = () => {};
    const secondSeen = new Promise<void>((resolve) => { markSecondSeen = resolve; });
    const capture = new BrowserAudioCapture({
      getUserMedia: async () => ({ getTracks: () => [track] }),
      createRecorder: () => recorder,
      isMimeTypeSupported: () => false,
      onChunk: async (bytes) => {
        chunks.push([...bytes]);
        if (chunks.length === 1) await firstAcknowledgement;
        if (chunks.length === 2) markSecondSeen();
      },
    });

    await capture.prepare();
    capture.start();
    recorder.emit([1]);
    recorder.emit([2]);
    const stopping = capture.stop();
    await secondSeen;

    expect(chunks).toEqual([[1], [2]]);
    releaseFirst();
    await stopping;
  });

  it("stops media tracks and rejects stop when the chunk sink fails", async () => {
    const track = new FakeTrack();
    const recorder = new FakeRecorder("audio/webm");
    const capture = new BrowserAudioCapture({
      getUserMedia: async () => ({ getTracks: () => [track] }),
      createRecorder: () => recorder,
      isMimeTypeSupported: () => false,
      onChunk: async () => { throw new Error("router rejected chunk"); },
    });

    await capture.prepare();
    capture.start();
    recorder.emit([1]);

    await expect(capture.stop()).rejects.toThrow("router rejected chunk");
    expect(track.stopped).toBe(true);
    expect(capture.getPhase()).toBe("failed");
  });
});
