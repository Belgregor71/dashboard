import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Phase 1 presence-runtime contract (docs/vision/phase-1-presence-runtime.md).
 *
 * Guards two things: with the flag ON the FSM names the presence mode off the
 * screensaver boundary and the dead click-cycle is suppressed; with the flag
 * OFF (production default) behaviour is unchanged and clicks still cycle.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// Flip the feature flag on by appending to the served (non-module) config
// script, so the committed config.js keeps presenceRuntime:false.
async function enablePresence(page) {
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) + "\nwindow.CONFIG.features.presenceRuntime = true;\n";
    await route.fulfill({ response: res, body });
  });
}

test("presence on: FSM tracks the screensaver boundary and suppresses the click-cycle", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enablePresence(page);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__presence === "function");

  // Boot: the dashboard is visibly awake → glance.
  await expect.poll(() => page.evaluate(() => document.body.dataset.presence)).toBe("glance");

  // Drive Mode 0 through the screensaver's own hooks; the FSM must follow.
  const seen = await page.evaluate(async () => {
    const out = [];
    window.__engageScreensaver();
    await new Promise((r) => setTimeout(r, 200));
    out.push(document.body.dataset.presence); // ambient
    window.__wakeScreensaver();
    await new Promise((r) => setTimeout(r, 200));
    out.push(document.body.dataset.presence); // glance
    return out;
  });
  expect(seen).toEqual(["ambient", "glance"]);

  // The click-cycle is dead: a document click must NOT change the view.
  const before = await page.evaluate(() => document.body.dataset.view);
  await page.evaluate(() => document.body.click());
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.body.dataset.view);
  expect(after).toBe(before);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("presence off (default): the click-cycle still advances the view", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => document.body?.dataset?.view === "home");
  await page.waitForTimeout(500);

  await page.evaluate(() => document.body.click());
  await page.waitForFunction(() => document.body.dataset.view !== "home", { timeout: 5_000 });
  const view = await page.evaluate(() => document.body.dataset.view);
  expect(view).not.toBe("home");
});
