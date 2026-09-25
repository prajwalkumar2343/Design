import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { summarizeTokenValue, TokenPreview } from "./token-preview";
import type { DesignToken } from "../tokens";

function token(overrides: Partial<DesignToken>): DesignToken {
  return { id: "t-1", name: "color.ink", type: "color", value: "#000000", ...overrides };
}

describe("summarizeTokenValue", () => {
  it("summarizes scalar and composite values", () => {
    expect(summarizeTokenValue(token({ value: "#123456" }))).toBe("#123456");
    expect(summarizeTokenValue(token({ type: "opacity", value: 0.5 }))).toBe("0.5");
    expect(
      summarizeTokenValue(token({
        type: "typography",
        value: { fontFamily: "Inter", fontSize: "16px" },
      })),
    ).toBe("16px Inter");
    expect(
      summarizeTokenValue(token({
        type: "motion",
        value: { duration: "200ms", easing: "ease-out" },
      })),
    ).toBe("200ms ease-out");
  });

  it("summarizes the resolved value for aliases instead of the {path}", () => {
    expect(
      summarizeTokenValue(token({ value: "{color.base}" }), "#ff0000"),
    ).toBe("#ff0000");
  });
});

describe("TokenPreview", () => {
  it("renders a color swatch filled with the resolved value", () => {
    const { container } = render(
      <TokenPreview token={token({ value: "{color.base}" })} resolvedValue="#00ff00" />,
    );
    const fill = container.querySelector(".tkn-color-fill") as HTMLElement;
    expect(fill.style.backgroundColor).toBe("rgb(0, 255, 0)");
  });

  it("scales the spacing bar between 4 and 44 px", () => {
    const { container, unmount } = render(
      <TokenPreview token={token({ type: "spacing", value: "200px" })} />,
    );
    expect((container.querySelector(".tkn-spacing-bar") as HTMLElement).style.width).toBe("44px");
    unmount();
    const small = render(<TokenPreview token={token({ type: "spacing", value: "2px" })} />);
    expect((small.container.querySelector(".tkn-spacing-bar") as HTMLElement).style.width).toBe("4px");
  });

  it("falls back to a fixed bar for non-px spacing values", () => {
    const { container } = render(
      <TokenPreview token={token({ type: "spacing", value: "2rem" })} />,
    );
    expect((container.querySelector(".tkn-spacing-bar") as HTMLElement).style.width).toBe("28px");
  });

  it("renders a distinct glyph structure per token type", () => {
    const cases: Array<{ token: DesignToken; selector: string }> = [
      { token: token({ type: "color", value: "#fff" }), selector: ".tkn-color-fill" },
      { token: token({ type: "radius", value: "8px" }), selector: ".tkn-radius-box" },
      { token: token({ type: "shadow", value: "0 1px 2px #000" }), selector: ".tkn-shadow-box" },
      { token: token({ type: "opacity", value: 0.4 }), selector: ".tkn-opacity-fill" },
      { token: token({ type: "typography", value: { fontFamily: "Inter", fontSize: "16px" } }), selector: ".tkn-preview-type" },
      { token: token({ type: "motion", value: { duration: "1s", easing: "linear" } }), selector: ".tkn-motion-dot" },
    ];
    for (const { token: t, selector } of cases) {
      const { container, unmount } = render(<TokenPreview token={t} size="sm" />);
      expect(container.querySelector(selector)).toBeTruthy();
      expect(container.querySelector(".tkn-preview-sm")).toBeTruthy();
      unmount();
    }
  });

  it("applies the token's own value to radius, shadow, opacity and typography previews", () => {
    const { container, unmount } = render(
      <TokenPreview token={token({ type: "radius", value: "8px" })} />,
    );
    expect((container.querySelector(".tkn-radius-box") as HTMLElement).style.borderRadius).toBe("8px");
    unmount();

    const shadowed = render(<TokenPreview token={token({ type: "shadow", value: "0 1px 2px #000" })} />);
    expect((shadowed.container.querySelector(".tkn-shadow-box") as HTMLElement).style.boxShadow).toBe("0 1px 2px #000");
    shadowed.unmount();

    const dim = render(<TokenPreview token={token({ type: "opacity", value: 0.4 })} />);
    expect((dim.container.querySelector(".tkn-opacity-fill") as HTMLElement).style.opacity).toBe("0.4");
    dim.unmount();

    const type = render(
      <TokenPreview token={token({ type: "typography", value: { fontFamily: "Inter", fontSize: "16px", fontWeight: "700" } })} />,
    );
    const glyph = type.container.querySelector(".tkn-preview-type") as HTMLElement;
    expect(glyph.style.fontFamily).toBe("Inter");
    expect(glyph.style.fontWeight).toBe("700");
  });

  it("falls back to the generic glyph for values the type cannot paint", () => {
    const { container } = render(
      <TokenPreview token={token({ type: "color", value: 42 as unknown as string })} />,
    );
    expect(container.querySelector(".tkn-preview-fallback")).toBeTruthy();
    expect(container.querySelector(".tkn-fallback-glyph")?.textContent).toBe("T");
  });
});
