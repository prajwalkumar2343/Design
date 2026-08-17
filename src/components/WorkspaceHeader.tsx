import { Cloud } from "lucide-react";
import type { ChangeEvent } from "react";

interface WorkspaceHeaderProps {
  frameCount: number;
  projectName?: string;
  projectMeta?: string;
  canExport?: boolean;
  onImportFile?: (file: File) => void | Promise<void>;
  onExport?: () => void;
  persistenceFeedback?: { kind: "success" | "error"; message: string } | null;
}

export function WorkspaceHeader({
  frameCount,
  projectName = "Fieldwork explorations",
  projectMeta,
  canExport = false,
  onImportFile,
  onExport,
  persistenceFeedback,
}: WorkspaceHeaderProps) {
  const handleImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onImportFile?.(file);
  };

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
        <span className="project-name">{projectName}</span>
        <span className="project-meta">{projectMeta ?? `${frameCount} frames`}</span>
      </div>

      <div className="workspace-header-right">
        <div className="workspace-project-actions" aria-label="Project file actions">
          <input
            accept=".wirecanvas.json,application/json"
            aria-label="Choose WireCanvas project to import"
            className="workspace-import-input"
            data-testid="import-project-input"
            onChange={handleImportChange}
            type="file"
          />
          <button
            className="workspace-file-button"
            data-testid="import-project-button"
            onClick={(event) => {
              event.stopPropagation();
              event.currentTarget.parentElement?.querySelector<HTMLInputElement>("input[type=file]")?.click();
            }}
            type="button"
          >
            Import
          </button>
          {canExport ? (
            <button
              className="workspace-file-button"
              data-testid="export-project-button"
              onClick={(event) => {
                event.stopPropagation();
                onExport?.();
              }}
              type="button"
            >
              Export
            </button>
          ) : null}
        </div>
        <div className="workspace-presence">
          <span className="sync-status">
            <Cloud size={13} strokeWidth={1.8} aria-hidden="true" />
            Saved
          </span>
          <span className="avatar" aria-label="Current user">A</span>
        </div>
        {persistenceFeedback ? (
          <div
            className={`workspace-feedback workspace-feedback-${persistenceFeedback.kind}`}
            data-testid="persistence-feedback"
            role={persistenceFeedback.kind === "error" ? "alert" : "status"}
          >
            {persistenceFeedback.message}
          </div>
        ) : null}
      </div>
    </header>
  );
}
