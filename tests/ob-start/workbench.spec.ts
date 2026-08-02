import { expect, test } from "@playwright/test";

const browserErrors = new WeakMap<object, string[]>();

// Rev 14 (review/100): acquisition is an action inside the Open flow, not a
// header identity. Every URL ingest in this suite goes through the dialog.
async function openTargetUrl(
  page: import("@playwright/test").Page,
  address: string,
): Promise<void> {
  await page.locator("#doc-open").click();
  await page.locator("#open-url").fill(address);
  await page.locator("#ingest-url-submit").click();
}

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

  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("openbindings.ob-start.session-token.v1"),
      ),
    )
    .toBe("test-token");
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .every(entry => !entry.name.includes("test-token")),
    ),
  ).toBe(true);
  await expect(page.locator("#connection-panel")).toBeHidden();
  await expect(page.locator("#document-name")).toHaveText("ob");
  const explorer = page.locator("ob-obi-explorer");
  const detail = page.locator("ob-operation-detail");
  const workbench = page.locator("ob-operation-workbench:not([hidden])");

  await expect(explorer.locator("h2")).not.toHaveText("No interface");
  await expect(explorer.locator(".description-toggle")).toHaveText("Show more");
  expect(
    await explorer
      .locator(".description")
      .evaluate(element => getComputedStyle(element).webkitLineClamp),
  ).toBe("4");
  await expect(detail.locator("h2")).toHaveText("openbindings.ob.describe");
  await expect(workbench.locator("h2")).toHaveText(
    "openbindings.ob.describe",
  );
  expect(
    await workbench
      .locator(".sr-only")
      .evaluate(element => getComputedStyle(element).position),
  ).toBe("absolute");

  const run = workbench.locator("button.run");
  await expect(run).toBeEnabled();
  await run.click();

  await expect(workbench.locator('pre[part~="output"]')).toContainText(
    '"name": "OpenBindings CLI"',
  );
  await expect(workbench.locator(".output-count")).toHaveText("1 value");
  await expect(workbench.locator(".error")).toBeHidden();

  // The fragment credential is retained only for this browser tab, so a
  // refresh remains seamless without putting the token back in the URL.
  await page.reload();
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await expect(
    page
      .locator("ob-operation-workbench:not([hidden])")
      .locator("button.run"),
  ).toBeEnabled();
});

test("the operation dependency becomes available when session context changes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection-status-text")).toHaveText(
    "Session credential needed",
  );

  const workbench = page.locator("ob-operation-workbench:not([hidden])");
  await expect(workbench.locator(".status")).toHaveText(
    "No compatible Operation Invoker is available",
  );
  await expect(workbench.locator("button.run")).toBeDisabled();

  await expect(page.locator("#connection-panel")).toBeHidden();
  await page.locator("#connection-toggle").click();
  await expect(page.locator("#connection-panel")).toBeVisible();
  await page.locator("#session-token").fill("test-token");
  await page.locator('#token-form button[type="submit"]').click();

  await expect(page.locator("#session-badge")).toHaveText("Connected");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect(workbench.locator(".status")).toHaveText("Ready");
  await expect(workbench.locator("button.run")).toBeEnabled();
});

test("a rejected session token is reported honestly instead of claiming Ready", async ({
  page,
}) => {
  await page.goto("/#token=wrong-token");

  // Ready must mean "an authenticated call succeeded", never "a token
  // exists". A wrong token has to surface as a rejection.
  await expect(page.locator("#connection-status-text")).toHaveText(
    "Credential rejected",
  );
  await expect(page.locator("#connection-status-text")).not.toHaveText(
    "Ready",
  );
  await expect(page.locator("#connection-panel")).toBeVisible();
  await expect(page.locator("#session-status")).toContainText(
    "Credential rejected",
  );
  await expect(page.locator("#session-badge")).not.toHaveText("Connected");

  // The verification probe's 401 response is the expected outcome under
  // test, not an application defect; drop only that resource error before
  // the shared afterEach console assertion runs.
  const errors = browserErrors.get(page) ?? [];
  errors.splice(
    0,
    errors.length,
    ...errors.filter(text => !/status of 401/i.test(text)),
  );
});

