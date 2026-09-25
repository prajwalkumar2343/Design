import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "./WorkspaceHeader";

function renderHeader(overrides: Partial<Parameters<typeof WorkspaceHeader>[0]> = {}) {
  const props: Parameters<typeof WorkspaceHeader>[0] = { frameCount: 0, ...overrides };
  return { props, ...render(<WorkspaceHeader {...props} />) };
}

describe("WorkspaceHeader", () => {
  it("hides export actions until the project can be exported", () => {
    renderHeader({ canExport: false, onExport: vi.fn(), onExportFigma: vi.fn(), onExportCode: vi.fn() });
    expect(screen.queryByTestId("export-project-button")).toBeNull();
    expect(screen.queryByTestId("export-figma-button")).toBeNull();
    expect(screen.queryByTestId("export-code-button")).toBeNull();
  });

  it("shows all export actions when exportable and routes their clicks", () => {
    const { props } = renderHeader({
      canExport: true,
      onExport: vi.fn(),
      onExportFigma: vi.fn(),
      onExportCode: vi.fn(),
      onExportReact: vi.fn(),
    });
    fireEvent.click(screen.getByTestId("export-project-button"));
    fireEvent.click(screen.getByTestId("export-figma-button"));
    fireEvent.click(screen.getByTestId("export-code-button"));
    fireEvent.click(screen.getByTestId("export-react-button"));
    expect(props.onExport).toHaveBeenCalledTimes(1);
    expect(props.onExportFigma).toHaveBeenCalledTimes(1);
    expect(props.onExportCode).toHaveBeenCalledTimes(1);
    expect(props.onExportReact).toHaveBeenCalledTimes(1);
  });

  it("gates Export Code on its own callback even when canExport is true", () => {
    renderHeader({ canExport: true, onExport: vi.fn(), onExportFigma: vi.fn() });
    expect(screen.getByTestId("export-project-button")).toBeTruthy();
    expect(screen.queryByTestId("export-code-button")).toBeNull();
    expect(screen.queryByTestId("export-react-button")).toBeNull();
  });

  it("forwards the chosen project file and resets the input for re-picks", () => {
    const onImportFile = vi.fn();
    renderHeader({ onImportFile });
    const input = screen.getByTestId("import-project-input") as HTMLInputElement;
    const file = new File(["{}"], "a.wirecanvas.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImportFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");
  });

  it("only renders the HTML import affordance when supported", () => {
    const { unmount } = renderHeader();
    expect(screen.queryByTestId("import-html-button")).toBeNull();
    unmount();
    const onImportHtmlFile = vi.fn();
    renderHeader({ onImportHtmlFile });
    fireEvent.change(screen.getByTestId("import-html-input") as HTMLInputElement, {
      target: { files: [new File(["<p>x</p>"], "page.html", { type: "text/html" })] },
    });
    expect(onImportHtmlFile).toHaveBeenCalled();
  });

  it("uses an alert role for errors and status for successes", () => {
    const { unmount } = renderHeader({ persistenceFeedback: { kind: "error", message: "Boom" } });
    expect(screen.getByRole("alert").textContent).toBe("Boom");
    unmount();
    renderHeader({ persistenceFeedback: { kind: "success", message: "Saved" } });
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("pluralizes the frame count and shows the lake state", () => {
    const { unmount } = renderHeader({ frameCount: 1 });
    expect(screen.getByText("1 frame")).toBeTruthy();
    unmount();
    renderHeader({ frameCount: 3, isLakeOpen: true, onShowLake: vi.fn(), lakeCount: 3 });
    expect(screen.queryByText(/frames/)).toBeNull();
    expect(screen.getByTestId("lake-toggle-button")).toBeTruthy();
  });
});
