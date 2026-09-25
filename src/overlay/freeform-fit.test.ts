import { describe, expect, it } from "vitest";
import {
  changeFootprint,
  computeFreeformFit,
  freeformBodyShiftFromValue,
  freeformBodyShiftValue,
  freeformFrameCommands,
  isFreeformContentNode,
  isFreeformContentTag,
  rotatedBoundsAabb,
} from "./freeform-fit";
import type { OverlayStyleChange } from "./commands";
import { FREEFORM_FRAME_PAD } from "../frame/freeform";

const frame = { id: "frame-1", x: 100, y: 100, width: 200, height: 200 };

describe("computeFreeformFit", () => {
  it("returns null when the frame already hugs its content", () => {
    const fit = computeFreeformFit(frame, [
      {
        x: 108,
        y: 108,
        width: 200 - FREEFORM_FRAME_PAD * 2,
        height: 200 - FREEFORM_FRAME_PAD * 2,
      },
    ]);
    expect(fit).toBeNull();
  });

  it("returns null when there is no measurable content", () => {
    expect(computeFreeformFit(frame, [])).toBeNull();
    expect(
      computeFreeformFit(frame, [{ x: 10, y: 10, width: 0, height: 0 }]),
    ).toBeNull();
  });

  it("grows the frame to content that escaped the bottom-right", () => {
    const fit = computeFreeformFit(frame, [
      { x: 108, y: 108, width: 50, height: 50 },
      { x: 400, y: 400, width: 50, height: 50 },
    ]);
    expect(fit).not.toBeNull();
    expect(fit!.rect.x).toBe(108 - FREEFORM_FRAME_PAD);
    expect(fit!.rect.y).toBe(108 - FREEFORM_FRAME_PAD);
    expect(fit!.rect.x + fit!.rect.width).toBe(450 + FREEFORM_FRAME_PAD);
    expect(fit!.rect.y + fit!.rect.height).toBe(450 + FREEFORM_FRAME_PAD);
    expect(fit!.originDelta).toEqual({
      x: fit!.rect.x - frame.x,
      y: fit!.rect.y - frame.y,
    });
  });

  it("moves the origin when content escapes top-left", () => {
    const fit = computeFreeformFit(frame, [
      { x: -200, y: -50, width: 40, height: 40 },
      { x: 108, y: 108, width: 50, height: 50 },
    ]);
    expect(fit).not.toBeNull();
    expect(fit!.originDelta.x).toBeLessThan(0);
    expect(fit!.originDelta.y).toBeLessThan(0);
    expect(fit!.rect.x).toBe(-200 - FREEFORM_FRAME_PAD);
    expect(fit!.rect.y).toBe(-50 - FREEFORM_FRAME_PAD);
  });

  it("shrinks an oversized frame back onto its content", () => {
    const fit = computeFreeformFit(
      { x: 0, y: 0, width: 800, height: 800 },
      [{ x: 20, y: 20, width: 30, height: 30 }],
    );
    expect(fit).not.toBeNull();
    expect(fit!.rect.width).toBe(30 + FREEFORM_FRAME_PAD * 2);
    expect(fit!.rect.height).toBe(30 + FREEFORM_FRAME_PAD * 2);
  });
});

describe("freeformFrameCommands", () => {
  it("emits a move command when the origin changes", () => {
    const commands = freeformFrameCommands(frame, {
      x: 50,
      y: 80,
      width: 200,
      height: 200,
    });
    expect(commands).toEqual([
      { type: "frame/move", frameId: "frame-1", position: { x: 50, y: 80 } },
    ]);
  });

  it("emits an update command when the size changes", () => {
    const commands = freeformFrameCommands(frame, {
      x: 100,
      y: 100,
      width: 300,
      height: 120,
    });
    expect(commands).toEqual([
      { type: "frame/update", frameId: "frame-1", patch: { width: 300, height: 120 } },
    ]);
  });
});

describe("body shift encoding", () => {
  it("round-trips the re-anchor translate", () => {
    const value = freeformBodyShiftValue({ x: -120, y: 40 });
    expect(value).toBe("translate(-120px, 40px)");
    expect(freeformBodyShiftFromValue(value)).toEqual({ x: 120, y: -40 });
  });

  it("clears the transform for a zero shift", () => {
    expect(freeformBodyShiftValue({ x: 0, y: 0 })).toBeNull();
    expect(freeformBodyShiftFromValue(null)).toEqual({ x: 0, y: 0 });
    expect(freeformBodyShiftFromValue("none")).toEqual({ x: 0, y: 0 });
  });
});

describe("rotatedBoundsAabb", () => {
  it("swaps axes at a quarter turn", () => {
    const rotated = rotatedBoundsAabb({ x: 0, y: 0, width: 100, height: 40 }, 90);
    expect(rotated.width).toBeCloseTo(40);
    expect(rotated.height).toBeCloseTo(100);
    expect(rotated.x + rotated.width / 2).toBeCloseTo(50);
    expect(rotated.y + rotated.height / 2).toBeCloseTo(20);
  });

  it("leaves unrotated bounds untouched", () => {
    const bounds = { x: 5, y: 5, width: 20, height: 10 };
    expect(rotatedBoundsAabb(bounds, 0)).toEqual(bounds);
  });
});

