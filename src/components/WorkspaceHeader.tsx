import { ArrowUpRight, ChevronRight, Code2, Download, FileCode2, Globe, Layers, Smartphone, Upload } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
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
  const projectInput = useRef<HTMLInputElement>(null);
  const htmlInput = useRef<HTMLInputElement>(null);
  const handleImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void onImportFile?.(file);
  };

  return (
    <header className="workspace-header" data-canvas-control data-home={isLakeOpen} aria-label="Project header">
      <div className="workspace-brand" aria-label="Canvas">
        <span className="workspace-mark" aria-hidden="true"><span /><span /></span>
        <span>Canvas<span className="workspace-brand-dot">.</span></span>
      </div>
      <div className="project-identity">
        {onShowLake ? (
          <button
            className={`workspace-home-button${isLakeOpen ? " is-active" : ""}`}
            data-testid="lake-toggle-button"
            onClick={onShowLake}
            type="button"
            aria-label="Open project lake"
            title={`${lakeCount ?? 0} projects in your workspace`}
          >
            <Layers size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>Workspace</span>
          </button>
        ) : null}
        {!isLakeOpen ? <>
          {onShowLake ? <ChevronRight className="project-breadcrumb-divider" size={13} aria-hidden="true" /> : null}
          <span className="project-name" title={projectName}>{projectName}</span>
          {canvasCategory ? (
            <span className="project-canvas-badge" data-testid={`header-canvas-${canvasCategory}`} title={projectMeta}>
              {canvasCategory === "website" ? <Globe size={11} aria-hidden="true" /> : <Smartphone size={11} aria-hidden="true" />}
              {canvasLabel}
            </span>
          ) : null}
          <span className="project-meta" title={projectMeta}>{frameCount} {frameCount === 1 ? "frame" : "frames"}</span>
        </> : null}
      </div>
      <div className="workspace-header-right">
        <div className="workspace-project-actions" aria-label="Project file actions">
          <input
            ref={projectInput}
            accept=".wirecanvas.json,.fig,application/json,application/octet-stream"
            aria-label="Choose WireCanvas or Figma file to import"
            className="workspace-import-input"
            data-testid="import-project-input"
            onChange={handleImportChange}
            type="file"
          />
          <button className="workspace-file-button" data-testid="import-project-button" onClick={() => projectInput.current?.click()} type="button" title="Import a WireCanvas project or Figma file">
            <Upload size={14} aria-hidden="true" /><span>Import</span>
          </button>
          {onImportHtmlFile ? <>
            <input
              ref={htmlInput}
              accept=".html,.htm,text/html"
              aria-label="Choose HTML file to import onto the canvas"
              className="workspace-import-input"
              data-testid="import-html-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onImportHtmlFile(file);
              }}
              type="file"
            />
            <button className="workspace-file-button" data-testid="import-html-button" onClick={() => htmlInput.current?.click()} type="button" title="Import a saved HTML page as a live design frame">
              <FileCode2 size={14} aria-hidden="true" /><span>Import HTML</span>
            </button>
          </> : null}
          {canExport ? <>
            <span className="workspace-action-divider" />
            <button className="workspace-file-button" data-testid="export-project-button" onClick={onExport} type="button" title="Download a WireCanvas project">
              <Download size={14} aria-hidden="true" /><span>Export</span>
            </button>
            <button className="workspace-file-button" data-testid="export-figma-button" onClick={onExportFigma} type="button" title="Download a Figma file">Export .fig</button>
            {onExportCode ? <button className="workspace-file-button workspace-export-code-button" data-testid="export-code-button" onClick={onExportCode} type="button" title="Download the working HTML code for every page on this canvas">
              <Code2 size={14} aria-hidden="true" /><span>Export Code</span><ArrowUpRight size={13} aria-hidden="true" />
            </button> : null}
          </> : null}
        </div>
        <div className="workspace-presence">
          <span className="avatar" aria-label="Personal workspace" title="Projects are stored locally on this device">A</span>
        </div>
        {persistenceFeedback ? (
          <div className={`workspace-feedback workspace-feedback-${persistenceFeedback.kind}`} data-testid="persistence-feedback" role={persistenceFeedback.kind === "error" ? "alert" : "status"}>
            {persistenceFeedback.message}
          </div>
        ) : null}
      </div>
    </header>
  );
}
