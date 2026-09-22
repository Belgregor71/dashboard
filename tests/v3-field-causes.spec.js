import { test, expect } from "@playwright/test";
import { toCauses } from "../src/v3/substrate/index.js";
import { surgeAt, LIFT_FRAME_MS } from "../src/v3/substrate/gl.js";
import { getMoonIllumination, getMoonPosition, getPosition } from "../src/js/vendor/suncalc.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE FIELD'S NEW CAUSES — features.v3FieldCauses (Living Window 2.0, Stage 3).
   Owner-scoped 2026-09-22 to exactly three: gusts, the moon, humidity.

   What this file is here to catch:
     · an UNKNOWN reading drawn as a plausible one  → the one rule every cause
                                                       inherits: unknown is no
                                                       effect, never a default
     · the moon's lit limb facing AWAY from the sun → invisible in review,
                                                       wrong to anyone who has
                                                       looked up at a crescent
     · a moon that is not where suncalc says, or    → decoration wearing the
       shows through overcast / below the horizon     costume of a cause
     · a high moon pinned under the date band        → the first render: a grey
                                                       smudge the ink guard dimmed
     · haze on a dry day, or none on a humid one
     · a gust that runs the cloud BACKWARDS, or     → the drift's clock must only
       adds frames (a rainy depth 0 has no GPU        ever stretch, and the cap
       headroom left)                                 must not move
     · any of it with the flag OFF, or without the lift
   ═══════════════════════════════════════════════════════════════════════════ */

const CITY = { lat: -27.47, lon: 153.02 };
const deg = (r) => (r * 180) / Math.PI;

/* ── Node-side: the translation layer, the gust pattern, the moon maths ─── */

test("UNKNOWN is no effect — never a plausible default", () => {
  const c = toCauses({ windKph: 20, windBearingDeg: 200 });
  expect(c.gust, "no gust reading must be no surge").toBe(0);
  expect(c.humid, "no humidity must be -1 (no haze), NOT 0 (a measured bone-dry)").toBe(-1);
  expect(c.moon[2], "no moon must be lit fraction -1 (not drawn)").toBe(-1);
});

test("a gust needs a gust, a mean wind AND a bearing — and saturates at 2.5x", () => {
  expect(toCauses({ windKph: 20, windBearingDeg: 200, windGustKph: 20 }).gust).toBe(0);         // no rise
  expect(toCauses({ windKph: 20, windBearingDeg: 200, windGustKph: 35 }).gust).toBeCloseTo(0.5, 5);
  expect(toCauses({ windKph: 20, windBearingDeg: 200, windGustKph: 50 }).gust).toBe(1);
  expect(toCauses({ windKph: 20, windBearingDeg: 200, windGustKph: 90 }).gust).toBe(1);         // clamped
  expect(toCauses({ windKph: 20, windBearingDeg: null, windGustKph: 50 }).gust, "no bearing, no drift to surge").toBe(0);
  expect(toCauses({ windKph: 0, windBearingDeg: 200, windGustKph: 30 }).gust, "no mean wind, no gust OF it").toBe(0);
});

test("humidity maps 0..100 to 0..1 and clamps; the moon uses its OWN 90° scale", () => {
  expect(toCauses({ humidityPct: 64 }).humid).toBeCloseTo(0.64, 5);
  expect(toCauses({ humidityPct: 140 }).humid).toBe(1);
  expect(toCauses({ humidityPct: 0 }).humid, "0% is a reading — a real 0, not unknown").toBe(0);
  const m = toCauses({ moon: { altitudeDeg: 74, azimuthRad: 2, fraction: 0.82 } }).moon;
  expect(m[0], "a 74° moon must not saturate like the sun's 35° scale").toBeCloseTo(74 / 90, 5);
  expect(m[1]).toBeCloseTo(2 - Math.PI / 2, 5);   // the sun's quarter-turn, so it rises where the sun does
  expect(m[2]).toBeCloseTo(0.82, 5);
});

