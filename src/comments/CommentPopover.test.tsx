import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommentPopover } from "./CommentPopover";
import type { CanvasComment } from "./model";

function makeComment(body = ""): CanvasComment {
  return { id: "comment-1", frameId: "frame-1", point: { x: 10, y: 20 }, body, status: "open" };
}

function renderPopover(overrides: Partial<Parameters<typeof CommentPopover>[0]> = {}) {
  const props: Parameters<typeof CommentPopover>[0] = {
    comment: makeComment(),
    feedback: null,
    style: {},
    onClose: vi.fn(),
    onSave: vi.fn(() => true),
    onDelete: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CommentPopover {...props} />) };
}

describe("CommentPopover", () => {
  it("autofocuses the textarea and shows any saved body", () => {
    renderPopover({ comment: makeComment("Saved text") });
    const input = screen.getByTestId("comment-input") as HTMLTextAreaElement;
    expect(input.value).toBe("Saved text");
    expect(document.activeElement).toBe(input);
  });

  it("saves the draft on outside pointerdown", () => {
    const { props } = renderPopover();
    fireEvent.change(screen.getByTestId("comment-input"), { target: { value: "Ship it" } });
    fireEvent.pointerDown(document.body);
    expect(props.onSave).toHaveBeenCalledWith("comment-1", "Ship it");
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("deletes instead of saving when the draft is empty", () => {
    const { props } = renderPopover();
    fireEvent.change(screen.getByTestId("comment-input"), { target: { value: "   " } });
    fireEvent.pointerDown(document.body);
    expect(props.onDelete).toHaveBeenCalledWith("comment-1");
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("finalizes on Escape and stays a single-fire action", () => {
    const { props } = renderPopover();
    const input = screen.getByTestId("comment-input");
    fireEvent.change(input, { target: { value: "Done" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onSave).toHaveBeenCalledTimes(1);
    // A later outside pointerdown must not double-fire save/delete.
    fireEvent.pointerDown(document.body);
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("does not finalize when the pointer lands inside the popover", () => {
    const { props } = renderPopover();
    fireEvent.pointerDown(screen.getByTestId("comment-popover"));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("offers an explicit save action only for nonempty text", () => {
    const { props } = renderPopover();
    const save = screen.getByRole("button", { name: "Save comment" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("comment-input"), { target: { value: "A clearer hierarchy" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(props.onSave).toHaveBeenCalledWith("comment-1", "A clearer hierarchy");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor open when focus moves to its controls", () => {
    const { props } = renderPopover({ comment: makeComment("Saved text") });
    fireEvent.blur(screen.getByTestId("comment-input"), { relatedTarget: screen.getByRole("button", { name: "Close comment" }) });
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("saves with the platform shortcut %j", (modifier) => {
    const { props } = renderPopover({ comment: makeComment("A note") });
    fireEvent.keyDown(screen.getByTestId("comment-input"), { key: "Enter", ...modifier });
    expect(props.onSave).toHaveBeenCalledWith("comment-1", "A note");
  });

  it("does not save during IME composition", () => {
    const { props } = renderPopover({ comment: makeComment("A note") });
    fireEvent.keyDown(screen.getByTestId("comment-input"), { key: "Enter", metaKey: true, isComposing: true });
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("keeps a rejected save open and allows retrying", () => {
    const onSave = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { props } = renderPopover({ comment: makeComment("A note"), onSave });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("saves current edits before resolving", () => {
    const onToggleResolved = vi.fn();
    const { props } = renderPopover({ comment: makeComment("A note"), onToggleResolved });
    fireEvent.change(screen.getByTestId("comment-input"), { target: { value: "Updated note" } });
    fireEvent.click(screen.getByRole("button", { name: "Resolve comment" }));
    expect(props.onSave).toHaveBeenCalledWith("comment-1", "Updated note");
    expect(onToggleResolved).toHaveBeenCalledWith("comment-1");
  });

  it("renders transient feedback", () => {
    renderPopover({ feedback: "Comment deleted" });
    expect(screen.getByTestId("comment-feedback").textContent).toBe("Comment deleted");
  });
});
