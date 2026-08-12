import { describe, expect, it } from "vitest";
import type { OverlayNodeTarget } from "./NodeOverlayLayer";
import {
  buildMoveChanges,
  buildResizeChanges,
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
});