test("the gust pattern: lulls AND gusts, irregular, and never below zero", () => {
  let lulls = 0, gusts = 0, min = 1;
  const starts = [];
  let prev = 0;
  for (let t = 0; t < 600; t += 0.1) {
    const s = surgeAt(t);
    min = Math.min(min, s);
    if (s === 0) lulls++;
    if (s > 0.9) gusts++;
    if (prev === 0 && s > 0) starts.push(t);
    prev = s;
  }
  expect(min, "a negative surge would run the cloud backwards").toBeGreaterThanOrEqual(0);
  expect(lulls, "no lulls: a constant surge is just faster wind").toBeGreaterThan(1000);
  expect(gusts, "no gusts at all").toBeGreaterThan(50);
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  expect(Math.max(...gaps) - Math.min(...gaps), "gusts on a fixed beat — the eye learns a beat").toBeGreaterThan(5);
});

test("the restored moon maths agrees with the almanac (2024, UTC)", () => {
  expect(getMoonIllumination(new Date("2024-01-25T17:54:00Z")).fraction, "full moon").toBeGreaterThan(0.99);
  expect(getMoonIllumination(new Date("2024-01-11T11:57:00Z")).fraction, "new moon").toBeLessThan(0.01);
  const q = getMoonIllumination(new Date("2024-01-18T03:52:00Z"));
  expect(q.fraction, "first quarter").toBeGreaterThan(0.45);
  expect(q.fraction).toBeLessThan(0.55);
  expect(q.phase).toBeGreaterThan(0.2);
  expect(q.phase).toBeLessThan(0.3);
  const p = getMoonPosition(new Date("2026-09-22T11:30:00Z"), CITY.lat, CITY.lon);
  expect(Math.abs(deg(p.altitude))).toBeLessThanOrEqual(90);
});

/* ── The page ──────────────────────────────────────────────────────────── */

const reading = ({ cloudPct = 0, windKph = 0, bearing = 200, gust = null, humidity = null, icon = "clear", code = 0 } = {}) => ({
  now: { wind_kph: windKph, wind_bearing: bearing, wind_gust_kph: gust, cloud_pct: cloudPct, humidity_pct: humidity, temp_c: 21, condition: { code, icon, intensity: null, label: "x" } }
});

async function bootV3(page, flags, { weather = reading(), at }) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(at);
  await page.route("**/api/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.route("**/api/weather/now", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(weather) }));
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) + Object.entries(flags).map(([k, v]) => `\nwindow.CONFIG.features.${k} = ${JSON.stringify(v)};`).join("");
    await route.fulfill({ response: res, body });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function" && window.__substrate?.().frames > 0);
  return errors;
}

// Mat off: this file measures the SKY, not the ink guard (v3-field-mat owns that).
const PLAIN = { v3FieldMat: false, v3SubstrateCoveredPause: false, v3FieldRender: true, v3FieldWeather: false };
const ON = { ...PLAIN, v3FieldCauses: true };
const OFF = { ...PLAIN, v3FieldCauses: false };
const stats = () => window.__substrate();
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const TONIGHT = new Date("2026-09-22T11:30:00Z");       // 82% gibbous, 74° up
const AFTERNOON = new Date("2026-09-22T05:00:00Z");     // 3 pm
const MOON_DOWN = new Date("2026-09-22T19:30:00Z");     // 5:30 am, moon below the horizon

test("flag ON compiles v5 and the tier is live — and it NEEDS the lift", async ({ browser }) => {
  const ctx = await browser.newContext();
  const p1 = await ctx.newPage();
  const errors = await bootV3(p1, ON, { at: TONIGHT });
  const on = await p1.evaluate(stats);
  const p2 = await ctx.newPage();
  await bootV3(p2, { ...ON, v3FieldRender: false }, { at: TONIGHT });
  const unlifted = await p2.evaluate(stats);
  await ctx.close();
  expect(on.backend, "the v5 shader failed to compile — the wall would drop to 2D").toBe("webgl2");
  expect(on.shader).toBe(5);
  expect(on.causes).toBe(1);
  expect(unlifted.causes, "causes on the v2 program: a tier the shader cannot draw").toBe(0);
  expect(errors).toEqual([]);
});

