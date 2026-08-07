import { expect, test } from "@playwright/test";

// Rev 1 perception gates: these assert what users SEE, not attributes.
// WB-VIS-01: the `hidden` attribute must actually hide an element even when
// document CSS sets `display` on the host (the app does exactly that).
// WB-THEME-01: --ob-* tokens set on an ANCESTOR must reach element internals,
// as the ui-core styles.ts doc comment promises.

test("hidden attribute hides elements despite host display overrides", async ({ page }) => {
  await page.goto("/css-contract.html");
  await page.waitForFunction(() => (window as any).fixtureReady === true);
  // App-style CSS in the fixture sets `ob-operation-workbench { display: block }`.
  const height = await page
    .locator("#hidden-workbench")
    .evaluate((el) => el.getBoundingClientRect().height);
  const display = await page
    .locator("#hidden-workbench")
    .evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe("none");
  expect(height).toBe(0);
});

test("ancestor-set --ob-* tokens reach element shadow internals", async ({ page }) => {
  await page.goto("/css-contract.html");
  await page.waitForFunction(() => (window as any).fixtureReady === true);
  // The fixture sets --ob-color-accent: rgb(255, 0, 0) on <body>.
  const runColor = await page
    .locator("#themed-workbench")
    .evaluate((el) => {
      const run = el.shadowRoot!.querySelector("button.run")!;
      return getComputedStyle(run).backgroundColor;
    });
  expect(runColor).toBe("rgb(255, 0, 0)");
  // And --ob-radius: 0 must flatten internal corners.
  const radius = await page
    .locator("#themed-workbench")
    .evaluate((el) => {
      const run = el.shadowRoot!.querySelector("button.run")!;
      return getComputedStyle(run).borderRadius;
    });
  expect(radius).toBe("0px");
});

test("element-level token override still beats ancestor and default", async ({ page }) => {
  await page.goto("/css-contract.html");
  await page.waitForFunction(() => (window as any).fixtureReady === true);
  // #override-workbench has an inline --ob-color-accent: rgb(0, 128, 0).
  const runColor = await page
    .locator("#override-workbench")
    .evaluate((el) => {
      const run = el.shadowRoot!.querySelector("button.run")!;
      return getComputedStyle(run).backgroundColor;
    });
  expect(runColor).toBe("rgb(0, 128, 0)");
});

test("standalone elements collapse motion when the user requests it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/css-contract.html");
  await page.waitForFunction(() => (window as any).fixtureReady === true);

  const duration = await page.locator("#themed-workbench").evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--_ob-duration").trim(),
  );
  expect(duration).toBe("0.01ms");
});
