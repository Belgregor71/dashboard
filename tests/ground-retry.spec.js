import { test, expect } from "./fixtures/coverage.js";

/* THE GROUND'S SECOND ATTEMPT — audit C1.
 *
 * `ground-diptych.spec.js` already drives `dissolve()` (twice, via
 * `__groundDissolve`) and the ERROR path of the first load (every thumb 404s).
 * Two terminal paths were still untested, and they are the two that decide
 * whether a wall that came up to nothing ever recovers:
 *
 *   1. THE STALL. A thumb that neither loads nor errors — a request that simply
 *      hangs, which is what a flaky Immich actually does. A 404 fires `onerror`
 *      and takes the latch immediately; a hang fires nothing at all, and only
 *      `shot.arm(fail, stallMs)` is left to clear `inFlight`. If that timer is
 *      ever dropped the wall stays empty until someone reloads it, and no
 *      existing spec would have noticed.
 *
 *   2. THE RETRY. `loadFirst`'s failure paths leave `current` null ON PURPOSE —
 *      the comment in ground.js says so — because that is what `tick()` reads
 *      to know there is still no photograph. Nothing proved the second attempt
 *      can then succeed. A latch that clears beside a `loadFirst` that refuses
 *      forever would satisfy every assertion that existed before this file.
 *
 * `window.__groundRetry(stallMs)` is `loadFirst` with a drivable stall, and it
 * was written for exactly this: STALL_MS is thirty seconds, and a suite that
 * sits out thirty seconds to prove a timer fires is a suite nobody runs.
 * It had no callers until this file. Flag state is pinned, never inherited.
 */

const asset = (id, iso) => ({
  id,
  aspect: 1.78,
  localDateTime: iso,
  city: "Nudgee",
  country: "Australia",
  people: []
});

/* Four, because every attempt in this file walks the pool one frame further:
   the failed first load, the stall, and the retry that finally lands. */
const POOL = [
  asset("one", "2013-08-13T06:00:00Z"),
  asset("two", "2013-08-13T07:00:00Z"),
  asset("three", "2013-08-13T08:00:00Z"),
  asset("four", "2013-08-13T09:00:00Z")
];

/* A 1x1 PNG — `load` has to fire and naturalWidth has to be non-zero. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/* Diptych off deliberately: this file is about the latch, and one image per
   frame keeps "the DOM it started with" a single unambiguous number. The
   pairing invariant is ground-diptych.spec.js's job. Pinned, never inherited —
   flipping either flag back is the rollback path. */
async function stubGround(page) {
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        "\nwindow.CONFIG.features.groundMemories = true;" +
        "\nwindow.CONFIG.features.groundDiptych = false;\n"
    });
  });
  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: POOL }) })
  );
}

const latchClear = (page) =>
  expect
    .poll(() => page.evaluate(() => window.__ground().inFlight), { timeout: 10_000 })
    .toBe(false);

const groundShown = (page) =>
  expect
    .poll(() => page.evaluate(() => window.__ground().shown), { timeout: 10_000 })
    .toBe(true);

test("a hung thumb clears the latch, and the ground's next attempt lands", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await stubGround(page);

  // ── 1. The first load fails fast, so the stall can be driven from a cold wall.
  await page.route("**/api/immich/asset/*/thumb", (route) => route.fulfill({ status: 404 }));

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__groundRetry === "function");
  await latchClear(page);
  expect(await page.evaluate(() => window.__ground().assetId)).toBeNull();

  /* ── 2. The stall. The thumb answers, but long after the latch should have
         given up on it. ⚠ Registered LAST because page.route() matches the most
         recently registered handler first — the 404 above is now shadowed,
         not gone. */
  await page.route("**/api/immich/asset/*/thumb", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({ contentType: "image/png", body: PNG });
  });

  const armedAt = Date.now();
  await page.evaluate(() => window.__groundRetry(150));
  await latchClear(page);
  const clearedIn = Date.now() - armedAt;

  /* The discriminating assertion. If `arm()` were dropped, the latch would
     still clear eventually — at ~2000ms, when the image finally arrived and
     `half()` settled the frame — and every other assertion below would have to
     be inverted to notice. So the ELAPSED TIME is the assertion, and `shown`
     is what separates "gave up" from "quietly succeeded, late". */
  expect(clearedIn).toBeLessThan(1500);

  const stalled = await page.evaluate(() => ({
    ...window.__ground(),
    halfAttr: document.getElementById("ground").dataset.half ?? null,
    diptych: document.querySelector(".photo").dataset.diptych ?? null
  }));

  expect(stalled.shown).toBe(false);
  // Null on purpose — this is precisely what tick() reads to know to try again.
  expect(stalled.assetId).toBeNull();
  expect(stalled.dayKey).toBeNull();
  // Exactly the DOM index.html shipped.
  expect(stalled.imgs).toBe(1);
  expect(stalled.layers).toBe(1);
  expect(stalled.halfAttr).toBeNull();
  expect(stalled.diptych).toBeNull();

  // ── 3. The retry tick() exists for. Immich is well again.
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG })
  );

  await page.evaluate(() => window.__groundRetry());
  await groundShown(page);

  const landed = await page.evaluate(() => ({
    ...window.__ground(),
    caption: document.getElementById("ground-caption").textContent
  }));

  expect(landed.assetId).not.toBeNull();
  expect(landed.dayKey).not.toBeNull();
  expect(landed.inFlight).toBe(false);
  /* ⚠ `layers` is the soak metric the cutover doc reads. Two failed attempts
     before this one must not have left a photographic layer behind, or every
     future soak reports a leak that is not there. */
  expect(landed.imgs).toBe(1);
  expect(landed.layers).toBe(1);
  expect(landed.caption).toBe("Nudgee · 2013");

  expect(pageErrors).toEqual([]);
});

test("the ground refuses a second attempt while a photograph is already up", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await stubGround(page);
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG })
  );

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__groundRetry === "function");
  await groundShown(page);

  /* `loadFirst` opens with `if (inFlight || current) return false`. The
     `current` half of that guard is what stops tick() from rebuilding a
     photograph that is already on the wall every ten minutes — and it is the
     reason this seam is safe to hand to a probe on the live kiosk. */
  const before = await page.evaluate(() => window.__ground().assetId);
  expect(await page.evaluate(() => window.__groundRetry())).toBe(false);

  const after = await page.evaluate(() => ({ ...window.__ground() }));
  expect(after.assetId).toBe(before);
  expect(after.imgs).toBe(1);
  expect(after.layers).toBe(1);
  expect(after.inFlight).toBe(false);
  expect(pageErrors).toEqual([]);
});
