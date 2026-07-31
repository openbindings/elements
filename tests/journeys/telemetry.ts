import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Friction-telemetry helper for the journey harness (development loop,
// station 1a). Every named moment appends one JSONL record to the run-scoped
// telemetry file, which scripts/loop-status.mjs aggregates into the scorecard.

export const TOKEN = process.env.OB_JOURNEY_TOKEN ?? "journey-token";

export const TELEMETRY_FILE = path.resolve(
  process.cwd(),
  "test-results",
  "journeys-telemetry.jsonl",
);

interface Budget {
  kind: "perf" | "honesty" | "perception" | "keyboard";
  budgetMs?: number;
  description?: string;
}

const budgets: Record<string, Budget> = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "tests", "journeys", "budgets.json"),
    "utf8",
  ),
);

export interface MomentCheck {
  /** Truth check result; defaults to true (the moment only measures latency). */
  ok?: boolean;
  /**
   * The defect is adjudicated and ships in a later rev: a miss is recorded as
   * outcome "known-open" and never fails the suite.
   */
  knownOpen?: boolean;
  /** A miss records + expect.soft-fails instead of hard-failing. */
  soft?: boolean;
  note?: string;
  /** Arbitrary passthrough for the caller. */
  value?: unknown;
}

export interface MomentRecord {
  instrument: "journey-harness";
  journey: string;
  moment: string;
  reasonCode: string;
  outcome: "pass" | "over-budget" | "known-open" | "fail" | "error";
  ms: number;
  budgetMs: number | null;
  note?: string;
  value?: unknown;
}

function journeyFromFile(file: string): string {
  const match = /([a-z])-[^/\\]*\.spec\.ts$/.exec(file);
  return match ? match[1].toUpperCase() : "?";
}

function append(record: MomentRecord): void {
  fs.mkdirSync(path.dirname(TELEMETRY_FILE), { recursive: true });
  const { value: _value, ...persisted } = record;
  fs.appendFileSync(TELEMETRY_FILE, `${JSON.stringify(persisted)}\n`);
}

/**
 * Run `fn` as a named moment: time it, judge it against the budget for
 * `reasonCode`, append a telemetry record, and enforce the outcome
 * (perf misses soft-fail; honesty/perception misses hard-fail unless the
 * check is marked knownOpen or soft).
 */
export async function moment(
  name: string,
  reasonCode: string,
  fn: () => Promise<MomentCheck | boolean | void>,
): Promise<MomentRecord> {
  const info = test.info();
  const journey = journeyFromFile(info.file);
  const budget = budgets[reasonCode];
  const budgetMs = budget?.budgetMs ?? null;
  const started = performance.now();
  let raw: MomentCheck | boolean | void;
  try {
    raw = await fn();
  } catch (error) {
    append({
      instrument: "journey-harness",
      journey,
      moment: name,
      reasonCode,
      outcome: "error",
      ms: Math.round(performance.now() - started),
      budgetMs,
      note: error instanceof Error ? error.message.slice(0, 200) : String(error),
    });
    throw error;
  }
  const ms = Math.round(performance.now() - started);
  const check: MomentCheck =
    raw === undefined ? {} : typeof raw === "boolean" ? { ok: raw } : raw;
  const ok = check.ok !== false;

  let outcome: MomentRecord["outcome"];
  if (!ok) outcome = check.knownOpen ? "known-open" : "fail";
  else if (budgetMs !== null && ms > budgetMs) outcome = "over-budget";
  else outcome = "pass";

  const record: MomentRecord = {
    instrument: "journey-harness",
    journey,
    moment: name,
    reasonCode,
    outcome,
    ms,
    budgetMs,
    ...(check.note ? { note: check.note } : {}),
    value: check.value,
  };
  append(record);

  const label = `${reasonCode} ${name}` + (check.note ? ` (${check.note})` : "");
  if (outcome === "over-budget" && budget?.kind === "perf") {
    if (check.knownOpen) {
      // Adjudicated miss (fix assigned to a later rev): the over-budget
      // outcome is still recorded above; the gate is an annotation, not a
      // failure, until that rev lands.
      info.annotations.push({
        type: "known-open",
        description: `${label}: ${ms}ms exceeds budget ${budgetMs}ms`,
      });
    } else {
      expect.soft(ms, `${label}: ${ms}ms exceeds budget ${budgetMs}ms`).toBeLessThanOrEqual(
        budgetMs as number,
      );
    }
  } else if (outcome === "known-open") {
    info.annotations.push({ type: "known-open", description: label });
  } else if (outcome === "fail") {
    if (check.soft) expect.soft(false, `${label}: truth check failed`).toBe(true);
    else expect(false, `${label}: truth check failed`).toBe(true);
  }
  return record;
}

/**
 * Path of shadow-piercing active elements, outermost first, each entry like
 * "ob-operation-tabs" or "button#run[role=tab]". Perception-level focus truth.
 */
export async function deepActivePath(page: {
  evaluate: <R>(fn: () => R) => Promise<R>;
}): Promise<string[]> {
  return page.evaluate(() => {
    const describe = (el: Element): string => {
      const role = el.getAttribute("role");
      return (
        el.tagName.toLowerCase() +
        (el.id ? `#${el.id}` : "") +
        (role ? `[role=${role}]` : "")
      );
    };
    const path: string[] = [];
    let el: Element | null = document.activeElement;
    while (el) {
      path.push(describe(el));
      const inner = el.shadowRoot?.activeElement ?? null;
      if (!inner || inner === el) break;
      el = inner;
    }
    return path;
  });
}