test("the workbench layout is adjustable, accessible, and persistent", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  await expect(
    page
      .locator("ob-operation-tabs")
      .locator('[role="tab"][aria-selected="true"]'),
  ).toContainText("openbindings.ob.describe");

  const grid = page.locator(".workbench-grid");
  const railGutter = page.locator("#rail-gutter");
  const sourceGutter = page.locator("#source-gutter");
  await railGutter.focus();
  await railGutter.press("ArrowRight");
  await expect(railGutter).toHaveAttribute("aria-valuenow", "376");
  expect(
    await grid.evaluate(element =>
      element.style.getPropertyValue("--rail-width"),
    ),
  ).toBe("376px");

  await sourceGutter.focus();
  await sourceGutter.press("ArrowLeft");
  await expect(sourceGutter).toHaveAttribute("aria-valuenow", "444");

  await page.locator(".layout-menu summary").click();
  await page.locator("#show-detail").uncheck();
  await expect(page.locator("ob-operation-detail")).toBeHidden();
  await page.locator("#show-invocation").uncheck();
  await expect(page.locator(".operation-column")).toBeHidden();
  await expect(page.locator("ob-obi-explorer")).toBeVisible();

  await page.locator("#reset-layout").click();
  await expect(page.locator("ob-operation-detail")).toBeVisible();
  await expect(
    page.locator("ob-operation-workbench:not([hidden])"),
  ).toBeVisible();
  await expect(railGutter).toHaveAttribute("aria-valuenow", "352");
  await expect(sourceGutter).toHaveAttribute("aria-valuenow", "420");

  await railGutter.press("ArrowRight");
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-dark", "");
  await page.reload();
  await expect(railGutter).toHaveAttribute("aria-valuenow", "376");
  await expect(page.locator("#theme-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the exec split is adjustable from the session gutter and persists", async ({
  page,
}) => {
  // Wide enough that the invocation area clears the element's 36rem
  // narrow-fallback threshold and actually renders the split cockpit.
  await page.setViewportSize({ width: 1760, height: 900 });
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  // Pick an operation WITH an input schema so the input editor renders —
  // the default describe session declares no input and hides it.
  await page
    .locator('ob-obi-explorer [part~="operation"]')
    .filter({ hasText: "validateInterface" })
    .click();
  const workbench = page.locator("ob-operation-workbench:not([hidden])");
  await expect(workbench.locator("h2")).toHaveText(
    "openbindings.ob.validateInterface",
  );
  const gutter = workbench.locator('[part~="layout-gutter"]');
  await expect(gutter).toHaveAttribute("role", "separator");
  const before = await gutter.getAttribute("aria-valuenow");
  await gutter.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const after = await gutter.getAttribute("aria-valuenow");
  expect(Number(after)).toBeLessThan(Number(before));
  // Input and output render side by side in split mode.
  const boxes = await workbench.evaluate(el => {
    const root = el.shadowRoot!;
    const input = root.querySelector("ob-json-editor")!.getBoundingClientRect();
    const output = root.querySelector('[part~="output-view"]')!.getBoundingClientRect();
    return {
      inputRight: input.right,
      outputLeft: output.left,
      // Columns overlap vertically when they share a row.
      overlapY: Math.min(input.bottom, output.bottom) - Math.max(input.top, output.top),
    };
  });
  expect(boxes.outputLeft).toBeGreaterThanOrEqual(boxes.inputRight - 1);
  expect(boxes.overlapY).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  const restored = page
    .locator("ob-operation-workbench:not([hidden])")
    .locator('[part~="layout-gutter"]');
  await expect(restored).toHaveAttribute("aria-valuenow", String(after));
});

test("document, source, and graph elements compose through explicit local drafts", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  const editor = page.locator("ob-obi-editor");
  const textarea = editor.locator("textarea");
  const source = await textarea.inputValue();
  const draft = JSON.parse(source) as {
    operations: Record<string, unknown>;
    sources?: Record<string, unknown>;
    bindings?: Record<string, unknown>;
  };
  draft.operations.graphDemo = {
    description: "A locally authored operation graph",
  };
  draft.sources = {
    ...(draft.sources ?? {}),
    graphSource: {
      bindingSpec: "openbindings.operation-graph@1",
      content: {
        "openbindings.operation-graph": "0.2.0",
        nodes: {
          in: { type: "input" },
          describe: {
            type: "operation",
            operation: "openbindings.ob.describe",
          },
          out: { type: "output" },
        },
        edges: [
          { from: "in", to: "describe" },
          { from: "describe", to: "out" },
        ],
      },
    },
  };
  draft.bindings = {
    ...(draft.bindings ?? {}),
    "graphDemo.graph": {
      operation: "graphDemo",
      source: "graphSource",
      ref: "#",
    },
  };
  await textarea.evaluate(
    (element, value) => {
      const input = element as HTMLTextAreaElement;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    `${JSON.stringify(draft, null, 2)}\n`,
  );
  await expect(page.locator("#apply-interface-draft")).toBeEnabled();
  await page.locator("#apply-interface-draft").click();
  await expect(page.locator("#document-dirty")).toBeVisible();

  const explorer = page.locator("ob-obi-explorer");
  await explorer.locator('input[type="search"]').fill("graphDemo");
  await explorer.locator('[part~="operation"]').click();
  await page.locator("#show-graph-pane").click();

  const graphViewer = page.locator(
    "#graph-pane > ob-operation-graph-viewer",
  );
  await expect(graphViewer.locator("[data-node-key]")).toHaveCount(3);
  await expect(page.locator("#graph-status")).toContainText(
    "graphDemo.graph",
  );

  await page.locator("#toggle-graph-edit").click();
  const graphEditor = page.locator("ob-operation-graph-editor");
  await graphEditor.locator('#add-node-form input[name="nodeKey"]').fill(
    "audit",
  );
  await graphEditor
    .locator('#add-node-form select[name="type"]')
    .selectOption("combine");
  await graphEditor.locator('#add-node-form button[type="submit"]').click();
  await expect(page.locator("#graph-status")).toContainText(
    "unapplied local changes",
  );
  await expect(page.locator("#apply-graph-draft")).toBeVisible();
  await page.locator("#apply-graph-draft").click();
  await expect(graphViewer.locator("[data-node-key]")).toHaveCount(4);
  await expect(page.locator("#bootstrap-message")).toContainText(
    "No source file was saved",
  );

  await page.locator("#show-sources-pane").click();
  const sources = page.locator("ob-interface-sources");
  await sources
    .locator('[part~="source"]')
    .filter({ hasText: "graphSource" })
    .click();
  await expect(sources.locator('[part~="binding"]')).toContainText(
    "graphDemo.graph",
  );
  await sources.locator("[data-binding-remove]").click();
  await expect(page.locator("#confirmation-dialog")).toBeVisible();
  await page.locator("#confirmation-accept").click();
  await sources
    .locator('[part~="source"]')
    .filter({ hasText: "graphSource" })
    .click();
  await expect(sources.locator('[part~="binding"]')).toHaveCount(0);
});

test("operation tabs retain independent invocation sessions, reorder, close, and restore", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  const explorer = page.locator("ob-obi-explorer");
  const tabs = page.locator("ob-operation-tabs");

  await explorer.locator('input[type="search"]').fill("listBindingSpecs");
  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "openbindings.ob.listBindingSpecs" })
    .click();
  const activeWorkbench = page.locator(
    'ob-operation-workbench:not([hidden])',
  );
  await expect(activeWorkbench.locator("h2")).toHaveText(
    "openbindings.ob.listBindingSpecs",
  );
  await activeWorkbench.locator("button.run").click();
  await expect(activeWorkbench.locator('pre[part~="output"]')).toContainText(
    "openbindings.openapi@1",
  );

  await explorer.locator('input[type="search"]').fill("listOperations");
  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "openbindings.ob.listOperations" })
    .click();
  await expect(tabs.locator('[role="tab"]')).toHaveCount(3);
  await expect(activeWorkbench.locator("h2")).toHaveText(
    "openbindings.ob.listOperations",
  );

  await tabs
    .locator('[role="tab"]')
    .filter({ hasText: "openbindings.ob.listBindingSpecs" })
    .click();
  await expect(activeWorkbench.locator('pre[part~="output"]')).toContainText(
    "openbindings.openapi@1",
  );

  const activeTab = tabs.locator('[role="tab"][aria-selected="true"]');
  await activeTab.press("Alt+ArrowLeft");
  const labels = await tabs.locator('[role="tab"] .label').allTextContents();
  expect(labels).toEqual([
    "openbindings.ob.listBindingSpecs",
    "openbindings.ob.describe",
    "openbindings.ob.listOperations",
  ]);

  await activeTab.press("Delete");
  await expect(tabs.locator('[role="tab"]')).toHaveCount(2);
  await expect(
    tabs.locator('[role="tab"][aria-selected="true"]'),
  ).toContainText("openbindings.ob.describe");

  await page.reload();
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect(tabs.locator('[role="tab"]')).toHaveCount(2);
  await expect(
    tabs.locator('[role="tab"][aria-selected="true"]'),
  ).toContainText("openbindings.ob.describe");
});

