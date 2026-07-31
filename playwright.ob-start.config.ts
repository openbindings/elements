import { defineConfig } from "@playwright/test";

const port = 20391;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/ob-start",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
  },
  webServer: [{
    command:
      "env GOCACHE=/tmp/openbindings-ob-elements-go-cache go -C ../ob run ./cmd/ob start --port 20391 --token test-token",
    url: `${origin}/healthz`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  }, {
    command:
      "env GOCACHE=/tmp/openbindings-ob-elements-go-cache go -C ../ob run ./cmd/ob demo --port 20392 --grpc-port 20393",
    url: "http://127.0.0.1:20392/api/menu",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  }],
});
