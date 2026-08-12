import { Cloud, Sparkles } from "lucide-react";

interface WorkspaceHeaderProps {
  frameCount: number;
}

export function WorkspaceHeader({ frameCount }: WorkspaceHeaderProps) {
  return (
    <header className="workspace-header" data-canvas-control aria-label="Project header">
      <div className="workspace-brand" aria-label="Canvas home">
        <span className="workspace-mark" aria-hidden="true">
          <span />
          <span />
        </span>
        <span>Canvas</span>
      </div>

      <div className="project-identity">
        <span className="project-name">Fieldwork explorations</span>
        <span className="project-meta">{frameCount} frames</span>
      </div>

      <div className="workspace-presence">
        <span className="sync-status">
          <Cloud size={13} strokeWidth={1.8} aria-hidden="true" />
          Saved
        </span>
        <span className="agent-status">
          <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />
          Agent ready
        </span>
        <span className="avatar" aria-label="Current user">A</span>
      </div>
    </header>
  );
}
