import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design-system follow-up (docs/design/DESIGN_ROLLOUT.md) — fold the remaining
 * home tiles (Tonight's Menu + Bins) off the presence surface.
 *
 * With features.foldHomeTiles ON, tonight's dinner surfaces as the quietest
 * low-band attention candidate (source "tonightsMenu") and the #home-stack tiles
 * are hidden (bins are already carried by the bin-night predictive candidate).
 * OFF (default) is byte-identical: no candidate, the tiles show.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

const MIDDAY = new Date("2026-07-06T12:00:00");

function enableFlags(fold) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        "\nwindow.CONFIG.features.presenceRuntime = true;" +
        "\nwindow.CONFIG.features.attentionEngine = true;" +
        `\nwindow.CONFIG.features.foldHomeTiles = ${fold};\n`;
      await route.fulfill({ response: res, body });
    });
}

// Mark the menu tile active the way tonightsMenu.js does when there's a dinner.
function activateMenu(page) {
  return page.evaluate(() => {
    const t = document.getElementById("menu-tile");
    t.classList.remove("is-hidden", "is-collapsed");
    document.getElementById("menu-tile-name").textContent = "Steak Sandwich";
  });
}

test("fold home tiles on: dinner rides the queue, #home-stack hidden", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/index.html");
  await page.waitForFunction(() => typeof window.__attention === "function");

  await expect(page.locator("body")).toHaveClass(/fold-home-tiles/);

  await activateMenu(page);
  await page.evaluate(() => window.__presence("dwell"));

  await expect
    .poll(() => page.evaluate(() => window.__attention().queue.some((c) => c.source === "tonightsMenu")))
    .toBe(true);
  const menu = await page.evaluate(() => window.__attention().queue.find((c) => c.source === "tonightsMenu"));
  expect(menu.text).toContain("Steak Sandwich");
  expect(menu.score).toBeLessThan(41); // quietest low-band
  expect(menu.stackOnly).toBe(true); // stack card only, never the centred hero

  const stackDisplay = await page.evaluate(() => getComputedStyle(document.getElementById("home-stack")).display);
  expect(stackDisplay).toBe("none");
  expect(await page.evaluate(() => document.getElementById("menu-tile") !== null)).toBe(true);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("fold home tiles off: no menu candidate, tiles visible (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/index.html");
  await page.waitForFunction(() => typeof window.__attention === "function");

  await expect(page.locator("body")).not.toHaveClass(/fold-home-tiles/);

  await activateMenu(page);
  await page.evaluate(() => window.__presence("dwell"));

  const hasMenu = await page.evaluate(() =>
    window.__attention().queue.some((c) => c.source === "tonightsMenu")
  );
  expect(hasMenu).toBe(false);

  const stackDisplay = await page.evaluate(() => getComputedStyle(document.getElementById("home-stack")).display);
  expect(stackDisplay).not.toBe("none");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
