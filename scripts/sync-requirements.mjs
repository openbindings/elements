import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const copies = [
  {
    source: resolve(root, "../interfaces/operation-invoker/0.1.json"),
    target: resolve(
      root,
      "packages/operation-workbench/src/requirements/operation-invoker.json",
    ),
  },
];

for (const copy of copies) {
  const raw = await readFile(copy.source, "utf8");
  const canonical = `${JSON.stringify(JSON.parse(raw), null, 2)}\n`;
  await mkdir(dirname(copy.target), { recursive: true });
  await writeFile(copy.target, canonical);
  console.log(
    `synced ${relative(root, copy.source)} -> ${relative(root, copy.target)}`,
  );
}

const license = await readFile(resolve(root, "../openbindings-ts/LICENSE"), "utf8");
await writeFile(
  resolve(root, "LICENSE"),
  license.endsWith("\n") ? license : `${license}\n`,
);
for (const packageName of [
  "ui-core",
  "obi-explorer",
  "operation-detail",
  "operation-workbench",
]) {
  await writeFile(
    resolve(root, "packages", packageName, "LICENSE"),
    license.endsWith("\n") ? license : `${license}\n`,
  );
}
console.log("synced Apache-2.0 license into the repository and packages");
