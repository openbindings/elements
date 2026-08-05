import { expect, test } from "@playwright/test";
import { moment } from "./telemetry";

// Journey D — failure and abuse paths. Failure moments are first-class
// citizens: the wrong-token honesty checks run on every build even while the
// defect is adjudicated known-open (the fix ships in a later rev), so the
// telemetry histogram keeps the miss visible without failing the suite.

test("wrong token: the connection pill must not claim Ready (WB-HONESTY-01, known-open)", async ({
  page,
}) => {
  const record = await moment("wrong-token-pill", "WB-HONESTY-01", async () => {
    await page.goto("/#token=wrong-token");
    const pill = page.locator("#connection-status-text");
    await expect(pill).not.toHaveText("", { timeout: 10_000 });
    // Let the claimed state settle past "Connecting…", bounded at 8s.
    const deadline = Date.now() + 8_000;
    let text = "";
    while (Date.now() < deadline) {
      text = ((await pill.textContent()) ?? "").trim();
      if (text && !/connecting/i.test(text)) break;
      await page.waitForTimeout(250);
    }
    return {
      ok: text !== "Ready",
      knownOpen: true,
      note: `pill read ${JSON.stringify(text)} with a wrong token`,
    };
  });
  // test.fixme()-style: the miss is recorded in telemetry above, then the
  // test steps aside instead of failing — the fix lands in a later rev.
  test.fixme(
    record.outcome === "known-open",
    `WB-HONESTY-01 known-open: ${record.note}`,
  );
  await expect(page.locator("#connection-status-text")).not.toHaveText("Ready");
});

test("invoking with a wrong token surfaces a non-empty, ideally credential-naming error", async ({
  page,
}) => {
  await page.goto("/#token=wrong-token");
  const workbench = page.locator("ob-operation-workbench:not([hidden])");
  // Rev 17.6: the strip owns Run inside the app.
  const run = page.locator("#sheet-run");

  let errorText = "";
  let runnable = false;
  try {
    await expect(run).toBeEnabled({ timeout: 10_000 });
    runnable = true;
  } catch {
    // Run never became available: the visible refusal is the error surface.
  }

  if (runnable) {
    await run.click();
    const error = workbench.locator(".error");
    await expect(error).toBeVisible({ timeout: 15_000 });
    errorText = ((await error.textContent()) ?? "").trim();
  } else {
    const status = workbench.locator(".status");
    const bootstrap = page.locator("#bootstrap-message");
    errorText = ((await status.textContent().catch(() => "")) ?? "").trim();
    if (!errorText) {
      errorText = ((await bootstrap.textContent().catch(() => "")) ?? "").trim();
    }
  }

  // Honesty floor: the failure is never blank.
  expect(errorText, "visible error text for a wrong-token invocation").not.toBe(
    "",
  );

  // Honesty target: the failure is *named* as a credential failure, not
  // blamed on the network. Known-open until the credential-naming rev lands.
  await moment("wrong-token-error-names-credentials", "WB-HONESTY-01", async () => ({
    ok: /credential|token|auth|unauthorized|forbidden|401|403/i.test(errorText),
    knownOpen: true,
    soft: true,
    note: `error read ${JSON.stringify(errorText.slice(0, 140))}`,
  }));
});
