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

test("operation list is one Tab stop with arrow-key navigation", async ({
  page,
}) => {
  const explorer = page.locator("ob-obi-explorer");
  const detail = page.locator("ob-operation-detail");
  const filter = explorer.locator('input[type="search"]');

  // Tab from the filter input lands on the list's single roving stop.
  await filter.focus();
  await page.keyboard.press("Tab");
  const focusedKey = () =>
    explorer.evaluate(el =>
      el.shadowRoot?.activeElement?.closest<HTMLElement>("li[data-ob-key]")
        ?.dataset.obKey,
    );
  await expect.poll(focusedKey).toBe("tasks.create");
  const tabStops = await explorer.evaluate(
    el =>
      [...el.shadowRoot!.querySelectorAll('[part~="operation"]')].filter(
        button => (button as HTMLElement).tabIndex === 0,
      ).length,
  );
  expect(tabStops).toBe(1);

  // ArrowDown twice then Enter selects the third visible operation.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect.poll(focusedKey).toBe("tasks.list");
  await page.keyboard.press("Enter");
  await expect(detail.locator("h2")).toHaveText("tasks.list");
  await expect(
    explorer.locator('[part~="operation"]').filter({ hasText: "tasks.list" }),
  ).toHaveAttribute("aria-current", "true");

  // Tab again leaves the whole list in one step.
  await page.keyboard.press("Tab");
  const focusedHost = await page.evaluate(() =>
    document.activeElement?.tagName.toLowerCase(),
  );
  expect(focusedHost).not.toBe("ob-obi-explorer");
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

test("editor focus indicator draws on the frame, not the inner overlay textarea", async ({
  page,
}) => {
  // The json-editor's real <textarea> is a transparent overlay inset past the
  // gutter and sized to the content — a focus ring on IT draws a floating box
  // mid-editor (glaring in dark themes). Focus must present on the frame.
  const probe = await page.evaluate(() => {
    const workbench = document.querySelector("ob-operation-workbench")!;
    const editor = workbench.shadowRoot!.querySelector("ob-json-editor")!;
    const textarea = editor.shadowRoot!.querySelector("textarea")!;
    const frame = editor.shadowRoot!.querySelector('[part~="frame"]')!;
    textarea.focus();
    return {
      textareaShadow: getComputedStyle(textarea).boxShadow,
      frameShadow: getComputedStyle(frame).boxShadow,
    };
  });
  expect(probe.textareaShadow).toBe("none");
  expect(probe.frameShadow).not.toBe("none");
});

test("tag chips read as chips on unselected rows — bordered, not bare text", async ({
  page,
}) => {
  // Chip background (surface-strong) is near-invisible against plain row
  // backgrounds; a border must carry the pill shape on every row, not only
  // when a selected row's tint happens to provide contrast.
  const probe = await page.evaluate(() => {
    const explorer = document.querySelector("ob-obi-explorer")!;
    const chip = explorer.shadowRoot!.querySelector(".tags span");
    if (!chip) return null;
    const cs = getComputedStyle(chip);
    return { borderStyle: cs.borderTopStyle, borderWidth: cs.borderTopWidth };
  });
  expect(probe).not.toBeNull();
  expect(probe!.borderStyle).toBe("solid");
  expect(probe!.borderWidth).not.toBe("0px");
});

test("split layout fills the height the host gives the element", async ({
  page,
}) => {
  // Rev-10 defect: in split mode the editor and output view stayed
  // content-height boxes with dead space below, ignoring the host's height.
  await page.goto("/split-layout.html");
  await page.waitForFunction(
    () => (window as unknown as { fixtureReady?: boolean }).fixtureReady === true,
  );

  const measure = () =>
    page.evaluate(() => {
      const root = document.getElementById("split-workbench")!.shadowRoot!;
      const rect = (selector: string) =>
        root.querySelector(selector)!.getBoundingClientRect();
      const container = root.querySelector(".container")!;
      return {
        editor: rect(".input-editor").height,
        output: rect(".output-view").height,
        outputBottom: rect(".output-view").bottom,
        workspaceBottom: rect(".workspace").bottom,
        scrollDelta: container.scrollHeight - container.clientHeight,
      };
    });

  const small = await measure();
  // (b) The output view's bottom lands on the exec grid's bottom.
  expect(Math.abs(small.workspaceBottom - small.outputBottom)).toBeLessThanOrEqual(8);
  // (c) The cockpit itself does not scroll.
  expect(small.scrollDelta).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    document.getElementById("stage")!.style.height = "950px";
  });
  const large = await measure();
  // (a) Both panes grow with the host.
  expect(large.editor - small.editor).toBeGreaterThan(200);
  expect(large.output - small.output).toBeGreaterThan(200);
  expect(Math.abs(large.workspaceBottom - large.outputBottom)).toBeLessThanOrEqual(8);
  expect(large.scrollDelta).toBeLessThanOrEqual(1);

  // (5) Without a definite host height the cockpit keeps a usable floor
  // (22rem = 352px) instead of collapsing.
  const flowHeight = await page.evaluate(() => {
    const root = document.getElementById("flow-workbench")!.shadowRoot!;
    return root.querySelector(".workspace")!.getBoundingClientRect().height;
  });
  expect(flowHeight).toBeGreaterThanOrEqual(350);

  // Rev-12: the form pane obeys the same fill physics — switching the input
  // view swaps panes at (near-)identical height, no layout jump.
  const formHeight = await page.evaluate(async () => {
    const el = document.getElementById("split-workbench") as HTMLElement & {
      inputView: string;
    };
    el.inputView = "form";
    await new Promise(resolve => requestAnimationFrame(resolve));
    const root = el.shadowRoot!;
    const form = root.querySelector<HTMLElement>(".form-view")!;
    return { hidden: form.hidden, height: form.getBoundingClientRect().height };
  });
  expect(formHeight.hidden).toBe(false);
  expect(Math.abs(formHeight.height - large.editor)).toBeLessThanOrEqual(8);
});

