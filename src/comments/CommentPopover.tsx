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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [comment.id]);

  const finalize = (nextBody: string) => {
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
      {feedback ? <div className="comment-feedback" data-testid="comment-feedback" role="status">{feedback}</div> : null}
    </div>
  );
}