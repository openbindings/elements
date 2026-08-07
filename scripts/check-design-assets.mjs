import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const favicon = await readFile(
  new URL("../apps/ob-start-workbench/public/assets/favicon.svg", import.meta.url),
);
const actual = createHash("sha256").update(favicon).digest("hex");
const expected = "e8b62b7d733177ef392de94efc945453905201ea37c65eb1466314ce67760e74";

if (actual !== expected) {
  throw new Error(
    "ob-start-workbench favicon must match openbindings/design identity revision 1",
  );
}

console.log("design assets: identity revision 1 current");
