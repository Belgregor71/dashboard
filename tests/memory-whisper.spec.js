import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design-system rollout WP-E (docs/design/DESIGN_ROLLOUT.md) — the captioned
 * memory whisper.
 *
 * With features.memoryWhisper ON, the Mode-0 "on this day" surface moves from the
 * footer line into the study-01 bottom-right whisper: a faint eyebrow + a display
 * title (DESIGN_SYSTEM.md §2.1). It shows only when today has an anniversary
 * (silence is the default). OFF (default) is byte-identical: no whisper element,
 * the footer keeps the line.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// A deterministic daytime, with an anniversary landing on that very day.
const MIDDAY = new Date("2026-07-06T12:00:00");
const ANNIVERSARY = { start: "2026-07-06T10:00:00", title: "Mum & Dad's anniversary" };

function forceMemoryWhisper(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        `\nwindow.CONFIG.features.memoryWhisper = ${value};` +
        `\nwindow.CONFIG.features.immichPhotos = false;\n`;
      await route.fulfill({ response: res, body });
    });
}

test("memory whisper on: eyebrow + title surface bottom-right for today's anniversary", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceMemoryWhisper(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__engageScreensaver === "function");

  // Seed today's anniversary the way the calendar feed does, then engage Mode 0.
  await page.evaluate((ev) => { window.__CAL_EVENTS__ = [ev]; }, ANNIVERSARY);
  await page.evaluate(() => window.__engageScreensaver());

  const whisper = page.locator("#screensaver .screensaver__memory");
  await expect(whisper).toHaveCount(1);
  await expect(whisper).toHaveClass(/is-visible/);
  await expect(page.locator("#screensaver .screensaver__memory-title")).toHaveText("Mum & Dad's anniversary");
  await expect(page.locator("#screensaver .screensaver__memory-eyebrow")).toContainText(/on this day/i);

  // The footer no longer carries the on-this-day line (it moved to the whisper).
  const footer = await page.evaluate(() => document.querySelector("#screensaver .screensaver__footer")?.textContent ?? "");
  expect(footer).not.toContain("Mum & Dad");

  // Legibility guardrail (sweep 2026-07-18): at 0.42 the eyebrow measured 2.92:1
  // over a worst-case white photo against the 3:1 bar; 0.50 clears every atmo-*
  // token (3.48:1 worst). Pin the fixed ink so a restyle can't quietly regress it.
  const eyebrowColor = await page.evaluate(() =>
    getComputedStyle(document.querySelector("#screensaver .screensaver__memory-eyebrow")).color);
  expect(eyebrowColor).toBe("rgba(238, 243, 251, 0.5)");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("memory whisper on: hidden when today has no anniversary (silence is default)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceMemoryWhisper(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__engageScreensaver === "function");
  await page.evaluate(() => { window.__CAL_EVENTS__ = []; });
  await page.evaluate(() => window.__engageScreensaver());

  await expect(page.locator("#screensaver .screensaver__memory")).not.toHaveClass(/is-visible/);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("memory whisper off: no whisper element (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceMemoryWhisper(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__engageScreensaver === "function");
  await page.evaluate(() => window.__engageScreensaver());

  await expect(page.locator("#screensaver .screensaver__memory")).toHaveCount(0);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
