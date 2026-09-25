import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: {
      // Worktrees commonly symlink node_modules; allow the resolved path too.
      allow: [".", dirname(realpathSync("node_modules"))],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: true,
    setupFiles: ["./src/test/dom-storage-polyfill.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**", "improved source/**", "tmp/**", ".worktrees/**"],
  },
});
