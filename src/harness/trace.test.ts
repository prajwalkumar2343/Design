import { describe, expect, it, vi } from "vitest";

import { TraceLog, createTraceId } from "./trace";

describe("TraceLog", () => {
  it("assigns span ids and replays events", () => {
    const log = new TraceLog();
    log.push({ traceId: "t1", type: "session/started", at: 1, data: {} });
    log.push({ traceId: "t1", type: "turn/ended", at: 2, data: { step: 1 } });

    expect(log.all().map((event) => event.spanId)).toEqual(["t1:1", "t1:2"]);
    expect(log.byType("turn/ended")).toHaveLength(1);
  });

  it("streams to subscribed sinks", () => {
    const log = new TraceLog();
    const sink = { push: vi.fn() };
    const unsubscribe = log.subscribe(sink);
    log.push({ traceId: "t1", type: "error", at: 1, data: { message: "x" } });
    expect(sink.push).toHaveBeenCalledTimes(1);
    unsubscribe();
    log.push({ traceId: "t1", type: "error", at: 2, data: {} });
    expect(sink.push).toHaveBeenCalledTimes(1);
  });

  it("creates prefixed trace ids", () => {
    expect(createTraceId("brainstorm")).toMatch(/^brainstorm-/);
  });
});
