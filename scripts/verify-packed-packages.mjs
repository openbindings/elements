import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
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
];
const packagesWithoutDefine = new Set(["ui-core", "operation-graph-model"]);
const temporary = await mkdtemp(resolve(tmpdir(), "openbindings-elements-pack-"));
const tarballs = resolve(temporary, "tarballs");
await mkdir(tarballs);

try {
  for (const packageName of packages) {
    const packageRoot = resolve(root, "packages", packageName);
    execFileSync(
      "pnpm",
      ["pack", "--pack-destination", tarballs],
      { cwd: packageRoot, stdio: "pipe" },
    );

    const manifest = JSON.parse(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
    );
    const expected = [
      "package/package.json",
      "package/README.md",
      "package/LICENSE",
      "package/dist/index.js",
      "package/dist/index.d.ts",
    ];
    if (!packagesWithoutDefine.has(packageName)) {
      expected.push("package/dist/define.js", "package/dist/define.d.ts");
    }

    const tarball = resolve(
      tarballs,
      `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`,
    );
    const entries = execFileSync("tar", ["-tzf", tarball], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    for (const file of expected) {
      if (!entries.includes(file)) {
        throw new Error(`${basename(tarball)} is missing ${file}`);
      }
    }

    const packedManifest = JSON.parse(
      execFileSync("tar", ["-xOzf", tarball, "package/package.json"], {
        encoding: "utf8",
      }),
    );
    const dependencyText = JSON.stringify({
      dependencies: packedManifest.dependencies,
      peerDependencies: packedManifest.peerDependencies,
    });
    if (dependencyText.includes("workspace:") || dependencyText.includes("link:")) {
      throw new Error(`${basename(tarball)} contains a workspace-local dependency`);
    }
  }

  console.log(`packed package surfaces verified: ${packages.join(", ")}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
