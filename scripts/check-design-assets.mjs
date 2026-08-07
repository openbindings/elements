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

const workbenchTheme = await readFile(
  new URL("../apps/ob-start-workbench/src/styles.css", import.meta.url),
  "utf8",
);
const uiCoreGuide = await readFile(
  new URL("../packages/ui-core/README.md", import.meta.url),
  "utf8",
);

const requiredThemeFragments = [
  "openbindings/design@ed8a409",
  "--page-faint: #737373",
  "--page-border-strong: #8a8a8a",
  "--page-text: #e5e5e5",
  "--page-border-strong: #737373",
  "--accent-contrast: #ffffff",
  "--accent-contrast: #0a0a0a",
  "@media (forced-colors: active)",
  "--accent: Highlight",
  "--accent-contrast: HighlightText",
  "--ob-color-border: var(--page-border-strong)",
];
for (const fragment of requiredThemeFragments) {
  if (!workbenchTheme.includes(fragment)) {
    throw new Error(`ob-start-workbench theme is missing ${fragment}`);
  }
}
if (
  !uiCoreGuide.includes("tokens/generated/openbindings-theme.css") ||
  !uiCoreGuide.includes("deliberately neutral")
) {
  throw new Error(
    "ui-core must document the official adapter and neutral fallback boundary",
  );
}

console.log(
  "design assets: identity revision 1 and color-theme revision 1 current",
);
