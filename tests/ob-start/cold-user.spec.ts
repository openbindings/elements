import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

let servers: Server[] = [];
let origins: string[] = [];
let delayedTarget: number | null = null;
let heldResponses: Array<() => void> = [];

function releaseHeldResponses() {
  for (const release of heldResponses.splice(0)) release();
}
let receipts: { target: number; path: string; key: boolean; backend: boolean; query: string }[] = [];

test.beforeAll(async () => {
  for (const target of [0, 1]) {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, origins[target]);
      res.setHeader("Content-Type", "application/json");
      if (url.pathname === "/openapi.json") {
        const ok = { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } } } };
        const document = JSON.stringify({ openapi: "3.1.2", info: { title: `Cold target ${target}`, version: "1" }, servers: [{ url: "/api" }],
          components: { securitySchemes: { TestKey: { type: "apiKey", in: "header", name: "X-Test-Key" } } },
          paths: {
            "/secure": { get: { operationId: "secure", security: [{ TestKey: [] }], responses: { "200": ok } } },
            "/list": { get: { operationId: "list", parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }], responses: { "200": ok } } },
            "/choice": { get: { operationId: "chooseServer", servers: [{ url: origins[0] + "/api" }, { url: origins[1] + "/api" }], responses: { "200": ok } } },
            "/drift": { get: { operationId: "drift", responses: { "200": ok } } },
          } });
        if (delayedTarget === target) heldResponses.push(() => res.end(document));
        else res.end(document);
        return;
      }
      receipts.push({ target, path: url.pathname, key: req.headers["x-test-key"] === "test-only", backend: JSON.stringify(req.headers).includes("test-token"), query: url.search });
      if (url.pathname === "/api/drift") res.end('{"unexpected":"private-response-sentinel"}');
      else res.end('{"ok":true}');
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    origins.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }
});

test.afterAll(async () => {
  releaseHeldResponses();
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});
test.beforeEach(async ({ page }) => {
  receipts = [];
  delayedTarget = null;
  releaseHeldResponses();
  await page.goto("/#token=test-token");
  await expect(page.locator("#connection-status-text")).toHaveText("Ready");
});

test.afterEach(() => {
  delayedTarget = null;
  releaseHeldResponses();
});

async function acquire(page: Page, target: number) {
  if (await page.locator("#context-dialog").isVisible()) await page.locator("#context-close").click();
  await page.locator("#acquire-open").click();
  await page.locator("#acquire-locator").fill(origins[target] + "/openapi.json");
  await expect(page.locator("#acquire-replace")).toBeEnabled({ timeout: 30000 });
  await page.locator("#acquire-replace").click();
  await expect(page.locator("#acquire-dialog")).toBeHidden();
}
async function select(page: Page, operation: string) {
  await page.locator("ob-obi-explorer").locator(".operation-key").getByText(operation, { exact: true }).click();
  await expect(page.locator("#sheet-run")).toBeEnabled();
}

test("credentials never survive target replacement or leak the backend token", async ({ page }) => {
  await acquire(page, 0);
  await select(page, "secure");
  await page.locator("#sheet-run").click();
  await expect(page.locator("#requirement-fields input")).toBeVisible();
  expect(receipts.filter(r => r.path === "/api/secure")).toEqual([]);
  await page.locator("#requirement-fields input").fill("test-only");
  await page.locator("#apply-requirements").click();
  await expect.poll(() => receipts.filter(r => r.key).length).toBe(1);
  await acquire(page, 1);
  await select(page, "secure");
  await page.locator("#sheet-run").click();
  await expect(page.locator("#requirement-fields input")).toBeVisible();
  await expect(page.locator("#requirement-fields input")).toHaveValue("");
  expect(receipts.some(r => r.target === 1 || r.backend)).toBe(false);
});

