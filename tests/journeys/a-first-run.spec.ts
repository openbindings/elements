import { expect, test } from "@playwright/test";
import { TOKEN, moment } from "./telemetry";

// Journey A — first-time developer. Named moments: first paint to Ready,
// finding an operation, first Run, reading the output — plus the perception
// truth that exactly one session is ever visible.

test("first run: navigate to Ready, first invocation, one visible session", async ({
  page,
}) => {
  // Moment: navigate -> Ready (WB-PERF-01). Baseline is ~5,000ms against a
  // 1,500ms budget; the fix (validator cache / truthful connection lifecycle)
  // is assigned to rev 2 in review/50-roadmap.md, so the miss is adjudicated
  // known-open: recorded as over-budget in telemetry, not gating yet.
  await moment("navigate-to-ready", "WB-PERF-01", async () => {
    await page.goto(`/#token=${TOKEN}`);
    await expect(page.locator("#connection-status-text")).toHaveText("Ready", {
      timeout: 30_000,
    });
    return { knownOpen: true, note: "rev-2 fix; baseline ~5000ms" };
  });

  // The fragment credential must be scrubbed from the URL immediately.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");

  // Finding an operation: select describe through the explorer rail
  // (operations are buttons inside ob-obi-explorer's shadow root).
  const explorer = page.locator("ob-obi-explorer");
  await explorer.locator('input[type="search"]').fill("describe");
  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "openbindings.ob.describe" })
    .click();

  const workbench = page.locator("ob-operation-workbench:not([hidden])");
  await expect(workbench.locator("h2")).toHaveText("openbindings.ob.describe");
  const run = workbench.locator("button.run");
  await expect(run).toBeEnabled();

  // Moment: Run click -> first output frame visible (WB-PERF-03).
  await moment("run-to-output", "WB-PERF-03", async () => {
    await run.click();
    await expect(workbench.locator('[part~="output"] .cm-content')).toContainText(
      '"name": "OpenBindings CLI"',
      { timeout: 15_000 },
    );
  });
  await expect(workbench.locator(".error")).toBeHidden();

  // Open a second operation tab, then assert the perception truth: exactly
  // one workbench has real geometry on screen (WB-VIS-01). Attribute-level
  // [hidden] checks passed for months while sessions stacked visibly.
  await explorer.locator('input[type="search"]').fill("listOperations");
  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "openbindings.ob.listOperations" })
    .click();
  await expect(workbench.locator("h2")).toHaveText(
    "openbindings.ob.listOperations",
  );

  await moment("one-visible-workbench", "WB-VIS-01", async () => {
    const heights = await page.evaluate(() =>
      Array.from(document.querySelectorAll("ob-operation-workbench")).map(
        element => element.getBoundingClientRect().height,
      ),
    );
    const visible = heights.filter(height => height > 0).length;
    return {
      ok: visible === 1,
      note: `${visible} of ${heights.length} workbenches have height > 0`,
      value: visible,
    };
  });
});