/* Where the moon lands, computed the way the shader places it. y DOWN. */
const moonAt = (m) => {
  const x = 0.5 + Math.cos(m[1]) * 0.42;
  const yUv = 0.14 + Math.max(-0.05, Math.min(1, m[0])) * 0.48;
  return [x, 1 - yUv];
};
const ring = ([x, y], r) => [[x + r / 1.7778, y], [x - r / 1.7778, y], [x, y + r], [x, y - r]];

test("the MOON is where suncalc says, bright — and gone with the flag off", async ({ browser }) => {
  const ctx = await browser.newContext();
  const read = async (flags) => {
    const p = await ctx.newPage();
    await bootV3(p, flags, { at: TONIGHT });
    const m = (await p.evaluate(stats)).moon;
    const at = moonAt(m);
    const [center, ...around] = await p.evaluate((pts) => window.__substrateSample(pts), [at, ...ring(at, 0.08)]);
    await p.close();
    return { m, at, center: lum(center), around: Math.max(...around.map(lum)) };
  };
  const on = await read(ON);
  const off = await read(OFF);
  await ctx.close();
  expect(on.m[2], "tonight's moon is ~82% lit").toBeGreaterThan(0.75);
  // ⚠ The first render pinned a 74° moon inside the ink guard's top band.
  expect(on.at[1], "a high moon must sit BELOW the date band (fy > 0.37)").toBeGreaterThan(0.37);
  expect(on.center, `no moon at ${on.at.map((v) => v.toFixed(3))} (around ${on.around.toFixed(1)})`).toBeGreaterThan(on.around + 60);
  expect(off.center, "the flag off still drew a moon").toBeLessThan(off.around + 10);
});

test("the moon is NOT drawn below the horizon, nor through overcast", async ({ browser }) => {
  const ctx = await browser.newContext();
  const read = async (at, weather) => {
    const p = await ctx.newPage();
    await bootV3(p, ON, { at, weather });
    const m = (await p.evaluate(stats)).moon;
    const pt = moonAt(m);
    const [center, ...around] = await p.evaluate((pts) => window.__substrateSample(pts), [pt, ...ring(pt, 0.08)]);
    await p.close();
    return { m, center: lum(center), around: Math.max(...around.map(lum)) };
  };
  const down = await read(MOON_DOWN, reading());
  const overcast = await read(TONIGHT, reading({ cloudPct: 98, icon: "cloudy", code: 3 }));
  await ctx.close();
  expect(down.m[0], "fixture: the moon must actually be below the horizon").toBeLessThan(0);
  expect(down.center, "a moon drawn below the horizon").toBeLessThan(down.around + 10);
  expect(overcast.center, "the moon shows THROUGH a 98% overcast").toBeLessThan(overcast.around + 25);
});

