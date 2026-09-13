import { test, expect } from "@playwright/test";
import {
  accentFor,
  gapFor,
  lanesFor,
  planStrike,
  texturesOf,
  RAIN_LEVEL,
  RAIN_MOVE_MS,
  STRIKE_MS
} from "../src/v3/core/atmosphere-fx.js";
import {
  FOG_GAP_MS,
  HEAT_PULSE_GAP_MS,
  LIGHTNING_GAP_MS,
  RAIN_GAP_MS,
  TWINKLE_GAP_MS
} from "../src/js/services/atmoFx/planner.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE LIVING WINDOW, STEP 3 — the five effects the overlay carries.

   v3AtmoAccent · v3AtmoLightning · v3AtmoTextures · v3AtmoNightSky ·
   v3AtmoRainEpisodes. Each behind its own flag, read only while v3AtmoOverlay
   is on (tests/v3-atmosphere.spec.js covers the overlay itself).

   What is asserted, and the wrong answer each one names:
     · every cause, off the page                  → an effect earned by the
       wrong sky (lightning without thunder, stars by day, fog in the heat)
     · the five flags OFF, every cause FORCED     → an effect leaking onto the
       shipped wall. The causes are forced so "nothing happened" cannot be the
       page simply not having run yet: the rain level proves paint() did.
     · each flag ON: the cause arms a real timer, the episode runs ON ITS OWN
       inside the incumbent's band (the clock is driven, not probed), and the
       cause ending cancels the lane → a loop with no cause, or a lane that
       never fires
     · the accent moves the HUE and nothing else, and never at night
     · stars sit on the mat, not on the overlay → a starfield over a photograph
     · rain bursts pause the pane rather than hide it → a dry-looking wall
       while it rains, or a pane that never moves
   ═══════════════════════════════════════════════════════════════════════════ */

const ALL = { accent: true, lightning: true, textures: true, nightSky: true, rainEpisodes: true };

test.describe("the causes, off the page", () => {
  test("each lane is earned only by its own sky", () => {
    expect(lanesFor({ weather: null, flags: ALL })).toEqual({ lightning: false, rain: null, twinkle: false, fog: false, heat: false });
    expect(lanesFor({ weather: { category: "storm", intensity: "heavy", thunder: true }, flags: ALL }))
      .toEqual({ lightning: true, rain: "heavy", twinkle: false, fog: false, heat: false });
    // Thunder must be literally true — a truthy string is not a storm.
    expect(lanesFor({ weather: { category: "cloudy", thunder: "yes" }, flags: ALL }).lightning).toBe(false);
    expect(lanesFor({ weather: { category: "rain", intensity: null }, flags: ALL }).rain).toBe("moderate");
    // Stars need BOTH a clear sky and the night.
    expect(lanesFor({ weather: { category: "clear" }, night: false, flags: ALL }).twinkle).toBe(false);
    expect(lanesFor({ weather: { category: "cloudy" }, night: true, flags: ALL }).twinkle).toBe(false);
    expect(lanesFor({ weather: { category: "clear" }, night: true, flags: ALL }).twinkle).toBe(true);
    expect(lanesFor({ weather: { category: "fog", tempC: 20 }, flags: ALL })).toMatchObject({ fog: true, heat: false });
    expect(lanesFor({ weather: { category: "clear", tempC: 33 }, flags: ALL })).toMatchObject({ fog: false, heat: true });
    // A missing temperature is not a cold one (Number(null) is 0).
    expect(texturesOf({ category: "clear", tempC: null })).toEqual([]);
    expect(texturesOf({ category: "fog", tempC: 6 })).toEqual(["fog", "cold"]);
  });

  test("a lane whose flag is off is never earned, whatever the sky", () => {
    const sky = { category: "storm", intensity: "heavy", thunder: true, tempC: 35 };
    expect(lanesFor({ weather: sky, night: true, flags: {} })).toEqual({ lightning: false, rain: null, twinkle: false, fog: false, heat: false });
    expect(lanesFor({ weather: sky, flags: { lightning: true } })).toEqual({ lightning: true, rain: null, twinkle: false, fog: false, heat: false });
    expect(lanesFor({ weather: sky, flags: { rainEpisodes: true } }).lightning).toBe(false);
  });

  test("the accent moves only under rain and storm", () => {
    expect(accentFor({ category: "rain" })).toBe("cool");
    expect(accentFor({ category: "storm" })).toBe("cool");
    for (const c of ["clear", "cloudy", "fog", "snow"]) expect(accentFor({ category: c })).toBeNull();
    expect(accentFor(null)).toBeNull();
  });

  test("every gap is the incumbent's band, at both ends of the rng", () => {
    const lo = () => 0;
    const hi = () => 0.999999;
    const cases = [
      ["lightning", null, LIGHTNING_GAP_MS],
      ["rain", "light", RAIN_GAP_MS.ambient.light],
      ["rain", "moderate", RAIN_GAP_MS.ambient.moderate],
      ["rain", "heavy", RAIN_GAP_MS.ambient.heavy],
      ["twinkle", null, TWINKLE_GAP_MS],
      ["fog", null, FOG_GAP_MS],
      ["heat", null, HEAT_PULSE_GAP_MS]
    ];
    for (const [lane, key, [min, max]] of cases) {
      expect(gapFor(lane, key, lo), `${lane} ${key} low`).toBe(min);
      expect(gapFor(lane, key, hi), `${lane} ${key} high`).toBeCloseTo(max, -1);
    }
  });

  test("a strike sequence is one strike and at most two weaker aftershocks, inside 4 s", () => {
    const quiet = planStrike(() => 0);
    expect(quiet.aftershocks).toEqual([]);
    expect(quiet.peak).toBe(0.8);
    expect(quiet.durationMs).toBe(STRIKE_MS);
    const loud = planStrike(() => 0.999);
    expect(loud.aftershocks).toHaveLength(2);
    for (const a of loud.aftershocks) {
      expect(a.offsetMs).toBeGreaterThanOrEqual(300);
      expect(a.offsetMs).toBeLessThanOrEqual(1800);
      expect(a.peak).toBeLessThan(0.5 + 1e-9);
      expect(a.peak).toBeLessThan(loud.peak);
    }
    expect(loud.durationMs).toBeLessThanOrEqual(4000);
  });
});

