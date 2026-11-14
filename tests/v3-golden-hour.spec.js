import { test, expect } from "./fixtures/coverage.js";
import { gradeOf, gradePixel, GRADE_EFFECT } from "../src/v3/core/journey-grade.js";
import { getPosition } from "../src/js/vendor/suncalc.js";

/* THE GRADE — features.v3GoldenHour (core/journey-grade.js, journey.js setGrade).

   The journey photograph wears the hour's light: golden / late golden from the real sun,
   twilight, night, and a grey softened look in rain. The pure half pins which look the
   wall may claim for which sky; the page half pins that the look is ON the photograph,
   arrives only with a new photograph, and that the corner shades are solved with it. */

/* ── Which look, for which sky ──────────────────────────────────────────── */

test("the sun's altitude picks the look, band by band, edges included", () => {
  expect(gradeOf({ sunAltDeg: -20 })).toBe("night");
  expect(gradeOf({ sunAltDeg: -6.01 })).toBe("night");
  expect(gradeOf({ sunAltDeg: -6 })).toBe("dusk");
  expect(gradeOf({ sunAltDeg: -0.01 })).toBe("dusk");
  expect(gradeOf({ sunAltDeg: 0 })).toBe("golden");
  expect(gradeOf({ sunAltDeg: 5.99 })).toBe("golden");
  expect(gradeOf({ sunAltDeg: 6 })).toBe("late");
  expect(gradeOf({ sunAltDeg: 14.99 })).toBe("late");
  expect(gradeOf({ sunAltDeg: 15 })).toBeNull();
  expect(gradeOf({ sunAltDeg: 60 })).toBeNull();
});

test("heavy cloud takes the gold away but never the twilight or the night", () => {
  expect(gradeOf({ sunAltDeg: 3, cloud: 0.7 })).toBeNull();
  expect(gradeOf({ sunAltDeg: 10, cloud: 0.95 })).toBeNull();
  expect(gradeOf({ sunAltDeg: 3, cloud: 0.69 })).toBe("golden");
  expect(gradeOf({ sunAltDeg: -3, cloud: 1 })).toBe("dusk");
  expect(gradeOf({ sunAltDeg: -10, cloud: 1 })).toBe("night");
  // Unknown cloud is not overcast: no claim either way, the sun decides.
  expect(gradeOf({ sunAltDeg: 3, cloud: null })).toBe("golden");
});

test("rain wins over the day's light, and the night wins over rain", () => {
  expect(gradeOf({ sunAltDeg: 40, raining: true })).toBe("rain");
  expect(gradeOf({ sunAltDeg: 3, raining: true })).toBe("rain");
  expect(gradeOf({ sunAltDeg: -3, raining: true })).toBe("rain");
  expect(gradeOf({ sunAltDeg: -10, raining: true })).toBe("night");
});

test("no sun reading is no claim about the light", () => {
  expect(gradeOf({ sunAltDeg: NaN })).toBeNull();
  expect(gradeOf({})).toBeNull();
  expect(gradeOf()).toBeNull();
});

/* ── What each look does to a pixel (the shade solver's model) ───────────── */

const GREY = () => [0.5, 0.5, 0.5];
const PIXELS = [[1, 1, 1], [0.6, 0.5, 0.4], [0.05, 0.05, 0.08], [0, 0, 0]];

test("no look leaves the pixel exactly as sampled", () => {
  for (const p of PIXELS) expect(gradePixel(p, null, "memory", GREY)).toBe(p);
});

test("the multiply looks only ever darken, at both corners, by the stated amount", () => {
  for (const look of ["dusk", "golden", "late", "night"]) {
    for (const corner of ["memory", "today"]) {
      const [, a] = GRADE_EFFECT[look].multiply[corner];
      for (const p of PIXELS) {
        const out = gradePixel(p, look, corner, GREY);
        out.forEach((v, i) => expect(v).toBeCloseTo(p[i] * (1 - a + a * 0.5), 6));
      }
    }
  }
});