test("numeric strict invocation, source bases, choice rendering and explicit raw recovery", async ({ page }) => {
  await acquire(page, 0);
  await select(page, "list");
  const workbench = page.locator("ob-operation-workbench:not([hidden])");
  // Use the rendered JSON editor, not a patched invocation implementation.
  const editor = workbench.getByRole("textbox", { name: "Input for list as JSON", exact: true });
  await editor.fill('{"limit":2}');
  await page.locator("#sheet-run").click();
  await expect.poll(() => receipts.some(r => r.path === "/api/list" && r.query === "?limit=2")).toBe(true);
  await select(page, "chooseServer");
  await page.locator("#sheet-run").click();
  const choices = page.locator("#requirement-fields select");
  await expect(choices).toBeVisible();
  await expect(choices.locator("option")).toHaveCount(3);
  await choices.selectOption(JSON.stringify(origins[1] + "/api"));
  await page.locator("#apply-requirements").click();
  await expect.poll(() => receipts.some(r => r.target === 1 && r.path === "/api/choice")).toBe(true);
  if (await page.locator("#context-dialog").isVisible()) await page.locator("#context-close").click();
  await select(page, "drift");
  await page.locator("#sheet-run").click();
  await expect(page.locator("#sheet-status")).toContainText("ERR_OPERATION_VALIDATION_FAILED");
  await expect(page.locator("#sheet-status")).toBeDisabled();
  await expect(page.locator("#bootstrap-message")).toContainText("Operation contract output:");
  await expect(page.locator("#bootstrap-message")).not.toContainText("private-response-sentinel");
  const before = receipts.filter(r => r.path === "/api/drift").length;
  await page.locator("#invocation-mode").selectOption("binding");
  expect(receipts.filter(r => r.path === "/api/drift").length).toBe(before);
  const binding = workbench.getByRole("combobox", { name: "Binding for drift", exact: true });
  const exact = binding.locator('option:not([value=""])');
  await expect(exact).toHaveCount(1);
  await binding.selectOption((await exact.getAttribute("value"))!);
  await page.locator("#sheet-run").click();
  await expect(workbench.locator('[part~="output"] .cm-content').first()).toContainText("private-response-sentinel");
  expect(receipts.some(r => r.backend)).toBe(false);
});

test("fresh matching challenges may reuse values but unrelated operations never inherit them", async ({ page }) => {
  await acquire(page, 0);
  await select(page, "secure");
  await page.locator("#sheet-run").click();
  await page.locator("#requirement-fields input").fill("test-only");
  await page.locator("#apply-requirements").click();
  await expect(page.locator("#sheet-status")).toContainText("1 value");
  await page.locator("#context-close").click();
  await select(page, "list");
  await page.locator("#sheet-run").click();
  await expect.poll(() => receipts.filter(r => r.path === "/api/list").length).toBe(1);
  expect(receipts.find(r => r.path === "/api/list")?.key).toBe(false);
  await select(page, "secure");
  await page.locator("#sheet-run").click();
  await expect(page.locator("#requirement-fields input")).toHaveValue("test-only");
  expect(receipts.filter(r => r.path === "/api/secure").length).toBe(1);
  await page.locator("#apply-requirements").click();
  await expect.poll(() => receipts.filter(r => r.path === "/api/secure").length).toBe(2);
});

test("a late old-document challenge cannot authorize the replacement", async ({ page }) => {
  await acquire(page, 0);
  await select(page, "secure");
  delayedTarget = 0;
  await page.locator("#sheet-run").click();
  // Prove the old request is in flight, then keep its response blocked until
  // replacement completes. Wall-clock fixture delays cannot establish order.
  await expect.poll(() => heldResponses.length).toBeGreaterThan(0);
  await acquire(page, 1);
  delayedTarget = null;
  releaseHeldResponses();
  await page.waitForTimeout(1000); // bounded observation window for a stale challenge
  await expect(page.locator("#target-requirements")).toBeHidden();
  expect(receipts.filter(r => r.path === "/api/secure")).toEqual([]);
  await select(page, "secure");
  await page.locator("#sheet-run").click();
  await expect(page.locator("#requirement-fields input")).toHaveValue("");
});
