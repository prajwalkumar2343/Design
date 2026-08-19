import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  appType: "spa",
  plugins: [react()],
  preview: {
    host: true,
  },
  server: {
    host: true,
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
