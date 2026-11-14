import { test, expect } from "./fixtures/coverage.js";
import { coldGlassOf, glassPixel, GLASS_EFFECT } from "../src/v3/core/journey-grade.js";
import { getPosition } from "../src/js/vendor/suncalc.js";

/* COLD GLASS — features.v3ColdGlass (journey-grade.js coldGlassOf, main.js syncColdGlass,
   journey.js syncGlass).

   Mist on a humid morning, frost on a cold one, on the wall's edges over the journey
   photograph, clearing as the sun climbs. The pure half pins which morning gets which
   glass; the page half pins that the layer is there with its look, that a flag-off wall
   has nothing, that only a MORNING sun counts, and that the corner shades are solved
   over the glass. */

/* ── Which glass, for which morning ─────────────────────────────────────── */

const M = (o) => coldGlassOf({ sunAltDeg: 0, morning: true, ...o });

test("frost at or below 8 °C, mist at 90 %+ humidity, frost wins when both hold", () => {
  expect(M({ tempC: 8 })?.look).toBe("frost");
  expect(M({ tempC: -2 })?.look).toBe("frost");
  expect(M({ tempC: 8.01 })).toBeNull();
  expect(M({ tempC: 14, humidityPct: 90 })?.look).toBe("mist");
  expect(M({ tempC: 14, humidityPct: 89.9 })).toBeNull();
  expect(M({ tempC: 5, humidityPct: 97 })?.look).toBe("frost");
  // Unknown readings make no claim.
  expect(M({ tempC: null, humidityPct: null })).toBeNull();
  expect(M({})).toBeNull();
});

test("mornings only, from where the night ends (−2°), full at sunrise, clearing to nothing by 10°", () => {
  const k = (sunAltDeg) => coldGlassOf({ tempC: 3, sunAltDeg, morning: true })?.k ?? 0;
  expect(k(-8)).toBe(0);
  expect(k(-2.01)).toBe(0);
  expect(k(-2)).toBe(0);
  expect(k(-1)).toBe(0.5);
  expect(k(0)).toBe(1);
  expect(k(1)).toBe(0.9);
  expect(k(5)).toBe(0.5);
  expect(k(9.5)).toBe(0.1);
  expect(k(10)).toBe(0);
  expect(k(40)).toBe(0);
  // The same low sun in the evening is no glass.
  expect(coldGlassOf({ tempC: 3, sunAltDeg: 2, morning: false })).toBeNull();
  expect(coldGlassOf({ tempC: 3, sunAltDeg: NaN, morning: true })).toBeNull();
  expect(coldGlassOf()).toBeNull();
});

test("the glass lightens a pixel towards its own colour, by its strength", () => {
  const black = [0, 0, 0];
  expect(glassPixel(black, null, 1)).toBe(black);
  expect(glassPixel(black, "frost", 0)).toBe(black);
  for (const look of ["mist", "frost"]) {
    const [c, a] = GLASS_EFFECT[look];
    glassPixel(black, look, 1).forEach((v, i) => expect(v).toBeCloseTo(c[i] * a, 6));
    glassPixel(black, look, 0.5).forEach((v, i) => expect(v).toBeCloseTo(c[i] * a * 0.5, 6));
  }
});

test("over a sky paler than the frost, the worst pixel is the sky itself, never darker", () => {
  // The flecks are speckled: the photograph shows between them. A plain veil would model a
  // white corner GREY and the shade would ease off under the glass (measured, 2026-11-15).
  const white = [1, 1, 1];
  for (const look of ["mist", "frost"]) expect(glassPixel(white, look, 1)).toEqual(white);
});

/* ── The page ───────────────────────────────────────────────────────────── */

const CITY = { lat: -27.47, lon: 153.02 };          // main.js CITY — the wall's sun
const sun = (d) => getPosition(d, CITY.lat, CITY.lon);
const altAt = (d) => (sun(d).altitude * 180) / Math.PI;
const MORNING = new Date("2026-07-05T21:00:00Z");   // 7:00 am, a few degrees up, in the east
const EVENING = new Date("2026-07-06T06:45:00Z");   // 4:45 pm, 3.5° up, in the west
const NOON = new Date("2026-07-06T02:00:00Z");      // midday, 40° up

const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${fill}"/></svg>`;
const at = (id) => ({ id, aspect: 1.778, localDateTime: "2019-07-06T09:00:00Z", city: "Nudgee", state: "Queensland", country: "Australia", lat: -27.37, lng: 153.08, people: [] });
const weatherOf = ({ tempC = 21, humidityPct = 50 } = {}) => ({
  now: { wind_kph: 0, wind_bearing: 200, cloud_pct: 0, humidity_pct: humidityPct, temp_c: tempC, condition: { code: 0, icon: "clear", intensity: null, label: "x" } }
});

async function boot(page, { glass, clock, weather = weatherOf(), photo = "#2a2622" }) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(clock);
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({
      response: res,
      body: (await res.text()) +
        `\nwindow.CONFIG.features.v3Archive = true;` +
        `\nwindow.CONFIG.features.v3MemoryJourney = true;` +
        `\nwindow.CONFIG.features.groundMemories = true;` +
        `\nwindow.CONFIG.features.groundDiptych = false;` +
        `\nwindow.CONFIG.features.v3HouseStoreField = false;` +
        `\nwindow.CONFIG.features.v3GoldenHour = false;` +
        `\nwindow.CONFIG.features.v3PhotoTransitions = false;` +
        `\nwindow.CONFIG.features.v3RainGlass = false;` +
        `\nwindow.CONFIG.features.v3ColdGlass = ${glass};\n`
    });
  });
  await page.route("**/api/voice/stream", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await page.route("**/api/weather/now", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(weather) }));
  await page.route("**/api/immich/on-this-day", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: [at("p-1"), at("p-2"), at("p-3")] }) }));
  await page.route("**/api/immich/asset/*/thumb", (r) => r.fulfill({ contentType: "image/svg+xml", body: svg(photo) }));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__journey === "function");
  await expect.poll(async () => (await page.evaluate(() => window.__journey()))?.shownFrames ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  return errors;
}

