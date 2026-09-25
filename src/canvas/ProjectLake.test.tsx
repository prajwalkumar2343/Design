import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_KINDS, type LocalProjectSummary } from "../persistence/local-projects";
import { ProjectLake } from "./ProjectLake";

function summary(overrides: Partial<LocalProjectSummary> = {}): LocalProjectSummary {
  return {
    id: "proj-1",
    name: "Field notes",
    kind: "landing",
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    frameCount: 2,
    lifecycle: "briefing",
    ...overrides,
  };
}

function renderLake(overrides: Partial<Parameters<typeof ProjectLake>[0]> = {}) {
  const props: Parameters<typeof ProjectLake>[0] = {
    projects: [],
    activeProjectId: null,
    onOpen: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ProjectLake {...props} />) };
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch {}
});

describe("ProjectLake bundled templates", () => {
  it("lists every bundled kind except the internal mobile-blank variant", () => {
    renderLake();
    const expected = PROJECT_KINDS.filter((kind) => kind.id !== "mobile-blank");
    for (const kind of expected) {
      expect(screen.getByTestId(`create-kind-${kind.id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("create-kind-mobile-blank")).toBeNull();
    expect(screen.getByTestId("project-lake").textContent).toContain(`${expected.length} notes`);
  });

  it("creates a non-blank kind directly from its card", () => {
    const { props } = renderLake();
    fireEvent.click(screen.getByTestId("create-kind-dashboard"));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate).toHaveBeenCalledWith("dashboard");
    expect(screen.queryByTestId("blank-chooser")).toBeNull();
  });

  it("routes the blank card through the canvas chooser", () => {
    const { props } = renderLake();
    fireEvent.click(screen.getByTestId("create-kind-blank"));
    expect(screen.getByTestId("blank-chooser")).toBeTruthy();
    expect(props.onCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("blank-choose-website"));
    expect(props.onCreate).toHaveBeenCalledWith("blank");
    expect(screen.queryByTestId("blank-chooser")).toBeNull();
  });

  it("maps the mobile canvas option to the mobile-blank kind", () => {
    const { props } = renderLake();
    fireEvent.click(screen.getByTestId("create-kind-blank"));
    fireEvent.click(screen.getByTestId("blank-choose-mobile"));
    expect(props.onCreate).toHaveBeenCalledWith("mobile-blank");
  });

  it("closes the chooser on Escape, on the backdrop, and via Cancel", () => {
    const { props, unmount } = renderLake();

    fireEvent.click(screen.getByTestId("create-kind-blank"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("blank-chooser")).toBeNull();
    expect(props.onCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("create-kind-blank"));
    fireEvent.click(screen.getByTestId("blank-chooser-backdrop"));
    expect(screen.queryByTestId("blank-chooser")).toBeNull();
    unmount();

    const second = renderLake({ onCreate: props.onCreate });
    fireEvent.click(second.getByTestId("create-kind-blank"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("blank-chooser")).toBeNull();
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});

describe("ProjectLake saved projects", () => {
  it("renders a card per project, marks the active one, and opens on click", () => {
    const { props } = renderLake({
      projects: [
        summary({ id: "proj-1", name: "Alpha" }),
        summary({ id: "proj-2", name: "Beta", kind: "commerce", frameCount: 5 }),
      ],
      activeProjectId: "proj-2",
    });

    const cards = screen.getAllByTestId("project-card");
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute("data-project-id")).toBe("proj-1");
    expect(cards[0].getAttribute("aria-current")).toBeNull();
    expect(cards[1].getAttribute("aria-current")).toBe("true");
    expect(cards[0].textContent).toContain("Alpha");
    expect(cards[1].textContent).toContain("Just now");

    fireEvent.click(screen.getByRole("button", { name: "Open Alpha" }));
    expect(props.onOpen).toHaveBeenCalledWith("proj-1");
    fireEvent.click(screen.getByRole("button", { name: /^Beta/ }));
    expect(props.onOpen).toHaveBeenCalledWith("proj-2");
  });

  it("shows the empty state and its blank-canvas entry point", () => {
    renderLake();
    expect(screen.getByText("No saved notes yet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("start-brainstorming"));
    expect(screen.getByTestId("blank-chooser")).toBeTruthy();
  });

  it("duplicates a project from the card menu and closes the menu", () => {
    const { props } = renderLake({ projects: [summary()] });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Duplicate/ }));
    expect(props.onDuplicate).toHaveBeenCalledWith("proj-1");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("requires the confirm step before deleting", () => {
    const { props } = renderLake({ projects: [summary({ name: "Doomed file" })] });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(props.onDelete).not.toHaveBeenCalled();

    const confirm = screen.getByRole("alertdialog");
    expect(confirm.textContent).toContain("Delete “Doomed file”?");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    fireEvent.click(screen.getByTestId("confirm-delete-project"));
    expect(props.onDelete).toHaveBeenCalledWith("proj-1");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the card menu on an outside pointerdown", () => {
    renderLake({ projects: [summary()] });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("commits a rename on Enter and reports it once", () => {
    const onRename = vi.fn();
    renderLake({ projects: [summary({ name: "Old name" })], onRename });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));

    const input = screen.getByLabelText("Rename file") as HTMLInputElement;
    expect(input.value).toBe("Old name");
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("proj-1", "New name");
    expect(screen.queryByLabelText("Rename file")).toBeNull();
  });

  it("cancels a rename on Escape without reporting", () => {
    const onRename = vi.fn();
    renderLake({ projects: [summary({ name: "Keep me" })], onRename });
    fireEvent.doubleClick(screen.getByRole("button", { name: /^Keep me/ }));

    const input = screen.getByLabelText("Rename file") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Rename file")).toBeNull();
  });

  it("does not report unchanged or blank renames on blur", () => {
    const onRename = vi.fn();
    renderLake({ projects: [summary({ name: "Same" })], onRename });
    fireEvent.doubleClick(screen.getByRole("button", { name: /^Same/ }));
    const input = screen.getByLabelText("Rename file") as HTMLInputElement;
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByRole("button", { name: /^Same/ }));
    const second = screen.getByLabelText("Rename file") as HTMLInputElement;
    fireEvent.change(second, { target: { value: "   " } });
    fireEvent.blur(second);
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("ProjectLake overlay mode", () => {
  it("renders a close affordance and closes on Escape", () => {
    const onCloseLake = vi.fn();
    renderLake({ projects: [summary()], showAsOverlay: true, onCloseLake });

    const section = screen.getByTestId("project-lake");
    expect(section.className).toContain("is-overlay");
    fireEvent.click(screen.getByRole("button", { name: "Back to canvas" }));
    expect(onCloseLake).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseLake).toHaveBeenCalledTimes(2);
  });

  it("Escape dismisses an open card menu before the lake itself", () => {
    const onCloseLake = vi.fn();
    renderLake({ projects: [summary()], showAsOverlay: true, onCloseLake });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onCloseLake).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseLake).toHaveBeenCalledTimes(1);
  });

  it("omits the close button in embedded mode", () => {
    renderLake({ projects: [summary()] });
    expect(screen.queryByRole("button", { name: "Back to canvas" })).toBeNull();
    expect(screen.getByTestId("project-lake").className).not.toContain("is-overlay");
  });
});
