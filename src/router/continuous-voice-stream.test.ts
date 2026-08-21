import { describe, expect, it } from "vitest";

import {
  ContinuousVoiceStream,
  ContinuousVoiceStreamError,
} from "./continuous-voice-stream";
import type {
  AppendVoiceAudioRequest,
  CancelVoiceStreamRequest,
  CodexVoiceStreamTransport,
  StartVoiceStreamRequest,
  StopVoiceStreamRequest,
  UpdateVoiceContextRequest,
  VoiceInteractionContext,
  VoiceStreamLifecycleEvent,
} from "./voice-stream-protocol";

function context(overrides: Partial<VoiceInteractionContext> = {}): VoiceInteractionContext {
  return {
    capturedAtMs: 100,
    documentId: "fieldwork",
    documentRevision: 1,
    activeFrameId: "desktop",
    selectedElementIds: [],
    pointer: null,
    ...overrides,
  };
}

class FakeVoiceTransport implements CodexVoiceStreamTransport {
  readonly calls: Array<
    | { type: "start"; request: StartVoiceStreamRequest }
    | { type: "audio"; request: AppendVoiceAudioRequest }
    | { type: "context"; request: UpdateVoiceContextRequest }
    | { type: "stop"; request: StopVoiceStreamRequest }
    | { type: "cancel"; request: CancelVoiceStreamRequest }
  > = [];
  appendGate: Promise<void> | null = null;
  appendError: Error | null = null;

  async start(request: StartVoiceStreamRequest) {
    this.calls.push({ type: "start", request });
    return { streamId: request.streamId, acceptedMimeType: request.mimeType };
  }

  async appendAudio(request: AppendVoiceAudioRequest, options: { signal?: AbortSignal }) {
    this.calls.push({ type: "audio", request });
    if (this.appendGate) {
      await Promise.race([
        this.appendGate,
        new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
      ]);
    }
    if (this.appendError) throw this.appendError;
    return { streamId: request.streamId, acceptedSequence: request.sequence };
  }

  async updateContext(request: UpdateVoiceContextRequest) {
    this.calls.push({ type: "context", request });
    return { streamId: request.streamId, acceptedSequence: request.sequence };
  }

  async stop(request: StopVoiceStreamRequest) {
    this.calls.push({ type: "stop", request });
    return { streamId: request.streamId, finalSequence: request.finalSequence };
  }

  async cancel(request: CancelVoiceStreamRequest) {
    this.calls.push({ type: "cancel", request });
  }
}

function createHarness(transport = new FakeVoiceTransport(), maxBufferedBytes?: number) {
  const lifecycle: VoiceStreamLifecycleEvent[] = [];
  const stream = new ContinuousVoiceStream({
    transport,
    now: () => 500,
    createStreamId: () => "voice-1",
    maxBufferedBytes,
    onLifecycleEvent: (event) => lifecycle.push(event),
  });
  return { lifecycle, stream, transport };
}

