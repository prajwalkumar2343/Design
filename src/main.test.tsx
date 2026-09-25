import { StrictMode, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRootMock, renderMock, installSwipeMock, ensureFontsMock, MockApp } = vi.hoisted(() => {
  function MockApp() {
    return null;
  }
  return {
    createRootMock: vi.fn(),
    renderMock: vi.fn(),
    installSwipeMock: vi.fn(),
    ensureFontsMock: vi.fn(),
    MockApp,
  };
});

vi.mock("react-dom/client", () => ({ createRoot: createRootMock }));
vi.mock("./fonts", () => ({ ensureCanvasFonts: ensureFontsMock }));
vi.mock("./interaction/history-swipe", () => ({ installHistorySwipeGuard: installSwipeMock }));
vi.mock("./App", () => ({ App: MockApp }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  createRootMock.mockReturnValue({ render: renderMock });
  document.body.innerHTML = '<div id="root"></div>';
});

describe("main entrypoint", () => {
  it("installs the swipe guard and fonts, then mounts <App /> under StrictMode into #root", async () => {
    await import("./main");

    expect(installSwipeMock).toHaveBeenCalledTimes(1);
    expect(ensureFontsMock).toHaveBeenCalledWith(document);
    expect(createRootMock).toHaveBeenCalledTimes(1);
    expect(createRootMock).toHaveBeenCalledWith(document.getElementById("root"));

    expect(renderMock).toHaveBeenCalledTimes(1);
    const element = renderMock.mock.calls[0][0] as ReactElement<{ children: ReactElement }>;
    expect(element.type).toBe(StrictMode);
    expect(element.props.children.type).toBe(MockApp);

    expect(installSwipeMock.mock.invocationCallOrder[0]).toBeLessThan(
      renderMock.mock.invocationCallOrder[0],
    );
    expect(ensureFontsMock.mock.invocationCallOrder[0]).toBeLessThan(
      renderMock.mock.invocationCallOrder[0],
    );
  });
});
