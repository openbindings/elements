import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  { name: "ui-core", expected: "OperationEnvironment", define: false },
  { name: "obi-editor", expected: "OBIEditorElement", define: true },
  { name: "obi-explorer", expected: "OBIExplorerElement", define: true },
  { name: "operation-detail", expected: "OperationDetailElement", define: true },
  { name: "source-detail", expected: "SourceDetailElement", define: true },
  { name: "schema-split", expected: "SchemaSplitElement", define: true },
  {
    name: "operation-graph-model",
    expected: "layoutOperationGraph",
    define: false,
  },
  {
    name: "operation-graph-viewer",
    expected: "OperationGraphViewerElement",
    define: true,
  },
  {
    name: "operation-graph-editor",
    expected: "OperationGraphEditorElement",
    define: true,
  },
  { name: "json-editor", expected: "JSONEditorElement", define: true },
  { name: "operation-tabs", expected: "OperationTabsElement", define: true },
  {
    name: "operation-workbench",
    expected: "OperationWorkbenchElement",
    define: true,
  },
];

if ("HTMLElement" in globalThis || "customElements" in globalThis) {
  throw new Error("SSR import proof must run without browser DOM globals");
}

for (const entry of packages) {
  const dist = resolve(root, "packages", entry.name, "dist");
  const module = await import(pathToFileURL(resolve(dist, "index.js")));
  if (!(entry.expected in module)) {
    throw new Error(`${entry.name} does not export ${entry.expected}`);
  }
  if (entry.define) {
    await import(pathToFileURL(resolve(dist, "define.js")));
  }
}

console.log(
  `SSR imports are inert without DOM globals: ${packages
    .map(entry => entry.name)
    .join(", ")}`,
);
