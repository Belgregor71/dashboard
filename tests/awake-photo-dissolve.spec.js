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

/**
 * Recovery from a dead Immich (2026-08-04).
 *
 * These live in this file rather than awake-ground.spec.js because they need
 * per-request control of the Immich stub, which is the infrastructure here —
 * but the behaviour under test belongs to `awakeGround`: the ground's job is
 * that there IS a photo, and `awakePhotoTick` is what repairs it.
 *
 * Both bugs had the same shape and the same consequence — a latch or a guard
 * left in a state nothing could clear, on a page that runs for weeks between
 * reloads, so the ground never changes again. They are asserted through the
 * `__awakePhotoTick` seam because the real one fires every ten minutes.
 */
test.describe("recovering from a dead Immich", () => {
  test("a photo that never arrives at boot is retried, not abandoned", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Immich is asleep: the asset list comes back empty, so no <img> src is ever
    // set and `awakePhotoDay` is never written. That guard is what used to make
    // this permanent.
    let awake = false;
    await page.route("**/api/immich/random**", (route) =>
      route.fulfill({ json: { assets: awake ? [{ id: "late-asset" }] : [] } })
    );
    await page.route("**/api/immich/asset/**", (route) =>
      route.fulfill({ contentType: "image/png", body: PNG })
    );
    await enableFlags(true)(page);

    await page.goto("/");
    await page.waitForFunction(() => document.getElementById("awake-photo") !== null);

    // The layer exists but carries no photo — the sky gradient is showing.
    const booted = await page.evaluate(() => {
      const el = document.getElementById("awake-photo");
      return { loaded: el.classList.contains("is-loaded"), src: el.getAttribute("src") };
    });
    expect(booted.loaded).toBe(false);
    expect(booted.src).toBe(null);

    // A tick while Immich is still down must not wedge anything either.
    // ⚠ Awaited, and the tick returns its promise so that this actually waits:
    // firing the next tick while this fetch is in flight hits the in-flight
    // latch, is correctly refused, and reads as "the retry is broken".
    await page.evaluate(() => window.__awakePhotoTick());
    expect(
      await page.evaluate(() => document.getElementById("awake-photo").classList.contains("is-loaded"))
    ).toBe(false);

    // The NAS wakes. The very next tick puts a photo on the glass.
    awake = true;
    await page.evaluate(() => window.__awakePhotoTick());
    await page.waitForFunction(
      () => document.getElementById("awake-photo")?.classList.contains("is-loaded"),
      null,
      { timeout: 8000 }
    );
    expect(await page.evaluate(() => document.getElementById("awake-photo").src)).toContain("late-asset");

    // Exactly one img — a retry must never leave a second layer behind.
    expect(await page.evaluate(() => document.querySelectorAll(".awake-photo").length)).toBe(1);
    expect(pageErrors).toEqual([]);
  });

  test("a broken image at boot leaves the retry able to run", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // The asset list answers, so a src IS set — but the image 404s. `onerror`
    // did not exist before this fix, so the in-flight latch is the thing under
    // test: it must be clear for the tick to get another go.
    let broken = true;
    await page.route("**/api/immich/random**", (route) =>
      route.fulfill({ json: { assets: [{ id: broken ? "broken-asset" : "good-asset" }] } })
    );
    await page.route("**/api/immich/asset/**", (route) =>
      broken ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ contentType: "image/png", body: PNG })
    );
    await enableFlags(true)(page);

    await page.goto("/");
    await page.waitForFunction(() => document.getElementById("awake-photo")?.getAttribute("src") !== null);
    expect(
      await page.evaluate(() => document.getElementById("awake-photo").classList.contains("is-loaded"))
    ).toBe(false);

    broken = false;
    await page.evaluate(() => window.__awakePhotoTick());
    await page.waitForFunction(
      () => document.getElementById("awake-photo")?.classList.contains("is-loaded"),
      null,
      { timeout: 8000 }
    );
    expect(await page.evaluate(() => document.getElementById("awake-photo").src)).toContain("good-asset");
    expect(pageErrors).toEqual([]);
  });

  test("a dissolve whose image hangs releases the latch instead of holding it forever", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    let hang = false;
    let n = 0;
    await page.route("**/api/immich/random**", (route) =>
      route.fulfill({ json: { assets: [{ id: "boot-asset" }, { id: `fresh-${++n}` }] } })
    );
    // A request that never settles: neither `load` nor `error` will ever fire on
    // the <img>, which is the sleeping-NAS shape and the one case the old code
    // had no way out of.
    await page.route("**/api/immich/asset/**", async (route) => {
      if (hang && route.request().url().includes("fresh-")) return; // never fulfilled
      await route.fulfill({ contentType: "image/png", body: PNG });
    });
    await enableFlags(true)(page);

    await page.goto("/");
    await page.waitForFunction(
      () => document.getElementById("awake-photo")?.classList.contains("is-loaded")
    );
    const bootSrc = await page.evaluate(() => document.getElementById("awake-photo").src);

    // A dissolve that hangs. Short stall so the suite does not sit out the real
    // 30s; the path is identical.
    hang = true;
    expect(await page.evaluate(() => window.__forcePhotoDissolve({ settleMs: 200, stallMs: 600 }))).toBeTruthy();

    // The stalled node is detached and the old photo is still the one on screen.
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll(".awake-photo").length), { timeout: 8000 })
      .toBe(1);
    expect(await page.evaluate(() => document.getElementById("awake-photo").src)).toBe(bootSrc);

    // The claim: the NEXT dissolve still runs. Before the fix this returned
    // false forever and the photo never changed again.
    hang = false;
    expect(await page.evaluate(() => window.__forcePhotoDissolve({ settleMs: 200 }))).toBeTruthy();
    await expect
      .poll(() => page.evaluate(() => document.getElementById("awake-photo")?.src ?? ""), { timeout: 10000 })
      .not.toBe(bootSrc);

    expect(await page.evaluate(() => document.querySelectorAll(".awake-photo").length)).toBe(1);
    expect(pageErrors).toEqual([]);
  });
});