const MIDDAY = new Date("2026-09-11T02:00:00Z"); // local noon in Brisbane (+10)

const FLAG_NAMES = {
  accent: "v3AtmoAccent",
  lightning: "v3AtmoLightning",
  textures: "v3AtmoTextures",
  nightSky: "v3AtmoNightSky",
  rainEpisodes: "v3AtmoRainEpisodes"
};

/* `on` names the step-3 effects to turn on; the overlay is always on here.
   The clock is INSTALLED, not fixed, so a test can drive a lane's real timer
   past the incumbent's band instead of calling the probe that fires it. */
async function boot(page, on = []) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.clock.install({ time: MIDDAY });
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  const lines = ["window.CONFIG.features.v3AtmoOverlay = true;"];
  for (const [k, name] of Object.entries(FLAG_NAMES)) lines.push(`window.CONFIG.features.${name} = ${on.includes(k)};`);
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: `${await res.text()}\n${lines.join("\n")}\n` });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function" && typeof window.__v3Atmo === "function");
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  return errors;
}

const atmo = (page) => page.evaluate(() => window.__v3Atmo());
const force = (page, f) => page.evaluate((x) => window.__v3Atmo.force(x), f);
const rootData = (page) => page.evaluate(() => ({ ...document.documentElement.dataset }));

const EFFECT_ATTRS = ["atmoAccent", "atmoTexture", "atmoNightSky", "atmoRainEpisodes", "atmoRainMoving", "atmoTwinkle", "atmoFogDrift", "atmoHeatPulse"];