describe("continuous Codex voice stream", () => {
  it("streams audio and context in one ordered lane before stopping", async () => {
    const { lifecycle, stream, transport } = createHarness();

    await stream.start({ mimeType: "audio/webm;codecs=opus", initialContext: context() });
    const first = stream.appendAudio(new Uint8Array([1, 2, 3]), 510);
    const second = stream.updateContext(context({
      capturedAtMs: 520,
      selectedElementIds: ["data:hero"],
    }));
    const third = stream.appendAudio(new Uint8Array([4, 5]), 530);
    await Promise.all([first, second, third]);
    await stream.stop();

    expect(transport.calls.map((call) => call.type)).toEqual([
      "start",
      "audio",
      "context",
      "audio",
      "stop",
    ]);
    expect(transport.calls
      .filter((call) => call.type === "audio" || call.type === "context")
      .map((call) => call.request.sequence))
      .toEqual([1, 2, 3]);
    expect(stream.getPhase()).toBe("stopped");
    expect(stream.getBufferedBytes()).toBe(0);
    expect(lifecycle.map((event) => event.type)).toEqual([
      "starting",
      "streaming",
      "audio-sent",
      "context-sent",
      "audio-sent",
      "stopping",
      "stopped",
    ]);
  });

  it("bounds queued audio while the router applies backpressure", async () => {
    const transport = new FakeVoiceTransport();
    let releaseAppend: () => void = () => {};
    transport.appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
    const { stream } = createHarness(transport, 5);
    await stream.start({ mimeType: "audio/webm", initialContext: context() });

    const inFlight = stream.appendAudio(new Uint8Array([1, 2, 3]));
    const queued = stream.appendAudio(new Uint8Array([4, 5]));
    const inFlightRejection = expect(inFlight).rejects.toThrow("Aborted");
    const queuedRejection = expect(queued).rejects.toThrow("cancelled");
    expect(() => stream.appendAudio(new Uint8Array([6])))
      .toThrowError(expect.objectContaining({ code: "buffer-overflow" }));
    await Promise.all([inFlightRejection, queuedRejection]);
    releaseAppend();
    expect(transport.calls.some((call) => call.type === "cancel" && call.request.reason === "buffer-overflow"))
      .toBe(true);
  });

  it("fails the stream without replaying a rejected audio chunk", async () => {
    const transport = new FakeVoiceTransport();
    transport.appendError = new Error("router unavailable");
    const { lifecycle, stream } = createHarness(transport);
    await stream.start({ mimeType: "audio/webm", initialContext: context() });

    await expect(stream.appendAudio(new Uint8Array([1]))).rejects.toThrow("router unavailable");
    expect(stream.getPhase()).toBe("failed");
    expect(transport.calls.filter((call) => call.type === "audio")).toHaveLength(1);
    expect(lifecycle.at(-1)).toMatchObject({ type: "failed", message: "router unavailable" });
  });

  it("supports idempotent user cancellation", async () => {
    const { stream, transport } = createHarness();
    await stream.start({ mimeType: "audio/webm", initialContext: context() });

    await stream.cancel("user");
    await stream.cancel("user");

    expect(stream.getPhase()).toBe("stopped");
    expect(transport.calls.filter((call) => call.type === "cancel")).toHaveLength(1);
  });

  it("rejects invalid context and audio before transport", async () => {
    const { stream, transport } = createHarness();
    await expect(stream.start({
      mimeType: "audio/webm",
      initialContext: context({ documentRevision: 0 }),
    })).rejects.toThrowError(expect.objectContaining({ code: "invalid-context" }));

    await stream.start({ mimeType: "audio/webm", initialContext: context() });
    expect(() => stream.appendAudio(new Uint8Array()))
      .toThrowError(expect.objectContaining({ code: "empty-chunk" }));
    expect(transport.calls.filter((call) => call.type === "audio")).toHaveLength(0);
  });

  it("rejects a second start while a stream is active", async () => {
    const { stream } = createHarness();
    await stream.start({ mimeType: "audio/webm", initialContext: context() });

    await expect(stream.start({ mimeType: "audio/webm", initialContext: context() }))
      .rejects.toBeInstanceOf(ContinuousVoiceStreamError);
  });

  it("keeps a cancelled lifecycle when the start transport rejects late", async () => {
    const lifecycle: VoiceStreamLifecycleEvent[] = [];
    let abortStart: () => void = () => {};
    const transport = new FakeVoiceTransport();
    transport.start = async (request: StartVoiceStreamRequest, options?: { signal?: AbortSignal }) => {
      transport.calls.push({ type: "start", request });
      await new Promise<void>((resolve, reject) => {
        abortStart = () => reject(new Error("start aborted"));
        options?.signal?.addEventListener("abort", () => abortStart(), { once: true });
      });
      return { streamId: request.streamId, acceptedMimeType: request.mimeType };
    };
    const stream = new ContinuousVoiceStream({
      transport,
      now: () => 500,
      createStreamId: () => "voice-1",
      onLifecycleEvent: (event) => lifecycle.push(event),
    });

    const pending = stream.start({ mimeType: "audio/webm", initialContext: context() });
    await stream.cancel("user");
    await expect(pending).rejects.toThrow("start aborted");

    expect(stream.getPhase()).toBe("stopped");
    expect(lifecycle.filter((event) => event.type === "failed")).toHaveLength(0);
    expect(lifecycle.at(-1)).toMatchObject({ type: "cancelled", reason: "user" });
  });

  it("does not fail a restarted stream when a stale drain settles with an error", async () => {
    const lifecycle: VoiceStreamLifecycleEvent[] = [];
    let releaseAppend: () => void = () => {};
    const transport = new FakeVoiceTransport();
    // Ignores the abort signal entirely, like a misbehaving transport, and
    // fails only the stale first-generation chunk when finally released.
    // Keyed on streamId (not sequence) because sequences restart per generation.
    transport.appendAudio = async (request: AppendVoiceAudioRequest) => {
      transport.calls.push({ type: "audio", request });
      if (request.streamId === "voice-1") {
        if (transport.appendGate) await transport.appendGate;
        if (transport.appendError) throw transport.appendError;
      }
      return { streamId: request.streamId, acceptedSequence: request.sequence };
    };
    const stream = new ContinuousVoiceStream({
      transport,
      now: () => 500,
      createStreamId: () => `voice-${transport.calls.filter((call) => call.type === "start").length + 1}`,
      onLifecycleEvent: (event) => lifecycle.push(event),
    });

    transport.appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
    transport.appendError = new Error("stale transport exploded");
    await stream.start({ mimeType: "audio/webm", initialContext: context() });
    const staleChunk = stream.appendAudio(new Uint8Array([1]));
    await stream.cancel("user");

    // Restart while the stale append is still parked on the gate; the stale
    // call still fails with the transport error when released.
    const secondStreamId = await stream.start({ mimeType: "audio/webm", initialContext: context() });
    const healthy = stream.appendAudio(new Uint8Array([2]));
    releaseAppend();
    await expect(staleChunk).rejects.toThrow("stale transport exploded");
    await healthy;
    await stream.stop();

    expect(secondStreamId).toBe("voice-2");
    expect(stream.getPhase()).toBe("stopped");
    expect(lifecycle.filter((event) => event.type === "failed")).toHaveLength(0);
  });
});
