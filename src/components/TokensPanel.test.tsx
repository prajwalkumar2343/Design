import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSeedTokenStore } from "../tokens";
import { TokensPanel, type TokensPanelProps } from "./TokensPanel";

function createHarness() {
  const handlers = {
    onUpsertSet: vi.fn(),
    onRemoveSet: vi.fn(),
    onUpsertToken: vi.fn(),
    onRemoveToken: vi.fn(),
    onUpsertTheme: vi.fn(),
    onRemoveTheme: vi.fn(),
    onSwitchTheme: vi.fn(),
    onExportDTCG: vi.fn(),
    onExportCss: vi.fn(),
  };
  const props: TokensPanelProps = { tokens: createSeedTokenStore(), ...handlers };
  return { props, handlers };
}

function createProps(): TokensPanelProps {
  return createHarness().props;
}

describe("TokensPanel", () => {
  it("lists themes with the active one marked", () => {
    render(<TokensPanel {...createProps()} />);
    expect(screen.getByTestId("theme-switch-light")).toHaveProperty("ariaPressed", "true");
    expect(screen.getByTestId("theme-switch-dark")).toHaveProperty("ariaPressed", "false");
  });

  it("switches themes through the callback", () => {
    const { props, handlers } = createHarness();
    render(<TokensPanel {...props} />);
    fireEvent.click(screen.getByTestId("theme-switch-dark"));
    expect(handlers.onSwitchTheme).toHaveBeenCalledWith("dark");
  });

  it("creates a token in the selected set", () => {
    const { props, handlers } = createHarness();
    render(<TokensPanel {...props} />);
    fireEvent.change(screen.getByTestId("token-set-select"), { target: { value: "light" } });
    fireEvent.change(screen.getByTestId("token-name-input"), { target: { value: "color.test.fresh" } });
    fireEvent.change(screen.getByTestId("token-type-select"), { target: { value: "color" } });
    fireEvent.change(screen.getByTestId("token-value-value"), { target: { value: "#222222" } });
    fireEvent.click(screen.getByTestId("token-create-button"));
    expect(handlers.onUpsertToken).toHaveBeenCalledWith(
      "light",
      expect.objectContaining({ name: "color.test.fresh", type: "color", value: "#222222" }),
    );
  });

  it("shows a validation error instead of committing bad values", () => {
    const { props, handlers } = createHarness();
    render(<TokensPanel {...props} />);
    fireEvent.click(screen.getByTestId("token-creator-toggle"));
    fireEvent.change(screen.getByTestId("token-name-input"), { target: { value: "color.test.bad" } });
    fireEvent.change(screen.getByTestId("token-value-value"), { target: { value: "nope!!" } });
    fireEvent.click(screen.getByTestId("token-create-button"));
    expect(handlers.onUpsertToken).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("rejects markup in values with an inline error", () => {
    const { props, handlers } = createHarness();
    render(<TokensPanel {...props} />);
    fireEvent.click(screen.getByTestId("token-creator-toggle"));
    fireEvent.change(screen.getByTestId("token-name-input"), { target: { value: "shadow.evil" } });
    fireEvent.change(screen.getByTestId("token-type-select"), { target: { value: "shadow" } });
    fireEvent.change(screen.getByTestId("token-value-value"), { target: { value: "0 4px 12px rgba(0,0,0,0.12)</style>" } });
    fireEvent.click(screen.getByTestId("token-create-button"));
    expect(handlers.onUpsertToken).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("must not contain < or >");
  });

  it("creates sets and themes", () => {
    const { props, handlers } = createHarness();
    render(<TokensPanel {...props} />);
    fireEvent.change(screen.getByTestId("set-name-input"), { target: { value: "Marketing" } });
    fireEvent.click(screen.getByTestId("set-create-button"));
    expect(handlers.onUpsertSet).toHaveBeenCalledWith(expect.objectContaining({ name: "Marketing" }));
    fireEvent.change(screen.getByTestId("theme-name-input"), { target: { value: "Campaign" } });
    fireEvent.click(screen.getByTestId("theme-set-core"));
    fireEvent.click(screen.getByTestId("theme-create-button"));
    expect(handlers.onUpsertTheme).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Campaign", setIds: ["core"] }),
    );
  });

  it("exports through the callbacks", () => {
    const { props, handlers } = createHarness();
    render(<TokensPanel {...props} />);
    fireEvent.click(screen.getByTestId("tokens-export-dtcg"));
    fireEvent.click(screen.getByTestId("tokens-export-css"));
    expect(handlers.onExportDTCG).toHaveBeenCalledTimes(1);
    expect(handlers.onExportCss).toHaveBeenCalledTimes(1);
  });

  it("filters variables through search", () => {
    render(<TokensPanel {...createProps()} />);
    fireEvent.change(screen.getByTestId("tkn-search"), { target: { value: "on-accent" } });
    expect(screen.queryByTestId("token-row-brand-accent-on")).toBeTruthy();
    expect(screen.queryByTestId("token-row-brand-accent-primary")).toBeNull();
    expect(screen.queryByTestId("token-row-brand-radius-md")).toBeNull();
  });

  it("filters variables by type", () => {
    render(<TokensPanel {...createProps()} />);
    fireEvent.click(screen.getByTestId("tkn-filter-radius"));
    expect(screen.queryByTestId("token-row-brand-radius-md")).toBeTruthy();
    expect(screen.queryByTestId("token-row-brand-accent-primary")).toBeNull();
  });

  it("collapses variable groups", () => {
    render(<TokensPanel {...createProps()} />);
    expect(screen.queryByTestId("token-row-brand-accent-primary")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tkn-group-color"));
    expect(screen.queryByTestId("token-row-brand-accent-primary")).toBeNull();
    expect(screen.queryByTestId("token-row-brand-radius-md")).toBeTruthy();
  });

  it("shows per-mode values for variables", () => {
    render(<TokensPanel {...createProps()} />);
    expect(screen.getAllByText("Dark").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("token-row-brand-accent-primary")).toBeTruthy();
  });

  it("expands the creators on demand", () => {
    render(<TokensPanel {...createProps()} />);
    expect(screen.getByTestId("token-name-input").closest("div[hidden]")).toBeTruthy();
    fireEvent.click(screen.getByTestId("token-creator-toggle"));
    expect(screen.getByTestId("token-name-input").closest("div[hidden]")).toBeNull();
    expect(screen.getByTestId("theme-name-input").closest("div[hidden]")).toBeTruthy();
    fireEvent.click(screen.getByTestId("theme-creator-toggle"));
    expect(screen.getByTestId("theme-name-input").closest("div[hidden]")).toBeNull();
  });
});
