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
      .locator("ob-json-editor .cm-content"),
  ).toBeVisible();
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

test("editor focus presents on the frame, not the editing surface", async ({
  page,
}) => {
  // Focus presentation is delegated to the frame; the CodeMirror surface
  // itself must not draw its own outline (glaring in dark themes).
  const probe = await page.evaluate(() => {
    const workbench = document.querySelector("ob-operation-workbench")!;
    const editor = workbench.shadowRoot!.querySelector("ob-json-editor")! as HTMLElement & { focusEditor(): void };
    const frame = editor.shadowRoot!.querySelector('[part~="frame"]')!;
    editor.focusEditor();
    const cm = editor.shadowRoot!.querySelector(".cm-editor")!;
    return {
      cmOutline: getComputedStyle(cm).outlineStyle,
      frameShadow: getComputedStyle(frame).boxShadow,
    };
  });
  expect(probe.cmOutline).toBe("none");
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

test("workspace-item tabs show kind subtitles and rename inline with real input events", async ({
  page,
}) => {
  // Rev 16 tabs are named workspace items; rev 17.1 renders the kind as a
  // small inline chip. Double-click opens an inline rename committed with
  // Enter.
  await page.evaluate(() => {
    const strip = document.createElement("ob-operation-tabs") as HTMLElement & {
      tabs: { key: string; label: string; kind?: string }[];
      activeKey: string | null;
    };
    strip.id = "rename-probe";
    strip.style.cssText = "display:block;width:36rem";
    document.body.append(strip);
    strip.tabs = [
      { key: "s1", label: "placeOrder", kind: "operation" },
      { key: "s2", label: "openapi", kind: "source" },
    ];
    strip.activeKey = "s1";
    (window as unknown as { renames: unknown[] }).renames = [];
    strip.addEventListener("ob-tab-rename", event => {
      (window as unknown as { renames: unknown[] }).renames.push(
        (event as CustomEvent).detail,
      );
    });
  });
  const strip = page.locator("#rename-probe");
  await expect(strip.locator(".kind").nth(0)).toHaveText("operation");
  await expect(strip.locator(".kind").nth(1)).toHaveText("source");
  // The subtitle is visually muted and smaller than the label.
  const sizes = await strip.evaluate(el => {
    const root = el.shadowRoot!;
    const label = getComputedStyle(root.querySelector(".label")!);
    const kind = getComputedStyle(root.querySelector(".kind")!);
    return {
      label: Number.parseFloat(label.fontSize),
      kind: Number.parseFloat(kind.fontSize),
      differs: label.color !== kind.color,
    };
  });
  expect(sizes.kind).toBeLessThan(sizes.label);
  expect(sizes.differs).toBe(true);

  await strip.locator('[data-tab-key="s1"] .label').dblclick();
  const input = strip.locator(".rename-input");
  await expect(input).toBeVisible();
  await input.fill("order · smoke");
  await input.press("Enter");
  await expect(strip.locator(".rename-input")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { renames: unknown[] }).renames)).toEqual([
    { key: "s1", label: "order · smoke" },
  ]);
  await page.evaluate(() => document.querySelector("#rename-probe")?.remove());
});

