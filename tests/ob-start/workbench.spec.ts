import { expect, test } from "@playwright/test";

const browserErrors = new WeakMap<object, string[]>();

// Rev 17 (review/120): the Open flow is killed pending the document-verb
// re-homing. Tests that needed an external target are suspended below with
// this marker; their specs stay intact for revival when Open returns.
const OPEN_FLOW_SUSPENDED =
  "Suspended by rev 17: the Open flow died with the document verb row " +
  "(review/120 loss ledger). Revive with the verb re-homing (rev 18).";

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
      .locator(".live-announcers")
      .evaluate(element => getComputedStyle(element).position),
  ).toBe("absolute");

  // The strip owns the Run verb (rev 17.6): the element's rail play button
  // is hidden inside the app, so every run goes through #sheet-run.
  const run = page.locator("#sheet-run");
  await expect(run).toBeEnabled();
  await run.click();

  await expect(workbench.locator('[part~="output"] .cm-content')).toContainText(
    '"name": "OpenBindings CLI"',
  );
  // Count and duration report in the strip, not the element (rev 17.6).
  await expect(page.locator("#sheet-status")).toContainText("1 value");
  await expect(workbench.locator(".error")).toBeHidden();

  // The fragment credential is retained only for this browser tab, so a
  // refresh remains seamless without putting the token back in the URL.
  await page.reload();
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await expect(page.locator("#sheet-run")).toBeEnabled();
});

