import { Check, CornerDownLeft, MessageSquare, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CanvasComment } from "./model";

export interface CommentPopoverProps {
  comment: CanvasComment;
  feedback: string | null;
  style: CSSProperties;
  onClose: () => void;
  onSave: (commentId: string, body: string) => boolean;
  onDelete: (commentId: string) => void;
  onToggleResolved?: (commentId: string) => void;
}

export function CommentPopover({ comment, feedback, style, onClose, onSave, onDelete, onToggleResolved }: CommentPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const finalizedRef = useRef(false);
  const [body, setBody] = useState(comment.body);
  const [position, setPosition] = useState<CSSProperties>({});
  const hintId = useId();
  const isNew = !comment.body;
  const isResolved = comment.status === "resolved";
  const hasBody = body.trim().length > 0;
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, [comment.id]);

  // The anchor point sits at the marker in surface coordinates — clamp the
  // popover into the free canvas area so it never opens under the overlay
  // chrome (sidebars) or partially offscreen.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const parent = root?.offsetParent;
    if (!root || !(parent instanceof HTMLElement)) return;
    const place = () => {
      const left = typeof style.left === "number" ? style.left : 12;
      const top = typeof style.top === "number" ? style.top : 12;
      const pRect = parent.getBoundingClientRect();
      const rail = document.querySelector(".left-sidebar")?.getBoundingClientRect();
      const inspector = document.querySelector(".right-properties-panel")?.getBoundingClientRect();
      const viewportMax = parent.clientWidth - 12 - root.offsetWidth;
      const railBound = (rail ? rail.right - pRect.left : 0) + 8;
      const inspectorBound = (inspector ? inspector.left - pRect.left : parent.clientWidth) - 8 - root.offsetWidth;
      // Side-chrome bounds only apply when the free band can fit the popover —
      // on narrow layouts it can't, so fall back to plain viewport clamping.
      const fitsBetweenPanels = inspectorBound >= Math.max(12, railBound);
      const minLeft = fitsBetweenPanels ? Math.max(12, railBound) : 12;
      const maxLeft = fitsBetweenPanels ? Math.min(viewportMax, inspectorBound) : viewportMax;
      setPosition({
        left: Math.max(minLeft, Math.min(left, Math.max(minLeft, maxLeft))),
        top: Math.max(12, Math.min(top, parent.clientHeight - root.offsetHeight - 12)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root);
    observer.observe(parent);
    document.querySelectorAll(".left-sidebar, .right-properties-panel").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [style.left, style.top]);

  const finalize = useCallback((nextBody: string, resolve = false) => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    if (nextBody.trim() === "") {
      onClose();
      onDelete(comment.id);
      return;
    }
    if (!onSave(comment.id, nextBody)) {
      finalizedRef.current = false;
      return;
    }
    onClose();
    if (resolve) onToggleResolved?.(comment.id);
  }, [comment.id, onClose, onDelete, onSave, onToggleResolved]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.contains(event.target)) return;
      finalize(textareaRef.current?.value ?? "");
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [finalize]);

  const stopPointer = (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation();

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey) && hasBody)) {
      event.preventDefault();
      finalize(body);
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
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        const root = event.currentTarget;
        if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
        queueMicrotask(() => {
          if (root.isConnected && !root.contains(document.activeElement)) finalize(textareaRef.current?.value ?? "");
        });
      }}
      role="dialog"
      style={{ ...style, ...position }}
    >
      <header className="comment-header">
        <span className="comment-heading-icon" aria-hidden="true"><MessageSquare size={16} /></span>
        <span className="comment-heading">{isNew ? "New comment" : "Comment"}</span>
        <span className="comment-status" data-resolved={isResolved}>{isNew ? "Draft" : isResolved ? "Resolved" : "Open"}</span>
        <button aria-label="Close comment" className="comment-icon-button" onClick={() => finalize(body)} title="Save and close (Esc)" type="button"><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="comment-composer">
        <textarea
          aria-label="Comment text"
          aria-describedby={hintId}
          className="comment-text-field"
          data-testid="comment-input"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What could be improved here?"
          ref={textareaRef}
          rows={4}
        />
        <div className="comment-composer-actions">
          <span className="comment-shortcut" aria-hidden="true"><kbd>{shortcut}</kbd><kbd><CornerDownLeft size={11} /></kbd><span>to save</span></span>
          <button className="comment-save-button" disabled={!hasBody} onClick={() => finalize(body)} type="button">
            {isNew ? "Save comment" : "Save changes"}<CornerDownLeft size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
      <footer className="comment-footer">
        <span className="comment-hint" id={hintId}>Click away or Esc to save &amp; close</span>
        {!isNew && onToggleResolved ? (
          <button className="comment-resolve-button" disabled={!hasBody} onClick={() => finalize(body, true)} aria-label={isResolved ? "Reopen comment" : "Resolve comment"} type="button">
            {isResolved ? <RotateCcw size={13} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{isResolved ? "Reopen" : "Resolve"}
          </button>
        ) : null}
      </footer>
      {feedback ? <div className="comment-feedback" data-testid="comment-feedback" role="status">{feedback}</div> : null}
    </div>
  );
}