test("the tabs overflow menu escapes ancestor clipping and its actions fire", async ({
  page,
}) => {
  // Dogfood report (rev 13.4): "the ••• more button doesn't work." It did
  // open — but the popover painted inside the strip's box, and the app styles
  // the strip with overflow:hidden (a standard grid-blowout guard), so the
  // menu was clipped to invisibility and every click landed on the panel
  // below. The popover must render in the top layer, above and outside any
  // ancestor clip, and its actions must still reach the app.
  const probe = await page.evaluate(async () => {
    const wrap = document.createElement("div");
    // The app's exact conditions: a clipping, strip-height box.
    wrap.style.cssText = "overflow:hidden;width:28rem;";
    const strip = document.createElement("ob-operation-tabs") as HTMLElement & {
      tabs: { key: string; label: string }[];
      activeKey: string | null;
    };
    strip.style.display = "block";
    wrap.append(strip);
    document.body.append(wrap);
    strip.tabs = [
      { key: "a", label: "alpha" },
      { key: "b", label: "beta" },
      { key: "c", label: "gamma" },
    ];
    strip.activeKey = "a";
    await new Promise(resolve => requestAnimationFrame(resolve));
    let closeAll = 0;
    strip.addEventListener("ob-tabs-close-all", () => {
      closeAll += 1;
    });
    const root = strip.shadowRoot!;
    root.querySelector<HTMLButtonElement>(".menu-toggle")!.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const pop = root.querySelector<HTMLElement>(".menu-popover")!;
    const rect = pop.getBoundingClientRect();
    const top = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    const closeButton = pop.querySelector<HTMLButtonElement>(
      '[data-action="close-all"]',
    )!;
    closeButton.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const openAfter = pop.matches(":popover-open");
    const state = {
      area: rect.width * rect.height,
      topIsStrip: top === strip,
      closeAll,
      openAfter,
    };
    wrap.remove();
    return state;
  });
  expect(probe.area).toBeGreaterThan(0);
  // Top layer: what the user hits at the popover's center is the strip's
  // shadow content, not whatever the layout put beneath the clip.
  expect(probe.topIsStrip).toBe(true);
  expect(probe.closeAll).toBe(1);
  expect(probe.openAfter).toBe(false);
});

test("the caret lands exactly where the user clicks, even under inherited white-space", async ({
  page,
}) => {
  // Rev 14.1's overlay fix is superseded by rev 14.2: source mode is
  // CodeMirror 6. The contract is asserted end-to-end with no editor API:
  // click at the visual position of a known character, type, and the typed
  // character must land at that index in the element's text — including
  // inside a hostile white-space: pre wrapper (the condition that displaced
  // the old overlay by two lines).
  const target = await page.evaluate(async () => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "white-space: pre; width: 30rem; height: 16rem;";
    const editor = document.createElement("ob-json-editor") as HTMLElement & {
      text: string;
    };
    editor.style.cssText = "display: block; height: 100%;";
    editor.id = "caret-probe";
    wrap.append(editor);
    document.body.append(wrap);
    editor.text = JSON.stringify(
      { alpha: 1, beta: [2, 3], gamma: "four", delta: { epsilon: 5 } },
      null,
      2,
    );
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const text = editor.text;
    const pos = text.indexOf("gamma") + 2;
    const before = text.slice(0, pos);
    const lineIndex = before.split("\n").length - 1;
    const column = pos - (before.lastIndexOf("\n") + 1);
    const line = editor.shadowRoot!.querySelectorAll(".cm-line")[lineIndex]!;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let node: Text | null = null;
    let offset = 0;
    let current: Node | null;
    while ((current = walker.nextNode())) {
      const data = (current as Text).data;
      if (column < seen + data.length) {
        node = current as Text;
        offset = column - seen;
        break;
      }
      seen += data.length;
    }
    const range = document.createRange();
    range.setStart(node!, offset);
    range.setEnd(node!, offset);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + 0.5, y: rect.y + rect.height / 2, pos, text };
  });
  await page.mouse.click(target.x, target.y);
  await page.keyboard.type("X");
  const after = await page.evaluate(() => {
    const editor = document.getElementById("caret-probe") as HTMLElement & {
      text: string;
    };
    const value = editor.text;
    editor.parentElement!.remove();
    return value;
  });
  let insertedAt = -1;
  for (let index = 0; index < after.length; index += 1) {
    if (after[index] !== target.text[index]) {
      insertedAt = index;
      break;
    }
  }
  expect(after.length).toBe(target.text.length + 1);
  expect(Math.abs(insertedAt - target.pos)).toBeLessThanOrEqual(1);
});