test("all five OFF, every cause forced: the overlay paints and no effect exists", async ({ page }) => {
  const errors = await boot(page, []);
  await force(page, { rain: "heavy", thunder: true, night: true, weather: { category: "fog", tempC: 34 } });
  const r = await page.evaluate(() => ({
    rainVar: document.documentElement.style.getPropertyValue("--atmo-rain"),
    stars: document.documentElement.style.getPropertyValue("--atmo-stars"),
    children: [...document.querySelectorAll(".atmo-overlay > *")].map((e) => e.className),
    archiveBg: getComputedStyle(document.querySelector(".archive")).backgroundImage,
    pane: getComputedStyle(document.querySelector(".atmo-overlay__rain")).animationPlayState
  }));
  // paint() ran — so an absent attribute below is the flag, not a page that had not started.
  expect(r.rainVar).toBe("1.000");
  const data = await rootData(page);
  for (const a of EFFECT_ATTRS) expect(data[a], a).toBeUndefined();
  expect(r.children).toEqual(["atmo-overlay__warm", "atmo-overlay__rain", "atmo-overlay__flash"]);
  expect(r.stars).toBe("");
  expect(r.archiveBg).toBe("none");
  expect(r.pane).toBe("running");
  expect((await atmo(page)).lanes).toEqual({});
  // Even a whole storm's worth of time arms nothing.
  await page.clock.runFor(LIGHTNING_GAP_MS[1] + 1000);
  expect((await atmo(page)).lanes).toEqual({});
  expect((await rootData(page)).atmoStrike).toBeUndefined();
  expect(errors).toEqual([]);
});

test("accent: rain turns the hue cool by day, holds L and C, and night keeps its warm 40", async ({ page }) => {
  const errors = await boot(page, ["accent"]);
  const hue = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--atmo-hue").trim());
  const accentLC = () => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return [cs.getPropertyValue("--accent-l").trim(), cs.getPropertyValue("--accent-c").trim()];
  });

  await force(page, { weather: { category: "clear" } });
  expect((await rootData(page)).atmoAccent).toBe("none");
  expect(await hue()).toBe("65");
  const dayLC = await accentLC();

  await force(page, { weather: { category: "rain" } });
  expect((await rootData(page)).atmoAccent).toBe("cool");
  expect(await hue()).toBe("240");
  expect(await accentLC()).toEqual(dayLC);

  await page.evaluate(() => { document.documentElement.dataset.night = "1"; });
  expect(await hue()).toBe("40");

  await page.evaluate(() => { delete document.documentElement.dataset.night; });
  await force(page, null);
  expect(await hue()).toBe("65");
  expect(errors).toEqual([]);
});

test("lightning: thunder arms a real timer, a strike arrives on its own, and the storm ending stops it", async ({ page }) => {
  const errors = await boot(page, ["lightning"]);
  await force(page, { weather: { category: "cloudy" } });
  expect((await atmo(page)).lanes.lightning).toBeUndefined();

  await force(page, { thunder: true, weather: { category: "storm" } });
  const armed = (await atmo(page)).lanes.lightning;
  expect(armed, "thunder did not arm the lane").toBeTruthy();
  expect(armed.armed).toBe(true);
  expect(armed.fired).toBe(0);
  expect(armed.inMs).toBeGreaterThanOrEqual(LIGHTNING_GAP_MS[0] - 50);
  expect(armed.inMs).toBeLessThanOrEqual(LIGHTNING_GAP_MS[1]);

  // Nothing yet, just short of the earliest the band allows.
  await page.clock.runFor(LIGHTNING_GAP_MS[0] - 1000);
  expect((await atmo(page)).lanes.lightning.fired).toBe(0);
  // Past the latest: it has struck, by itself.
  await page.clock.runFor(LIGHTNING_GAP_MS[1] - LIGHTNING_GAP_MS[0] + 2000);
  const after = (await atmo(page)).lanes.lightning;
  expect(after.fired).toBeGreaterThanOrEqual(1);

  // A strike in flight is the flash with a size the planner chose.
  await page.evaluate(() => window.__v3Atmo.fire("lightning"));
  const during = await page.evaluate(() => ({
    attr: document.documentElement.dataset.atmoStrike ?? null,
    peak: Number(document.documentElement.style.getPropertyValue("--atmo-strike-peak")),
    anim: getComputedStyle(document.querySelector(".atmo-overlay__flash")).animationName
  }));
  expect(during.attr).toBe("1");
  expect(during.anim).toBe("atmo-strike");
  expect(during.peak).toBeGreaterThanOrEqual(0.25);
  expect(during.peak).toBeLessThanOrEqual(1);

  // The flash is SIZED by that peak: hold the one-shot at its 5% attack frame
  // and read it — 0.90 x peak x amp (midday, amp 1). An aftershock-sized strike
  // makes the difference unmistakable.
  const sized = await page.evaluate(() => {
    const root = document.documentElement;
    delete root.dataset.atmoStrike;
    root.style.setProperty("--atmo-strike-peak", "0.300");
    void root.offsetWidth;
    root.dataset.atmoStrike = "1";
    const el = document.querySelector(".atmo-overlay__flash");
    const anim = el.getAnimations()[0];
    if (!anim) return null;
    anim.pause();
    anim.currentTime = 80; // 5% of 1600 ms
    return Number(getComputedStyle(el).opacity);
  });
  expect(sized, "no strike animation to hold").not.toBeNull();
  expect(sized).toBeCloseTo(0.9 * 0.3, 2);

  // The storm ends: the lane and every timer it owned are gone, and the flash goes out.
  await force(page, { weather: { category: "cloudy" } });
  expect((await atmo(page)).lanes.lightning).toBeUndefined();
  await page.clock.runFor(STRIKE_MS + 2500);
  expect((await rootData(page)).atmoStrike).toBeUndefined();
  await page.clock.runFor(LIGHTNING_GAP_MS[1] + 1000);
  expect((await rootData(page)).atmoStrike).toBeUndefined();
  expect(errors).toEqual([]);
});

