import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Living Window Phase 3 — skyRamp + nightSky.
 *
 * skyRamp ON: <body> gets .sky-ramp and syncNight writes --sky-warmth (0..1,
 * sun-altitude driven); body.sky-ramp.substrate::before color-mixes the warmth
 * into the substrate tint. OFF: no class, no property, tint untouched.
 *
 * nightSky ON: __forceAtmoEpisode("twinkle") runs a twinkle on a painted
 * starfield; once the episode ends the runtime reconciles against real
 * conditions (weather is null under the stubbed test server) and clears the
 * field. OFF: the planner never emits a twinkle, canvas stays hidden.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

function forceFlags(flags) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const lines = Object.entries(flags)
        .map(([k, v]) => `window.CONFIG.features.${k} = ${v};`)
        .join("\n");
      await route.fulfill({ response: res, body: (await res.text()) + "\n" + lines + "\n" });
    });
}

// Late golden hour in Brisbane midwinter (sunset ≈ 17:04) — the sun sits a few
// degrees up, so the ramp is well off zero but it is not yet night (no
// screensaver auto-engage at boot).
const LATE_GOLDEN = new Date("2026-07-06T16:45:00");

test("sky ramp on: syncNight steps --sky-warmth and the substrate mixes it in", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceFlags({ skyRamp: true })(page);
  await page.clock.setFixedTime(LATE_GOLDEN);

  await page.goto("/");
  await page.waitForFunction(() => document.body.classList.contains("sky-ramp"));
  await page.waitForFunction(() => document.body.style.getPropertyValue("--sky-warmth") !== "");

  const warmth = await page.evaluate(() => parseFloat(document.body.style.getPropertyValue("--sky-warmth")));
  expect(warmth).toBeGreaterThan(0.2); // sun a few degrees up → the ramp is on
  expect(warmth).toBeLessThanOrEqual(1);

  // The color-mix responds to the warmth: pin a token, freeze the 60s settle,
  // and read the substrate layer at warmth 0 vs 1 — the warm mix must move the
  // computed color toward red.
  const colors = await page.evaluate(() => {
    document.body.classList.add("substrate", "atmo-cloudy");
    document.body.style.setProperty("--atmo-settle", "0s");
    document.body.style.setProperty("--sky-warmth", "0");
    const c0 = getComputedStyle(document.body, "::before").backgroundColor;
    document.body.style.setProperty("--sky-warmth", "1");
    const c1 = getComputedStyle(document.body, "::before").backgroundColor;
    return { c0, c1 };
  });
  expect(colors.c1).not.toBe(colors.c0);
  const red = (c) => parseFloat(c.match(/\(([\d.]+)/)?.[1] ?? "0");
  expect(red(colors.c1)).toBeGreaterThan(red(colors.c0));

  expect(pageErrors).toEqual([]);
});

test("sky ramp off (default): no body class, no --sky-warmth written", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceFlags({ skyRamp: false })(page);
  await page.clock.setFixedTime(LATE_GOLDEN);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__atmosphere === "function");

  expect(await page.evaluate(() => document.body.classList.contains("sky-ramp"))).toBe(false);
  expect(await page.evaluate(() => document.body.style.getPropertyValue("--sky-warmth"))).toBe("");

  expect(pageErrors).toEqual([]);
});

test("night sky on: a forced twinkle paints the field, then reconciles it away", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceFlags({ nightSky: true })(page);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__forceAtmoEpisode === "function");

  expect(await page.evaluate(() => window.__atmoFx().enabled.nightSky)).toBe(true);

  const type = await page.evaluate(() => window.__forceAtmoEpisode("twinkle"));
  expect(type).toBe("twinkle");

  // The field is up and painted: stars generated, canvas visible, real pixels.
  //
  // All three read in ONE evaluate, deliberately. Split across three awaits this
  // raced the live weather slice: /api/weather/now resolves mid-test, the
  // context updates, syncNightSky re-runs nightSkyWanted() and — for anything
  // but a clear night — revokes the field between the stars check and the
  // canvasVisible read. It failed ~1 in 3 FULL-SUITE runs and 0 in 6 standalone,
  // because suite load is what moves the fetch into that window. Synchronous JS
  // cannot be preempted by the subscriber, so the window is gone rather than
  // narrowed — same fix as reactive-glass's glassAfterAtmo (c40e32a).
  const field = await page
    .waitForFunction(() => {
      const state = window.__atmoFx();
      if (!(state.night.stars > 0)) return null;
      const c = document.getElementById("atmo-fx-canvas");
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
      return { canvasVisible: state.canvasVisible, lit };
    })
    .then((handle) => handle.jsonValue());

  expect(field.canvasVisible).toBe(true);
  expect(field.lit).toBeGreaterThan(50); // a starfield, not an empty frame

  // Reconcile: weather is LIVE Open-Meteo here (contract philosophy — never
  // assert it), and a genuinely clear night would let the field persist. So
  // falsify the one condition we control — ambient mode — and confirm the
  // runtime clears the field. Awake already (daytime run) → the episode just
  // finishes and reconciles; ambient (night run) → the wake cancels it.
  await page.evaluate(() => window.__wakeScreensaver());
  await page.waitForFunction(() => window.__atmoFx().mode === "awake");
  await page.waitForFunction(() => window.__atmoFx().running === null, null, { timeout: 15_000 });
  await page.waitForFunction(() => window.__atmoFx().canvasVisible === false);
  expect(await page.evaluate(() => window.__atmoFx().night.live)).toBe(false);

  expect(pageErrors).toEqual([]);
});

test("night sky off (default): the planner never emits a twinkle", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceFlags({ nightSky: false })(page);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__forceAtmoEpisode === "function");

  expect(await page.evaluate(() => window.__atmoFx().enabled.nightSky)).toBe(false);
  expect(await page.evaluate(() => window.__forceAtmoEpisode("twinkle"))).toBe(null);
  expect(await page.evaluate(() => window.__atmoFx().canvasVisible)).toBe(false);
  expect(await page.evaluate(() => window.__atmoFx().night)).toEqual({ live: false, stars: 0 });

  expect(pageErrors).toEqual([]);
});
