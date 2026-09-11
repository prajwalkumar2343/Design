export type TraceEventType =
  | "session/started"
  | "session/input-admitted"
  | "brainstorm/provider-started"
  | "brainstorm/provider-ended"
  | "brainstorm/provider-failed"
  | "brainstorm/assistant-message"
  | "brainstorm/tool-call"
  | "brainstorm/tool-result"
  | "brainstorm/tool-failed"
  | "main/provider-started"
  | "main/provider-ended"
  | "main/provider-failed"
  | "main/repair"
  | "main/admission-failed"
  | "wireframe/created"
  | "wireframe/edited"
  | "turn/ended"
  | "error";

export interface TraceEvent {
  traceId: string;
  spanId: string;
  type: TraceEventType;
  at: number;
  data: Record<string, unknown>;
}

export interface TraceSink {
  push(event: TraceEvent): void;
}

/**
 * Append-only lifecycle log. Live streaming deltas are intentionally kept
 * separate from the durable transcript; traces are for debugging and evals.
 */
export class TraceLog implements TraceSink {
  private readonly events: TraceEvent[] = [];
  private readonly listeners = new Set<TraceSink>();
  private sequence = 0;

  push(event: Omit<TraceEvent, "spanId">): void {
    this.sequence += 1;
    const full: TraceEvent = {
      ...event,
      spanId: `${event.traceId}:${this.sequence}`,
    };
    this.events.push(full);
    for (const listener of this.listeners) listener.push(full);
  }

  subscribe(sink: TraceSink): () => void {
    this.listeners.add(sink);
    return () => this.listeners.delete(sink);
  }

  all(): readonly TraceEvent[] {
    return this.events;
  }

  byType(type: TraceEventType): readonly TraceEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export function createTraceId(prefix = "trace"): string {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}
