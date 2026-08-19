import { AgentConnectionPanel } from "./AgentConnectionPanel";

interface EmptyCanvasStateProps {
  onStartBrainstorming: () => void;
}

export function EmptyCanvasState({ onStartBrainstorming }: EmptyCanvasStateProps) {
  return (
    <section className="empty-canvas-state" data-canvas-control data-testid="empty-canvas-state">
      <span className="empty-canvas-eyebrow">A clear place to begin</span>
      <h1>Start with the project.</h1>
      <p>Tell Codex what you’re making, who it’s for, and what it should help them do.</p>
      <button data-testid="start-brainstorming" onClick={onStartBrainstorming} type="button">
        Start brainstorming
      </button>
      <AgentConnectionPanel />
    </section>
  );
}
