import { describe, expect, it } from "vitest";
import {
  BRIDGE_PROTOCOL,
  BRIDGE_PROTOCOL_VERSION,
  parseBridgeMessage,
  validateBridgeMessage,
  type BridgeElementTarget,
} from "./protocol";

const target: BridgeElementTarget = {
  elementId: "id%3Atitle",
  tagName: "h1",
  path: "html[1]/body[1]/h1[1]",
  name: "Hello",
  role: null,
  bounds: { x: 10, y: 20, width: 100, height: 30 },
};

const identity = { channel: "frame-desktop-channel", frameId: "desktop" };

describe("iframe bridge protocol", () => {
  it("parses a versioned target event and validates its session identity", () => {
    const message = {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      ...identity,
      type: "event",
      event: "select",
      target,
      point: { x: 25, y: 35 },
    };

    expect(parseBridgeMessage(message)).toEqual(message);
    expect(validateBridgeMessage(message, identity)).toEqual(message);
    expect(validateBridgeMessage(message, { ...identity, channel: "other" })).toBeNull();
  });

  it("accepts text-edit lifecycle events and commands", () => {
    const event = {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      ...identity,
      type: "event",
      event: "text-commit",
      target,
      point: { x: 25, y: 35 },
      text: "Updated heading",
    };
    expect(parseBridgeMessage(event)).toEqual(event);

    const command = {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      ...identity,
      type: "command",
      requestId: "text-edit-1",
      command: { command: "commit-text-edit", targetId: target.elementId, text: "Updated heading" },
    };
    expect(parseBridgeMessage(command)).toEqual(command);
  });

  it("accepts keydown events carrying command modifiers and rejects non-boolean modifier values", () => {
    const base = {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      ...identity,
      type: "event",
      event: "keydown",
      target,
      point: { x: 25, y: 35 },
      key: "z",
      shiftKey: false,
      altKey: false,
    };

    expect(parseBridgeMessage({ ...base, metaKey: true })).toEqual({ ...base, metaKey: true });
    expect(parseBridgeMessage({ ...base, ctrlKey: true })).toEqual({ ...base, ctrlKey: true });
    expect(parseBridgeMessage({ ...base, metaKey: true, ctrlKey: true })).toEqual({ ...base, metaKey: true, ctrlKey: true });
    expect(parseBridgeMessage({ ...base, metaKey: "yes" })).toBeNull();
    expect(parseBridgeMessage({ ...base, ctrlKey: 1 })).toBeNull();
  });

  it("rejects malformed command shapes while leaving value policy to the sandbox runtime", () => {
    const base = {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      ...identity,
      type: "command",
      requestId: "request-1",
    };

    expect(parseBridgeMessage({ ...base, command: { command: "unknown", targetId: target.elementId } })).toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "set-inline-style",
        targetId: target.elementId,
        property: "background",
        value: "url(javascript:alert(1))",
      },
    })).not.toBeNull();
    expect(parseBridgeMessage({ ...base, version: 2, command: { command: "set-text", targetId: "x", text: "ok" } })).toBeNull();
    expect(parseBridgeMessage({ ...base, command: { command: "set-text", targetId: "x", text: "\u0000" } })).toBeNull();
  });

  it("rejects invalid geometry instead of allowing NaN or negative dimensions", () => {
    expect(
      parseBridgeMessage({
        protocol: BRIDGE_PROTOCOL,
        version: BRIDGE_PROTOCOL_VERSION,
        ...identity,
        type: "event",
        event: "hover",
        target: { ...target, bounds: { x: 0, y: 0, width: -1, height: 4 } },
        point: { x: 0, y: 0 },
      }),
    ).toBeNull();
  });

  it("accepts reversible command acknowledgements with an inverse operation", () => {
    const response = {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      ...identity,
      type: "response",
      requestId: "request-2",
      ok: true,
      result: {
        kind: "command",
        ack: {
          kind: "command",
          command: "set-inline-style",
          targetId: target.elementId,
          property: "color",
          previousValue: "rgb(0, 0, 0)",
          value: "rgb(255, 0, 0)",
          undo: {
            command: "set-inline-style",
            targetId: target.elementId,
            property: "color",
            value: "rgb(0, 0, 0)",
          },
        },
      },
    };

    expect(parseBridgeMessage(response)).toEqual(response);
  });

  it("validates typed creation commands and rejects unsafe restore payloads", () => {
    const base = {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      ...identity,
      type: "command",
      requestId: "create-1",
    };
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "create-element",
        elementId: "rectangle-1",
        kind: "rectangle",
        bounds: { x: 10, y: 20, width: 120, height: 80 },
        fill: "#fff",
      },
    })).not.toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "create-element",
        elementId: "bad",
        kind: "image",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        src: "https://example.test/image.png",
      },
    })).toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "restore-element",
        snapshot: { elementId: "x", kind: "rectangle", bounds: { x: 0, y: 0, width: 10, height: 10 }, text: "", alt: "", src: "", points: [], fill: "#fff", stroke: "#000", strokeWidth: 2, radius: 0, editable: true, style: {} },
      },
    })).not.toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "create-element",
        elementId: "radius-rect",
        kind: "rectangle",
        bounds: { x: 0, y: 0, width: 100, height: 60 },
        radius: 12,
      },
    })).not.toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "create-element",
        elementId: "radius-rect",
        kind: "rectangle",
        bounds: { x: 0, y: 0, width: 100, height: 60 },
        radius: 999,
      },
    })).toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "set-shape-radius",
        targetId: "rectangle-1",
        radius: 18,
      },
    })).not.toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "set-shape-radius",
        targetId: "rectangle-1",
        radius: -1,
      },
    })).toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "set-inline-style",
        targetId: "x",
        property: "width",
        value: "120px",
      },
    })).not.toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "pick-element",
        point: { x: 320, y: 180 },
        shiftKey: false,
      },
    })).not.toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "pick-element",
        point: { x: "north", y: 180 },
        shiftKey: false,
      },
    })).toBeNull();
    expect(parseBridgeMessage({
      ...base,
      command: {
        command: "pick-element",
        point: { x: 320, y: 180 },
        shiftKey: "yes",
      },
    })).toBeNull();
  });

  it("validates shape fill and glass commands", () => {
    const commandEnvelope = (command: unknown) => ({
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      ...identity,
      type: "command",
      requestId: "bridge-desktop-8",
      command,
    });
    expect(parseBridgeMessage(commandEnvelope(
      { command: "set-shape-fill", targetId: "rectangle-1", color: "#e5484d" },
    ))).not.toBeNull();
    expect(parseBridgeMessage(commandEnvelope(
      { command: "set-shape-fill", targetId: "rectangle-1", color: null },
    ))).not.toBeNull();
    expect(parseBridgeMessage(commandEnvelope(
      { command: "set-shape-fill", targetId: "rectangle-1", color: "url(#evil)" },
    ))).toBeNull();
    expect(parseBridgeMessage(commandEnvelope(
      { command: "set-shape-glass", targetId: "rectangle-1", level: 60 },
    ))).not.toBeNull();
    expect(parseBridgeMessage(commandEnvelope(
      { command: "set-shape-glass", targetId: "rectangle-1", level: null },
    ))).not.toBeNull();
    expect(parseBridgeMessage(commandEnvelope(
      { command: "set-shape-glass", targetId: "rectangle-1", level: 140 },
    ))).toBeNull();
  });

  it("validates shape fill and glass acknowledgements with their undo payloads", () => {
    const fillAck = {
      protocol: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      ...identity,
      type: "response",
      requestId: "bridge-desktop-9",
      ok: true,
      result: {
        kind: "command",
        ack: {
          kind: "command",
          command: "set-shape-fill",
          targetId: "rectangle-1",
          previousColor: null,
          color: "#e5484d",
          undo: { command: "set-shape-fill", targetId: "rectangle-1", color: null },
        },
      },
    };
    expect(parseBridgeMessage(fillAck)).not.toBeNull();

    const glassAck = {
      ...fillAck,
      requestId: "bridge-desktop-10",
      result: {
        kind: "command",
        ack: {
          kind: "command",
          command: "set-shape-glass",
          targetId: "rectangle-1",
          previousLevel: null,
          level: 60,
          undo: { command: "set-shape-glass", targetId: "rectangle-1", level: null },
        },
      },
    };
    expect(parseBridgeMessage(glassAck)).not.toBeNull();

    const glassAckBadUndo = {
      ...glassAck,
      requestId: "bridge-desktop-11",
      result: {
        kind: "command",
        ack: {
          ...glassAck.result.ack,
          undo: { command: "set-shape-glass", targetId: "rectangle-1", level: 250 },
        },
      },
    };
    expect(parseBridgeMessage(glassAckBadUndo)).toBeNull();
  });
});
