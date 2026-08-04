import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Browser half of the mechanical design gates (JUDGE station 1 in
 * review/90-design-loop.md): computed-style probes against the RUNNING
 * workbench in both themes.
 *
 * - Contrast: WCAG ratios for the surfaces people actually read — rail row
 *   text, muted text, tag chips, the Run button, the connection status pill.
 *   Threshold 4.5:1, relaxed to 3:1 for large/bold text (>=14px at
 *   weight >= 600, per the loop's gate definition).
 * - Focus visibility: focus really placed via keyboard, then the focused
 *   element must carry a non-none outline or box-shadow (the rev-4 bug class).
 */

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

interface ContrastMeasurement {
  ratio: number;
  fontSizePx: number;
  fontWeight: number;
  foreground: string;
  background: string;
}

/** Runs in the page: composited text-vs-background WCAG contrast ratio. */
function measureContrast(el: Element): ContrastMeasurement {
  interface RGBA { r: number; g: number; b: number; a: number }
  const parse = (raw: string): RGBA | null => {
    if (!raw) return null;
    if (raw === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    let match = raw.match(/^rgba?\(([^)]+)\)$/);
    if (match) {
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return {
        r: parts[0], g: parts[1], b: parts[2],
        a: parts.length > 3 ? parts[3] : 1,
      };
    }
    match = raw.match(
      /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/,
    );
    if (match) {
      const alphaRaw = match[4];
      const a = alphaRaw === undefined
        ? 1
        : alphaRaw.endsWith("%") ? Number.parseFloat(alphaRaw) / 100 : Number.parseFloat(alphaRaw);
      return {
        r: 255 * Number(match[1]),
        g: 255 * Number(match[2]),
        b: 255 * Number(match[3]),
        a,
      };
    }
    return null;
  };
  const over = (top: RGBA, bottom: RGBA): RGBA => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  // Walk the composed tree (crossing shadow boundaries through hosts)
  // collecting background layers until an opaque one grounds the stack.
  const layers: RGBA[] = [];
  let node: Element | null = el;
  let grounded = false;
  while (node) {
    const layer = parse(getComputedStyle(node).backgroundColor);
    if (layer && layer.a > 0) {
      layers.push(layer);
      if (layer.a >= 1) {
        grounded = true;
        break;
      }
    }
    const root = node.getRootNode();
    node = node.parentElement ??
      (root instanceof ShadowRoot ? (root.host as Element) : null);
  }
  let background: RGBA = grounded
    ? layers[layers.length - 1]
    : { r: 255, g: 255, b: 255, a: 1 };
  for (let index = layers.length - (grounded ? 2 : 1); index >= 0; index -= 1) {
    background = over(layers[index], background);
  }
  const style = getComputedStyle(el);
  let foreground = parse(style.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  if (foreground.a < 1) foreground = over(foreground, background);
  const luminance = (color: RGBA): number => {
    const channel = (value: number): number => {
      const scaled = value / 255;
      return scaled <= 0.03928
        ? scaled / 12.92
        : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel(color.r) +
      0.7152 * channel(color.g) +
      0.0722 * channel(color.b)
    );
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  const hex = (color: RGBA): string =>
    `#${[color.r, color.g, color.b]
      .map(value => Math.round(value).toString(16).padStart(2, "0"))
      .join("")}`;
  return {
    ratio: (lighter + 0.05) / (darker + 0.05),
    fontSizePx: Number.parseFloat(style.fontSize),
    fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
    foreground: hex(foreground),
    background: hex(background),
  };
}

interface FocusRing {
  description: string;
  matchesFocusVisible: boolean;
  outlineStyle: string;
  outlineWidthPx: number;
  boxShadow: string;
}

/** Runs in the page: ring styles of the deep (shadow-piercing) active element. */
function readActiveFocusRing(): FocusRing {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  if (!active || active === document.body) {
    return {
      description: "(no active element)",
      matchesFocusVisible: false,
      outlineStyle: "none",
      outlineWidthPx: 0,
      boxShadow: "none",
    };
  }
  const style = getComputedStyle(active);
  const label = [
    active.tagName.toLowerCase(),
    active.getAttribute("id") ? `#${active.getAttribute("id")}` : "",
    active.getAttribute("part") ? `[part=${active.getAttribute("part")}]` : "",
    active.className && typeof active.className === "string"
      ? `.${active.className.trim().split(/\s+/).join(".")}`
      : "",
  ].join("");
  return {
    description: label,
    matchesFocusVisible: active.matches(":focus-visible"),
    outlineStyle: style.outlineStyle,
    outlineWidthPx: Number.parseFloat(style.outlineWidth) || 0,
    boxShadow: style.boxShadow,
  };
}

async function openWorkbench(page: Page, theme: Theme): Promise<void> {
  await page.setViewportSize({ width: 1760, height: 1000 });
  await page.goto("/#token=gallery-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready", {
    timeout: 20_000,
  });
  const dark = await page.evaluate(() =>
    document.documentElement.hasAttribute("data-dark"),
  );
  if ((theme === "dark") !== dark) await page.locator("#theme-toggle").click();
  if (theme === "dark") {
    await expect(page.locator("html")).toHaveAttribute("data-dark", "");
  }
}

function assertRing(
  probe: string,
  theme: Theme,
  ring: FocusRing,
  options: { rejectUADefault?: boolean } = {},
): void {
  // With rejectUADefault, the UA's `outline: auto` sliver does not count:
  // the element must carry an app-authored ring (DS-FOCUS-01 — non-control
  // elements like the layout gutters otherwise fall back to the UA default,
  // which the app's focus convention is meant to replace).
  const outlineCounts =
    ring.outlineStyle !== "none" &&
    ring.outlineWidthPx > 0 &&
    !(options.rejectUADefault && ring.outlineStyle === "auto");
  const hasRing = outlineCounts || ring.boxShadow !== "none";
  console.log(
    `focus ${theme} ${probe}: ${ring.description} focus-visible=${ring.matchesFocusVisible} ` +
      `outline=${ring.outlineStyle}/${ring.outlineWidthPx}px box-shadow=${ring.boxShadow === "none" ? "none" : "set"}`,
  );
  expect
    .soft(
      ring.matchesFocusVisible,
      `${probe} (${theme}): ${ring.description} does not match :focus-visible — probe could not place keyboard focus`,
    )
    .toBe(true);
  expect
    .soft(
      hasRing,
      `${probe} (${theme}): focused ${ring.description} has no visible ring ` +
        `(outline ${ring.outlineStyle} ${ring.outlineWidthPx}px, box-shadow ${ring.boxShadow})`,
    )
    .toBe(true);
}

for (const theme of THEMES) {
  test(`contrast gates — ${theme}`, async ({ page }) => {
    await openWorkbench(page, theme);
    const probes: Array<{ name: string; locator: Locator; note?: string }> = [
      {
        name: "rail selected row text vs row background",
        locator: page.locator("ob-obi-explorer button.selected .operation-key"),
      },
      {
        name: "rail muted summary text vs background",
        locator: page
          .locator("ob-obi-explorer li button:not(.selected) .operation-summary")
          .first(),
      },
      {
        name: "rail tag chip text vs chip background",
        locator: page
          .locator("ob-obi-explorer li button:not(.selected) .tags span")
          .first(),
      },
      {
        name: "Run button text vs button background",
        locator: page.locator("ob-operation-workbench:not([hidden]) .run"),
      },
      {
        name: "status pill text vs pill background",
        locator: page.locator("#connection-status-text"),
      },
    ];
    for (const probe of probes) {
      await expect(probe.locator).toBeVisible();
      const result = await probe.locator.evaluate(measureContrast);
      const large =
        result.fontSizePx >= 24 ||
        (result.fontSizePx >= 14 && result.fontWeight >= 600);
      const required = large ? 3 : 4.5;
      console.log(
        `contrast ${theme} ${probe.name}: ${result.ratio.toFixed(2)}:1 ` +
          `(${result.foreground} on ${result.background}, ${result.fontSizePx}px/${result.fontWeight}, needs >= ${required})`,
      );
      expect
        .soft(
          result.ratio,
          `${probe.name} (${theme}): ${result.ratio.toFixed(2)}:1 ` +
            `(${result.foreground} on ${result.background}) below required ${required}:1`,
        )
        .toBeGreaterThanOrEqual(required);
    }
  });

  test(`focus visibility gates — ${theme}`, async ({ page }) => {
    await openWorkbench(page, theme);
    const explorer = page.locator("ob-obi-explorer");
    const filter = explorer.locator('input[type="search"]');

    // 1. The rail filter input (text inputs match :focus-visible on focus).
    await filter.focus();
    assertRing("filter input", theme, await page.evaluate(readActiveFocusRing));

    // 2. A rail row, focused by keyboard: ArrowDown hands the input's focus
    //    to the roving row stop inside the keydown handler.
    await filter.press("ArrowDown");
    assertRing("rail row", theme, await page.evaluate(readActiveFocusRing));

    // 3. The app rail gutter (DS-FOCUS-01): keyboard focus on the splitter
    //    must render a real ring, not the opacity-only hover pill.
    const railGutter = page.locator("#rail-gutter");
    await railGutter.focus();
    // A real keypress upgrades focus to :focus-visible (the width nudge is
    // discarded with the fresh context).
    await page.keyboard.press("ArrowRight");
    assertRing("rail gutter", theme, await page.evaluate(readActiveFocusRing), {
      rejectUADefault: true,
    });

    // 4. The cockpit layout gutter (split mode needs an input schema wide).
    await filter.fill("openbindings.ob.validateInterface");
    await explorer
      .locator('[part~="operation"]')
      .filter({
        has: page.locator('.operation-key:text-is("openbindings.ob.validateInterface")'),
      })
      .click();
    const workbench = page.locator("ob-operation-workbench:not([hidden])");
    await expect(workbench.locator("h2")).toHaveText(
      "openbindings.ob.validateInterface",
    );
    const gutter = workbench.locator('[part~="layout-gutter"]');
    await expect(gutter).toBeVisible();
    await gutter.focus();
    // A real keypress while focused: Chromium upgrades the focus to
    // :focus-visible on keyboard interaction (and nudges the split, which a
    // fresh context discards).
    await page.keyboard.press("ArrowLeft");
    assertRing("layout gutter", theme, await page.evaluate(readActiveFocusRing));

    // 5. Run, reached by keyboard: Cancel is hidden while idle, so Shift+Tab
    //    from the gutter lands on the Run button.
    await page.keyboard.press("Shift+Tab");
    const runRing = await page.evaluate(readActiveFocusRing);
    expect(
      runRing.description,
      `expected Shift+Tab from the layout gutter to land on Run, got ${runRing.description}`,
    ).toContain("run");
    assertRing("Run button", theme, runRing);
  });
}
