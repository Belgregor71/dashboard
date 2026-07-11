import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Phase 7 "Dissolve the dashboard" contract (docs/vision/phase-7-dissolve.md).
 *
 * Two guarantees, both gated on features.ambientSubstrate:
 *  1. The atmo-* token lives on a shared root (<body>) and PERSISTS across a
 *     presence mode change — leaning in during a storm keeps the storm present
 *     in the awake dashboard (it no longer evaporates when the screensaver exits).
 *  2. Passive navigation into the retired rich views (weather/cameras/briefing)
 *     is gated off flag-ON, and unchanged (reachable) flag-OFF. Event/voice
 *     paths pass { force:true } and are covered by their own surfaces.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// Force the feature flag by appending to the served (non-module) config script,
// so the test is independent of the committed default (which flips once the Pi
// GPU gate passes). Mirrors presence.spec's forcePresence helper.
function forceSubstrate(value) {
  return async (page) => {
    await page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text())
        + `\nwindow.CONFIG.features.ambientSubstrate = ${value};`
        // Phase 9.5: pin the Immich photo source off — its async init fetch would
        // otherwise delay the __engageScreensaver hook this spec drives.
        + `\nwindow.CONFIG.features.immichPhotos = false;\n`;
      await route.fulfill({ response: res, body });
    });
  };
}

// Pin a deterministic daytime so isNight() is false — otherwise, after sunset,
// initScreensaver() auto-engages the dim clock at boot and the dashboard isn't
// awake to carry the substrate. (Same guard as presence.spec.)
const MIDDAY = new Date("2026-07-06T12:00:00");

test("substrate on: the atmosphere token persists across a presence mode change", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceSubstrate(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__atmosphere === "function");

  // Awake at boot: the shared root is marked and dressed.
  await expect
    .poll(() => page.evaluate(() => document.body.classList.contains("substrate")))
    .toBe(true);

  // Drive Mode 0 → awake via the screensaver's own hooks and read the shared
  // root's atmo-* token at each stage. The token is weather-derived (real
  // condition wins over a forced one), so we assert it's PRESENT and the SAME
  // token throughout — the mood no longer evaporates when the screensaver exits.
  const result = await page.evaluate(async () => {
    const bodyToken = () =>
      [...document.body.classList].find((c) => c.startsWith("atmo-")) ?? null;
    const awake = bodyToken();
    window.__engageScreensaver();
    await new Promise((r) => setTimeout(r, 200));
    const ambient = bodyToken();
    window.__wakeScreensaver();
    await new Promise((r) => setTimeout(r, 200));
    const backAwake = bodyToken();
    return { awake, ambient, backAwake };
  });

  expect(result.awake).toMatch(/^atmo-/);          // dressed while awake
  expect(result.ambient).toBe(result.awake);        // still dressed in Mode 0
  expect(result.backAwake).toBe(result.awake);      // and persists on the way back
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("substrate on: passive navigation into a retired view is gated off", async ({ page }) => {
  await forceSubstrate(true)(page);
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__switchView === "function");
  await page.waitForFunction(() => document.body?.dataset?.view === "home");

  await page.evaluate(() => window.__switchView("weather"));
  await page.waitForTimeout(300);
  // The passive nav is a no-op — the awake substrate stays put on home.
  expect(await page.evaluate(() => document.body.dataset.view)).toBe("home");
});

test("substrate off: navigation into the rich views is unchanged", async ({ page }) => {
  await forceSubstrate(false)(page);
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__switchView === "function");
  await page.waitForFunction(() => document.body?.dataset?.view === "home");

  await page.evaluate(() => window.__switchView("weather"));
  await page.waitForFunction(() => document.body.dataset.view === "weather", { timeout: 5_000 });
  expect(await page.evaluate(() => document.body.dataset.view)).toBe("weather");
});
