import { defineConfig } from "@playwright/test";
import fs from "node:fs";

// Rev-1 journey harness (development loop, station 1a).
// Modeled on playwright.ob-start.config.ts but on its own port/token so both
// suites can run side by side.
const port = 20397;
const origin = `http://127.0.0.1:${port}`;
const token = process.env.OB_JOURNEY_TOKEN ?? "journey-token";

// Prefer the preinstalled system chromium when present (container CI); fall
// back to Playwright's own browser everywhere else.
const chromiumPath = "/opt/pw-browsers/chromium";
const launchOptions = fs.existsSync(chromiumPath)
  ? { executablePath: chromiumPath }
  : {};

export default defineConfig({
  testDir: "./tests/journeys",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/journeys/global-setup.ts",
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
    launchOptions,
  },
  webServer: {
    command: `env GOCACHE=/tmp/ob-journeys-go-cache GOTOOLCHAIN=local GOPROXY=direct go -C ../ob run ./cmd/ob start --port ${port} --token ${token}`,
    url: `${origin}/healthz`,
    reuseExistingServer: true,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
