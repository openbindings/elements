import { expect, test } from "@playwright/test";

const browserErrors = new WeakMap<object, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test("plain HTML composes explorer, detail, and invocation", async ({
  page,
}) => {
  const explorer = page.locator("ob-obi-explorer");
  const detail = page.locator("ob-operation-detail");
  const workbench = page.locator("ob-operation-workbench");

  await expect(explorer).toBeVisible();
  await expect(detail).toBeVisible();
  await expect(workbench).toBeVisible();

  await expect(
    explorer.locator('[part~="operation"]').filter({ hasText: "tasks.create" }),
  ).toBeVisible();
  await expect(detail.locator("h2")).toHaveText("tasks.create");
  await expect(workbench.locator(".status")).toHaveText("Ready");

  await workbench.locator(".run").click();
  await expect(workbench.locator('pre[part~="output"]')).toContainText(
    "local-result",
  );
  await expect(workbench.locator('pre[part~="output"]')).toContainText(
    "Ship reusable elements",
  );

  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "tasks.list" })
    .click();
  await expect(detail.locator("h2")).toHaveText("tasks.list");
  await expect(workbench.locator("h2")).toHaveText("tasks.list");
});

test("documented CSS variables customize elements without internal selectors", async ({
  page,
}) => {
  const explorer = page.locator("ob-obi-explorer");
  await explorer.evaluate(element => {
    (element as HTMLElement).style.setProperty(
      "--ob-color-accent",
      "rgb(180, 20, 120)",
    );
    (element as HTMLElement).style.setProperty("--ob-radius", "1.25rem");
  });

  const selected = explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "tasks.create" });
  await expect(selected).toHaveCSS("border-radius", "20px");
  await expect
    .poll(() =>
      explorer.evaluate(element =>
        getComputedStyle(element).getPropertyValue("--ob-color-accent").trim(),
      ),
    )
    .toBe("rgb(180, 20, 120)");
});

test("narrow layouts preserve independent element usability", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("ob-obi-explorer")).toBeVisible();
  await expect(page.locator("ob-operation-detail")).toBeVisible();
  await expect(page.locator("ob-operation-workbench")).toBeVisible();
  await expect(
    page
      .locator("ob-operation-workbench")
      .locator("textarea"),
  ).toBeEditable();
});

test("filtering preserves keyboard focus and uses native button semantics", async ({
  page,
}) => {
  const explorer = page.locator("ob-obi-explorer");
  const filter = explorer.locator('input[type="search"]');

  await filter.focus();
  await filter.fill("list");
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("list");
  await expect(explorer.locator('[part~="operation"]')).toHaveCount(1);
  await expect(
    explorer.locator('[part~="operation"]'),
  ).not.toHaveAttribute("aria-current", "true");

  await explorer.locator('[part~="operation"]').press("Enter");
  await expect(explorer.locator('[part~="operation"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
});
