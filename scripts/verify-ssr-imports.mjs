import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  { name: "ui-core", expected: "OperationEnvironment", define: false },
  { name: "obi-explorer", expected: "OBIExplorerElement", define: true },
  { name: "operation-detail", expected: "OperationDetailElement", define: true },
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
