import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { detectPaperShaderSupport, loadPaperShader } from "../shaders";
import { useLoadedShader } from "./useLoadedShader";

vi.mock("../shaders", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shaders")>();
  return {
    ...mod,
    loadPaperShader: vi.fn(mod.loadPaperShader),
    detectPaperShaderSupport: vi.fn(mod.detectPaperShaderSupport),
  };
});

function Probe({ shaderId, checkSupport }: { shaderId: "ferro-tide" | "mesh-gradient" | string; checkSupport?: boolean }) {
  const { shader, failure, retry } = useLoadedShader(shaderId as never, { checkSupport });
  return (
    <div>
      <span data-testid="status">
        {failure ?? (shader ? "ready" : "loading")}
      </span>
      <button data-testid="retry" onClick={retry} type="button">
        retry
      </button>
    </div>
  );
}

describe("useLoadedShader", () => {
  it("gates Paper shaders on the WebGL2 probe before fetching the module", async () => {
    vi.mocked(detectPaperShaderSupport).mockReturnValueOnce({
      supported: false,
      reason: "webgl2-unavailable",
    });
    render(<Probe shaderId="mesh-gradient" />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unsupported"));
    expect(loadPaperShader).not.toHaveBeenCalled();
  });

  it("skips the WebGL2 gate when checkSupport is false", async () => {
    vi.mocked(detectPaperShaderSupport).mockReturnValue({
      supported: false,
      reason: "webgl2-unavailable",
    });
    render(<Probe shaderId="mesh-gradient" checkSupport={false} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(loadPaperShader).toHaveBeenCalledWith("mesh-gradient");
  });

  it("recovers a failed load when retry is invoked", async () => {
    vi.mocked(loadPaperShader).mockRejectedValueOnce(new Error("stale chunk"));
    render(<Probe shaderId="ferro-tide" />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("load-error"));

    fireEvent.click(screen.getByTestId("retry"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
  });

  it("classifies an unsupported shader id as unknown rather than a load failure", async () => {
    render(<Probe shaderId="retired-shader" />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unknown"));
  });
});
