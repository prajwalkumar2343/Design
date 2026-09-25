import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyCanvasState } from "./EmptyCanvasState";

describe("EmptyCanvasState", () => {
  it("renders the briefing pitch and the agent connection panel", () => {
    render(<EmptyCanvasState onStartBrainstorming={vi.fn()} />);

    const section = screen.getByTestId("empty-canvas-state");
    expect(section.tagName).toBe("SECTION");
    expect(section.getAttribute("data-canvas-control")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Start with the project.");
    expect(section.textContent).toContain("A clear place to begin");
    expect(screen.getByTestId("agent-connection-panel")).toBeTruthy();
  });

  it("invokes onStartBrainstorming once per click", () => {
    const onStartBrainstorming = vi.fn();
    render(<EmptyCanvasState onStartBrainstorming={onStartBrainstorming} />);

    const button = screen.getByTestId("start-brainstorming") as HTMLButtonElement;
    expect(button.type).toBe("button");
    expect(button.textContent).toBe("Start brainstorming");

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onStartBrainstorming).toHaveBeenCalledTimes(2);
  });
});
