import { build } from "esbuild";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  "ui-core",
  "obi-editor",
  "json-editor",
  "obi-explorer",
  "operation-detail",
  "source-detail",
  "operation-graph-model",
  "operation-graph-viewer",
  "operation-graph-editor",
  "operation-tabs",
  "operation-workbench",
  "schema-split",
];
const forbiddenSpecifiers = [
  /^node:/,
  /^(?:react|react-dom|svelte|vue)(?:\/|$)/,
  /^@openbindings\/(?:openapi|asyncapi|graphql|grpc|connect|mcp|usage|operationgraph)$/,
];

for (const packageName of packages) {
  const sourceRoot = resolve(root, "packages", packageName, "src");
  for (const file of await sourceFiles(sourceRoot)) {
    const text = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(text)) {
      if (forbiddenSpecifiers.some(pattern => pattern.test(specifier))) {
        throw new Error(
          `${file.slice(root.length + 1)} imports forbidden browser dependency ${specifier}`,
        );
      }
    }
  }

  await build({
    entryPoints: [resolve(sourceRoot, "index.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2022",
    packages: "external",
    logLevel: "silent",
  });
}

console.log(
  `browser import graph clean: ${packages.join(", ")} (no Node, framework, or binding-family imports)`,
);

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await sourceFiles(path)));
    } else if ([".ts", ".js", ".mjs"].includes(extname(entry.name))) {
      result.push(path);
    }
  }
  return result;
}

function importSpecifiers(source) {
  const result = [];
  const pattern =
    /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    result.push(match[1] ?? match[2]);
  }
  return result;
}