test("a raw API artifact is synthesized and invoked without a browser binding-family client", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  await openTargetUrl(page, "http://127.0.0.1:20391/openapi.yaml");

  await expect(page.locator("#bootstrap-message")).toContainText(
    "Synthesized ob start API",
    { timeout: 15_000 },
  );
  const explorer = page.locator("ob-obi-explorer");
  const workbench = page.locator("ob-operation-workbench:not([hidden])");
  await expect(explorer.locator("h2")).toHaveText("ob start API");

  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "getOBI" })
    .click();
  await expect(workbench.locator("h2")).toHaveText("getOBI");
  await workbench.locator("button.run").click();

  await expect(workbench.locator('pre[part~="output"]')).toContainText(
    '"openbindings": "0.2.0"',
  );
  await expect(workbench.locator(".error")).toBeHidden();
});

test("target authentication is preflighted into focused fields", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  await openTargetUrl(page, "http://127.0.0.1:20391/openapi.yaml");
  await expect(page.locator("#document-name")).toHaveText("ob start API");

  const explorer = page.locator("ob-obi-explorer");
  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "describe" })
    .click();

  await expect(page.locator("#requirement-banner")).toBeVisible();
  await expect(page.locator("#requirement-banner-copy")).toContainText(
    "needs context",
  );
  await page.locator("#requirement-banner-action").click();
  await expect(page.locator("#connection-panel")).toBeVisible();
  await page.locator("#requirement-alternative").selectOption({
    label: "Bearer token",
  });
  const bearer = page.locator(
    '#requirement-fields input[data-field="bearerToken"]',
  );
  await expect(bearer).toBeVisible();
  await bearer.fill("test-token");
  await page.locator("#apply-requirements").click();

  await expect(page.locator("#requirement-banner")).toBeHidden();
  const workbench = page.locator("ob-operation-workbench:not([hidden])");
  await workbench.locator("button.run").click();
  await expect(workbench.locator('pre[part~="output"]')).toContainText(
    '"name": "OpenBindings CLI"',
  );
  await expect(workbench.locator(".error")).toBeHidden();
});

