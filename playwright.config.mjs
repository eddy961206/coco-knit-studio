import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  use: {
    baseURL: "http://127.0.0.1:4187",
    viewport: { width: 1440, height: 960 },
    headless: true,
  },
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
  outputDir: join(tmpdir(), "coco-knit-test-results"),
});
