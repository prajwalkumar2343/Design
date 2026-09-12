import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig({
  ...config,
  use: { ...config.use, baseURL: "http://127.0.0.1:4181" },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4181",
    url: "http://127.0.0.1:4181",
    reuseExistingServer: false,
  },
});