/** The root stamp and the glass node as the wall has them. */
const glassNow = (page) => page.evaluate(() => {
  const root = document.documentElement.dataset;
  const nodes = document.querySelectorAll(".journey__glass");
  const el = nodes[0];
  const cs = el ? getComputedStyle(el) : null;
  const r = el?.getBoundingClientRect();
  return {
    stamp: root.coldGlass ?? null, k: root.coldGlassK ?? null, nodes: nodes.length,
    look: el?.dataset.look ?? null, opacity: el ? el.style.opacity : null,
    bg: cs?.backgroundImage ?? null, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
    // Under the today shade: the glass must come BEFORE it at the same z-index.
    underShade: el ? Boolean(el.compareDocumentPosition(document.querySelector(".journey__shade--today")) & Node.DOCUMENT_POSITION_FOLLOWING) : null
  };
});

test("the test clocks are where they say (suncalc, not assumed)", () => {
  expect(altAt(MORNING)).toBeGreaterThan(-2);
  expect(altAt(MORNING)).toBeLessThan(10);
  expect(sun(MORNING).azimuth).toBeLessThan(0);   // east of south
  expect(altAt(EVENING)).toBeGreaterThan(-2);
  expect(altAt(EVENING)).toBeLessThan(10);
  expect(sun(EVENING).azimuth).toBeGreaterThan(0);
  expect(altAt(NOON)).toBeGreaterThan(10);
});

test("flag OFF on a frosty morning: no stamp, no node, and the lever does nothing", async ({ page }) => {
  const errors = await boot(page, { glass: false, clock: MORNING, weather: weatherOf({ tempC: 3 }) });
  expect(await glassNow(page)).toMatchObject({ stamp: null, k: null, nodes: 0 });
  expect(await page.evaluate(() => window.__coldGlass("frost"))).toBeNull();
  expect(await glassNow(page)).toMatchObject({ stamp: null, nodes: 0 });
  expect(errors).toEqual([]);
});

test("a frosty morning: the frost layer covers the wall, under the shades", async ({ page }) => {
  const errors = await boot(page, { glass: true, clock: MORNING, weather: weatherOf({ tempC: 3 }) });
  const g = await glassNow(page);
  expect(g.nodes, "the glass node must exist before its look is judged").toBe(1);
  expect(g).toMatchObject({ stamp: "frost", look: "frost", w: 1920, h: 1080, underShade: true });
  expect(Number(g.opacity)).toBeGreaterThan(0);
  expect(g.opacity).toBe(g.k);
  expect(g.bg).toMatch(/^url\(/);
  expect(errors).toEqual([]);
});

test("a humid morning gets mist; the same sun in the evening, and noon, get nothing", async ({ browser }) => {
  for (const [clock, weather, want] of [
    [MORNING, weatherOf({ humidityPct: 95 }), "mist"],
    [EVENING, weatherOf({ tempC: 3, humidityPct: 95 }), null],
    [NOON, weatherOf({ tempC: 3, humidityPct: 95 }), null]
  ]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await boot(page, { glass: true, clock, weather });
    const g = await glassNow(page);
    expect(g.stamp, String(clock)).toBe(want);
    if (want) expect(g.look, String(clock)).toBe(want);
    else expect(g.nodes, "no glass was ever asked for, so no node").toBe(0);
    await page.close();
  }
});

test("after dark the glass stands down, even when forced (the night ink is dimmed)", async ({ page }) => {
  const NIGHT = new Date("2026-07-06T09:00:00Z");   // 7 pm, well below −2°
  expect(altAt(NIGHT)).toBeLessThan(-2);
  const errors = await boot(page, { glass: true, clock: NIGHT, weather: weatherOf({ tempC: 3 }) });
  expect(await page.evaluate(() => document.documentElement.dataset.night)).toBe("1");
  expect(await page.evaluate(() => window.__coldGlass("frost"))).toBeNull();
  expect(await glassNow(page)).toMatchObject({ stamp: null, nodes: 0 });
  expect(errors).toEqual([]);
});

test("the shades are solved OVER the glass: frost on a dark photo needs more shade, and gives it back", async ({ page }) => {
  await boot(page, { glass: true, clock: NOON });
  const none = await page.evaluate(() => window.__journey().shades);
  expect(await page.evaluate(() => window.__coldGlass("frost"))).toBe("frost");
  await expect.poll(async () => (await page.evaluate(() => window.__journey().shades)).memory).toBeGreaterThan(none.memory + 0.1);
  const frost = await page.evaluate(() => window.__journey().shades);
  expect(frost.today).toBeGreaterThan(none.today + 0.1);
  // The wall, not just the probe.
  const prop = await page.evaluate(() => getComputedStyle(document.querySelector(".journey")).getPropertyValue("--j-shade-memory").trim());
  expect(Number(prop)).toBeCloseTo(frost.memory, 3);
  // Handed back to the weather (noon: none): stamp gone, layer faded, shades as before.
  expect(await page.evaluate(() => window.__coldGlass())).toBeNull();
  await expect.poll(async () => (await glassNow(page)).opacity).toBe("0");
  const back = await page.evaluate(() => window.__journey().shades);
  expect(back.memory).toBeCloseTo(none.memory, 3);
  expect(back.today).toBeCloseTo(none.today, 3);
});
