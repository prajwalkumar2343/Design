import { Check, Pencil, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useEffect, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CanvasComment } from "./model";

export interface CommentPopoverProps {
  comment: CanvasComment;
  feedback: string | null;
  style: CSSProperties;
  onClose: () => void;
  onSave: (commentId: string, body: string) => boolean;
  onToggleResolved: (commentId: string) => void;
  onDelete: (commentId: string) => void;
}

export function CommentPopover({ comment, feedback, style, onClose, onSave, onToggleResolved, onDelete }: CommentPopoverProps) {
  const [draft, setDraft] = useState(comment.body);
  const [editing, setEditing] = useState(comment.body.length === 0);

  useEffect(() => {
    setDraft(comment.body);
    if (comment.body.length === 0) setEditing(true);
  }, [comment.body, comment.id]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (onSave(comment.id, draft)) setEditing(false);
  };

  const stopPointer = (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation();
  const isResolved = comment.status === "resolved";

  return (
    <article
      aria-label="Comment"
      className="canvas-comment-popover"
      data-canvas-control
      data-testid="comment-popover"
      onPointerDown={stopPointer}
      role="dialog"
      style={style}
    >
      <header className="comment-popover-header">
        <span className={`comment-status${isResolved ? " is-resolved" : ""}`}>
          {isResolved ? <Check size={12} /> : <span className="comment-status-dot" />}
          {isResolved ? "Resolved" : comment.body ? "Open comment" : "New comment"}
        </span>
        <button aria-label="Close comment" className="comment-close-button" onClick={onClose} type="button"><X size={14} /></button>
      </header>

      {editing ? (
        <form className="comment-editor" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor={`comment-input-${comment.id}`}>Comment text</label>
          <textarea
            autoFocus
            id={`comment-input-${comment.id}`}
            aria-label="Comment text"
            data-testid="comment-input"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a note for this spot…"
            rows={3}
            value={draft}
          />
          <div className="comment-popover-actions">
            <button className="comment-primary-action" data-testid="comment-save" type="submit"><Save size={13} /> Save comment</button>
            <button aria-label="Delete comment" className="comment-icon-action is-danger" onClick={() => onDelete(comment.id)} type="button"><Trash2 size={13} /></button>
          </div>
        </form>
      ) : (
        <div className="comment-viewer">
          <p data-testid="comment-body">{comment.body}</p>
          <div className="comment-popover-actions">
            <button className="comment-secondary-action" data-testid="comment-edit" onClick={() => setEditing(true)} type="button"><Pencil size={13} /> Edit</button>
            <button aria-label={isResolved ? "Reopen comment" : "Resolve comment"} className="comment-secondary-action" onClick={() => onToggleResolved(comment.id)} type="button">
              {isResolved ? <RotateCcw size={13} /> : <Check size={13} />}
              {isResolved ? "Reopen" : "Resolve"}
            </button>
            <button aria-label="Delete comment" className="comment-icon-action is-danger" onClick={() => onDelete(comment.id)} type="button"><Trash2 size={13} /></button>
          </div>
        </div>
      )}

      {feedback ? <div className="comment-feedback" data-testid="comment-feedback" role="status">{feedback}</div> : null}
    </article>
  );
}
