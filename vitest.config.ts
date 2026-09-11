import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    css: true,
    setupFiles: ["./src/test/dom-storage-polyfill.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**", "improved source/**", "tmp/**"],
  },
});