describe("changeFootprint", () => {
  const target = (bounds: OverlayStyleChange["target"]["bounds"]) => ({
    frameId: "f1",
    nodeId: "data:n1",
    tagName: "div",
    name: "n1",
    bounds,
  });

  it("uses the translated AABB verbatim when moving a rotated element", () => {
    // A move carries the measured post-transform AABB — rotating it again
    // double-applies the element's angle and over-grows the frame.
    const change: OverlayStyleChange = {
      target: target({ x: 0, y: 0, width: 99, height: 99 }),
      nextBounds: { x: 50, y: 0, width: 99, height: 99 },
      rotation: 45,
      previous: { transform: "rotate(45deg)" },
      next: { transform: "translate(50px, 0px) rotate(45deg)" },
    };
    expect(changeFootprint(change)).toEqual({ x: 50, y: 0, width: 99, height: 99 });
  });

  it("rotates the canonical rect into the occupied AABB on a rotate", () => {
    // Canonical changes carry the unrotated element rect — the footprint is
    // that rect spun by the change's total rotation.
    const change: OverlayStyleChange = {
      target: target({ x: 0, y: 0, width: 100, height: 40 }),
      nextBounds: { x: 0, y: 0, width: 100, height: 40 },
      rotation: 90,
      canonical: true,
      previous: { transform: null },
      next: { transform: "rotate(90deg)" },
    };
    const footprint = changeFootprint(change);
    expect(footprint.width).toBeCloseTo(40);
    expect(footprint.height).toBeCloseTo(100);
    expect(footprint.x + footprint.width / 2).toBeCloseTo(50);
    expect(footprint.y + footprint.height / 2).toBeCloseTo(20);
  });

  it("applies the rotation to a resized canonical rect", () => {
    const change: OverlayStyleChange = {
      target: target({ x: 0, y: 0, width: 99, height: 99 }),
      nextBounds: { x: 0, y: 0, width: 120, height: 60 },
      rotation: 90,
      canonical: true,
      previous: { transform: "rotate(90deg)" },
      next: { transform: "rotate(90deg)", width: "120px", height: "60px" },
    };
    const footprint = changeFootprint(change);
    expect(footprint.width).toBeCloseTo(60);
    expect(footprint.height).toBeCloseTo(120);
  });

  it("passes an AABB-space rotate change through verbatim when canonical bounds are unknown", () => {
    // A rotated element whose untransformed size can't be recovered stays in
    // measured-AABB space — re-rotating it would double-apply the angle.
    const change: OverlayStyleChange = {
      target: target({ x: 0, y: 0, width: 99, height: 99 }),
      nextBounds: { x: 0, y: 0, width: 99, height: 99 },
      rotation: 45,
      previous: { transform: "rotate(30deg)" },
      next: { transform: "rotate(45deg)" },
    };
    expect(changeFootprint(change)).toEqual({ x: 0, y: 0, width: 99, height: 99 });
  });

  it("passes unrotated changes straight through", () => {
    const change: OverlayStyleChange = {
      target: target({ x: 0, y: 0, width: 10, height: 10 }),
      nextBounds: { x: 5, y: 5, width: 20, height: 10 },
      rotation: 0,
      previous: { transform: null },
      next: { transform: "translate(5px, 5px)" },
    };
    expect(changeFootprint(change)).toEqual({ x: 5, y: 5, width: 20, height: 10 });
  });
});

describe("isFreeformContentTag", () => {
  it("excludes the frame document's structural elements", () => {
    expect(isFreeformContentTag("html")).toBe(false);
    expect(isFreeformContentTag("BODY")).toBe(false);
    expect(isFreeformContentTag("svg")).toBe(true);
    expect(isFreeformContentTag("div")).toBe(true);
  });
});

describe("isFreeformContentNode", () => {
  it("recognizes created roots by their data: id, scoped or not", () => {
    expect(isFreeformContentNode({ tagName: "svg", elementId: "data:shape-1" })).toBe(true);
    expect(isFreeformContentNode({ tagName: "svg", elementId: "frm~frame-1~data:shape-1" })).toBe(true);
    // Structural and authored-document nodes never fit content.
    expect(isFreeformContentNode({ tagName: "body", elementId: "frm~frame-1~path:html[1]/body[1]" })).toBe(false);
    expect(isFreeformContentNode({ tagName: "div", elementId: "frm~frame-1~path:html[1]/body[1]/div[1]" })).toBe(false);
    expect(isFreeformContentNode({ tagName: "div", elementId: "frm~frame-1~id:panel" })).toBe(false);
  });
});
