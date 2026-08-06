import { defineConfig } from "@playwright/test";

// PORT MAP (rev 17.20.1). Every suite config must claim a disjoint range —
// the gallery's demo gRPC port was 20397, which is the JOURNEYS workbench
// port, so running the gallery first left its demo squatting there and the
// journeys server silently fell back to another port while Playwright waited
// forever on a healthz that would never answer. Suite order must never
// decide whether a suite can boot.
//   ob-start: 20391 http / 20392 demo / 20393 demo-grpc
//   gallery:  20395 http / 20396 demo / 20399 demo-grpc
//   journeys: 20397 http

// Sandbox override of playwright.gallery.config.ts: pins the local Chromium
// build and keeps the Go webServer offline (GOTOOLCHAIN=local GOPROXY=direct).
const port = 20395;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/gallery",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: "list",
  use: { launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
    baseURL: origin,
    trace: "retain-on-failure",
    viewport: { width: 1760, height: 1000 },
  },
  webServer: [{
    command:
      "env GOCACHE=/tmp/openbindings-ob-elements-go-cache GOTOOLCHAIN=local GOPROXY=direct go -C ../ob run ./cmd/ob start --port 20395 --token gallery-token",
    url: `${origin}/healthz`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  }, {
    command:
      "env GOCACHE=/tmp/openbindings-ob-elements-go-cache GOTOOLCHAIN=local GOPROXY=direct go -C ../ob run ./cmd/ob demo --port 20396 --grpc-port 20399",
    url: "http://127.0.0.1:20396/api/menu",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  }],
});
