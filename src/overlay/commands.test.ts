import { describe, expect, it } from "vitest";
import type { OverlayNodeTarget } from "./NodeOverlayLayer";
import {
  buildMoveChanges,
  buildResizeChanges,
  buildRotationChanges,
  parseTransform,
  toInlineStyleCommands,
  type OverlayStyleSnapshot,
} from "./commands";

function snapshot(
  tagName: string,
  bounds: OverlayNodeTarget["bounds"],
  inlineStyle: OverlayStyleSnapshot["inlineStyle"] = {},
  computedStyle: Record<string, string> = {},
): OverlayStyleSnapshot {
  return {
    target: {
      frameId: "desktop",
      nodeId: `id:${tagName}`,
      tagName,
      name: tagName,
      bounds,
    },
    inlineStyle,
    computedStyle,
  };
}

describe("overlay style commands", () => {
  it("turns a constrained image resize into an exact freeform border box", () => {
    const image = snapshot(
      "img",
      { x: 10, y: 20, width: 180, height: 120 },
      {
        width: "180px",
        height: "120px",
        "box-sizing": "content-box",
        "max-width": "180px",
      },
      { display: "block", "object-fit": "cover" },
    );

    const change = buildResizeChanges(
      [image],
      image.target.bounds,
      "e",
      { x: 70, y: 0 },
    )[0];

    expect(change.next).toMatchObject({
      "aspect-ratio": "auto",
      "box-sizing": "border-box",
      "max-height": "none",
      "max-width": "none",
      "min-height": "0",
      "min-width": "0",
      width: "250px",
      height: "120px",
    });
    expect(change.previous).toMatchObject({
      "box-sizing": "content-box",
      "max-width": "180px",
      width: "180px",
      height: "120px",
    });
    expect(toInlineStyleCommands([change], "next").map(({ property }) => property)).toEqual([
      "box-sizing",
      "aspect-ratio",
      "min-width",
      "min-height",
      "max-width",
      "max-height",
      "width",
      "height",
    ]);
  });

  it("makes an inline text node a wrapping box without forcing height on a horizontal resize", () => {
    const text = snapshot(
      "span",
      { x: 300, y: 420, width: 488, height: 38 },
      { display: "inline", "box-sizing": "content-box" },
      { display: "block", "white-space": "normal" },
    );

    const change = buildResizeChanges(
      [text],
      text.target.bounds,
      "e",
      { x: -110, y: 0 },
    )[0];

    expect(change.next).toMatchObject({
      display: "inline-block",
      "box-sizing": "border-box",
      "white-space": "normal",
      width: "378px",
    });
    expect(change.next.height).toBeUndefined();
    expect(toInlineStyleCommands([change], "previous")).toEqual([
      { command: "set-inline-style", targetId: "id:span", property: "display", value: "inline" },
      { command: "set-inline-style", targetId: "id:span", property: "box-sizing", value: "content-box" },
      { command: "set-inline-style", targetId: "id:span", property: "white-space", value: null },
      { command: "set-inline-style", targetId: "id:span", property: "width", value: null },
    ]);
  });

  it("does not rewrite dimensions while moving a node", () => {
    const heading = snapshot("h1", { x: 10, y: 20, width: 100, height: 30 }, { width: "100px" });
    const change = buildMoveChanges([heading], { x: 24, y: 8 })[0];

    expect(change.next).toEqual({ transform: "translate(24px, 8px)" });
    expect(toInlineStyleCommands([change], "next")).toEqual([
      { command: "set-inline-style", targetId: "id:h1", property: "transform", value: "translate(24px, 8px)" },
    ]);
  });

  it("parses canonical and authored transform chains", () => {
    expect(parseTransform(null)).toEqual({ tx: 0, ty: 0, rotation: 0 });
    expect(parseTransform("none")).toEqual({ tx: 0, ty: 0, rotation: 0 });
    expect(parseTransform("rotate(30deg)")).toEqual({ tx: 0, ty: 0, rotation: 30 });
    expect(parseTransform("translate(24px, 8px)")).toEqual({ tx: 24, ty: 8, rotation: 0 });
    expect(parseTransform("translate(5px, 0px) rotate(30deg)")).toEqual({ tx: 5, ty: 0, rotation: 30 });
    expect(parseTransform("translate(10px 20px) rotate(15deg) rotate(15deg)")).toEqual({ tx: 10, ty: 20, rotation: 30 });
    expect(parseTransform("scale(2)")).toBeNull();
  });

  it("keeps world-axis translation on a rotated node and reports the total rotation", () => {
    const rotated = snapshot(
      "h1",
      { x: 10, y: 20, width: 100, height: 30 },
      { transform: "rotate(30deg)" },
    );
    const change = buildMoveChanges([rotated], { x: 24, y: 8 })[0];

    expect(change.next).toEqual({ transform: "translate(24px, 8px) rotate(30deg)" });
    expect(change.rotation).toBe(30);
  });

  it("accumulates an existing translation when moving a previously moved node", () => {
    const moved = snapshot(
      "h1",
      { x: 10, y: 20, width: 100, height: 30 },
      { transform: "translate(5px, 0px) rotate(30deg)" },
    );
    const change = buildMoveChanges([moved], { x: 24, y: 8 })[0];

    expect(change.next).toEqual({ transform: "translate(29px, 8px) rotate(30deg)" });
  });

  it("appends a rotation delta to an existing rotation without rewriting translation", () => {
    const rotated = snapshot(
      "h1",
      { x: 10, y: 20, width: 100, height: 30 },
      { transform: "translate(5px, 0px) rotate(20deg)" },
    );
    const change = buildRotationChanges([rotated], 10)[0];

    expect(change.next).toEqual({ transform: "translate(5px, 0px) rotate(30deg)" });
    expect(change.rotation).toBe(30);
  });

  it("resizes a rotated element along its own rotated axes", () => {
    const rotated = snapshot(
      "div",
      { x: 10, y: 20, width: 100, height: 50 },
      { transform: "rotate(30deg)" },
    );
    const change = buildResizeChanges(
      [rotated],
      rotated.target.bounds,
      "e",
      { x: 100, y: 0 },
    )[0];

    expect(change.next.transform).toBeUndefined();
    expect(Number.parseFloat(change.next.width!)).toBeCloseTo(186.6, 1);
    expect(change.next.height).toBeUndefined();
    expect(change.rotation).toBe(30);
  });

  it("rotates a multi-node selection rigidly around the group center", () => {
    const left = snapshot("div", { x: 0, y: 0, width: 100, height: 50 });
    const right = snapshot("div", { x: 200, y: 0, width: 100, height: 50 });

    const changes = buildRotationChanges([left, right], 90);

    expect(changes[0].next).toMatchObject({
      transform: "translate(100px, -100px) rotate(90deg)",
    });
    expect(changes[1].next).toMatchObject({
      transform: "translate(-100px, 100px) rotate(90deg)",
    });
    expect(changes[0].rotation).toBe(90);
    expect(changes[1].rotation).toBe(90);
  });

  it("falls back to appending deltas when a transform cannot be parsed", () => {
    const scaled = snapshot(
      "div",
      { x: 10, y: 20, width: 100, height: 30 },
      { transform: "scale(2)" },
    );
    const change = buildMoveChanges([scaled], { x: 24, y: 8 })[0];

    expect(change.next).toEqual({ transform: "scale(2) translate(24px, 8px)" });
  });
});
