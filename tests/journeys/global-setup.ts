import fs from "node:fs";
import path from "node:path";

// The telemetry file is run-scoped: each `test:journeys` run starts a fresh
// JSONL so scripts/loop-status.mjs reports exactly one run's histogram.
export default function globalSetup(): void {
  const file = path.resolve(
    process.cwd(),
    "test-results",
    "journeys-telemetry.jsonl",
  );
  fs.rmSync(file, { force: true });
}