test("tab overflow hint fades the tabs themselves — no scrim painted over them", async ({
  page,
}) => {
  // Dogfood report (rev 13.2): the overflow fade was a text-color gradient
  // painted OVER the first tab, which reads as a smudgy fake shadow on light
  // surfaces. The hint must dissolve the strip's own content at the scrolled
  // edge (a mask on the scroller) — nothing may paint on top of tab labels.
  const probe = await page.evaluate(async () => {
    const strip = document.createElement("ob-operation-tabs") as HTMLElement & {
      tabs: { key: string; label: string }[];
      activeKey: string | null;
    };
    strip.style.width = "20rem";
    strip.style.display = "block";
    document.body.append(strip);
    strip.tabs = Array.from({ length: 12 }, (_, i) => ({
      key: `op-${i}`,
      label: `operation.number${i}`,
    }));
    strip.activeKey = "op-0";
    await new Promise(resolve => requestAnimationFrame(resolve));
    const root = strip.shadowRoot!;
    const container = root.querySelector<HTMLElement>(".container")!;
    const list = root.querySelector<HTMLElement>(".tab-list")!;
    // Scroll to the middle so both edges have hidden tabs.
    list.scrollLeft = (list.scrollWidth - list.clientWidth) / 2;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const mask = (el: Element) => {
      const cs = getComputedStyle(el) as CSSStyleDeclaration & {
        webkitMaskImage?: string;
      };
      return cs.maskImage && cs.maskImage !== "none"
        ? cs.maskImage
        : (cs.webkitMaskImage ?? "none");
    };
    const scrim = (pseudo: string) => {
      const cs = getComputedStyle(container, pseudo);
      return cs.backgroundImage;
    };
    const overflowing = {
      state: container.getAttribute("data-overflow"),
      listMask: mask(list),
      before: scrim("::before"),
      after: scrim("::after"),
    };
    strip.tabs = [{ key: "only", label: "only" }];
    await new Promise(resolve => requestAnimationFrame(resolve));
    const settled = {
      state: container.getAttribute("data-overflow"),
      listMask: mask(list),
    };
    strip.remove();
    return { overflowing, settled };
  });

  expect(probe.overflowing.state).toBe("both");
  // The hint is a mask on the scroller…
  expect(probe.overflowing.listMask).toContain("linear-gradient");
  // …and nothing paints over the tabs.
  expect(probe.overflowing.before).toBe("none");
  expect(probe.overflowing.after).toBe("none");
  // No overflow, no mask: nothing dissolves when everything is visible.
  expect(probe.settled.state).toBe("none");
  expect(probe.settled.listMask).toBe("none");
});