test("rain can LIGHTEN a shadow (the veil), and that is what the solver must see", () => {
  const black = gradePixel([0, 0, 0], "rain", "memory", GREY);
  const [, a] = GRADE_EFFECT.rain.veil.memory;
  black.forEach((v) => expect(v).toBeCloseTo(0.5 * a, 6));
  // And a saturated colour loses saturation before the veil.
  const red = gradePixel([1, 0, 0], "rain", "today", () => null);
  expect(red[1]).toBeGreaterThan(0);
  expect(red[0]).toBeLessThan(1);
});

/* ── The page ───────────────────────────────────────────────────────────── */

const CITY = { lat: -27.47, lon: 153.02 };          // main.js CITY — the wall's sun
const altAt = (d) => (getPosition(d, CITY.lat, CITY.lon).altitude * 180) / Math.PI;
const GOLDEN = new Date("2026-07-06T06:45:00Z");   // 4:45 pm, 3.5° up
const LATE = new Date("2026-07-06T06:15:00Z");     // 4:15 pm, 9° up
const NIGHT = new Date("2026-07-06T07:45:00Z");    // 5:45 pm, 8.6° down — still inside the display window
const NOON = new Date("2026-07-06T02:00:00Z");     // midday, 40° up

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">${body}</svg>`;
const BRIGHT = svg(`<rect width="1600" height="900" fill="#f4f7fb"/>`);
const at = (id) => ({ id, aspect: 1.778, localDateTime: "2019-07-06T09:00:00Z", city: "Nudgee", state: "Queensland", country: "Australia", lat: -27.37, lng: 153.08, people: [] });
const weatherOf = (icon = "clear", cloudPct = 0) => ({
  now: { wind_kph: 0, wind_bearing: 200, cloud_pct: cloudPct, humidity_pct: null, temp_c: 21, condition: { code: 0, icon, intensity: icon === "rain" ? "moderate" : null, label: "x" } }
});

async function boot(page, { grade, clock, weather = weatherOf() }) {
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
        `\nwindow.CONFIG.features.v3GoldenHour = ${grade};\n`
    });
  });
  await page.route("**/api/voice/stream", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await page.route("**/api/weather/now", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(weather) }));
  await page.route("**/api/immich/on-this-day", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: [at("bright-1"), at("bright-2"), at("bright-3")] }) }));
  await page.route("**/api/immich/asset/*/thumb", (r) => r.fulfill({ contentType: "image/svg+xml", body: BRIGHT }));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__journey === "function");
  await expect.poll(async () => (await page.evaluate(() => window.__journey()))?.shownFrames ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  return errors;
}

/** The shown (top) frame's grade node, as the wall has it. Null when there is none. */
const topGrade = (page) => page.evaluate(() => {
  const el = document.querySelector(".journey__frame.is-top .journey__grade");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const photo = getComputedStyle(document.querySelector(".journey__frame.is-top .journey__photo"));
  const r = el.getBoundingClientRect();
  return { look: el.dataset.look, blend: cs.mixBlendMode, bg: cs.backgroundImage, color: cs.backgroundColor,
    shown: cs.display !== "none", w: Math.round(r.width), h: Math.round(r.height), photoFilter: photo.filter };
});

test("the test clocks are where the bands say they are (suncalc, not assumed)", () => {
  expect(altAt(GOLDEN)).toBeGreaterThan(0);
  expect(altAt(GOLDEN)).toBeLessThan(6);
  expect(altAt(LATE)).toBeGreaterThan(6);
  expect(altAt(LATE)).toBeLessThan(15);
  expect(altAt(NIGHT)).toBeLessThan(-6);
  expect(altAt(NOON)).toBeGreaterThan(15);
});

test("flag OFF at golden hour: no stamp, no grade node, nothing to remove", async ({ page }) => {
  const errors = await boot(page, { grade: false, clock: GOLDEN });
  const p = await page.evaluate(() => ({
    stamp: document.documentElement.dataset.grade ?? null,
    nodes: document.querySelectorAll(".journey__grade").length,
    frameGrade: [...document.querySelectorAll(".journey__frame")].map((f) => f.dataset.grade ?? null),
    probe: window.__journey().grade
  }));
  expect(p).toEqual({ stamp: null, nodes: 0, frameGrade: [null, null], probe: null });
  expect(errors).toEqual([]);
});

