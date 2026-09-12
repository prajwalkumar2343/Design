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

  it("renders each token type without throwing", () => {
    const cases: DesignToken[] = [
      token({ type: "color", value: "#fff" }),
      token({ type: "radius", value: "8px" }),
      token({ type: "shadow", value: "0 1px 2px #000" }),
      token({ type: "opacity", value: 0.4 }),
      token({ type: "typography", value: { fontFamily: "Inter", fontSize: "16px" } }),
      token({ type: "motion", value: { duration: "1s", easing: "linear" } }),
    ];
    for (const t of cases) {
      const { container, unmount } = render(<TokenPreview token={t} size="sm" />);
      expect(container.querySelector(".tkn-preview")).toBeTruthy();
      unmount();
    }
  });
});
