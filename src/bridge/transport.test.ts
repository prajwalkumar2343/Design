import { describe, expect, it, vi } from "vitest";
import { BRIDGE_PROTOCOL, BRIDGE_PROTOCOL_VERSION } from "./protocol";
import { IframeBridgeTransport } from "./transport";

describe("iframe bridge transport validation", () => {
  it("requires the sandbox origin, exact iframe source, channel, frame, and version", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const onEvent = vi.fn();
    const transport = new IframeBridgeTransport({
      iframe,
      channel: "channel-1",
      frameId: "frame-1",
      handlers: { onEvent },
    });
    const message = {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      channel: "channel-1",
      frameId: "frame-1",
      type: "event",
      event: "hover",
      target: null,
      point: { x: 10, y: 20 },
    } as const;

    expect(transport.acceptMessage({ data: message, origin: "http://evil.test", source: iframe.contentWindow })).toBe(false);
    expect(transport.acceptMessage({ data: message, origin: "null", source: window })).toBe(false);
    expect(transport.acceptMessage({ data: { ...message, channel: "wrong" }, origin: "null", source: iframe.contentWindow })).toBe(false);
    expect(transport.acceptMessage({ data: { ...message, version: 2 }, origin: "null", source: iframe.contentWindow })).toBe(false);
    expect(onEvent).not.toHaveBeenCalled();

    expect(transport.acceptMessage({ data: message, origin: "null", source: iframe.contentWindow })).toBe(true);
    expect(onEvent).toHaveBeenCalledWith(message);
    transport.destroy();
    iframe.remove();
  });

  it("resolves a command request with a reversible acknowledgement and rejects bridge errors", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const transport = new IframeBridgeTransport({
      iframe,
      channel: "channel-2",
      frameId: "frame-2",
    });
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);

    const resultPromise = transport.setInlineStyle({
      command: "set-inline-style",
      targetId: "id%3Atitle",
      property: "color",
      value: "red",
    });
    const request = postMessage.mock.calls[0]?.[0] as { requestId: string };
    expect(request.requestId).toBeTruthy();

    const ack = {
      kind: "command" as const,
      command: "set-inline-style" as const,
      targetId: "id%3Atitle",
      property: "color" as const,
      previousValue: "black",
      value: "red",
      undo: {
        command: "set-inline-style" as const,
        targetId: "id%3Atitle",
        property: "color" as const,
        value: "black",
      },
    };
    expect(transport.acceptMessage({
      origin: "null",
      source: iframe.contentWindow,
      data: {
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_PROTOCOL_VERSION,
        channel: "channel-2",
        frameId: "frame-2",
        type: "response",
        requestId: request.requestId,
        ok: true,
        result: { kind: "command", ack },
      },
    })).toBe(true);
    await expect(resultPromise).resolves.toEqual(ack);

    const errorPromise = transport.setText({
      command: "set-text",
      targetId: "missing",
      text: "new",
    });
    const errorRequest = postMessage.mock.calls[1]?.[0] as { requestId: string };
    expect(transport.acceptMessage({
      origin: "null",
      source: iframe.contentWindow,
      data: {
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_PROTOCOL_VERSION,
        channel: "channel-2",
        frameId: "frame-2",
        type: "response",
        requestId: errorRequest.requestId,
        ok: false,
        error: { code: "target-not-found", message: "The requested element no longer exists" },
      },
    })).toBe(true);
    await expect(errorPromise).rejects.toMatchObject({ code: "target-not-found" });

    postMessage.mockRestore();
    transport.destroy();
    iframe.remove();
  });

  it("reports DOM-mutating commands through onMutatingCommand but not reads", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const onMutatingCommand = vi.fn();
    const transport = new IframeBridgeTransport({
      iframe,
      channel: "channel-3",
      frameId: "frame-3",
      handlers: { onMutatingCommand },
    });
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);

    const styleAck = {
      kind: "command" as const,
      command: "set-inline-style" as const,
      targetId: "id%3Aa",
      property: "color" as const,
      previousValue: null,
      value: "red",
      undo: { command: "set-inline-style" as const, targetId: "id%3Aa", property: "color" as const, value: null },
    };
    const respondOk = (callIndex: number) => {
      const request = postMessage.mock.calls[callIndex]?.[0] as { requestId: string };
      transport.acceptMessage({
        origin: "null",
        source: iframe.contentWindow,
        data: {
          protocol: BRIDGE_PROTOCOL,
          version: BRIDGE_PROTOCOL_VERSION,
          channel: "channel-3",
          frameId: "frame-3",
          type: "response",
          requestId: request.requestId,
          ok: true,
          result: { kind: "command", ack: styleAck },
        },
      });
    };

    const pending: Promise<unknown>[] = [
      transport.setInlineStyle({ command: "set-inline-style", targetId: "id%3Aa", property: "color", value: "red" }),
      transport.createElement({
        command: "create-element",
        elementId: "id%3Anew",
        kind: "text",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        parentId: "id%3Abody",
        text: "x",
      }),
      transport.startTextEdit("id%3Aa"),
      transport.inspect("id%3Aa"),
    ];
    // No ack yet — a command in flight is not a landed mutation.
    expect(onMutatingCommand).not.toHaveBeenCalled();

    respondOk(0);
    respondOk(1);
    respondOk(2);
    const inspectRequest = postMessage.mock.calls[3]?.[0] as { requestId: string };
    transport.acceptMessage({
      origin: "null",
      source: iframe.contentWindow,
      data: {
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_PROTOCOL_VERSION,
        channel: "channel-3",
        frameId: "frame-3",
        type: "response",
        requestId: inspectRequest.requestId,
        ok: true,
        result: { kind: "inspection", inspection: null },
      },
    });

    await Promise.allSettled(pending);
    // set-inline-style + create-element landed; session chrome and reads don't count.
    expect(onMutatingCommand).toHaveBeenCalledTimes(2);
    expect(onMutatingCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({ command: "set-inline-style" }));
    expect(onMutatingCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({ command: "create-element" }));

    // A rejected command never touched the document — it must not mark dirty.
    const failed = transport.setInlineStyle({
      command: "set-inline-style",
      targetId: "id%3Agone",
      property: "color",
      value: "red",
    });
    const failRequest = postMessage.mock.calls[4]?.[0] as { requestId: string };
    transport.acceptMessage({
      origin: "null",
      source: iframe.contentWindow,
      data: {
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_PROTOCOL_VERSION,
        channel: "channel-3",
        frameId: "frame-3",
        type: "response",
        requestId: failRequest.requestId,
        ok: false,
        error: { code: "target-not-found", message: "The requested element no longer exists" },
      },
    });
    await expect(failed).rejects.toMatchObject({ code: "target-not-found" });
    expect(onMutatingCommand).toHaveBeenCalledTimes(2);

    transport.destroy();
    iframe.remove();
  });

  it("reads back the live document markup", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const transport = new IframeBridgeTransport({
      iframe,
      channel: "channel-4",
      frameId: "frame-4",
    });
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);

    const promise = transport.readDocument();
    const request = postMessage.mock.calls[0]?.[0] as { requestId: string; command: string };
    expect(request.command).toBe("document");

    transport.acceptMessage({
      origin: "null",
      source: iframe.contentWindow,
      data: {
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_PROTOCOL_VERSION,
        channel: "channel-4",
        frameId: "frame-4",
        type: "response",
        requestId: request.requestId,
        ok: true,
        result: { kind: "document", html: "<!doctype html>\n<html><body>live</body></html>" },
      },
    });
    await expect(promise).resolves.toContain("<body>live</body>");

    transport.destroy();
    iframe.remove();
  });
});
