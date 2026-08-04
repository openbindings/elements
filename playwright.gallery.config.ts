import { defineConfig } from "@playwright/test";

// SHOOT station of the design loop (review/90-design-loop.md): renders the
// running workbench (real ob start + demo servers, real data, real focus)
// into a stable screenshot corpus under test-results/gallery/, and runs the
// browser-side mechanical gates (contrast + focus visibility probes).
const port = 20395;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/gallery",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: "list",
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
    viewport: { width: 1760, height: 1000 },
  },
  webServer: [{
    command:
      "env GOCACHE=/tmp/openbindings-ob-elements-go-cache go -C ../ob run ./cmd/ob start --port 20395 --token gallery-token",
    url: `${origin}/healthz`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  }, {
    command:
      "env GOCACHE=/tmp/openbindings-ob-elements-go-cache go -C ../ob run ./cmd/ob demo --port 20396 --grpc-port 20397",
    url: "http://127.0.0.1:20396/api/menu",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  }],
});
