import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * WP-D follow-up "day-boundary photo cross-dissolve" (features.awakePhotoDissolve).
 *
 * With the flag ON, __forcePhotoDissolve fades a NEW Immich photo in over the
 * old (two .awake-photo imgs during the settle), then removes the old node and
 * hands the #awake-photo id to the survivor — bounded DOM, symmetric teardown.
 * OFF (default): no hook, the photo holds for the session.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

async function stubImmich(page) {
  let n = 0;
  // The boot asset is always offered FIRST in every response — so the dissolve
  // only lands on a fresh photo if its repeat-guard skips the current asset
  // (a naive ids[0] pick would re-serve the boot photo and fail the src check).
  await page.route("**/api/immich/random**", (route) =>
    route.fulfill({ json: { assets: [{ id: "boot-asset" }, { id: `fresh-${++n}` }] } })
  );
  await page.route("**/api/immich/asset/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG })
  );
}

function enableFlags(dissolve) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        "\nwindow.CONFIG.features.awakeGround = true;" +
        `\nwindow.CONFIG.features.awakePhotoDissolve = ${dissolve};\n`;
      await route.fulfill({ response: res, body });
    });
}

test("dissolve on: new photo fades in over the old, old node removed, id handed off", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await stubImmich(page);
  await enableFlags(true)(page);

  await page.goto("/");
  // Boot photo loaded (stub answers instantly).
  await page.waitForFunction(
    () => document.getElementById("awake-photo")?.classList.contains("is-loaded")
  );
  const bootSrc = await page.evaluate(() => document.getElementById("awake-photo").src);

  // Force the dissolve with a fast settle (200ms + 2s cleanup buffer).
  expect(await page.evaluate(() => typeof window.__forcePhotoDissolve)).toBe("function");
  await page.evaluate(() => window.__forcePhotoDissolve({ settleMs: 200 }));

  // During the settle: TWO imgs (old + incoming later sibling).
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll(".awake-photo").length))
    .toBe(2);

  // After cleanup: back to ONE img, it owns the id, and it is the NEW photo.
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll(".awake-photo").length), {
      timeout: 8000
    })
    .toBe(1);
  const after = await page.evaluate(() => {
    const el = document.getElementById("awake-photo");
    return { src: el?.src ?? "", loaded: el?.classList.contains("is-loaded") ?? false };
  });
  expect(after.src).not.toBe(bootSrc);
  expect(after.loaded).toBe(true);

  // A second forced dissolve still works (the in-flight latch released).
  expect(await page.evaluate(() => window.__forcePhotoDissolve({ settleMs: 200 }))).toBeTruthy();

  expect(pageErrors).toEqual([]);
});

test("dissolve off (default): no hook, the photo holds", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await stubImmich(page);
  await enableFlags(false)(page);

  await page.goto("/");
  await page.waitForFunction(() => document.getElementById("awake-photo") !== null);

  expect(await page.evaluate(() => typeof window.__forcePhotoDissolve)).toBe("undefined");
  expect(await page.evaluate(() => document.querySelectorAll(".awake-photo").length)).toBe(1);

  expect(pageErrors).toEqual([]);
});
