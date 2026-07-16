import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design-system rollout WP-D (docs/design/DESIGN_ROLLOUT.md) — the awake
 * photographic ground.
 *
 * With features.awakeGround ON, <body> gets .awake-ground: a static #awake-photo
 * layer is created behind the awake modes, the animated aurora/stars/time-tint are
 * retired, and a readability gradient (::after) sits over the atmosphere tint. The
 * photo is static (no rotation timer) so the ground adds no animation. OFF
 * (default) is byte-identical: no #awake-photo, aurora visible.
 *
 * Immich is stubbed off in tests, so the photo <img> exists but never loads — we
 * assert the structural layers, not a real image.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

const MIDDAY = new Date("2026-07-06T12:00:00");

function forceAwakeGround(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + `\nwindow.CONFIG.features.awakeGround = ${value};\n`;
      await route.fulfill({ response: res, body });
    });
}

const disp = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).display : "absent";
  }, sel);

test("awake ground on: photo layer created, aurora retired, readability gradient present", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceAwakeGround(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body.dataset.view === "home");
  await page.waitForFunction(() => document.getElementById("awake-photo") !== null);

  await expect(page.locator("body")).toHaveClass(/awake-ground/);

  // The photo layer exists, is a bottom-anchored full-bleed <img>, cover-fit.
  const photo = await page.evaluate(() => {
    const el = document.getElementById("awake-photo");
    const cs = getComputedStyle(el);
    return { tag: el.tagName, objectFit: cs.objectFit, position: cs.position, filter: cs.filter };
  });
  expect(photo.tag).toBe("IMG");
  expect(photo.objectFit).toBe("cover");
  expect(photo.position).toBe("absolute");

  // The brightness clamp Mode 0 already puts on .screensaver__photo. Without it
  // a blown-out photo reaches the surface at full 255 and the light tokens go
  // illegible — measured 1.17:1 on the top row, 1.76:1 on the hero, against a
  // 3:1 bar. Not cosmetic: the tint/text-shadow alone cannot recover it.
  expect(photo.filter).toContain("brightness(0.62)");

  // The animated aurora HUD + time tint are retired.
  expect(await disp(page, "#aurora-sky")).toBe("none");
  expect(await disp(page, ".aurora-blobs")).toBe("none");
  expect(await disp(page, "#stars")).toBe("none");
  expect(await disp(page, "#background-tint")).toBe("none");

  // The readability gradient (::after) carries a gradient, not "none".
  const readGrad = await page.evaluate(
    () => getComputedStyle(document.body, "::after").backgroundImage
  );
  expect(readGrad).toContain("gradient");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("awake ground off: aurora intact, no photo layer (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceAwakeGround(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body.dataset.view === "home");

  await expect(page.locator("body")).not.toHaveClass(/awake-ground/);
  expect(await page.evaluate(() => document.getElementById("awake-photo"))).toBeNull();
  expect(await disp(page, "#aurora-sky")).not.toBe("none"); // aurora still shows

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
