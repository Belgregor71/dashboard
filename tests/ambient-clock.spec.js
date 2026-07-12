import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design study 05 "The Ambient Clock" (docs/design/homeos-ambient-clock.html),
 * WP1 of docs/design/PLAN.md.
 *
 * With features.ambientClock ON, the Mode-0 clock carries the study treatment:
 * tabular figures + a quieter meridiem span, and a sun-altitude dim written to
 * --clock-dim on a ~0.3→0.9 curve. OFF (default) is byte-identical: plain clock
 * string, no meridiem span, no --clock-dim.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

function forceAmbientClock(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        `\nwindow.CONFIG.features.ambientClock = ${value};` +
        // Pin Immich off so the async photo fetch never delays __engageScreensaver.
        `\nwindow.CONFIG.features.immichPhotos = false;\n`;
      await route.fulfill({ response: res, body });
    });
}

// Deterministic daytime → isNight() false (no auto-engage at boot) and the sun
// is well up, so the dim clamps to the daytime ceiling (0.9) regardless of the
// runner's timezone.
const MIDDAY = new Date("2026-07-06T12:00:00");

test("ambient clock on: tabular face, meridiem span, sun-altitude dim", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceAmbientClock(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__engageScreensaver === "function" && typeof window.__ambientClock === "function"
  );
  await page.evaluate(() => window.__engageScreensaver());

  const saver = page.locator("#screensaver");
  await expect(saver).toHaveClass(/screensaver--ambient-clock/);

  // The meridiem is split into its own span so it can be set quieter/smaller.
  const meridiem = page.locator("#screensaver .screensaver__meridiem");
  await expect(meridiem).toHaveText(/^[ap]m$/i);

  // Tabular figures on the time so the digits never jitter as minutes tick.
  const numeric = await page.evaluate(
    () => getComputedStyle(document.querySelector("#screensaver .screensaver__time")).fontVariantNumeric
  );
  expect(numeric).toContain("tabular-nums");

  // The dim is written and, at midday, clamps to the daytime ceiling.
  const probe = await page.evaluate(() => window.__ambientClock());
  expect(probe.enabled).toBe(true);
  expect(typeof probe.altitudeDeg).toBe("number");
  const dim = parseFloat(probe.dim);
  expect(dim).toBeGreaterThanOrEqual(0.3);
  expect(dim).toBeLessThanOrEqual(0.9);
  expect(dim).toBeCloseTo(0.9, 2); // sun well up at midday → the ceiling

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("ambient clock off: byte-identical plain clock", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceAmbientClock(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__engageScreensaver === "function");
  await page.evaluate(() => window.__engageScreensaver());

  await expect(page.locator("#screensaver")).not.toHaveClass(/screensaver--ambient-clock/);
  await expect(page.locator("#screensaver .screensaver__meridiem")).toHaveCount(0);

  const probe = await page.evaluate(() => window.__ambientClock());
  expect(probe.enabled).toBe(false);
  expect(probe.dim).toBeNull();

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
