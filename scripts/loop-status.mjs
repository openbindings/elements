#!/usr/bin/env node
// loop:status — computed, not asserted. Reads the journey harness's friction
// telemetry and prints the per-reason-code scorecard. Reporting tool, not a
// gate: always exits 0.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const telemetryFile = path.join(root, "test-results", "journeys-telemetry.jsonl");
const budgetsFile = path.join(root, "tests", "journeys", "budgets.json");

const budgets = JSON.parse(fs.readFileSync(budgetsFile, "utf8"));

let records = [];
if (fs.existsSync(telemetryFile)) {
  records = fs
    .readFileSync(telemetryFile, "utf8")
    .split("\n")
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
} else {
  console.log(`No telemetry at ${path.relative(root, telemetryFile)} — run \`pnpm test:journeys\` first.\n`);
}

const codes = new Map();
for (const code of Object.keys(budgets)) {
  codes.set(code, { records: [] });
}
for (const record of records) {
  if (!codes.has(record.reasonCode)) codes.set(record.reasonCode, { records: [] });
  codes.get(record.reasonCode).records.push(record);
}

function statusOf(entryRecords) {
  if (entryRecords.length === 0) return "no data";
  const outcomes = new Set(entryRecords.map(r => r.outcome));
  if (outcomes.has("fail") || outcomes.has("error")) return "FAIL";
  if (outcomes.has("known-open")) return "known-open";
  if (outcomes.has("over-budget")) return "OVER";
  return "pass";
}

const rows = [...codes.entries()].map(([code, { records: recs }]) => {
  const budget = budgets[code] ?? {};
  const withMs = recs.filter(r => typeof r.ms === "number");
  const worst = withMs.length ? Math.max(...withMs.map(r => r.ms)) : null;
  const count = outcome => recs.filter(r => r.outcome === outcome).length;
  return {
    code,
    kind: budget.kind ?? "?",
    budget: budget.budgetMs != null ? `${budget.budgetMs}ms` : "boolean",
    worst: worst != null && budget.budgetMs != null ? `${worst}ms` : worst != null ? `${worst}ms*` : "-",
    pass: count("pass"),
    over: count("over-budget"),
    knownOpen: count("known-open"),
    fail: count("fail") + count("error"),
    status: statusOf(recs),
  };
});

const headers = ["reason code", "kind", "budget", "worst", "pass", "over", "known-open", "fail", "status"];
const table = rows.map(r => [
  r.code, r.kind, r.budget, r.worst,
  String(r.pass), String(r.over), String(r.knownOpen), String(r.fail), r.status,
]);
const widths = headers.map((h, i) => Math.max(h.length, ...table.map(row => row[i].length)));
const line = row => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");

console.log(`Journey telemetry: ${records.length} moment record(s)\n`);
console.log(line(headers));
console.log(widths.map(w => "-".repeat(w)).join("  "));
for (const row of table) console.log(line(row));
console.log(
  "\n(* elapsed ms shown for context only — this code has a boolean budget)",
);
console.log(
  "known-open = adjudicated miss recorded in telemetry, fix ships in a later rev.",
);

process.exit(0);
