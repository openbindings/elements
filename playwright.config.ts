import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command:
      "pnpm --filter @openbindings/vanilla-elements-example dev --host 127.0.0.1 --port 4178",
    url: "http://127.0.0.1:4178",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
