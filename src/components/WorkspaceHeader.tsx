import { Cloud, Layers } from "lucide-react";
import type { ChangeEvent } from "react";
import { useLiquidGlass } from "../glass/useLiquidGlass";

interface WorkspaceHeaderProps {
  frameCount: number;
  projectName?: string;
  projectMeta?: string;
  canExport?: boolean;
  onImportFile?: (file: File) => void | Promise<void>;
  onExport?: () => void;
  onExportFigma?: () => void;
  persistenceFeedback?: { kind: "success" | "error"; message: string } | null;
  onShowLake?: () => void;
  lakeCount?: number;
  isLakeOpen?: boolean;
}

export function WorkspaceHeader({
  frameCount,
  projectName = "Fieldwork explorations",
  projectMeta,
  canExport = false,
  onImportFile,
  onExport,
  onExportFigma,
  persistenceFeedback,
  onShowLake,
  lakeCount,
  isLakeOpen = false,
}: WorkspaceHeaderProps) {
  const glassRef = useLiquidGlass<HTMLElement>({ radius: 13, bezel: 16, scale: 44, blur: 10, saturation: 1.7 });
  const handleImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onImportFile?.(file);
  };

  return (
    <header ref={glassRef} className="workspace-header" data-canvas-control aria-label="Project header">
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
              event.currentTarget.parentElement?.querySelector<HTMLInputElement>("input[type=file]")?.click();
            }}
            type="button"
          >
            Import
          </button>
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
