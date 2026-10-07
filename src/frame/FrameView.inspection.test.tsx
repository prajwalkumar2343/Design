import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BridgeElementTarget, BridgeEventMessage, BridgeInspection } from "../bridge/protocol";
import { FrameView } from "./FrameView";

const bridge = vi.hoisted(() => ({
  onEvent: null as ((message: unknown) => void) | null,
  pending: new Map<string, (value: unknown) => void>(),
}));

vi.mock("../bridge/transport", () => ({
  IframeBridgeTransport: class {
    constructor(options: { handlers: { onEvent: (message: unknown) => void } }) {
      bridge.onEvent = options.handlers.onEvent;
    }
    attach() {}
    destroy() {}
    inspect(targetId: string) {
      return new Promise((resolve) => bridge.pending.set(targetId, resolve));
    }
  },
}));

const target: BridgeElementTarget = {
  elementId: "frm~f1~data:text-1",
  tagName: "div",
  path: "html[1]/body[1]/div[1]",
  name: "Hello",
  role: null,
  bounds: { x: 7, y: 7, width: 240, height: 32 },
};

function event(name: BridgeEventMessage["event"], eventTarget: BridgeElementTarget | null) {
  return { type: "event", event: name, target: eventTarget, point: { x: 10, y: 10 } } as unknown as BridgeEventMessage;
}

describe("FrameView inspection", () => {
  it("keeps a selection's inspection when a hover-out lands before the response", async () => {
    const onBridgeInspection = vi.fn();
    render(
      <FrameView
        frame={{ id: "f1", name: "Draw", documentId: "d1", x: 0, y: 0, width: 300, height: 100, srcDoc: "<!doctype html><html><body></body></html>", background: "transparent", category: "desktop" }}
        isLive
        isSelected={false}
        isPanTool={false}
        onSelect={vi.fn()}
        onStartMove={vi.fn()}
        onStartPan={vi.fn()}
        onBridgeInspection={onBridgeInspection}
      />,
    );

    act(() => {
      bridge.onEvent!(event("select", target));
      bridge.onEvent!(event("hover", null));
    });
    const inspection: BridgeInspection = { target, text: "Hello", attributes: {}, inlineStyle: {}, computedStyle: {} };
    await act(async () => {
      bridge.pending.get(target.elementId)!(inspection);
    });

    expect(onBridgeInspection).toHaveBeenLastCalledWith("f1", inspection);
  });
});