test("golden hour: the photograph wears the warm multiply, edge to edge", async ({ page }) => {
  const errors = await boot(page, { grade: true, clock: GOLDEN });
  expect(await page.evaluate(() => document.documentElement.dataset.grade)).toBe("golden");
  const g = await topGrade(page);
  expect(g, "the grade node must exist before its look is judged").not.toBeNull();
  expect(g).toMatchObject({ look: "golden", blend: "multiply", shown: true, w: 1920, h: 1080 });
  expect(g.bg).toContain("radial-gradient");
  expect((await page.evaluate(() => window.__journey())).grade).toBe("golden");
  expect(errors).toEqual([]);
});

test("late golden, night and noon each get their own answer", async ({ browser }) => {
  for (const [clock, want] of [[LATE, "late"], [NIGHT, "night"], [NOON, null]]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await boot(page, { grade: true, clock });
    expect(await page.evaluate(() => document.documentElement.dataset.grade ?? null), String(clock)).toBe(want);
    const g = await topGrade(page);
    if (want) expect(g?.look, String(clock)).toBe(want);
    else expect(g, "noon: no look was ever asked for, so no node").toBeNull();
    await page.close();
  }
});

test("overcast golden hour: the gold is withheld", async ({ page }) => {
  await boot(page, { grade: true, clock: GOLDEN, weather: weatherOf("cloudy", 90) });
  expect(await page.evaluate(() => document.documentElement.dataset.grade ?? null)).toBeNull();
  expect(await topGrade(page)).toBeNull();
});

test("rain: grey veil over a desaturated photograph", async ({ page }) => {
  await boot(page, { grade: true, clock: NOON, weather: weatherOf("rain", 90) });
  const g = await topGrade(page);
  expect(g, "the grade node must exist before its look is judged").not.toBeNull();
  expect(g.look).toBe("rain");
  expect(g.blend).toBe("normal");
  expect(g.bg).toContain("linear-gradient");
  expect(g.photoFilter).toBe("saturate(0.62) brightness(0.92)");
});

test("a change of light waits for the next photograph; it never repaints the one on the glass", async ({ page }) => {
  await boot(page, { grade: true, clock: GOLDEN });
  const was = await topGrade(page);
  expect(was?.look).toBe("golden");
  // The house's answer changes (the minute tick would do this at the band edge).
  await page.evaluate(() => { document.documentElement.dataset.grade = "late"; });
  // The PAINTED light, not just the attribute: CSS keyed on the root stamp would
  // repaint the glass while leaving data-look exactly as it was.
  const still = await topGrade(page);
  expect(still?.look, "the photograph on the glass keeps its light").toBe("golden");
  expect(still?.bg, "…and is still painted golden").toBe(was.bg);
  const before = await page.evaluate(() => window.__ground().assetId);
  await expect.poll(async () => {
    const now = await page.evaluate(() => window.__ground().assetId);
    if (now === before) await page.evaluate(() => window.__groundDissolve(2600, 5_000));
    return now;
  }, { timeout: 15_000, intervals: [0, 1_000] }).not.toBe(before);
  await expect.poll(async () => (await topGrade(page))?.look, { timeout: 10_000 }).toBe("late");
});

test("the shades are solved WITH the grade: night over a bright photo needs less shade", async ({ page }) => {
  await boot(page, { grade: true, clock: NOON });
  const none = await page.evaluate(() => { window.__journeyGrade(null); return window.__journey().shades; });
  const night = await page.evaluate(() => { window.__journeyGrade("night"); return window.__journey().shades; });
  expect(night.memory).toBeLessThan(none.memory - 0.1);
  expect(night.today).toBeLessThan(none.today - 0.1);
  // And the live property follows the solved value — the wall, not just the probe.
  const prop = await page.evaluate(() => getComputedStyle(document.querySelector(".journey")).getPropertyValue("--j-shade-memory").trim());
  expect(Number(prop)).toBeCloseTo(night.memory, 3);
});
