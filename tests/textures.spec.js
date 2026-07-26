import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Living Window Phase 4 — atmoTextures.
 *
 * ON: <body> gets .fx-textures, the runtime syncs fx-fog/fx-heat/fx-cold from
 * the weather slice (pure texturesFor — thresholds unit-tested in
 * atmo-fx.spec), __forceAtmoEpisode gains "fog" (canvas blob drift) and
 * "heat-pulse" (warm veil breath). The static CSS contract is asserted by
 * pinning classes directly (the live slice is real Open-Meteo — never assert
 * it). OFF: no marker class, forced texture episodes refuse, CSS inert.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

// Pin the clock like presence/ui/reactive-glass do. Unpinned, this spec ran at
// real local time and after sunset the screensaver auto-engages — measured
// mid-test with isNight:true and the screensaver ACTIVE, which flips the atmoFx
// runtime to "ambient" mode where the night starfield owns the canvas and a
// forced episode does not behave like the awake-mode one under test. It failed
// 0/3 in the afternoon, 2/6 at dusk and 6/6 after, with the victim assertion
// moving between the fog canvas and the heat-pulse veil.
const MIDDAY = new Date("2026-07-06T12:00:00");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

function forceFlag(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + `\nwindow.CONFIG.features.atmoTextures = ${value};\n`;
      await route.fulfill({ response: res, body });
    });
}

test("textures on: forced fog-drift and heat-pulse episodes run and clean up", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceFlag(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__forceAtmoEpisode === "function");
  expect(await page.evaluate(() => document.body.classList.contains("fx-textures"))).toBe(true);
  expect(await page.evaluate(() => window.__atmoFx().enabled.textures)).toBe(true);

  // Fog drift: canvas episode with real painted pixels.
  expect(await page.evaluate(() => window.__forceAtmoEpisode("fog"))).toBe("fog-drift");
  expect(await page.evaluate(() => window.__atmoFx().running)).toBe("fog-drift");
  expect(await page.evaluate(() => window.__atmoFx().canvasVisible)).toBe(true);
  await page.waitForFunction(() => {
    const c = document.getElementById("atmo-fx-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  });

  // Heat pulse: cancels the fog (one episode in flight), runs on the veil.
  expect(await page.evaluate(() => window.__forceAtmoEpisode("heat-pulse"))).toBe("heat-pulse");
  const veil = await page.evaluate(() => {
    const v = document.getElementById("atmo-fx-veil");
    return { display: v.style.display, warm: v.classList.contains("fx-warm"), pulsing: v.classList.contains("fx-warm-pulse") };
  });
  expect(veil).toEqual({ display: "block", warm: true, pulsing: true });

  // The pulse is a one-shot: it ends, the veil hides, classes come off.
  await page.waitForFunction(() => window.__atmoFx().running === null, null, { timeout: 15_000 });
  const after = await page.evaluate(() => {
    const v = document.getElementById("atmo-fx-veil");
    return { display: v.style.display, warm: v.classList.contains("fx-warm") };
  });
  expect(after).toEqual({ display: "none", warm: false });

  expect(pageErrors).toEqual([]);
});

test("textures on: the static CSS contract (vignettes, photo filters, cold glass, seasons)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceFlag(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body.classList.contains("fx-textures"));

  const readings = await page.evaluate(() => {
    const b = document.body;
    const before = () => getComputedStyle(b, "::before");
    b.classList.add("substrate", "atmo-fog");
    b.style.setProperty("--atmo-settle", "0s");

    const plainImage = before().backgroundImage;
    b.classList.add("fx-fog");
    const fogImage = before().backgroundImage;
    b.classList.remove("fx-fog");

    b.classList.add("fx-cold", "reactive-glass"); // cold glass composes with Phase 2
    const coldImage = before().backgroundImage;
    const coldSheen = getComputedStyle(b).getPropertyValue("--glass-sheen");
    b.classList.remove("fx-cold");

    // Season bias: July boots as season-winter (background.js); toggling it
    // must move the substrate color (the --substrate-base color-mix).
    b.classList.remove("atmo-fog");
    b.classList.add("atmo-clear-day", "season-winter");
    const winterBg = before().backgroundColor;
    b.classList.remove("season-winter");
    const neutralBg = before().backgroundColor;

    return { plainImage, fogImage, coldImage, coldSheen, winterBg, neutralBg };
  });

  expect(readings.plainImage).toBe("none");
  expect(readings.fogImage).toContain("radial-gradient");
  expect(readings.coldImage).toContain("radial-gradient");
  expect(readings.coldImage).not.toBe(readings.fogImage);
  expect(readings.coldSheen.replace(/\s+/g, "")).toContain("rgba(205,228,255,0.12)".replace("0.12", ".12"));
  expect(readings.winterBg).not.toBe(readings.neutralBg);

  // Photo filter overrides ride the awake-ground photo when states are on.
  const filters = await page.evaluate(() => {
    const b = document.body;
    b.classList.add("awake-ground");
    const img = document.createElement("img");
    img.className = "awake-photo";
    document.getElementById("background")?.appendChild(img);
    const read = () => getComputedStyle(img).filter;
    const base = read();
    b.classList.add("fx-fog");
    const fog = read();
    b.classList.remove("fx-fog");
    b.classList.add("fx-heat");
    const heat = read();
    b.classList.remove("fx-heat", "awake-ground");
    img.remove();
    return { base, fog, heat };
  });
  expect(filters.fog).not.toBe(filters.base);
  expect(filters.heat).not.toBe(filters.base);
  expect(filters.fog).toContain("contrast(0.9)");
  expect(filters.heat).toContain("saturate(0.84)");

  expect(pageErrors).toEqual([]);
});

test("textures off (default): no marker class, forced texture episodes refuse", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceFlag(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__forceAtmoEpisode === "function");

  expect(await page.evaluate(() => document.body.classList.contains("fx-textures"))).toBe(false);
  expect(await page.evaluate(() => window.__atmoFx().enabled.textures)).toBe(false);
  expect(await page.evaluate(() => window.__forceAtmoEpisode("fog"))).toBe(null);
  expect(await page.evaluate(() => window.__forceAtmoEpisode("heat-pulse"))).toBe(null);
  expect(await page.evaluate(() => window.__atmoFx().textures)).toEqual([]);

  expect(pageErrors).toEqual([]);
});
