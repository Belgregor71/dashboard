import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Browser smoke test — the "would this brick the kiosk?" gate.
 *
 * Loads the built bundle headless at kiosk resolution and asserts the app
 * boots without uncaught exceptions and the core surfaces render. Network
 * errors are expected on a dev machine (no HA, no Sonarr…) and are NOT
 * failures; an uncaught page error always is.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// Pin a neutral daytime so the boot is deterministic: away from the morning /
// evening briefing windows (which switchView("briefing") within a 30-min catch-up
// and would steal body.dataset.view) and not night (which auto-engages the
// screensaver). Mirrors the clock pin in presence/attention/ambient-clock specs.
const MIDDAY = new Date("2026-07-06T12:00:00");

test("dashboard boots with no uncaught exceptions and core panels render", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body?.dataset?.view === "home");

  // Clock renders a real time within a couple of ticks.
  await expect(page.locator("#clock")).toContainText(/\d/, { timeout: 10_000 });

  // Let startup work settle (weather fetch, lottie load, HA connect attempt).
  await page.waitForTimeout(5_000);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("view switching cycles without errors and lottie wrappers stay bounded", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // Phase 7 gates passive __switchView into the rich views; pin it off so this
  // lottie-leak guard can actually cycle the views regardless of the committed
  // default (mirrors dissolve.spec's forceSubstrate).
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()) + `\nwindow.CONFIG.features.ambientSubstrate = false;\n` });
  });

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__switchView === "function");
  await page.waitForTimeout(2_000);

  const result = await page.evaluate(async () => {
    const views = ["weather", "cameras", "timeline", "briefing", "status", "home"];
    const seen = [];
    for (const view of views) {
      window.__switchView(view);
      await new Promise((r) => setTimeout(r, 1500));
      seen.push(document.body.dataset.view);
    }
    return {
      seen,
      wrappers: document.querySelectorAll(".lottie-fade").length
    };
  });

  expect(result.seen).toEqual(["weather", "cameras", "timeline", "briefing", "status", "home"]);
  // 7 live weather icons + a small in-flight allowance; the pre-fix kiosk
  // accumulated hundreds of these (see project memory: leak audit 2026-07).
  expect(result.wrappers).toBeLessThanOrEqual(20);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
