import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentConnectionPanel } from "./AgentConnectionPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(impl);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentConnectionPanel", () => {
  it("connects with a detected Gemini key and shows the reply", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "connected" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchFn);

    render(<AgentConnectionPanel />);

    fireEvent.change(screen.getByTestId("agent-key-input"), {
      target: { value: "AIzaFakeGeminiKey" },
    });
    fireEvent.click(screen.getByTestId("agent-connect-button"));

    await waitFor(() => {
      expect(screen.getByTestId("agent-connection-result").textContent).toContain("connected");
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent",
    );
    expect((init as RequestInit).headers).toMatchObject({ "x-goog-api-key": "AIzaFakeGeminiKey" });
  });

  it("requires a key before connecting", async () => {
    vi.stubGlobal("fetch", vi.fn());

    render(<AgentConnectionPanel />);

    fireEvent.click(screen.getByTestId("agent-connect-button"));

    await waitFor(() => {
      expect(screen.getByTestId("agent-connection-result").textContent).toContain(
        "Paste a provider key first.",
      );
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces typed connection failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { message: "invalid key" } }, 401)),
    );

    render(<AgentConnectionPanel />);

    fireEvent.change(screen.getByTestId("agent-key-input"), {
      target: { value: "sk-go-invalid" },
    });
    fireEvent.click(screen.getByTestId("agent-connect-button"));

    await waitFor(() => {
      const result = screen.getByTestId("agent-connection-result");
      expect(result.textContent).toContain("HTTP 401");
    });
  });

  it("asks for a manual provider when the key cannot be detected", async () => {
    vi.stubGlobal("fetch", vi.fn());

    render(<AgentConnectionPanel />);

    fireEvent.change(screen.getByTestId("agent-key-input"), {
      target: { value: "my-unknown-key" },
    });
    fireEvent.click(screen.getByTestId("agent-connect-button"));

    await waitFor(() => {
      expect(screen.getByTestId("agent-connection-result").textContent).toContain(
        "choose one manually",
      );
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets the provider be selected manually", async () => {
    const fetchFn = mockFetch(async () =>
      jsonResponse({
        choices: [{ message: { content: "connected" } }],
      }),
    );
    vi.stubGlobal("fetch", fetchFn);

    render(<AgentConnectionPanel />);

    fireEvent.change(screen.getByTestId("agent-key-input"), {
      target: { value: "my-unknown-key" },
    });
    fireEvent.change(screen.getByTestId("agent-provider-select"), {
      target: { value: "opencode-go" },
    });
    fireEvent.click(screen.getByTestId("agent-connect-button"));

    await waitFor(() => {
      expect(screen.getByTestId("agent-connection-result").textContent).toContain("connected");
    });

    const [url] = fetchFn.mock.calls[0];
    expect(url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
  });
});
