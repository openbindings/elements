import { expect, test } from "@playwright/test";
import { TOKEN, deepActivePath, moment } from "./telemetry";

// Journey E — keyboard subset: the rail gutter is operable with arrows, the
// tab strip is reachable by Tab alone, and reaching past it does not cost
// more stops than tabs (+ a little chrome). Focus truths are perception-level
// (shadow-piercing activeElement), never attribute checks.

test.beforeEach(async ({ page }) => {
  await page.goto(`/#token=${TOKEN}`);
  await expect(page.locator("#connection-status-text")).toHaveText("Ready", {
    timeout: 30_000,
  });
});

test("rail gutter: focus + ArrowRight changes aria-valuenow", async ({
  page,
}) => {
  const gutter = page.locator("#rail-gutter");
  await expect(gutter).toHaveAttribute("role", "separator");
  const before = await gutter.getAttribute("aria-valuenow");
  await gutter.focus();
  await gutter.press("ArrowRight");
  const after = await gutter.getAttribute("aria-valuenow");
  await moment("rail-gutter-arrow-resize", "WB-KEY-01", async () => ({
    ok: after !== null && after !== before,
    note: `aria-valuenow ${before} -> ${after}`,
  }));
  expect(after).not.toBe(before);
});

test("tab strip: reachable by Tab, stops within tab count + 2 chrome stops", async ({
  page,
}) => {
  // Open two more operation sessions so the strip holds three tabs.
  const explorer = page.locator("ob-obi-explorer");
  const tabs = page.locator("ob-operation-tabs");
  for (const name of ["listOperations", "listBindingSpecs"]) {
    await explorer.locator('input[type="search"]').fill(name);
    await explorer
      .locator('[part~="operation"]')
      .filter({ hasText: `openbindings.ob.${name}` })
      .click();
  }
  const tabCount = await tabs.locator('[role="tab"]').count();
  expect(tabCount).toBe(3);

  // Walk the page with Tab from the top until focus enters the strip.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
  });
  const maxStops = 80;
  let stopsToStrip = -1;
  for (let stop = 1; stop <= maxStops; stop += 1) {
    await page.keyboard.press("Tab");
    const path = await deepActivePath(page);
    if (path.some(entry => entry.startsWith("ob-operation-tabs"))) {
      stopsToStrip = stop;
      break;
    }
  }
  await moment("tab-strip-reachable", "WB-KEY-01", async () => ({
    ok: stopsToStrip > 0,
    note:
      stopsToStrip > 0
        ? `strip reached after ${stopsToStrip} Tab stops`
        : `strip not reached within ${maxStops} Tab stops`,
  }));
  expect(stopsToStrip, "tab strip must be reachable by Tab").toBeGreaterThan(0);

  // Count how many consecutive Tab stops stay inside the strip (including
  // the entry stop). A roving-tabindex strip costs 1; budget is
  // tab count + <=2 chrome stops (soft — recorded as WB-KEY-01).
  let stopsInStrip = 1;
  for (let stop = 0; stop < tabCount + 6; stop += 1) {
    await page.keyboard.press("Tab");
    const path = await deepActivePath(page);
    if (path.some(entry => entry.startsWith("ob-operation-tabs"))) {
      stopsInStrip += 1;
    } else {
      break;
    }
  }
  await moment("tab-strip-stop-budget", "WB-KEY-01", async () => ({
    ok: stopsInStrip <= tabCount + 2,
    soft: true,
    note: `${stopsInStrip} Tab stops inside the strip for ${tabCount} tabs (budget ${tabCount + 2})`,
  }));
});
