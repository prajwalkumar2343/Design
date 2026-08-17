/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENCODE_GO_API_KEY?: string;
  readonly VITE_OPENCODE_GO_BASE_URL?: string;
  readonly VITE_CODEX_CHATGPT_API_KEY?: string;
  readonly VITE_CODEX_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
