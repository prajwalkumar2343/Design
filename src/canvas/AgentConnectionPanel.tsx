import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  chatWith,
  createCredentialsForKey,
  defaultModelForProvider,
  detectProviderForKey,
  type LLMProviderId,
} from "../llm";

const PROVIDER_OPTIONS: Array<{ id: LLMProviderId; label: string }> = [
  { id: "opencode-go", label: "OpenCode Go" },
  { id: "codex-chatgpt", label: "ChatGPT / Codex" },
  { id: "gemini", label: "Google Gemini" },
];

const TEST_PROMPT = "Reply with exactly one word: connected";

type ConnectionStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; text: string; model: string }
  | { kind: "failed"; message: string };

/**
 * TEMPORARY TEST PANEL — remove before shipping.
 * Lets a developer paste a provider key in the center of an empty canvas and
 * verify the LLM connection. Keys live in component state only and are never
 * persisted. See PROJECT_SPEC §10.1: this is test-only plumbing, not the
 * deferred fallback-mode decision.
 */
export function AgentConnectionPanel() {
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<LLMProviderId | "">("");
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "idle" });

  const detected = detectProviderForKey(apiKey);
  const effectiveProvider = provider || detected;

  function onKeyChange(event: ChangeEvent<HTMLInputElement>) {
    setApiKey(event.target.value);
    setStatus({ kind: "idle" });
  }

  function onProviderChange(event: ChangeEvent<HTMLSelectElement>) {
    setProvider(event.target.value as LLMProviderId | "");
    setStatus({ kind: "idle" });
  }

  async function onConnect(event: FormEvent) {
    event.preventDefault();
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setStatus({ kind: "failed", message: "Paste a provider key first." });
      return;
    }
    if (!effectiveProvider) {
      setStatus({
        kind: "failed",
        message: "Could not detect the provider from the key — choose one manually.",
      });
      return;
    }

    setStatus({ kind: "connecting" });
    try {
      const model = defaultModelForProvider(effectiveProvider);
      const result = await chatWith(
        effectiveProvider,
        { model, messages: [{ role: "user", content: TEST_PROMPT }] },
        { credentials: createCredentialsForKey(effectiveProvider, trimmedKey) },
      );
      setStatus({ kind: "connected", text: result.text, model: result.model });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection test failed.";
      setStatus({ kind: "failed", message });
    }
  }

  return (
    <section
      className="agent-connection-panel"
      data-canvas-control
      data-testid="agent-connection-panel"
      aria-label="Test agent connection"
    >
      <p className="agent-connection-note">Temporary test panel — remove before shipping.</p>
      <form onSubmit={onConnect} className="agent-connection-form">
        <label className="agent-connection-label" htmlFor="agent-connection-key">
          Provider key
          <input
            id="agent-connection-key"
            data-testid="agent-key-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={onKeyChange}
            placeholder="Paste a key to test the agent connection"
          />
        </label>
        <label className="agent-connection-label" htmlFor="agent-connection-provider">
          Provider
          <select
            id="agent-connection-provider"
            data-testid="agent-provider-select"
            value={provider}
            onChange={onProviderChange}
          >
            <option value="">Auto-detect{detected ? ` (${detected})` : ""}</option>
            {PROVIDER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          data-testid="agent-connect-button"
          type="submit"
          disabled={status.kind === "connecting"}
        >
          {status.kind === "connecting" ? "Connecting…" : "Test connection"}
        </button>
      </form>
      {status.kind === "connected" && (
        <p className="agent-connection-result agent-connection-result-ok" data-testid="agent-connection-result">
          Connected via {status.model}: {status.text}
        </p>
      )}
      {status.kind === "failed" && (
        <p className="agent-connection-result agent-connection-result-error" data-testid="agent-connection-result">
          Connection failed: {status.message}
        </p>
      )}
    </section>
  );
}
