import { describe, expect, it } from "vitest";

import { installPageZoomGuard } from "./page-zoom";

describe("installPageZoomGuard", () => {
  it("prevents pinch wheels while leaving plain scroll wheels alone", () => {
    const dispose = installPageZoomGuard(window);
    try {
      const pinch = new WheelEvent("wheel", { ctrlKey: true, deltaY: -40, cancelable: true });
      window.dispatchEvent(pinch);
      expect(pinch.defaultPrevented).toBe(true);

      const metaPinch = new WheelEvent("wheel", { metaKey: true, deltaY: -40, cancelable: true });
      window.dispatchEvent(metaPinch);
      expect(metaPinch.defaultPrevented).toBe(true);

      const scroll = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
      window.dispatchEvent(scroll);
      expect(scroll.defaultPrevented).toBe(false);
    } finally {
      dispose();
    }
  });

  it("prevents browser zoom keys and Safari gesture events", () => {
    const dispose = installPageZoomGuard(window);
    try {
      for (const key of ["=", "-", "0"]) {
        const event = new KeyboardEvent("keydown", { key, metaKey: true, cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }

      const plainKey = new KeyboardEvent("keydown", { key: "=", cancelable: true });
      window.dispatchEvent(plainKey);
      expect(plainKey.defaultPrevented).toBe(false);

      const gesture = new Event("gesturestart", { cancelable: true });
      document.dispatchEvent(gesture);
      expect(gesture.defaultPrevented).toBe(true);
    } finally {
      dispose();
    }
  });

  it("stops blocking after disposal", () => {
    const dispose = installPageZoomGuard(window);
    dispose();
    const pinch = new WheelEvent("wheel", { ctrlKey: true, deltaY: -40, cancelable: true });
    window.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);
  });
});
