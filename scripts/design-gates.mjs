#!/usr/bin/env node
/**
 * Mechanical design gates — static half (review/90-design-loop.md, JUDGE
 * station 1). Scans the CSS template literals inside packages/*\/src\/**\/*.ts
 * for:
 *
 *  1. Raw color literals (#hex, rgb(, rgba(, hsl(, hsla(, color() outside the
 *     token definition file (packages/ui-core/src/styles.ts) and outside
 *     var(--ob-...) fallback values, which ARE the token defaults
 *     (`--_ob-x: var(--ob-x, <literal>)` is the sanctioned pattern).
 *     These are ERRORS: exit 1.
 *  2. transition/animation durations written as literals instead of a var()
 *     motion token (`--ob-duration` landed in ui-core). `0s`/`0ms` are
 *     allowed. These are ERRORS: exit 1.
 *
 * Flags:
 *   --warn-only   downgrade everything (colors and durations) to warnings; exit 0.
 *
 * The browser half (computed-style contrast and focus probes) lives in
 * tests/gallery/gallery-gates.spec.ts and runs with `pnpm gallery`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGES_DIR = path.join(ROOT, "packages");
const TOKEN_DEFINITION_FILE = path.join(ROOT, "packages", "ui-core", "src", "styles.ts");

const warnOnly = process.argv.includes("--warn-only");

/** Recursively collects .ts sources under every packages/<name>/src. */
function collectSources() {
  const files = [];
  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const src = path.join(PACKAGES_DIR, pkg, "src");
    let stats;
    try {
      stats = statSync(src);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(src);
  }
  return files.sort();
}

/**
 * Extracts template literals with their source offsets. Comments and
 * quoted strings are skipped so selector strings like "#add-node-form" and
 * HTML entities like "&#039;" never reach the color scanner.
 */
function extractTemplates(source) {
  const templates = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && source[j] !== ch && source[j] !== "\n") {
        if (source[j] === "\\") j += 1;
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === "`") {
      const start = i + 1;
      let j = start;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === "`") break;
        if (source[j] === "$" && source[j + 1] === "{") {
          j = skipExpression(source, j + 2);
          continue;
        }
        j += 1;
      }
      templates.push({ start, text: source.slice(start, j) });
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return templates;
}

/** Skips a ${...} expression (handles nested braces and quoted strings). */
function skipExpression(source, from) {
  let depth = 1;
  let i = from;
  const n = source.length;
  while (i < n && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && source[j] !== ch) {
        if (source[j] === "\\") j += 1;
        j += 1;
      }
      i = j;
    }
    i += 1;
  }
  return i;
}

/** A template is "CSS content" when it holds property declarations. */
function looksLikeCSS(text) {
  return /[{;]\s*(?:--)?[a-zA-Z-]+\s*:\s*[^;{}]+;/.test(text);
}

/**
 * Spans inside `var(--ob-...)` / `var(--_ob-...)` groups: literals there are
 * the token defaults and are allowed. Paren-matched so nested functions
 * (color-mix inside a fallback) stay inside the allowed span.
 */
function allowedFallbackSpans(text) {
  const spans = [];
  const re = /var\(\s*--_?ob-/g;
  let match;
  while ((match = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") depth -= 1;
      i += 1;
    }
    spans.push([match.index, i]);
  }
  return spans;
}

const COLOR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|(?<![\w-])(?:rgb|rgba|hsl|hsla|color)\(/g;

const DECLARATION_RE =
  /(?:^|[{;])\s*(transition|animation|transition-duration|animation-duration)\s*:\s*([^;{}]*)/g;

const TIME_RE = /(?<![\w.-])(\d+(?:\.\d+)?)(ms|s)(?![\w-])/g;

function lineOffsets(source) {
  const offsets = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function lineOf(offsets, index) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (offsets[mid] <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function snippetAround(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  let end = text.indexOf("\n", index);
  if (end < 0) end = text.length;
  return text.slice(start, end).trim().slice(0, 120);
}

const colorViolations = [];
const durationFindings = [];

for (const file of collectSources()) {
  if (path.resolve(file) === TOKEN_DEFINITION_FILE) continue;
  const source = readFileSync(file, "utf8");
  const offsets = lineOffsets(source);
  const relative = path.relative(ROOT, file);
  for (const template of extractTemplates(source)) {
    if (!looksLikeCSS(template.text)) continue;
    const allowed = allowedFallbackSpans(template.text);
    const isAllowed = index =>
      allowed.some(([from, to]) => index >= from && index < to);

    COLOR_RE.lastIndex = 0;
    let match;
    while ((match = COLOR_RE.exec(template.text))) {
      if (isAllowed(match.index)) continue;
      colorViolations.push({
        file: relative,
        line: lineOf(offsets, template.start + match.index),
        token: match[0],
        snippet: snippetAround(template.text, match.index),
      });
    }

    DECLARATION_RE.lastIndex = 0;
    let declaration;
    while ((declaration = DECLARATION_RE.exec(template.text))) {
      const value = declaration[2];
      if (value.includes("var(")) continue;
      const propertyOffset =
        declaration.index + declaration[0].indexOf(declaration[1]);
      const valueOffset =
        declaration.index + declaration[0].length - value.length;
      TIME_RE.lastIndex = 0;
      let time;
      while ((time = TIME_RE.exec(value))) {
        if (Number.parseFloat(time[1]) === 0) continue;
        durationFindings.push({
          file: relative,
          line: lineOf(offsets, template.start + valueOffset + time.index),
          token: time[0],
          snippet: snippetAround(template.text, propertyOffset),
        });
      }
    }
  }
}

for (const violation of colorViolations) {
  console.log(
    `${warnOnly ? "WARN " : "ERROR"} color    ${violation.file}:${violation.line}  ` +
      `raw color literal "${violation.token}" outside token definitions — ${violation.snippet}`,
  );
}
for (const finding of durationFindings) {
  console.log(
    `${warnOnly ? "WARN " : "ERROR"} duration ${finding.file}:${finding.line}  ` +
      `literal duration "${finding.token}" without a motion var() — ${finding.snippet}`,
  );
}

const colorCount = colorViolations.length;
const durationCount = durationFindings.length;
console.log(
  `design-gates: ${colorCount} color violation${colorCount === 1 ? "" : "s"}, ` +
    `${durationCount} duration violation${durationCount === 1 ? "" : "s"} ` +
    `(token file and var(--ob-*) fallbacks exempt)`,
);

const failed = !warnOnly && (colorCount > 0 || durationCount > 0);
if (failed) {
  console.log("design-gates: RED");
  process.exit(1);
}
console.log(
  warnOnly && (colorCount > 0 || durationCount > 0)
    ? "design-gates: GREEN (warn-only)"
    : "design-gates: GREEN",
);
