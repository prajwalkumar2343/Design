import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorField, COLOR_SWATCHES, SwatchGrid } from "./ColorField";

function renderField(overrides: Partial<Parameters<typeof ColorField>[0]> = {}) {
  const props: Parameters<typeof ColorField>[0] = {
    label: "Fill",
    value: "#e5484d",
    onCommit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ColorField {...props} />) };
}

describe("SwatchGrid", () => {
  it("renders every swatch with its color as the accessible name", () => {
    const onPick = vi.fn();
    const { container } = render(<SwatchGrid value={null} onPick={onPick} />);
    const swatches = container.querySelectorAll(".color-swatch");
    expect(swatches).toHaveLength(COLOR_SWATCHES.length);
    expect(screen.getByLabelText("transparent")).toBeTruthy();
    fireEvent.click(screen.getByTestId("color-option-#6cbf5d"));
    expect(onPick).toHaveBeenCalledWith("#6cbf5d");
  });

  it("marks the swatch matching the current value, including rgb() input", () => {
    render(<SwatchGrid value="rgb(229, 72, 77)" onPick={vi.fn()} />);
    expect((screen.getByTestId("color-option-#e5484d") as HTMLElement).className).toContain("is-active");
    expect((screen.getByTestId("color-option-#6cbf5d") as HTMLElement).className).not.toContain("is-active");
  });

  it("marks the transparent swatch only for a transparent value", () => {
    const { unmount } = render(<SwatchGrid value="transparent" onPick={vi.fn()} />);
    expect((screen.getByTestId("color-option-transparent") as HTMLElement).className).toContain("is-active");
    unmount();
    render(<SwatchGrid value="#e5484d" onPick={vi.fn()} />);
    expect((screen.getByTestId("color-option-transparent") as HTMLElement).className).not.toContain("is-active");
  });

  it("leads with a glass pseudo-swatch only when onPickGlass is provided", () => {
    const onPickGlass = vi.fn();
    const { container, unmount } = render(
      <SwatchGrid value={null} onPick={vi.fn()} onPickGlass={onPickGlass} glassActive />,
    );
    const glass = screen.getByTestId("color-option-glass");
    expect(glass.className).toContain("is-active");
    fireEvent.click(glass);
    expect(onPickGlass).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".color-swatch")).toHaveLength(COLOR_SWATCHES.length + 1);
    unmount();
    render(<SwatchGrid value={null} onPick={vi.fn()} />);
    expect(screen.queryByTestId("color-option-glass")).toBeNull();
  });
});

describe("ColorField", () => {
  it("paints the swatch button with the value and seeds the input", () => {
    renderField();
    const swatch = screen.getByTestId("color-swatch-Fill") as HTMLButtonElement;
    expect(swatch.style.background).toBe("rgb(229, 72, 77)");
    expect(swatch.getAttribute("aria-expanded")).toBe("false");
    expect((screen.getByLabelText("Fill") as HTMLInputElement).value).toBe("#e5484d");
  });

  it("shows a Mixed placeholder and empty draft for mixed values", () => {
    renderField({ value: "mixed" });
    const input = screen.getByLabelText("Fill") as HTMLInputElement;
    expect(input.placeholder).toBe("Mixed");
    expect(input.value).toBe("");
    expect((screen.getByTestId("color-swatch-Fill") as HTMLElement).style.background).toBe("transparent");
  });

  it("opens the palette and commits a swatch pick in one gesture", () => {
    const { props } = renderField();
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    expect(screen.getByTestId("color-popover-Fill")).toBeTruthy();
    expect((screen.getByTestId("color-swatch-Fill") as HTMLElement).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByTestId("color-option-#3b74c2"));
    expect(props.onCommit).toHaveBeenCalledWith("#3b74c2");
    expect(screen.queryByTestId("color-popover-Fill")).toBeNull();
  });

  it("closes the palette on a pointerdown outside the field", () => {
    renderField();
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    expect(screen.getByTestId("color-popover-Fill")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("color-popover-Fill")).toBeNull();
  });

  it("commits a typed value on blur, but not an unchanged or empty draft", () => {
    const { props } = renderField();
    const input = screen.getByLabelText("Fill");

    fireEvent.change(input, { target: { value: "#123456" } });
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(props.onCommit).toHaveBeenCalledWith("#123456");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input, { relatedTarget: document.body });
    fireEvent.change(input, { target: { value: "#e5484d" } });
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(props.onCommit).toHaveBeenCalledTimes(1);
  });

  it("commits on Enter by blurring the input", () => {
    const { props } = renderField();
    const input = screen.getByLabelText("Fill") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "#0e7a5a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onCommit).toHaveBeenCalledWith("#0e7a5a");
    expect(document.activeElement).not.toBe(input);
  });

  it("does not commit when focus moves to another control inside the field", () => {
    const { props } = renderField({ onPickGlass: vi.fn() });
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    const input = screen.getByLabelText("Fill");
    fireEvent.change(input, { target: { value: "#abcdef" } });
    fireEvent.blur(input, { relatedTarget: screen.getByTestId("color-option-#bcd9f5") });
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("routes the glass swatch to onPickGlass instead of onCommit", () => {
    const onPickGlass = vi.fn();
    const { props } = renderField({ onPickGlass });
    fireEvent.click(screen.getByTestId("color-swatch-Fill"));
    fireEvent.click(screen.getByTestId("color-option-glass"));
    expect(onPickGlass).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("color-popover-Fill")).toBeNull();
  });
});
