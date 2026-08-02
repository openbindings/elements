import { expect, test, type Locator, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * SHOOT station (review/90-design-loop.md): a manifested screenshot corpus of
 * the running workbench. Every shot has a stable id
 * `surface/state/theme/width.png` and comes from the real product — real
 * `ob start` server, real demo target, real focus placement. Surfaces or
 * states the harness cannot reach are counted dispositions in manifest.json,
 * never silent omissions. No timestamps anywhere in ids or metadata, so two
 * runs of the same build produce identically named artifacts.
 */

const THEMES = ["light", "dark"] as const;
const WIDTHS = [1760, 900] as const;
const VIEWPORT_HEIGHT = 1000;
const OUT_DIR = path.resolve("test-results", "gallery");
const DEMO_ORIGIN = "http://127.0.0.1:20396";

type Theme = (typeof THEMES)[number];
type Width = (typeof WIDTHS)[number];

/** The planned corpus. Every id below appears in the manifest, shot or not. */
const PLAN: Record<string, string[]> = {
  rail: ["default", "filtered-with-count", "keyboard-focused-row"],
  tabs: ["multiple", "overflow"],
  detail: ["bindings-collapsed", "bindings-open"],
  "cockpit-input": ["json-starter", "focused-editor"],
  "cockpit-output": [
    "empty",
    "single-value-with-duration",
    "streaming-or-multi-value-with-offsets",
    "error-category-card",
  ],
  "document-editor": ["source-focused", "tree-view"],
  "connection-panel": ["open"],
  "workbench-full": ["default", "panels-menu-open"],
};

interface ManifestEntry {
  id: string;
  surface: string;
  state: string;
  theme: Theme;
  width: Width;
  status: "shot" | "skipped";
  reason?: string;
  file?: string;
}

// workers=1 keeps every sweep in one process, so a module-level map is the
// single accumulation point and afterAll writes the complete manifest.
const entries = new Map<string, ManifestEntry>();

/** Thrown by a shot's prep to record an honest "unreachable" disposition. */
class SkipShot extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SkipShot";
  }
}

function shotId(surface: string, state: string, theme: Theme, width: Width) {
  return `${surface}/${state}/${theme}/${width}`;
}

function makeShooter(page: Page, theme: Theme, width: Width) {
  return async function shoot(
    surface: string,
    state: string,
    prep: () => Promise<Locator | "page">,
  ): Promise<void> {
    const id = shotId(surface, state, theme, width);
    const file = `${id}.png`;
    const absolute = path.join(OUT_DIR, file);
    try {
      const target = await prep();
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      if (target === "page") {
        await page.screenshot({ path: absolute, animations: "disabled" });
      } else {
        await target.screenshot({ path: absolute, animations: "disabled" });
      }
      entries.set(id, {
        id, surface, state, theme, width,
        status: "shot",
        file,
      });
    } catch (error) {
      const disposition = error instanceof SkipShot;
      const reason = `${disposition ? "unreachable" : "error"}: ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`.slice(0, 300);
      entries.set(id, { id, surface, state, theme, width, status: "skipped", reason });
      console.log(`gallery skip ${id} — ${reason}`);
    }
  };
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  const dark = await page.evaluate(() =>
    document.documentElement.hasAttribute("data-dark"),
  );
  if ((theme === "dark") !== dark) await page.locator("#theme-toggle").click();
  if (theme === "dark") {
    await expect(page.locator("html")).toHaveAttribute("data-dark", "");
  } else {
    await expect(page.locator("html")).not.toHaveAttribute("data-dark", "");
  }
}

/** Selects an operation through the rail by exact key, then clears the filter. */
async function selectOperation(page: Page, key: string): Promise<void> {
  const explorer = page.locator("ob-obi-explorer");
  await explorer.locator('input[type="search"]').fill(key);
  await explorer
    .locator('[part~="operation"]')
    .filter({ has: page.locator(`.operation-key:text-is("${key}")`) })
    .click();
  await expect(
    page.locator("ob-operation-workbench:not([hidden])").locator("h2"),
  ).toHaveText(key);
  await explorer.locator('input[type="search"]').fill("");
}

