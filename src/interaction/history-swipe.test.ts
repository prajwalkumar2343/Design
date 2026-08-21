import { afterEach, describe, expect, it } from "vitest";

import { installHistorySwipeGuard } from "./history-swipe";

describe("installHistorySwipeGuard", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  const wheel = (init: WheelEventInit): WheelEvent => {
    const event = new WheelEvent("wheel", { cancelable: true, bubbles: true, ...init });
    window.dispatchEvent(event);
    return event;
  };

  it("blocks horizontal-dominant trackpad swipes that trigger history navigation", () => {
    cleanups.push(installHistorySwipeGuard());
    expect(wheel({ deltaX: -120, deltaY: -4 }).defaultPrevented).toBe(true);
    expect(wheel({ deltaX: 90, deltaY: 10 }).defaultPrevented).toBe(true);
  });

  it("leaves vertical scrolling and pinch zoom untouched", () => {
    cleanups.push(installHistorySwipeGuard());
    expect(wheel({ deltaX: 0, deltaY: 100 }).defaultPrevented).toBe(false);
    expect(wheel({ deltaX: -8, deltaY: 60 }).defaultPrevented).toBe(false);
    expect(wheel({ deltaX: -120, deltaY: 4, ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("keeps horizontal scrolling working inside scrollable panels", () => {
    cleanups.push(installHistorySwipeGuard());
    const panel = document.createElement("div");
    Object.defineProperty(panel, "scrollWidth", { value: 900, configurable: true });
    Object.defineProperty(panel, "clientWidth", { value: 300, configurable: true });
    panel.style.overflowX = "auto";
    const inner = document.createElement("span");
    panel.appendChild(inner);
    document.body.appendChild(panel);

    const event = new WheelEvent("wheel", { deltaX: -40, deltaY: -2, cancelable: true, bubbles: true });
    inner.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("still blocks swipes over panels that cannot scroll further horizontally", () => {
    cleanups.push(installHistorySwipeGuard());
    const panel = document.createElement("div");
    Object.defineProperty(panel, "scrollWidth", { value: 300, configurable: true });
    Object.defineProperty(panel, "clientWidth", { value: 300, configurable: true });
    panel.style.overflowX = "auto";
    document.body.appendChild(panel);

    const event = new WheelEvent("wheel", { deltaX: -40, deltaY: -2, cancelable: true, bubbles: true });
    panel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
