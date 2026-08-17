import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CanvasComment } from "./model";

export interface CommentPopoverProps {
  comment: CanvasComment;
  feedback: string | null;
  style: CSSProperties;
  onClose: () => void;
  onSave: (commentId: string, body: string) => boolean;
  onDelete: (commentId: string) => void;
}

export function CommentPopover({ comment, feedback, style, onClose, onSave, onDelete }: CommentPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const finalizedRef = useRef(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [comment.id]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.contains(event.target)) return;
      finalize(textareaRef.current?.value ?? "");
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  const finalize = (nextBody: string) => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    const body = nextBody.trim();
    onClose();
    if (body === "") {
      onDelete(comment.id);
    } else {
      onSave(comment.id, nextBody);
    }
  };

  const stopPointer = (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation();

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finalize(event.currentTarget.value);
    }
  };

  return (
    <div
      ref={rootRef}
      aria-label="Comment"
      className="canvas-comment-popover"
      data-canvas-control
      data-testid="comment-popover"
      onPointerDown={stopPointer}
      role="dialog"
      style={style}
    >
      <textarea
        aria-label="Comment text"
        autoFocus
        className="comment-text-field"
        data-testid="comment-input"
        defaultValue={comment.body}
        onBlur={(event) => finalize(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment…"
        ref={textareaRef}
        rows={5}
      />
      <div className="comment-hint" aria-hidden="true">
        <span>Click away to save</span>
        <span className="comment-hint-dot" />
        <kbd>esc</kbd>
        <span>to dismiss</span>
      </div>
      {feedback ? <div className="comment-feedback" data-testid="comment-feedback" role="status">{feedback}</div> : null}
    </div>
  );
}