test("local and target credentials remain visibly separate", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  await page.locator("#connection-toggle").click();
  await expect(page.locator("#session-status")).toHaveText(
    "Authenticated for this browser tab.",
  );
  await expect(page.locator("#target-context-status")).toHaveText(
    "No target credentials configured.",
  );

  await page.locator(".raw-context summary").click();
  await page
    .locator("#target-context")
    .fill('{"bearerToken":"target-only-token"}');
  await page.locator("#target-context-form button").first().click();
  await expect(page.locator("#target-context-status")).toHaveText(
    "Context is configured for the selected target.",
  );
  await expect(page.locator("#session-status")).toHaveText(
    "Authenticated for this browser tab.",
  );

  await openTargetUrl(page, "http://127.0.0.1:20391/openapi.yaml");
  await expect(page.locator("#document-name")).toHaveText("ob start API");
  await expect(page.locator("#target-context-status")).toHaveText(
    "No target credentials configured.",
  );
  await expect(page.locator("#target-context")).toHaveValue("");
});

test("a malformed target fails recoverably without replacing the current interface", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect(page.locator("#document-name")).toHaveText("ob");

  await openTargetUrl(page, "http://[::1");

  await expect(page.locator("#bootstrap-message")).not.toBeEmpty();
  await expect(page.locator("#doc-open")).toBeEnabled();
  await expect(page.locator("#document-name")).toHaveText("ob");
  await expect(
    page
      .locator("ob-operation-workbench:not([hidden])")
      .locator("button.run"),
  ).toBeEnabled();
});

