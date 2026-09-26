import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasFrame } from "../canvas/types";
import { FrameView } from "./FrameView";

const SRC_DOC =
  "<!doctype html><html><head><title>H</title></head><body><main>Hi</main></body></html>";

function makeFrame(overrides: Partial<CanvasFrame> = {}): CanvasFrame {
  return {
    id: "f1",
    name: "Hero",
    documentId: "doc-1",
    x: 40,
    y: 24,
    width: 1440,
    height: 900,
    srcDoc: SRC_DOC,
    background: "#ffffff",
    category: "desktop",
    ...overrides,
  };
}

function renderFrame(overrides: Partial<ComponentProps<typeof FrameView>> = {}) {
  const props: ComponentProps<typeof FrameView> = {
    frame: makeFrame(),
    isLive: false,
    isSelected: false,
    isPanTool: false,
    onSelect: vi.fn(),
    onStartMove: vi.fn(),
    onStartPan: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<FrameView {...props} />) };
}

describe("FrameView", () => {
  beforeEach(() => {
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => undefined;
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => undefined;
    }
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false;
    }
  });

  it("renders a paused frame as a sized placeholder with idle bridge state", () => {
    const { container } = renderFrame({ frame: makeFrame({ freeform: true }) });
    const section = container.querySelector("section.canvas-frame")!;
    expect(section.getAttribute("data-frame-id")).toBe("f1");
    expect(section.getAttribute("data-bridge-status")).toBe("idle");
    expect(section.getAttribute("data-selected")).toBe("false");
    expect(section.getAttribute("data-freeform")).toBe("true");
    expect((section as HTMLElement).style.transform).toBe("translate3d(40px, 24px, 0)");
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByLabelText("Hero is paused").textContent).toBe("1440 × 900");
  });

  it("mounts a live iframe with the bridge runtime injected and exposes a controller", () => {
    const onBridgeController = vi.fn();
    const { container } = renderFrame({ isLive: true, onBridgeController });
    const iframe = container.querySelector("iframe")!;
    const srcdoc = iframe.getAttribute("srcdoc")!;
    expect(srcdoc).toContain('data-design-tool-iframe-bridge="1"');
    expect(srcdoc).toContain("<main>Hi</main>");
    expect(srcdoc).toContain("frame-f1-");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(container.querySelector("section.canvas-frame")!.getAttribute("data-bridge-status")).toBe("waiting");
    expect(onBridgeController).toHaveBeenCalledWith(
      "f1",
      expect.objectContaining({
        requestSnapshot: expect.any(Function),
        inspect: expect.any(Function),
        setInlineStyle: expect.any(Function),
        setTokenTheme: expect.any(Function),
      }),
    );
  });

  it("tears the controller down and reports detach on unmount", async () => {
    const onBridgeController = vi.fn();
    const onBridgeDetach = vi.fn();
    const { unmount } = renderFrame({ isLive: true, onBridgeController, onBridgeDetach });
    unmount();
    expect(onBridgeController).toHaveBeenLastCalledWith("f1", null);
    await waitFor(() => expect(onBridgeDetach).toHaveBeenCalledWith("f1"));
  });

  it("reports a null controller and detach for a paused frame", () => {
    const onBridgeController = vi.fn();
    const onBridgeDetach = vi.fn();
    renderFrame({ onBridgeController, onBridgeDetach });
    expect(onBridgeController).toHaveBeenCalledWith("f1", null);
    expect(onBridgeDetach).toHaveBeenCalledWith("f1");
  });

  it("injects the wireframe theme instead of token css for wireframe frames", () => {
    const { container } = renderFrame({
      isLive: true,
      frame: makeFrame({ mode: "wireframe" }),
      tokenCss: ":root{--accent:#f00}",
    });
    const srcdoc = container.querySelector("iframe")!.getAttribute("srcdoc")!;
    expect(srcdoc).toContain("data-design-tool-wireframe-theme");
    expect(srcdoc).not.toContain("--accent:#f00");
  });

  it("bakes token css into the srcdoc for design frames", () => {
    const { container } = renderFrame({
      isLive: true,
      tokenCss: ":root{--accent:#123456}",
    });
    const srcdoc = container.querySelector("iframe")!.getAttribute("srcdoc")!;
    expect(srcdoc).toContain("data-design-tool-token-theme");
    expect(srcdoc).toContain("--accent:#123456");
  });

  it("selects and starts moves from the frame label", () => {
    const { props } = renderFrame();
    const label = screen.getByRole("button", { name: "Move Hero" });
    fireEvent.pointerDown(label);
    expect(props.onStartMove).toHaveBeenCalledWith("f1", expect.anything());
    fireEvent.click(label);
    expect(props.onSelect).toHaveBeenCalledWith("f1");
  });

  it("shows an activation layer on unselected frames and hides it once selected", () => {
    const { props, unmount } = renderFrame();
    const activation = screen.getByRole("button", { name: "Select Hero" });
    fireEvent.click(activation);
    expect(props.onSelect).toHaveBeenCalledWith("f1");
    unmount();

    renderFrame({ isSelected: true });
    expect(screen.queryByRole("button", { name: "Select Hero" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pan across Hero" })).toBeNull();
  });

  it("starts a move from the drag ring on selected frames only", () => {
    const { props, container, unmount } = renderFrame({ isSelected: true });
    const ring = container.querySelector(".frame-drag-ring")!;
    fireEvent.pointerDown(ring);
    expect(props.onStartMove).toHaveBeenCalledWith("f1", expect.anything());
    unmount();

    const { container: unselected } = renderFrame();
    expect(unselected.querySelector(".frame-drag-ring")).toBeNull();
  });

  it("routes the activation layer to the pan handler under the pan tool", () => {
    const { props } = renderFrame({ isPanTool: true, isSelected: true });
    const activation = screen.getByRole("button", { name: "Pan across Hero" });
    fireEvent.pointerDown(activation);
    expect(props.onStartPan).toHaveBeenCalledTimes(1);
    fireEvent.click(activation);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("opens a full-site blob preview for desktop frames only", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const createObjectURL = vi.fn((_blob: Blob) => "blob:preview-1");
    (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURL;

    renderFrame();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Hero as a full website in a new tab" }),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/html");
    expect(await blob.text()).toContain("<main>Hi</main>");
    expect(open).toHaveBeenCalledWith("blob:preview-1", "_blank", "noopener");
    open.mockRestore();
  });

  it("renders notch chrome and a home indicator on mobile device frames", () => {
    const { container } = renderFrame({
      frame: makeFrame({
        category: "mobile",
        width: 375,
        height: 812,
        chrome: { type: "notch", width: 148, height: 28, bezelRadius: 44 },
      }),
    });
    const section = container.querySelector("section.canvas-frame")!;
    expect(section.getAttribute("data-chrome")).toBe("notch");
    expect(section.getAttribute("data-category")).toBe("mobile");
    const notch = container.querySelector<HTMLElement>(".device-notch")!;
    expect(notch.style.width).toBe("133px");
    expect(notch.style.height).toBe("25px");
    expect(container.querySelector(".device-notch-speaker")).not.toBeNull();
    expect(container.querySelector(".device-notch-camera")).not.toBeNull();
    expect(container.querySelector(".device-home-indicator")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /full website/ })).toBeNull();
  });

  it("positions a left punch-hole cutout without viewport scaling", () => {
    const { container } = renderFrame({
      frame: makeFrame({
        category: "mobile",
        width: 390,
        height: 844,
        chrome: { type: "punch-hole", width: 18, punchPosition: "left", bezelRadius: 48 },
      }),
    });
    const hole = container.querySelector<HTMLElement>(".device-punch-hole")!;
    expect(hole.style.left).toBe("24%");
    expect(hole.style.width).toBe("18px");
    expect(container.querySelector(".device-punch-lens")).not.toBeNull();
  });

  it("shows the creation layer only while live and not panning, and maps pointer coords into frame space", () => {
    const onCreationPointerDown = vi.fn();
    const onCreationPointerMove = vi.fn();
    const onCreationPointerUp = vi.fn();
    const { container, unmount } = renderFrame({
      isLive: true,
      isCreationMode: true,
      creationShape: "rectangle",
      onCreationPointerDown,
      onCreationPointerMove,
      onCreationPointerUp,
    });
    const layer = screen.getByTestId("frame-creation-layer");
    expect(screen.queryByRole("button", { name: "Select Hero" })).toBeNull();

    const iframe = container.querySelector("iframe")!;
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 820,
      bottom: 500,
      width: 720,
      height: 450,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(layer, { button: 0, isPrimary: true, pointerId: 3, clientX: 160, clientY: 95 });
    expect(onCreationPointerDown).toHaveBeenCalledWith("f1", { x: 120, y: 90 }, 3);
    expect(screen.getByTestId("shape-preview")).not.toBeNull();

    fireEvent.pointerMove(layer, { isPrimary: true, pointerId: 3, clientX: 170, clientY: 105 });
    expect(onCreationPointerMove).toHaveBeenCalledWith("f1", { x: 140, y: 110 }, 3);

    fireEvent.pointerUp(layer, { isPrimary: true, pointerId: 3, clientX: 170, clientY: 105 });
    expect(onCreationPointerUp).toHaveBeenCalledWith("f1", { x: 140, y: 110 }, 3);
    expect(screen.queryByTestId("shape-preview")).toBeNull();
    unmount();

    renderFrame({ isLive: true, isCreationMode: true, isPanTool: true });
    expect(screen.queryByTestId("frame-creation-layer")).toBeNull();
  });

  it("ignores secondary-button and non-primary presses on the creation layer", () => {
    const onCreationPointerDown = vi.fn();
    renderFrame({
      isLive: true,
      isCreationMode: true,
      onCreationPointerDown,
    });
    const layer = screen.getByTestId("frame-creation-layer");
    fireEvent.pointerDown(layer, { button: 2, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerDown(layer, { button: 0, isPrimary: false, pointerId: 9, clientX: 0, clientY: 0 });
    expect(onCreationPointerDown).not.toHaveBeenCalled();
  });
});