test("the moon's LIT LIMB faces the sun — a crescent is lit on the sunward side", async ({ page }) => {
  /* A young crescent at dusk: the sun has just set, so the lit sliver must face
     where the sun sits on this wall. Computed from the same suncalc and the
     same placement the shader uses, then sampled either side of the centre. */
  const at = new Date("2026-09-13T08:45:00Z");
  await bootV3(page, ON, { at });
  const m = (await page.evaluate(stats)).moon;
  const sun = getPosition(at, CITY.lat, CITY.lon);
  const sunAlt = Math.max(-1, Math.min(1, deg(sun.altitude) / 35));
  const sunAt = [0.5 + Math.cos(sun.azimuth - Math.PI / 2) * 0.42, sunAlt * 0.7 + 0.12];      // uv, y up
  const mUv = [0.5 + Math.cos(m[1]) * 0.42, 0.14 + Math.max(-0.05, Math.min(1, m[0])) * 0.48];
  let ld = [(sunAt[0] - mUv[0]) * 1.7778, sunAt[1] - mUv[1]];
  const n = Math.hypot(ld[0], ld[1]);
  ld = [ld[0] / n, ld[1] / n];
  /* 0.94 of the radius: a 6%-lit crescent is lit only in the outer ~13% of the
     disc on the sunward side (terminator at 0.87 r). 0.8 r sampled the DARK
     part on both sides and read 13 vs 12 — a test of nothing. */
  const r = 0.021 * 0.94;
  const toward = [mUv[0] + (ld[0] * r) / 1.7778, 1 - (mUv[1] + ld[1] * r)];
  const away = [mUv[0] - (ld[0] * r) / 1.7778, 1 - (mUv[1] - ld[1] * r)];
  const [t, a] = await page.evaluate((pts) => window.__substrateSample(pts), [toward, away]);
  expect(m[2], "fixture: a thin crescent").toBeLessThan(0.15);
  expect(m[0], "fixture: the crescent must be up").toBeGreaterThan(0);
  expect(lum(t), `sunward ${lum(t).toFixed(1)} vs far side ${lum(a).toFixed(1)}`).toBeGreaterThan(lum(a) + 40);
});

/* Open low sky right of the card, above the horizon. */
const LOW_SKY = [0.60, 0.62, 0.35, 0.20];
const meanLum = async (page) => {
  const { lum: L } = await page.evaluate((r) => window.__substrateSampleRect(...r), LOW_SKY);
  return L.reduce((a, b) => a + b, 0) / L.length;
};

test("HUMIDITY hazes the low sky on a humid day — and not on a dry one, unknown, or flag off", async ({ browser }) => {
  const ctx = await browser.newContext();
  const read = async (flags, humidity) => {
    const p = await ctx.newPage();
    await bootV3(p, flags, { at: AFTERNOON, weather: reading({ cloudPct: 3, humidity }) });
    const v = await meanLum(p);
    await p.close();
    return v;
  };
  const unknown = await read(ON, null);
  const dry = await read(ON, 40);
  const humid = await read(ON, 95);
  const off = await read(OFF, 95);
  await ctx.close();
  expect(humid, `no haze at 95% (unknown ${unknown.toFixed(2)})`).toBeGreaterThan(unknown + 1.5);
  expect(Math.abs(dry - unknown), "40% hazed the sky — a dry day has no haze").toBeLessThan(0.3);
  expect(Math.abs(off - unknown), "the flag off still hazed the sky").toBeLessThan(0.3);
});

test("a GUST stretches the drift's clock — never shrinks it — and adds no frames", async ({ browser }) => {
  /* driftT is integrated per draw: it may only run AHEAD of real time in a gust
     and must equal it with no gust reading. Waited until the pattern has had a
     gust, computed from surgeAt so the wait is not a guess. */
  let t = 0, extra = 0;
  while (extra < 1.0) { extra += 0.1 * 1.4 * surgeAt(t); t += 0.1; }
  const ctx = await browser.newContext();
  const read = async (gust) => {
    const p = await ctx.newPage();
    await bootV3(p, ON, { at: AFTERNOON, weather: reading({ windKph: 20, gust }) });
    await p.waitForFunction((need) => window.__substrate().seconds > need, t + 1, { timeout: 60_000 });
    const s = await p.evaluate(stats);
    await p.close();
    return s;
  };
  const none = await read(null);
  const gusty = await read(50);   // 2.5x the mean: gust 1
  await ctx.close();
  expect(none.gust).toBe(0);
  expect(gusty.gust).toBe(1);
  expect(Math.abs(none.driftT - none.seconds), "no gust reading, yet the drift ran off real time").toBeLessThan(0.5);
  expect(gusty.driftT, "a gust must run the drift AHEAD of real time").toBeGreaterThan(gusty.seconds + 0.5);
  expect(gusty.capMs, "a gust must ride the wind's own frame rate").toBe(LIFT_FRAME_MS);
  expect(none.capMs).toBe(LIFT_FRAME_MS);
});