test("the complete primary flow remains usable without horizontal overflow on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#token=test-token");

  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect(page.locator("#doc-open")).toBeVisible();
  await expect(page.locator("#doc-new")).toBeVisible();
  await expect(
    page
      .locator("ob-operation-workbench:not([hidden])")
      .locator("button.run"),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.locator("#connection-toggle").click();
  await expect(page.locator("#connection-panel")).toBeVisible();
  await expect(page.locator("#connection-close")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("multi-binding operations default to the author's preferred binding and run one-click — including through an operation graph", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  await openTargetUrl(page, "http://127.0.0.1:20392");
  await expect(page.locator("#document-name")).toHaveText("OpenBlendings", {
    timeout: 20_000,
  });

  const explorer = page.locator("ob-obi-explorer");
  const workbench = page.locator("ob-operation-workbench:not([hidden])");

  // getMenu: five bindings, restApi carries the highest author preference.
  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "getMenu" })
    .click();
  await expect(workbench.locator("h2")).toHaveText("getMenu");
  const select = workbench.locator('select[part~="binding-select"]');
  await expect(select).toHaveValue("getMenu.restApi");
  await expect(page.locator("#bootstrap-message")).toContainText(
    "author's preferred binding",
  );
  await workbench.locator("button.run").click();
  await expect(workbench.locator('pre[part~="output"]')).toContainText(
    "Schema Latte",
    { timeout: 15_000 },
  );
  await expect(workbench.locator(".error")).toBeHidden();

  // placeAndTrack: a graph operation whose inner steps (placeOrder,
  // orderUpdates) resolve through the derived configuration.selection.
  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "placeAndTrack" })
    .click();
  const graphSession = page.locator("ob-operation-workbench:not([hidden])");
  await expect(graphSession.locator("h2")).toHaveText("placeAndTrack");
  const input = graphSession.locator("ob-json-editor").first();
  await input.evaluate((el, value) => {
    const editor = el as HTMLElement & { value: string };
    const textarea = el.shadowRoot!.querySelector("textarea")!;
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, '{"customer":"E2E","drink":"Schema Latte","size":"v2"}');
  await graphSession.locator("button.run").click();
  // The output view renders each stream value as its own block.
  await expect(graphSession.locator('pre[part~="output"]').first()).toContainText(
    '"status": "received"',
    { timeout: 30_000 },
  );
  await expect(graphSession.locator('pre[part~="output"]').last()).toContainText(
    '"status": "ready"',
    { timeout: 60_000 },
  );
  await expect(graphSession.locator(".error")).toBeHidden();
});

test("form input mode drives placeOrder through schema fields", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  await openTargetUrl(page, "http://127.0.0.1:20392");
  await expect(page.locator("#document-name")).toHaveText("OpenBlendings", {
    timeout: 20_000,
  });

  const explorer = page.locator("ob-obi-explorer");
  // placeAndTrack's summary mentions placeOrder, so match the key exactly.
  await explorer
    .locator('[part~="operation"]')
    .filter({ has: page.locator('.operation-key:text-is("placeOrder")') })
    .click();
  const workbench = page.locator("ob-operation-workbench:not([hidden])");
  await expect(workbench.locator("h2")).toHaveText("placeOrder");

  // PlaceOrderInput is a $ref-rooted schema: the local reference resolves
  // before capability analysis, so Form view is available.
  const formToggle = workbench.locator("button.view-form");
  await expect(formToggle).toBeEnabled();
  await formToggle.click();

  const customer = workbench.locator("#f-customer");
  const drink = workbench.locator("#f-drink");
  const size = workbench.locator("select#f-size");
  await expect(customer).toBeVisible();
  await expect(drink).toBeVisible();
  // size is an enum and renders as a select carrying the documented values.
  await expect(size).toBeVisible();
  await expect(size.locator('option[value="v2"]')).toHaveCount(1);

  await drink.fill("Schema Latte");
  await customer.fill("FormBot");
  await size.selectOption("v2");

  await workbench.locator("button.run").click();
  await expect(workbench.locator('pre[part~="output"]').first()).toContainText(
    '"status": "received"',
    { timeout: 30_000 },
  );
  await expect(workbench.locator('pre[part~="output"]').first()).toContainText(
    '"customer": "FormBot"',
  );
  await expect(workbench.locator(".error")).toBeHidden();
});

test("a failed resolve reports the server's diagnostic, not a bare status line", async ({
  page,
}) => {
  // Dogfood report (rev 13.2): resolving a URL that serves no interface
  // surfaced as "ERR_UNAVAILABLE: HTTP 502 Bad Gateway" — the transport's
  // view of the resolve endpoint's failure status, while the endpoint's own
  // diagnostic (the full resolution trail) rode an ignored response body.
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  await openTargetUrl(page, "http://127.0.0.1:20392/definitely-not-here.json");

  const message = page.locator("#bootstrap-message");
  await expect(message).toContainText("could not resolve an OBI", {
    timeout: 30_000,
  });
  await expect(message).not.toContainText("Bad Gateway");
  // Recoverable: the control returns and the current target is untouched.
  await expect(page.locator("#doc-open")).toBeEnabled();
  await expect(page.locator("#document-name")).toHaveText("ob");
});
