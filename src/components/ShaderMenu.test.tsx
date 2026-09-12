import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShaderMenu } from "./ShaderMenu";

function renderMenu(overrides: Partial<Parameters<typeof ShaderMenu>[0]> = {}) {
  const props = { onAddShader: vi.fn(), onClose: vi.fn(), ...overrides };
  return { props, ...render(<ShaderMenu {...props} />) };
}

describe("ShaderMenu gallery", () => {
  it("renders cards for every registered shader with zero live GL mounts at rest", () => {
    const { container } = renderMenu();
    // Every card exists…
    expect(container.querySelectorAll(".shader-card").length).toBeGreaterThan(20);
    // …but none of them mount a live preview — the menu must not spend the
    // browser's WebGL context budget just by opening.
    expect(container.querySelectorAll(".shader-preview-mount")).toHaveLength(0);
    expect(container.querySelectorAll(".shader-preview-loading")).toHaveLength(0);
    expect(container.querySelectorAll(".shader-card-thumb").length).toBe(
      container.querySelectorAll(".shader-card").length,
    );
  });

  it("mounts a live preview only for the hovered card and releases it on leave", async () => {
    const { container } = renderMenu();
    const card = screen.getByTestId("shader-card-ferro-tide");
    fireEvent.pointerEnter(card);
    expect(container.querySelectorAll(".shader-preview-loading, .shader-preview-mount, .shader-preview-fallback").length).toBeGreaterThan(0);
    await waitFor(() =>
      // jsdom lacks WebGL2 — the preview resolves to the contained fallback.
      expect(container.querySelectorAll(".shader-preview-fallback").length +
        container.querySelectorAll(".shader-preview-mount").length).toBeGreaterThan(0),
    );
    fireEvent.pointerLeave(card);
    await waitFor(() =>
      expect(container.querySelectorAll(".shader-preview-loading, .shader-preview-mount")).toHaveLength(0),
    );
  });

  it("keeps at most one live preview while moving across cards", async () => {
    const { container } = renderMenu();
    fireEvent.pointerEnter(screen.getByTestId("shader-card-ferro-tide"));
    fireEvent.pointerEnter(screen.getByTestId("shader-card-warp"));
    const liveNodes = container.querySelectorAll(".shader-preview-loading, .shader-preview-mount, .shader-preview-fallback");
    expect(liveNodes.length).toBeLessThanOrEqual(2);
  });
});

describe("ShaderMenu filtering", () => {
  it("narrows the gallery by name with a case-insensitive query", () => {
    renderMenu();
    const input = screen.getByTestId("shader-search-input");
    fireEvent.change(input, { target: { value: "FERRO" } });
    expect(screen.getByTestId("shader-card-ferro-tide")).toBeTruthy();
    expect(screen.queryByTestId("shader-card-warp")).toBeNull();
  });

  it("shows an honest empty state when nothing matches", () => {
    renderMenu();
    fireEvent.change(screen.getByTestId("shader-search-input"), { target: { value: "zzz-no-such-shader" } });
    expect(screen.getByTestId("shader-menu-empty")).toBeTruthy();
  });

  it("restricts the gallery to the selected category chip", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("shader-filter-custom"));
    expect(screen.getByTestId("shader-card-ferro-tide")).toBeTruthy();
    expect(screen.queryByTestId("shader-card-mesh-gradient")).toBeNull();
    fireEvent.click(screen.getByTestId("shader-filter-all"));
    expect(screen.getByTestId("shader-card-mesh-gradient")).toBeTruthy();
  });
});

describe("ShaderMenu actions", () => {
  it("adds the clicked shader and closes on Escape from search", () => {
    const { props } = renderMenu();
    fireEvent.click(screen.getByTestId("shader-card-mesh-gradient"));
    expect(props.onAddShader).toHaveBeenCalledWith("mesh-gradient");
    fireEvent.keyDown(screen.getByTestId("shader-search-input"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });
});
