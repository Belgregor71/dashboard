import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * WP-D follow-up "living accent" (docs/design/DESIGN_SYSTEM.md §6).
 *
 * With features.livingAccent ON, <body> gets .living-accent and the accent
 * follows the weather: body.living-accent.atmo-* overrides the time-based
 * tint-* --accent (background.css). OFF (default) is byte-identical: no body
 * class, the atmo token changes nothing about --accent.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

function forceLivingAccent(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + `\nwindow.CONFIG.features.livingAccent = ${value};\n`;
      await route.fulfill({ response: res, body });
    });
}

// The computed value of an unregistered custom property preserves the authored
// token stream — normalise whitespace and the minifier's dropped leading zeros
// ("0.94" → ".94") so the assertions don't hang on formatting.
function readAccent(page) {
  return page.evaluate(() =>
    getComputedStyle(document.body)
      .getPropertyValue("--accent")
      .replace(/\s+/g, "")
      .replace(/0\./g, ".")
  );
}

// Deterministic daytime — after sunset body.tint-night sets --accent to the
// very night value the fallback assertion excludes (mirrors the MIDDAY pin in
// ambient-clock.spec / attention.spec).
const MIDDAY = new Date("2026-07-06T12:00:00");

function setAtmo(page, token) {
  return page.evaluate((t) => {
    document.body.classList.remove(
      "atmo-night", "atmo-clear-golden", "atmo-clear-day",
      "atmo-cloudy", "atmo-rain", "atmo-storm", "atmo-fog"
    );
    if (t) document.body.classList.add(t);
  }, token);
}

test("living accent on: the atmo token drives --accent over the tint cycle", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceLivingAccent(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body.classList.contains("living-accent"));

  // Golden hour → the sanctioned §6 warm accent (not --warm).
  await setAtmo(page, "atmo-clear-golden");
  expect(await readAccent(page)).toBe("rgba(255,185,130,.94)");

  // Rain → the cool accent.
  await setAtmo(page, "atmo-rain");
  expect(await readAccent(page)).toBe("rgba(196,230,255,.97)");

  // Night → the night accent (same value the tint cycle used — night unchanged).
  await setAtmo(page, "atmo-night");
  expect(await readAccent(page)).toBe("rgba(130,215,255,.92)");

  // No atmo token at all → the time-based tint-* accent stands (graceful
  // fallback). MIDDAY is pinned, so that's the tint-day value.
  await setAtmo(page, null);
  expect(await readAccent(page)).toBe("rgba(196,230,255,.97)");

  expect(pageErrors).toEqual([]);
});

test("living accent off (default): no body class, atmo token leaves --accent alone", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceLivingAccent(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body.classList.contains("tint-day") || document.body.className !== "");

  expect(await page.evaluate(() => document.body.classList.contains("living-accent"))).toBe(false);

  const before = await readAccent(page);
  await setAtmo(page, "atmo-clear-golden");
  expect(await readAccent(page)).toBe(before); // flag-off: the golden token changes nothing

  expect(pageErrors).toEqual([]);
});
