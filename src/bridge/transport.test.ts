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
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);

    const pending: Promise<unknown>[] = [
      transport.setInlineStyle({ command: "set-inline-style", targetId: "id%3Aa", property: "color", value: "red" }),
    ];
    expect(onMutatingCommand).toHaveBeenCalledTimes(1);
    expect(onMutatingCommand).toHaveBeenLastCalledWith(expect.objectContaining({ command: "set-inline-style" }));

    pending.push(
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
    );
    expect(onMutatingCommand).toHaveBeenCalledTimes(2);

    transport.destroy();
    await Promise.allSettled(pending);
    iframe.remove();
  });
});
