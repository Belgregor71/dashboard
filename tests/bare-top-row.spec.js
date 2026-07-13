import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design-system rollout WP-B (docs/design/DESIGN_ROLLOUT.md) — the bare top row.
 *
 * With features.bareTopRow ON, the awake Glance/Lean-in top row sheds its old
 * chrome: <body> gets .bare-top-row, the clock/weather glass cards go bare, the
 * date + weather icon + wind + hi/lo range are hidden, and the condition line is
 * uppercased (LOCATION · CONDITION). OFF (default) is byte-identical.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

const MIDDAY = new Date("2026-07-06T12:00:00");

function forceBareTopRow(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + `\nwindow.CONFIG.features.bareTopRow = ${value};\n`;
      await route.fulfill({ response: res, body });
    });
}

const disp = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).display : "absent";
  }, sel);

test("bare top row on: body class, bare clock, hidden date/icon/wind/range, uppercased condition", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceBareTopRow(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body.dataset.view === "home");

  await expect(page.locator("body")).toHaveClass(/bare-top-row/);

  // The date belongs to the Ambient clock; the awake top row drops it.
  expect(await disp(page, "#date")).toBe("none");
  // Borrowed light — no weather icon; wind + hi/lo range gone too.
  expect(await disp(page, "#weather-lottie")).toBe("none");
  expect(await disp(page, "#weather-range")).toBe("none");
  expect(await disp(page, ".weather-wind")).toBe("none");
  // The middle slot yields — commute/next-event flow into the attention queue.
  expect(await disp(page, "#middle-slot")).toBe("none");

  // The clock reads as the bare design-system time (tabular, --ink).
  const clock = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById("clock"));
    return { fvn: cs.fontVariantNumeric, weight: cs.fontWeight };
  });
  expect(clock.fvn).toContain("tabular-nums");
  expect(clock.weight).toBe("500");

  // The condition line is uppercased and the location carries the middot separator.
  const cond = await page.evaluate(() => getComputedStyle(document.getElementById("current-conditions")).textTransform);
  expect(cond).toBe("uppercase");
  const midDot = await page.evaluate(
    () => getComputedStyle(document.getElementById("weather-home-location"), "::after").content
  );
  expect(midDot).toContain("·");

  // The clock's glass card is stripped (no gradient background image on it).
  const timeBg = await page.evaluate(() => getComputedStyle(document.getElementById("time-panel")).backgroundImage);
  expect(timeBg).toBe("none");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("bare top row off: chrome intact (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceBareTopRow(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body.dataset.view === "home");

  await expect(page.locator("body")).not.toHaveClass(/bare-top-row/);
  expect(await disp(page, "#date")).not.toBe("none"); // the date still shows

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
