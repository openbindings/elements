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
const uiCoreStyles = await readFile(
  new URL("../packages/ui-core/src/styles.ts", import.meta.url),
  "utf8",
);
const editorSource = await readFile(
  new URL("../packages/json-editor/src/index.ts", import.meta.url),
  "utf8",
);
const codeBlockSource = await readFile(
  new URL("../packages/json-editor/src/highlight.ts", import.meta.url),
  "utf8",
);

const requiredThemeFragments = [
  "color-theme revision 1 at ed8a409",
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
  "machine-material revision 1 at",
  "dc46aff",
  "foundations revision 1 at 3ef2505",
  "zero-radius embedded content planes",
  "--ob-machine-color-primary: #2456c4",
  "--ob-machine-color-primary: #8fb4ff",
  "--ob-editor-token-key: var(--ob-machine-role-name)",
  "--ob-editor-token-invalid: var(--ob-machine-role-invalid)",
  "--ob-machine-role-comment: GrayText",
];
for (const fragment of requiredThemeFragments) {
  if (!workbenchTheme.includes(fragment)) {
    throw new Error(`ob-start-workbench theme is missing ${fragment}`);
  }
}
if (
  !uiCoreGuide.includes("tokens/generated/openbindings-theme.css") ||
  !uiCoreGuide.includes("tokens/generated/openbindings-foundations.css") ||
  !uiCoreGuide.includes("tokens/generated/openbindings-machine-material.css") ||
  !uiCoreGuide.includes("deliberately neutral") ||
  !uiCoreGuide.includes("openbindings/design@3ef2505") ||
  !uiCoreGuide.includes("openbindings/design@dc46aff")
) {
  throw new Error(
    "ui-core must document the official adapter and neutral fallback boundary",
  );
}

for (const reducedMotionFragment of [
  "@media (prefers-reduced-motion: reduce)",
  "--_ob-duration: 0.01ms",
  "public --ob-duration contract",
]) {
  if (!uiCoreStyles.includes(reducedMotionFragment)) {
    throw new Error(
      `ui-core reduced-motion contract changed: ${reducedMotionFragment}`,
    );
  }
}

for (const neutralToken of [
  "--_ob-editor-token-key: var(--ob-editor-token-key, #1a4fd6)",
  "--_ob-editor-token-string: var(--ob-editor-token-string, #0b7a52)",
  "--_ob-editor-token-invalid: var(--ob-editor-token-invalid, var(--_ob-color-danger))",
]) {
  if (!uiCoreStyles.includes(neutralToken)) {
    throw new Error(
      `ui-core neutral machine-material contract changed: ${neutralToken}`,
    );
  }
}

if (
  !editorSource.includes('textDecoration: "underline wavy"') ||
  !codeBlockSource.includes("text-decoration: underline wavy")
) {
  throw new Error("invalid machine material must retain a non-color cue");
}

console.log(
  "design assets: identity, color-theme, foundations, and machine-material revision 1 current",
);