test("textures: fog and heat paint their vignettes, drift and pulse on their own, and clear skies take them away", async ({ page }) => {
  const errors = await boot(page, ["textures"]);
  const tex = () => page.evaluate(() => {
    const t = document.querySelector(".atmo-overlay__texture");
    const f = document.querySelector(".atmo-overlay__fog");
    const h = document.querySelector(".atmo-overlay__heat");
    if (!t || !f || !h) return null;
    return {
      layers: (getComputedStyle(t).backgroundImage.match(/radial-gradient/g) || []).length,
      fog: { display: getComputedStyle(f).display, anim: getComputedStyle(f).animationName },
      heat: getComputedStyle(h).animationName
    };
  });

  await force(page, { weather: { category: "clear", tempC: 22 } });
  const dry = await tex();
  expect(dry, "the texture children were not built").not.toBeNull();
  expect(dry.layers).toBe(0);
  expect((await rootData(page)).atmoTexture).toBeUndefined();

  await force(page, { weather: { category: "fog", tempC: 34 } });
  expect((await rootData(page)).atmoTexture).toBe("fog heat");
  expect((await tex()).layers).toBe(2);
  const lanes = (await atmo(page)).lanes;
  expect(lanes.fog?.armed).toBe(true);
  expect(lanes.heat?.armed).toBe(true);

  // The fog bank crosses on its own inside its band, and is gone again afterwards.
  await page.clock.runFor(FOG_GAP_MS[1] + 100);
  expect((await atmo(page)).lanes.fog.fired).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => window.__v3Atmo.fire("fog"));
  expect((await tex()).fog).toEqual({ display: "block", anim: "atmo-fog" });
  await page.clock.runFor(10_500);
  expect((await tex()).fog.display).toBe("none");

  await page.evaluate(() => window.__v3Atmo.fire("heat"));
  expect((await tex()).heat).toBe("atmo-heat");

  await force(page, { weather: { category: "clear", tempC: 5 } });
  expect((await rootData(page)).atmoTexture).toBe("cold");
  expect((await tex()).layers).toBe(2); // the two frost corners
  expect((await atmo(page)).lanes).toEqual({});
  expect((await rootData(page)).atmoHeatPulse).toBeUndefined();
  expect(errors).toEqual([]);
});

