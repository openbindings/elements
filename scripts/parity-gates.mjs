#!/usr/bin/env node
/**
 * Parity gate (review/100, P2): every operation in the ob contract must have
 * exactly one disposition in the workbench's ui-parity.json — an affordance,
 * a composed flow, coverage by another affordance, an internal caller, a
 * deferral with a revolution number, or a refusal with a reason. The
 * workbench drifts out of parity with the contract, this goes red.
 *
 * Failures:
 *   - contract operation with no mapping (the contract grew; the UI didn't notice)
 *   - mapping for an operation the contract no longer has (stale map)
 *   - unknown status token
 *   - deferred without a rev number (silent cap)
 *   - refused/covered/internal/composed/affordance without detail text
 *   - entry with a `selector` that no longer occurs in the app shell or source
 *
 * Usage: node scripts/parity-gates.mjs [--contract <path-to-obi.json>]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const contractFlag = args.indexOf("--contract");
const contractPath =
  contractFlag >= 0
    ? args[contractFlag + 1]
    : path.resolve("..", "ob", "ob.obi.json");
const parityPath = path.resolve(
  "apps",
  "ob-start-workbench",
  "ui-parity.json",
);
const appFiles = [
  path.resolve("apps", "ob-start-workbench", "index.html"),
  path.resolve("apps", "ob-start-workbench", "src", "main.ts"),
];

function fail(message) {
  console.error(`parity-gates: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(contractPath)) {
  fail(
    `contract not found at ${contractPath} — pass --contract <path>. ` +
      "The gate never skips silently.",
  );
}
if (!fs.existsSync(parityPath)) {
  fail(`ui-parity.json not found at ${parityPath}`);
}

const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const parity = JSON.parse(fs.readFileSync(parityPath, "utf8"));
const operations = Object.keys(contract.operations ?? {});
const mapped = Object.keys(parity);
const appText = appFiles
  .filter(file => fs.existsSync(file))
  .map(file => fs.readFileSync(file, "utf8"))
  .join("\n");

const STATUSES = new Set([
  "affordance",
  "composed",
  "covered",
  "internal",
  "deferred",
  "refused",
]);

const problems = [];

for (const op of operations) {
  if (!(op in parity)) problems.push(`unmapped contract operation: ${op}`);
}
for (const op of mapped) {
  if (!operations.includes(op)) {
    problems.push(`stale mapping (not in contract): ${op}`);
    continue;
  }
  const entry = parity[op];
  if (!entry || typeof entry !== "object") {
    problems.push(`entry for ${op} is not an object`);
    continue;
  }
  if (!STATUSES.has(entry.status)) {
    problems.push(`unknown status "${entry.status}" for ${op}`);
    continue;
  }
  if (typeof entry.detail !== "string" || entry.detail.trim() === "") {
    problems.push(`missing detail for ${op} (${entry.status})`);
  }
  if (entry.status === "deferred" && typeof entry.rev !== "number") {
    problems.push(`deferred without rev for ${op} — that is a silent cap`);
  }
  if (typeof entry.selector === "string" && !appText.includes(entry.selector)) {
    problems.push(
      `selector "${entry.selector}" for ${op} no longer occurs in the app`,
    );
  }
}

const counts = {};
for (const op of mapped) {
  const status = parity[op]?.status ?? "invalid";
  counts[status] = (counts[status] ?? 0) + 1;
}

for (const problem of problems) console.error(`ERROR parity  ${problem}`);
console.log(
  `parity-gates: ${operations.length} contract operations — ` +
    Object.entries(counts)
      .sort()
      .map(([status, n]) => `${status} ${n}`)
      .join(", "),
);
if (problems.length > 0) {
  console.log(`parity-gates: RED (${problems.length} problems)`);
  process.exit(1);
}
console.log("parity-gates: GREEN");