test("the schemas strip shows the contract over the cockpit on one shared axis", async ({
  page,
}) => {
  // Wide enough that the invocation area clears the element's 36rem
  // narrow-fallback threshold and actually renders the split cockpit.
  await page.setViewportSize({ width: 1760, height: 900 });
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  // describe declares no input and a $ref output: one quiet empty pane, one
  // highlighted code block (rev 17.12).
  const split = page.locator("#schema-split");
  await expect(page.locator("#schemas-strip")).toBeVisible();
  await expect(split.locator(".input-empty")).toBeVisible();
  await expect(split.locator(".input-empty")).toHaveText("No input schema.");
  // Read-only code views (17.12.1): assert through the CM content layer,
  // and dereferenced — the reader sees the contract, not a bare pointer.
  await expect(split.locator('[part~="output-schema"]')).toBeVisible();
  await expect(
    split.locator('[part~="output-schema"] .cm-content'),
  ).toContainText('"type"');

  // The detail tab no longer duplicates the contract (hideSchemas).
  await expect(
    page.locator("ob-operation-detail").locator(".schemas"),
  ).toBeHidden();

  // ONE split axis: a keyboard step on the COCKPIT gutter moves the schema
  // strip's gutter too — the columns align by construction.
  const cockpitGutter = page
    .locator("ob-operation-workbench:not([hidden])")
    .locator('[part~="layout-gutter"]');
  await cockpitGutter.focus();
  await cockpitGutter.press("ArrowRight");
  await expect(split.locator(".layout-gutter")).toHaveAttribute(
    "aria-valuenow",
    "52",
  );

  // Collapse to the one-line strip and back; the header never moves.
  await page.locator("#schemas-toggle").click();
  await expect(page.locator("#schemas-content")).toBeHidden();
  await expect(page.locator("#schemas-strip .sheet-title")).toBeVisible();
  await page.locator("#schemas-toggle").click();
  await expect(page.locator("#schemas-content")).toBeVisible();
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
  await expect(page.locator("#sheet-run")).toBeDisabled();

  await expect(page.locator("#connection-panel")).toBeHidden();
  // The status pill is the standing entry to connection settings (rev 17).
  await page.locator("#connection-status").click();
  await expect(page.locator("#connection-panel")).toBeVisible();
  await page.locator("#session-token").fill("test-token");
  await page.locator('#token-form button[type="submit"]').click();

  await expect(page.locator("#session-badge")).toHaveText("Connected");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect(workbench.locator(".status")).toHaveText("Ready");
  await expect(page.locator("#sheet-run")).toBeEnabled();
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

  // Rev 17: two VS Code-style panel toggles; the center tab column is the
  // core space and never hides. The Panels menu is gone.
  await expect(page.locator(".layout-menu")).toHaveCount(0);
  const leftToggle = page.locator("#toggle-left-panel");
  const rightToggle = page.locator("#toggle-right-panel");
  await leftToggle.click();
  await expect(page.locator(".rail-column")).toBeHidden();
  await expect(page.locator(".operation-column")).toBeVisible();
  await leftToggle.click();
  await expect(page.locator(".rail-column")).toBeVisible();
  await rightToggle.click();
  await expect(page.locator(".source-column")).toBeHidden();
  // The breadcrumb keeps wayfinding while panels hide.
  await expect(page.locator("#tab-breadcrumb")).toContainText("ob");
  await rightToggle.click();
  await expect(page.locator(".source-column")).toBeVisible();

  // The invocation sheet's gutter resizes per-session (5–95 range).
  const sheetGutter = page.locator("#sheet-gutter");
  await expect(sheetGutter).toHaveAttribute("aria-valuenow", "45");
  await sheetGutter.focus();
  await sheetGutter.press("ArrowUp");
  await expect(sheetGutter).toHaveAttribute("aria-valuenow", "49");

  // Reset layout died with the Panels menu (rev 17): widths accumulate —
  // 352 + two ArrowRight steps — and persist across the reload.
  await railGutter.press("ArrowRight");
  // Tri-state cycle (rev 17.9): system → light → dark.
  await page.locator("#theme-toggle").click();
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-dark", "");
  await page.reload();
  await expect(railGutter).toHaveAttribute("aria-valuenow", "400");
  // The pinned mode survives the reload.
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-dark", "");
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

test("document and source elements compose through direct edits to the living document", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  const editor = page.locator("ob-obi-editor");
  const innerEditor = editor.locator("ob-json-editor");
  const source = await innerEditor.evaluate(
    el => (el as HTMLElement & { text: string }).text,
  );
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
  // Author the draft through the element contract: assign the document and
  // announce it the way a keystroke would (CodeMirror owns the DOM now).
  await innerEditor.evaluate(
    (element, value) => {
      const editorElement = element as HTMLElement & { text: string };
      editorElement.text = value;
      editorElement.dispatchEvent(
        new CustomEvent("ob-json-input", {
          detail: { text: value, structured: false },
          bubbles: true,
          composed: true,
        }),
      );
    },
    `${JSON.stringify(draft, null, 2)}\n`,
  );
  // Direct editing (rev 14.3): a valid document commits on idle — no Apply.
  // Rail (rev 15.1, panjir master pane): ONE scroller — operations first,
  // sources beneath, one sticky filter narrowing both — and the editor
  // stays visible throughout; no tab click reaches the sources.
  await expect(page.locator("ob-obi-editor")).toBeVisible();
  // The committed draft is visible in the workspace mirror (rev 17.10.1
  // killed the "unsaved" marker: there is no save — Export is the only
  // durability act, so a dirty flag was noise).
  await expect(
    page.locator("ob-obi-explorer").locator('[part~="operation"]', {
      hasText: "graphDemo",
    }),
  ).toBeVisible({ timeout: 10_000 });

  const rail = page.locator(".rail-column");
  const explorer = page.locator("ob-obi-explorer");
  const railFilter = explorer.locator('input[type="search"]');

  // The rail scrolls as one unit, and the filter stays pinned while it does.
  await rail.evaluate(element => {
    element.scrollTop = 400;
  });
  expect(await rail.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(railFilter).toBeInViewport();
  await rail.evaluate(element => {
    element.scrollTop = 0;
  });

  // One filter, both sections: "openapi" keeps only the matching source row
  // and narrows the operation rows (both counts flip to N / total honesty).
  await railFilter.fill("openapi");
  await expect(explorer.locator('[part~="source"]')).toHaveCount(1);
  await expect(explorer.locator('[part~="source"]')).toContainText("openapi");
  await expect(explorer.locator(".count")).toContainText("/");
  await expect(explorer.locator(".sources-count")).toContainText("/");
  await railFilter.fill("");

  // The graph pane died with rev 17 (review/120): the operation-graph
  // authoring surface returns per-operation with the parked graph
  // revolution. The graph BINDING data authored above still exercises the
  // document path: it merges, appears on the source tab, and unbinds.

  // A source is a workspace item (rev 16): its rail row opens a source tab —
  // kind subtitle, ob-source-detail content, no invocation sheet — where the
  // facts and the unbind verb live.
  await railFilter.fill("");
  await explorer
    .locator('[part~="source"]')
    .filter({ hasText: "graphSource" })
    .click();
  const tabs = page.locator("ob-operation-tabs");
  const sourceTab = tabs
    .locator('[role="tab"][aria-selected="true"]')
    .filter({ hasText: "graphSource" });
  await expect(sourceTab).toHaveCount(1);
  await expect(sourceTab.locator(".kind")).toHaveText("source");
  const sourceDetail = page.locator("ob-source-detail");
  await expect(sourceDetail).toBeVisible();
  await expect(page.locator("#invocation-sheet")).toBeHidden();
  await expect(sourceDetail.locator('[part~="binding"]')).toContainText(
    "graphDemo.graph",
  );
  await sourceDetail.locator("[data-binding-remove]").click();
  await expect(page.locator("#confirmation-dialog")).toBeVisible();
  await page.locator("#confirmation-accept").click();
  // The source tab survives the edit; its binding list is honestly empty.
  await expect(sourceDetail.locator("[data-binding-key]")).toHaveCount(0);
  await expect(sourceDetail).toBeVisible();
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
  await page.locator("#sheet-run").click();
  await expect(activeWorkbench.locator('[part~="output"] .cm-content')).toContainText(
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
  await expect(activeWorkbench.locator('[part~="output"] .cm-content')).toContainText(
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

test("tabs are workspace items: duplicate forks a session, rename sticks, the collapsed sheet reports runs without expanding", async ({
  page,
}) => {
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  const tabs = page.locator("ob-operation-tabs");
  await expect(tabs.locator('[role="tab"]')).toHaveCount(1);
  // The default kind goes unmarked (rev 17.1): operation tabs are one clean
  // line; only source views carry the inline kind chip.
  await expect(tabs.locator(".kind").first()).toBeHidden();

  // Duplicate forks the session: same operation, its own tab and history.
  await tabs.locator(".menu-toggle").click();
  await tabs.locator('[data-action="duplicate"]').click();
  await expect(tabs.locator('[role="tab"]')).toHaveCount(2);
  const labels = await tabs.locator(".label").allTextContents();
  expect(labels).toEqual([
    "openbindings.ob.describe",
    "openbindings.ob.describe · 2",
  ]);
  // A rail click focuses an existing session rather than opening a third.
  await page
    .locator('ob-obi-explorer [part~="operation"]')
    .filter({ hasText: "openbindings.ob.describe" })
    .first()
    .click();
  await expect(tabs.locator('[role="tab"]')).toHaveCount(2);

  // Rename: double-click the label, type, Enter commits.
  await tabs.locator(".tab-shell.active .label").dblclick();
  const rename = tabs.locator(".rename-input");
  await expect(rename).toBeVisible();
  await rename.fill("describe · smoke");
  await rename.press("Enter");
  await expect(
    tabs.locator('[role="tab"]').filter({ hasText: "describe · smoke" }),
  ).toHaveCount(1);

  // Collapse the sheet; run from the strip. The strip reports completion —
  // and the sheet NEVER auto-expands.
  await page.locator("#sheet-toggle").click();
  await expect(page.locator("#invocation-sessions")).toBeHidden();
  await expect(page.locator("#sheet-run")).toBeVisible();
  await page.locator("#sheet-run").click();
  await expect(page.locator("#sheet-status")).toContainText("value", {
    timeout: 15_000,
  });
  await expect(page.locator("#invocation-sessions")).toBeHidden();

  // Sessions, labels, and per-session sheet state survive a reload (schema
  // v2 in sessionStorage).
  await page.reload();
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect(tabs.locator('[role="tab"]')).toHaveCount(2);
  await expect(
    tabs.locator('[role="tab"]').filter({ hasText: "describe · smoke" }),
  ).toHaveCount(1);
  await expect(page.locator("#invocation-sessions")).toBeHidden();
  await expect(page.locator("#sheet-run")).toBeVisible();
});

test("a raw API artifact is synthesized and invoked without a browser binding-family client", async ({
  page,
}) => {
  test.skip(true, OPEN_FLOW_SUSPENDED);
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
  await page.locator("#sheet-run").click();

  await expect(workbench.locator('[part~="output"] .cm-content')).toContainText(
    '"openbindings": "0.2.0"',
  );
  await expect(workbench.locator(".error")).toBeHidden();
});

test("target authentication is preflighted into focused fields", async ({
  page,
}) => {
  test.skip(true, OPEN_FLOW_SUSPENDED);
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  await openTargetUrl(page, "http://127.0.0.1:20391/openapi.yaml");
  await expect(page.locator("#document-name")).toHaveText("ob start API");

  const explorer = page.locator("ob-obi-explorer");
  await explorer
    .locator('[part~="operation"]')
    .filter({ hasText: "describe" })
    .click();

  // Rev 17.10: the preflight is a quiet strip advisory — authoring never
  // raises the banner. The banner appears only when a RUN actually emits
  // CONTEXT_REQUIRED.
  await expect(page.locator("#sheet-status")).toHaveText(
    "needs target credentials",
  );
  await expect(page.locator("#requirement-banner")).toBeHidden();
  await page.locator("#sheet-run").click();
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
  await page.locator("#sheet-run").click();
  await expect(workbench.locator('[part~="output"] .cm-content')).toContainText(
    '"name": "OpenBindings CLI"',
  );
  await expect(workbench.locator(".error")).toBeHidden();
});

test("local and target credentials remain visibly separate", async ({
  page,
}) => {
  test.skip(true, OPEN_FLOW_SUSPENDED);
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");

  await page.locator("#connection-status").click();
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
  test.skip(true, OPEN_FLOW_SUSPENDED);
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect(page.locator("#document-name")).toHaveText("ob");

  await openTargetUrl(page, "http://[::1");

  await expect(page.locator("#bootstrap-message")).not.toBeEmpty();
  await expect(page.locator("#doc-open")).toBeEnabled();
  await expect(page.locator("#document-name")).toHaveText("ob");
  await expect(page.locator("#sheet-run")).toBeEnabled();
});

test("the complete primary flow remains usable without horizontal overflow on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#token=test-token");

  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
  await expect(page.locator("#toggle-left-panel")).toBeVisible();
  await expect(page.locator("#toggle-right-panel")).toBeVisible();
  await expect(page.locator("#tab-breadcrumb")).toContainText("ob");
  await expect(page.locator("#sheet-run")).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.locator("#connection-status").click();
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
  test.skip(true, OPEN_FLOW_SUSPENDED);
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
  await page.locator("#sheet-run").click();
  await expect(workbench.locator('[part~="output"] .cm-content')).toContainText(
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
    const editorElement = el as HTMLElement & { text: string };
    editorElement.text = value;
    editorElement.dispatchEvent(
      new CustomEvent("ob-json-input", {
        detail: { text: value, structured: false },
        bubbles: true,
        composed: true,
      }),
    );
  }, '{"customer":"E2E","drink":"Schema Latte","size":"v2"}');
  await page.locator("#sheet-run").click();
  // The output view renders each stream value as its own block.
  await expect(graphSession.locator('[part~="output"] .cm-content').first()).toContainText(
    '"status": "received"',
    { timeout: 30_000 },
  );
  await expect(graphSession.locator('[part~="output"] .cm-content').last()).toContainText(
    '"status": "ready"',
    { timeout: 60_000 },
  );
  await expect(graphSession.locator(".error")).toBeHidden();
});

test("form input mode drives placeOrder through schema fields", async ({
  page,
}) => {
  test.skip(true, OPEN_FLOW_SUSPENDED);
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

  await page.locator("#sheet-run").click();
  await expect(workbench.locator('[part~="output"] .cm-content').first()).toContainText(
    '"status": "received"',
    { timeout: 30_000 },
  );
  await expect(workbench.locator('[part~="output"] .cm-content').first()).toContainText(
    '"customer": "FormBot"',
  );
  await expect(workbench.locator(".error")).toBeHidden();
});

test("a failed resolve reports the server's diagnostic, not a bare status line", async ({
  page,
}) => {
  test.skip(true, OPEN_FLOW_SUSPENDED);
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