test("night sky: a clear night puts stars on the MAT, twinkles on a painted star, and day takes them off", async ({ page }) => {
  const errors = await boot(page, ["nightSky"]);
  const sky = () => page.evaluate(() => {
    const a = document.querySelector(".archive");
    return {
      archiveOn: document.documentElement.dataset.archive ?? null,
      bg: getComputedStyle(a).backgroundImage.slice(0, 26),
      // Images on the overlay: the rain tile is the only one it may carry.
      overlayImages: [...document.querySelectorAll(".atmo-overlay, .atmo-overlay > *")]
        .filter((e) => getComputedStyle(e).backgroundImage.includes("data:image"))
        .map((e) => e.className)
    };
  });

  await force(page, { night: false, weather: { category: "clear" } });
  const day = await sky();
  expect(day.archiveOn).toBe("1");
  expect(day.bg).toBe("none");
  expect((await atmo(page)).lanes.twinkle).toBeUndefined();

  await force(page, { night: true, weather: { category: "cloudy" } });
  expect((await sky()).bg).toBe("none");

  await force(page, { night: true, weather: { category: "clear" } });
  expect((await rootData(page)).atmoNightSky).toBe("1");
  const night = await sky();
  expect(night.bg).toBe('url("data:image/png;base64');
  expect(night.overlayImages).toEqual(["atmo-overlay__rain"]);
  expect((await atmo(page)).lanes.twinkle?.armed).toBe(true);

  await page.clock.runFor(TWINKLE_GAP_MS[1] + 100);
  expect((await atmo(page)).lanes.twinkle.fired).toBeGreaterThanOrEqual(1);

  await page.evaluate(() => window.__v3Atmo.fire("twinkle"));
  const tw = await page.evaluate(() => ({
    anim: getComputedStyle(document.querySelector(".archive"), "::before").animationName,
    pos: document.documentElement.style.getPropertyValue("--atmo-tw-1").trim()
  }));
  expect(tw.anim).toBe("atmo-twinkle");
  // It lands on a star the field actually painted, inside the panel.
  const [x, y] = tw.pos.split(" ").map((v) => parseFloat(v));
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThanOrEqual(1920);
  expect(y).toBeGreaterThanOrEqual(0.02 * 1080 - 1);
  expect(y).toBeLessThanOrEqual(0.72 * 1080 + 1);

  await force(page, { night: false, weather: { category: "clear" } });
  expect((await rootData(page)).atmoNightSky).toBeUndefined();
  expect((await sky()).bg).toBe("none");
  expect((await atmo(page)).lanes.twinkle).toBeUndefined();
  expect(errors).toEqual([]);
});

test("rain bursts: the pane stays up while it rains, moves only in a burst, and holds still between", async ({ page }) => {
  const errors = await boot(page, ["rainEpisodes"]);
  const pane = () => page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".atmo-overlay__rain"));
    return {
      display: cs.display,
      anim: cs.animationName,
      play: cs.animationPlayState,
      moving: document.documentElement.dataset.atmoRainMoving ?? null
    };
  });

  await force(page, { rain: "moderate" });
  // The first burst starts with the rain.
  await page.clock.runFor(50);
  expect(await pane()).toEqual({ display: "block", anim: "atmo-fall", play: "running", moving: "1" });

  // The burst ends on its timer; the pane stays, still.
  await page.clock.runFor(RAIN_MOVE_MS.moment + 100);
  const still = await pane();
  expect(still).toEqual({ display: "block", anim: "atmo-fall", play: "paused", moving: null });
  expect(Number(await page.evaluate(() => getComputedStyle(document.querySelector(".atmo-overlay__rain")).opacity)))
    .toBeCloseTo(RAIN_LEVEL.moderate * 0.6, 1);
  const lane = (await atmo(page)).lanes.rain;
  expect(lane.armed).toBe(true);
  expect(lane.inMs).toBeGreaterThanOrEqual(RAIN_GAP_MS.ambient.moderate[0] - 200);
  expect(lane.inMs).toBeLessThanOrEqual(RAIN_GAP_MS.ambient.moderate[1]);

  // The next burst arrives on its own.
  await page.clock.runFor(RAIN_GAP_MS.ambient.moderate[1] + 100);
  expect((await atmo(page)).lanes.rain.fired).toBeGreaterThanOrEqual(2);

  // The rain stops: no pane, no lane, no moving flag left behind.
  await force(page, null);
  expect((await pane()).display).toBe("none");
  expect((await pane()).moving).toBeNull();
  expect((await atmo(page)).lanes.rain).toBeUndefined();
  expect(errors).toEqual([]);
});

test("rain bursts OFF: the pane falls continuously while it rains, as shipped", async ({ page }) => {
  const errors = await boot(page, []);
  await force(page, { rain: "heavy" });
  await page.clock.runFor(RAIN_MOVE_MS.heavy + 5000);
  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".atmo-overlay__rain"));
    return { display: cs.display, anim: cs.animationName, play: cs.animationPlayState };
  });
  expect(r).toEqual({ display: "block", anim: "atmo-fall", play: "running" });
  expect(errors).toEqual([]);
});
