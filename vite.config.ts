import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { canvasAgentBridge } from "./vite-plugin-canvas-agent";

// A stray "%" in the path (e.g. /design/%) makes the static handler's
// decodeURIComponent throw, answering a bare 404 instead of the SPA. Rewrite
// the request to the app shell; client routing then lands on the lake.
const spaFallbackOnMalformedUrl: Plugin = {
  name: "spa-fallback-on-malformed-url",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      try {
        if (req.url) decodeURIComponent(req.url);
      } catch {
        req.url = "/";
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      try {
        if (req.url) decodeURIComponent(req.url);
      } catch {
        req.url = "/";
      }
      next();
    });
  },
};

export default defineConfig({
  appType: "spa",
  plugins: [react(), spaFallbackOnMalformedUrl, canvasAgentBridge()],
  preview: {
    host: true,
  },
  server: {
    host: true,
    watch: {
      // Tests rewrite fixture files under tmp/; reloading on them would
      // interrupt anyone with the dev server open.
      ignored: ["**/tmp/**"],
    },
    fs: {
      // Worktrees commonly symlink node_modules; allow the resolved path too.
      allow: [".", dirname(realpathSync("node_modules"))],
    },
    proxy: {
      // Browser-only LLM clients call these in dev (see .env.development) so
      // provider keys stay out of the network path and CORS is avoided.
      "/zen/go": {
        target: "https://opencode.ai",
        changeOrigin: true,
      },
      "/backend-api": {
        target: "https://chatgpt.com",
        changeOrigin: true,
      },
    },
  },
});
