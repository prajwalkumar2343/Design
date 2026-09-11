import { Cloud, Globe, Layers, Smartphone } from "lucide-react";
import type { ChangeEvent } from "react";
import type { CanvasCategory } from "../persistence/local-projects";

interface WorkspaceHeaderProps {
  frameCount: number;
  projectName?: string;
  projectMeta?: string;
  canExport?: boolean;
  onImportFile?: (file: File) => void | Promise<void>;
  onImportHtmlFile?: (file: File) => void | Promise<void>;
  onExport?: () => void;
  onExportFigma?: () => void;
  onExportCode?: () => void;
  persistenceFeedback?: { kind: "success" | "error"; message: string } | null;
  onShowLake?: () => void;
  lakeCount?: number;
  isLakeOpen?: boolean;
  canvasCategory?: CanvasCategory;
  canvasLabel?: string;
}

export function WorkspaceHeader({
  frameCount,
  projectName = "Fieldwork explorations",
  projectMeta,
  canExport = false,
  onImportFile,
  onImportHtmlFile,
  onExport,
  onExportFigma,
  onExportCode,
  persistenceFeedback,
  onShowLake,
  lakeCount,
  isLakeOpen = false,
  canvasCategory,
  canvasLabel,
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
        {canvasCategory ? (
          <span className="project-canvas-badge" data-testid={`header-canvas-${canvasCategory}`} title={`Canvas: ${canvasLabel} · agent: ${canvasCategory === "website" ? "agent.md" : "agent-mobile.md"}`}>
            {canvasCategory === "website" ? <Globe size={11} aria-hidden="true" /> : <Smartphone size={11} aria-hidden="true" />}
            {canvasLabel}
          </span>
        ) : null}
      </div>

      <div className="workspace-header-right">
        <div className="workspace-project-actions" aria-label="Project file actions">
          {onShowLake ? (
            <button
              className={`workspace-file-button workspace-lake-button${isLakeOpen ? " is-active" : ""}`}
              data-testid="lake-toggle-button"
              onClick={(event) => {
                event.stopPropagation();
                onShowLake?.();
              }}
              type="button"
              aria-label={isLakeOpen ? "Back to canvas" : "Open project lake"}
              title={lakeCount ? `${lakeCount} projects in your lake` : "Open project lake"}
            >
              <Layers size={13} strokeWidth={1.8} aria-hidden="true" />
              Lake {typeof lakeCount === "number" ? `· ${lakeCount}` : ""}
            </button>
          ) : null}
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
              event.currentTarget.parentElement?.querySelector<HTMLInputElement>('[data-testid="import-project-input"]')?.click();
            }}
            type="button"
          >
            Import
          </button>
          {onImportHtmlFile ? (
            <>
              <input
                accept=".html,.htm,text/html"
                aria-label="Choose HTML file to import onto the canvas"
                className="workspace-import-input"
                data-testid="import-html-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void onImportHtmlFile?.(file);
                }}
                type="file"
              />
              <button
                className="workspace-file-button"
                data-testid="import-html-button"
                onClick={(event) => {
                  event.stopPropagation();
                  event.currentTarget.parentElement?.querySelector<HTMLInputElement>('[data-testid="import-html-input"]')?.click();
                }}
                type="button"
                title="Import a saved .html page as a live design frame"
              >
                Import HTML
              </button>
            </>
          ) : null}
          {canExport ? (
            <>
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
              <button
                className="workspace-file-button"
                data-testid="export-figma-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onExportFigma?.();
                }}
                type="button"
              >
                Export .fig
              </button>
              {onExportCode ? (
                <button
                  className="workspace-file-button workspace-export-code-button"
                  data-testid="export-code-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onExportCode();
                  }}
                  type="button"
                  title="Download the working HTML code for every page on this canvas"
                >
                  Export Code
                </button>
              ) : null}
            </>
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
