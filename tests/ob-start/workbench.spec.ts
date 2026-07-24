import { expect, test } from "@playwright/test";

const browserErrors = new WeakMap<object, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test("the embedded workbench invokes ob start through its published interface", async ({
  page,
}) => {
  await page.goto("/#token=test-token");

  await expect(page.locator("#connection-status")).toHaveText(
    "Connected through OpenBindings",
  );
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  const explorer = page.locator("ob-obi-explorer");
  const detail = page.locator("ob-operation-detail");
  const workbench = page.locator("ob-operation-workbench");

  await expect(explorer.locator("h2")).not.toHaveText("No interface");
  await expect(detail.locator("h2")).toHaveText("openbindings.ob.describe");
  await expect(workbench.locator("h2")).toHaveText(
    "openbindings.ob.describe",
  );

  const run = workbench.locator("button.run");
  await expect(run).toBeEnabled();
  await run.click();

  await expect(workbench.locator("pre")).toContainText(
    '"name": "OpenBindings CLI"',
  );
  await expect(workbench.locator(".output-count")).toHaveText("1 value");
  await expect(workbench.locator(".error")).toBeHidden();
});

test("the operation dependency becomes available when session context changes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection-status")).toHaveText(
    "Connected through OpenBindings",
  );

  const workbench = page.locator("ob-operation-workbench");
  await expect(workbench.locator(".status")).toHaveText(
    "No compatible Operation Invoker is available",
  );
  await expect(workbench.locator("button.run")).toBeDisabled();

  await page.locator("#session-token").fill("test-token");
  await page.locator("#token-form button").click();

  await expect(workbench.locator(".status")).toHaveText("Ready");
  await expect(workbench.locator("button.run")).toBeEnabled();
});

test("a raw API artifact is synthesized and invoked without a browser binding-family client", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status")).toHaveText(
    "Connected through OpenBindings",
  );

  await page
    .locator("#target-url")
    .fill("http://127.0.0.1:20391/openapi.yaml");
  await page.locator("#target-form button").click();

  await expect(page.locator("#bootstrap-message")).toContainText(
    "Synthesized ob start API",
  );
  const explorer = page.locator("ob-obi-explorer");
  const workbench = page.locator("ob-operation-workbench");
  await expect(explorer.locator("h2")).toHaveText("ob start API");

  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "getOBI" })
    .click();
  await expect(workbench.locator("h2")).toHaveText("getOBI");
  await workbench.locator("button.run").click();

  await expect(workbench.locator("pre")).toContainText(
    '"openbindings": "0.2.0"',
  );
  await expect(workbench.locator(".error")).toBeHidden();
});