async function setEditorValue(workbench: Locator, value: string): Promise<void> {
  await workbench
    .locator("ob-json-editor")
    .first()
    .evaluate((el, text) => {
      const textarea = el.shadowRoot!.querySelector("textarea")!;
      textarea.value = text;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
}

async function sweep(page: Page, theme: Theme, width: Width): Promise<void> {
  const shoot = makeShooter(page, theme, width);
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
  await page.goto("/#token=gallery-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready", {
    timeout: 20_000,
  });
  await setTheme(page, theme);

  const explorer = page.locator("ob-obi-explorer");
  const filter = explorer.locator('input[type="search"]');
  const active = page.locator("ob-operation-workbench:not([hidden])");
  const tabs = page.locator("ob-operation-tabs");
  const detail = page.locator("ob-operation-detail");

  // -- pristine full workbench, before any interaction disturbs it ----------
  await shoot("workbench-full", "default", async () => "page");

  await shoot("rail", "default", async () => {
    await expect(explorer.locator("h2")).not.toHaveText("No interface");
    return explorer;
  });

  // -- operation detail: the local describe operation carries one binding ---
  await shoot("detail", "bindings-open", async () => {
    const bindings = detail.locator(".bindings");
    if (await bindings.isHidden()) {
      throw new SkipShot("selected operation exposes no bindings");
    }
    // One binding on the local operations, so the disclosure defaults open.
    await expect(detail.locator(".bindings details")).toHaveAttribute("open", "");
    return detail;
  });

  await shoot("detail", "bindings-collapsed", async () => {
    const disclosure = detail.locator(".bindings details");
    if (await detail.locator(".bindings").isHidden()) {
      throw new SkipShot("selected operation exposes no bindings");
    }
    await detail.locator('[part~="bindings-summary"]').click();
    await expect(disclosure).not.toHaveAttribute("open", "");
    return detail;
  });
  // Restore the disclosure so later full shots keep the default state.
  if (await detail.locator(".bindings details:not([open])").count()) {
    await detail.locator('[part~="bindings-summary"]').click();
  }

  // -- cockpit output: empty, then a completed single-value run -------------
  await shoot("cockpit-output", "empty", async () => {
    await expect(active.locator(".output-notice")).toBeVisible();
    return active.locator(".output-column");
  });

  await shoot("cockpit-output", "single-value-with-duration", async () => {
    await active.locator("button.run").click();
    await expect(active.locator('pre[part~="output"]')).toContainText(
      '"name": "OpenBindings CLI"',
      { timeout: 15_000 },
    );
    await expect(active.locator(".output-count")).toHaveText("1 value");
    await expect(active.locator('[part~="output-timing"]')).toBeVisible();
    return active.locator(".output-column");
  });

  // -- error category card: getContext with an empty key is an HTTP 400 -----
  await shoot("cockpit-output", "error-category-card", async () => {
    await selectOperation(page, "openbindings.ob.getContext");
    await setEditorValue(active, '{"key":""}');
    await active.locator("button.run").click();
    await expect(active.locator(".error")).toBeVisible({ timeout: 15_000 });
    await expect(active.locator(".error-summary")).not.toBeEmpty();
    return active.locator(".output-column");
  });

  // -- cockpit input: schema starter, then genuinely focused editor ---------
  await shoot("cockpit-input", "json-starter", async () => {
    await selectOperation(page, "openbindings.ob.validateInterface");
    await expect(active.locator("ob-json-editor").first()).toBeVisible();
    return active.locator(".input-column");
  });

  await shoot("cockpit-input", "focused-editor", async () => {
    const textarea = active.locator("ob-json-editor textarea").first();
    await textarea.click();
    await expect(textarea).toBeFocused();
    return active.locator(".input-column");
  });

  // -- rail states ----------------------------------------------------------
  await shoot("rail", "filtered-with-count", async () => {
    await filter.fill("list");
    await expect(explorer.locator(".count")).toContainText("/");
    return explorer;
  });

  await shoot("rail", "keyboard-focused-row", async () => {
    await filter.fill("");
    await filter.focus();
    // ArrowDown hands focus to the roving row — focus really placed.
    await filter.press("ArrowDown");
    const focusedRow = await explorer.evaluate(el => {
      const activeElement = el.shadowRoot?.activeElement;
      return activeElement?.closest("li[data-ob-key]")?.getAttribute("data-ob-key") ?? null;
    });
    if (!focusedRow) throw new Error("focus did not land on a rail row");
    return explorer;
  });

  // -- tabs -----------------------------------------------------------------
  await shoot("tabs", "multiple", async () => {
    await expect(tabs.locator('[role="tab"]')).toHaveCount(3);
    return tabs;
  });

  await shoot("tabs", "overflow", async () => {
    const container = tabs.locator(".container");
    for (let index = 0; index < 12; index += 1) {
      if ((await container.getAttribute("data-overflow")) !== "none") break;
      const row = explorer.locator('[part~="operation"]').nth(index);
      if ((await row.count()) === 0) break;
      await row.click();
    }
    if ((await container.getAttribute("data-overflow")) === "none") {
      throw new SkipShot(
        "tab strip did not overflow at this width with every opened operation",
      );
    }
    return tabs;
  });

  // -- document editor ------------------------------------------------------
  const documentEditor = page.locator("ob-obi-editor");
  await shoot("document-editor", "source-focused", async () => {
    const textarea = documentEditor.locator("textarea").first();
    await textarea.click();
    await expect(textarea).toBeFocused();
    return documentEditor;
  });

  await shoot("document-editor", "tree-view", async () => {
    await documentEditor.locator(".view-tree").click();
    await expect(documentEditor.locator(".tree-pane")).toBeVisible();
    return documentEditor;
  });
  // Back to source view for any later full-frame shot.
  if (await documentEditor.locator(".view-source").count()) {
    await documentEditor.locator(".view-source").click();
  }

  // -- connection panel -----------------------------------------------------
  await shoot("connection-panel", "open", async () => {
    await page.locator("#connection-toggle").click();
    await expect(page.locator("#connection-panel")).toBeVisible();
    return page.locator("#connection-panel");
  });
  await page.locator("#connection-close").click();
  await expect(page.locator("#connection-panel")).toBeHidden();

  // -- panels menu over the full workbench ----------------------------------
  await shoot("workbench-full", "panels-menu-open", async () => {
    await page.locator(".layout-menu summary").click();
    await expect(page.locator(".layout-popover")).toBeVisible();
    return "page";
  });
  await page.locator(".layout-menu summary").click();

  // -- demo target: a real multi-value (graph) run with offsets -------------
  await shoot("cockpit-output", "streaming-or-multi-value-with-offsets", async () => {
    await page.locator("#doc-open").click();
    await page.locator("#open-url").fill(DEMO_ORIGIN);
    await page.locator("#ingest-url-submit").click();
    await expect(page.locator("#document-name")).toHaveText("OpenBlendings", {
      timeout: 20_000,
    });
    await selectOperation(page, "placeAndTrack");
    await setEditorValue(
      active,
      '{"customer":"Gallery","drink":"Schema Latte","size":"v2"}',
    );
    await active.locator("button.run").click();
    await expect(active.locator(".output-item")).toHaveCount(2, {
      timeout: 45_000,
    });
    await expect(active.locator(".output-item-offset").first()).toContainText("+");
    return active.locator(".output-column");
  });
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test(`gallery sweep — ${theme} @ ${width}`, async ({ page }) => {
      await sweep(page, theme, width);
    });
  }
}

test.afterAll(async () => {
  // Playwright wipes test-results at run start, so any manifest present now
  // came from an earlier worker of THIS run (a worker restart after a
  // failure). Merge it in first; fresh entries win.
  try {
    const previous = JSON.parse(
      await fs.readFile(path.join(OUT_DIR, "manifest.json"), "utf8"),
    ) as { shots?: ManifestEntry[] };
    for (const entry of previous.shots ?? []) {
      if (!entries.has(entry.id) && entry.status === "shot") {
        entries.set(entry.id, entry);
      }
    }
  } catch {
    // No earlier manifest this run — the common case.
  }
  // Fill unattempted planned ids so the manifest is the complete corpus map.
  for (const [surface, states] of Object.entries(PLAN)) {
    for (const state of states) {
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          const id = shotId(surface, state, theme, width);
          if (!entries.has(id)) {
            entries.set(id, {
              id, surface, state, theme, width,
              status: "skipped",
              reason: "unreachable: sweep did not reach this shot in this run",
            });
          }
        }
      }
    }
  }
  const list = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  const manifest = {
    corpus: "openbindings-workbench-gallery",
    origin: "ob start (port 20395) + ob demo (port 20396)",
    themes: THEMES,
    widths: WIDTHS,
    viewportHeight: VIEWPORT_HEIGHT,
    planned: list.length,
    shot: list.filter(entry => entry.status === "shot").length,
    skipped: list.filter(entry => entry.status === "skipped").length,
    shots: list,
  };
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `gallery manifest: ${manifest.shot} shot, ${manifest.skipped} skipped of ${manifest.planned} planned`,
  );
});
