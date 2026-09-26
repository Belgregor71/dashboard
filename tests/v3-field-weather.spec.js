import { test, expect } from "@playwright/test";
import {
  frameMsFor, strikeEnvelope, STRIKE_MS,
  FRAME_MS, LIFT_FRAME_MS, RAIN_FRAME_MS, STRIKE_FRAME_MS
} from "../src/v3/substrate/gl.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE WEATHER IN THE FIELD — features.v3FieldWeather (Living Window 2.0,
   Stage 2, slice 2). Rain, stars and lightning drawn by the lifted program.
   What this file is here to catch:

     · rain that is drawn with no rain reading, or none with one
     · rain leaning AGAINST the wind            → the sign is invisible in
                                                  review and obvious to anyone
                                                  who just walked in out of it
     · stars in daylight, or through overcast   → the one thing the CSS field
                                                  on the mat got wrong
     · a strike that never lights the field     → the onStrike wiring is dead
     · a field that HOLDS the flash             → a still day has no next frame
                                                  to put the sky back
     · a frame cap that does not fall back      → 60 fps forever, for nothing
     · the mat's painted stars left up           → two star patterns on one wall
     · any of it with the flag OFF               → flag off must be the lift

   Pixels are read back from the GL buffer in the same task as a draw
   (window.__substrateSample / __substrateSampleRect).
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-09-11T02:00:00Z");   // local noon in Brisbane (+10)
const MIDNIGHT = new Date("2026-09-11T14:00:00Z"); // local midnight

const reading = ({ cloudPct = 3, windKph = 0, bearing = 200, icon = "clear", code = 0, intensity = null } = {}) => ({
  now: {
    wind_kph: windKph,
    wind_bearing: bearing,
    cloud_pct: cloudPct,
    temp_c: 21,
    condition: { code, icon, intensity, label: "x" }
  }
});

async function bootV3(page, flags, { weather = reading(), at = MIDDAY } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(at);
  // ⚠ Catch-all FIRST: page.route matches the last-registered handler first.
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.route("**/api/weather/now", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(weather) }));
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) +
      Object.entries(flags).map(([k, v]) => `\nwindow.CONFIG.features.${k} = ${JSON.stringify(v)};`).join("");
    await route.fulfill({ response: res, body });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function" && window.__substrate?.().frames > 0);
  return pageErrors;
}

/* Mat and guard OFF — this file measures the SKY (v3-field-mat.spec owns the
   guard); covered pause off so the field is live. The lift is ON everywhere:
   the weather is drawn only by the lifted program. */
const PLAIN = { v3FieldMat: false, v3SubstrateCoveredPause: false, v3FieldRender: true };
const ON = { ...PLAIN, v3FieldWeather: true };
const OFF = { ...PLAIN, v3FieldWeather: false };

const stats = () => window.__substrate();

/* ── Node-side: the caps and the curve ──────────────────────────────────── */

test("each cause earns its own frame cap — and only on the lifted program with the weather drawn", () => {
  expect(frameMsFor({ lift: 0, weather: 1, rain: 1, striking: true }), "v2 must stay the measured 66").toBe(FRAME_MS);
  expect(frameMsFor({ lift: 1 })).toBe(LIFT_FRAME_MS);
  expect(frameMsFor({ lift: 1, weather: 1 }), "a still sky earns nothing above 15").toBe(LIFT_FRAME_MS);
  expect(frameMsFor({ lift: 1, weather: 1, rain: 0.6 })).toBe(RAIN_FRAME_MS);
  expect(frameMsFor({ lift: 1, weather: 1, rain: 0.6, striking: true }), "a strike outranks rain").toBe(STRIKE_FRAME_MS);
  // The weather tier off: nothing is drawn at rain rate, so nothing is paid for.
  expect(frameMsFor({ lift: 1, weather: 0, rain: 1 })).toBe(LIFT_FRAME_MS);
  expect(frameMsFor({ lift: 1, weather: 0, striking: true })).toBe(LIFT_FRAME_MS);
});

/* 60 Hz with jitter on the rAF timestamp, as in v3-field-render.spec. */
function delivered(ms, jitterMs, seconds = 10) {
  let seed = 7;
  const jitter = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * jitterMs; };
  let last = 0, drawn = 0;
  for (let i = 1; i <= seconds * 60; i++) {
    const now = i * (1000 / 60) + jitter();
    if (now - last >= ms) { last = now; drawn++; }
  }
  return drawn / seconds;
}

test("rain DELIVERS a steady 30 and a strike a steady 60, at every jitter", () => {
  for (const j of [0.4, 1.4, 2, 3, 6]) {
    expect(delivered(RAIN_FRAME_MS, j), `rain at ${j} ms`).toBeGreaterThanOrEqual(29.9);
    expect(delivered(RAIN_FRAME_MS, j), `rain at ${j} ms`).toBeLessThanOrEqual(30.1);
    expect(delivered(STRIKE_FRAME_MS, j), `strike at ${j} ms`).toBeGreaterThanOrEqual(59.9);
  }
});

test("the strike curve is the overlay's: dark, a peak at 5%, a flicker bump, dark by 1.6 s", () => {
  expect(strikeEnvelope(0)).toBe(0);
  expect(strikeEnvelope(STRIKE_MS * 0.05)).toBeCloseTo(0.9, 5);
  expect(strikeEnvelope(STRIKE_MS * 0.12)).toBeCloseTo(0.4, 5);
  expect(strikeEnvelope(STRIKE_MS * 0.2)).toBeCloseTo(0.68, 5);
  expect(strikeEnvelope(STRIKE_MS * 0.2)).toBeGreaterThan(strikeEnvelope(STRIKE_MS * 0.12)); // the bump
  expect(strikeEnvelope(STRIKE_MS)).toBe(0);
  expect(strikeEnvelope(STRIKE_MS * 3)).toBe(0);
  expect(strikeEnvelope(-5)).toBe(0);
  expect(strikeEnvelope(STRIKE_MS * 0.05, 0.3)).toBeCloseTo(0.27, 5);   // an aftershock is smaller
});

/* ── The page ──────────────────────────────────────────────────────────── */

test("flag ON: the v4 program compiles and the weather tier is live", async ({ page }) => {
  const errors = await bootV3(page, ON);
  const s = await page.evaluate(stats);
  // A GLSL error drops the wall to canvas 2D silently, so "still webgl2" IS the compile check.
  expect(s.backend, "the v4 shader failed to compile").toBe("webgl2");
  expect(s.shader).toBe(5);
  expect(s.weather).toBe(1);
  expect(errors).toEqual([]);
});

test("the weather NEEDS the lift — on the v2 program it is not drawn", async ({ page }) => {
  await bootV3(page, { ...ON, v3FieldRender: false });
  const s = await page.evaluate(stats);
  expect(s.lift).toBe(0);
  expect(s.weather, "weather on the v2 program: a tier the shader cannot draw").toBe(0);
  expect(s.capMs).toBe(FRAME_MS);
});

const HEAVY = reading({ cloudPct: 3, icon: "rain", code: 65, intensity: "heavy" });
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* ⚠ Not a single 1-px row: the 8-bit dither alone scores ~0.55 there, and the
   rain — faint on purpose — only doubled it (first run: wet 1.04, dry 0.55).
   With no wind the streaks are exactly vertical, so averaging 16 rows down each
   column cancels the dither (it is per-pixel noise) and keeps the streaks. */
async function streakiness(page) {
  const { w, h, lum: L } = await page.evaluate(() => window.__substrateSampleRect(0.60, 0.36, 0.125, 16 / 1080));
  const profile = Array.from({ length: w }, (_, x) => {
    let s = 0;
    for (let y = 0; y < h; y++) s += L[y * w + x];
    return s / h;
  });
  let s = 0;
  for (let i = 1; i < w - 1; i++) s += Math.abs(profile[i - 1] - 2 * profile[i] + profile[i + 1]);
  return s / (w - 2);
}

test("rain follows the READING and the FLAG — streaks with both, none without either", async ({ page }) => {
  await bootV3(page, ON, { weather: HEAVY });
  const wet = await streakiness(page);
  expect((await page.evaluate(stats)).capMs, "raining, weather on: the 30 fps cap").toBe(RAIN_FRAME_MS);

  const dry = await page.context().newPage();
  await bootV3(dry, ON, { weather: reading({ cloudPct: 3 }) });
  const dryR = await streakiness(dry);
  await dry.close();

  const off = await page.context().newPage();
  await bootV3(off, OFF, { weather: HEAVY });
  const offR = await streakiness(off);
  expect((await off.evaluate(stats)).capMs, "weather off: rain earns nothing").toBe(LIFT_FRAME_MS);
  await off.close();

  const floor = Math.max(dryR, offR);
  expect(wet, `rain drew no streaks (dry ${dryR.toFixed(2)}, off ${offR.toFixed(2)})`).toBeGreaterThan(floor * 3);
  expect(Math.abs(offR - dryR), `the flag off still drew rain (wet ${wet.toFixed(2)})`).toBeLessThan(wet / 4);
});

/* The lean. Two 1-px rows 24 px apart; along a streak, the lower row is the
   upper one SHIFTED by the lean. The best-matching shift says which way. */
const UP = 0.38, GAP = 24;
/* ⚠ THE SPAN IS BELOW THE STREAK GRID'S COMMON PERIOD, AND THAT IS THE WHOLE
   TEST. The sheets' columns repeat every 28.4 px (near), 15 px (mid) and
   10.1 px (far) — and 1x, 2x and 3x of those all land at ~29-30 px. So ~29 px
   from the true shift, all three sheets line up AGAIN: an aliased peak as
   strong as the real one. At ±20 that alias (-11 + 29 = +18) was in range and
   won on some random layouts — pre-push red 2026-09-22, "west" read +18 where
   every clean run reads exactly -11. ±15 excludes it with margin; the aliases
   left in range are single-sheet, so the three-sheet true peak outvotes them.
   ⚠⚠ BUT THE ALIAS'S SHOULDER STILL REACHES IN. Excluding +18 does not exclude
   the slope up to it: measured over 32 curves, the score RAMPS toward the +15
   edge, and on one clean run the edge tied the true -11 peak exactly (2104 vs
   2104) — under full-suite load it won, "west" read +15 (2026-09-26). So the
   winner is the most PROMINENT shift, not the highest: score minus the mean of
   its ±2 neighbours. A streak peak is sharp (+150..+300 over 32 curves); a ramp
   scores ~0 however high it climbs, and the window's own edges cannot compete. */
function bestShift(a, b, span = 15) {
  const score = [];
  for (let s = -span; s <= span; s++) {
    let sum = 0;
    for (let i = span; i < a.length - span; i++) sum += a[i] * b[i + s];
    score.push(sum);
  }
  let best = 0, bestProm = -Infinity;
  for (let k = 2; k < score.length - 2; k++) {
    const prom = score[k] - (score[k - 2] + score[k + 2]) / 2;
    if (prom > bestProm) { bestProm = prom; best = k - span; }
  }
  return best;
}
async function leanUnder(page, bearing) {
  await bootV3(page, ON, { weather: reading({ cloudPct: 3, windKph: 45, bearing, icon: "rain", code: 65, intensity: "heavy" }) });
  /* ⚠ Both rows in ONE draw. Two draws are tens of ms apart and the rain
     FALLS between them, so the lower row would be compared with streaks that
     have already moved on — the correlation would measure the fall, not the lean. */
  /* ⚠ And ONE readPixels, not 720. Point sampling syncs the GPU per pixel,
     and on a page raining at 30 fps in SwiftShader that ran past the 30 s
     timeout under worker contention. One rect spanning both rows is one sync. */
  const { w, lum: L } = await page.evaluate(([fy, h]) => window.__substrateSampleRect(0.55, fy, 360 / 1920, h), [UP, (GAP + 1) / 1080]);
  const a = L.slice(0, w), b = L.slice(GAP * w, GAP * w + w);
  // Mean-removed, so the sky's gradient does not vote.
  const norm = (l) => { const m = l.reduce((x, y) => x + y) / l.length; return l.map((v) => v - m); };
  return bestShift(norm(a), norm(b));
}

test("rain LEANS WITH THE WIND — the way the cloud drifts, both directions", async ({ browser }) => {
  /* East is on the LEFT of this wall (toCauses). A wind FROM the east (90)
     blows west, to the right: a drop's lower end is further right. From the
     west (270), the mirror. Predicted shift at 45 kph: ~11 px over 24.

     ⚠ REDUCED MOTION, so the rain is PAINTED but not LOOPED. The lean is a
     property of one frame; a page raining at 30 fps in SwiftShader queued the
     read behind its own draws and timed out under worker contention. Reduced
     motion is the designed "still field that still shows the weather" (gl.js),
     so the read is of a real state, and asserted to be one — not assumed: this
     repo has seen Playwright's reducedMotion do nothing. */
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const east = await leanUnder(await ctx.newPage(), 90);
  const west = await leanUnder(await ctx.newPage(), 270);
  const still = await (async () => {
    const p = await ctx.newPage();
    await bootV3(p, ON, { weather: HEAVY });
    const s = await p.evaluate(() => ({ ...window.__substrate(), rm: matchMedia("(prefers-reduced-motion: reduce)").matches }));
    await p.close();
    return s;
  })();
  await ctx.close();
  expect(still.rm, "reducedMotion never reached matchMedia — the loop is still running").toBe(true);
  expect(still.animating, "reduced motion: rain must be painted, not looped").toBe(false);
  expect(still.weather).toBe(1);
  expect(east, "wind from the east: rain should lean toward the west (right)").toBeGreaterThan(3);
  expect(west, "wind from the west: rain should lean toward the east (left)").toBeLessThan(-3);
});

/* Stars: local peaks in a patch of upper sky — a pixel brighter than every
   pixel 3 px away by a margin. Cloud edges are smooth over 3 px; a star is not. */
const PATCH = [0.60, 0.15, 0.35, 0.30];
async function starsIn(page) {
  const r = await page.evaluate((p) => window.__substrateSampleRect(...p), PATCH);
  const { w, h, lum: L } = r;
  let n = 0;
  for (let y = 3; y < h - 3; y++) {
    for (let x = 3; x < w - 3; x++) {
      const v = L[y * w + x];
      const ring = [L[y * w + x - 3], L[y * w + x + 3], L[(y - 3) * w + x], L[(y + 3) * w + x]];
      if (v > Math.max(...ring) + 18 && v >= L[y * w + x - 1] && v >= L[y * w + x + 1]
        && v >= L[(y - 1) * w + x] && v > L[(y + 1) * w + x]) n++;
    }
  }
  return n;
}

test("stars: on a clear night, behind overcast NOT, by day NOT, with the flag off NOT", async ({ browser }) => {
  const ctx = await browser.newContext();
  const count = async (flags, weather, at) => {
    const p = await ctx.newPage();
    await bootV3(p, flags, { weather, at });
    const n = await starsIn(p);
    await p.close();
    return n;
  };
  const clearNight = await count(ON, reading({ cloudPct: 0 }), MIDNIGHT);
  const overcast = await count(ON, reading({ cloudPct: 97, icon: "cloudy", code: 3 }), MIDNIGHT);
  const day = await count(ON, reading({ cloudPct: 0 }), MIDDAY);
  const off = await count(OFF, reading({ cloudPct: 0 }), MIDNIGHT);
  await ctx.close();

  // ~0.1 stars per 24 px cell over ~350 cells, fading toward the patch's lower edge.
  expect(clearNight, "a clear night drew no stars").toBeGreaterThan(8);
  expect(overcast, `stars showed THROUGH overcast (clear night ${clearNight})`).toBeLessThan(clearNight / 3);
  expect(day, "stars in daylight").toBe(0);
  expect(off, "the flag off drew stars").toBe(0);
});

/* The whole sky's mean, on a coarse grid — the strike point is random. */
const GRID = [];
for (let y = 0.1; y < 0.85; y += 0.05) for (let x = 0.05; x < 1; x += 0.05) GRID.push([x, y]);
const mean = (px) => px.map(lum).reduce((a, b) => a + b) / px.length;
const STORM = reading({ cloudPct: 60, icon: "storm", code: 95, intensity: "heavy" });

/* Sampled ~80 ms into the strike — the curve's 5% peak. A busy wait, because
   setFixedTime freezes Date, not performance.now(), and the envelope reads the
   latter. Rain off (no intensity) keeps the loop quiet between strikes. */
async function flashAt(page) {
  return page.evaluate((grid) => {
    const before = window.__substrateSample(grid);
    // Timed from the CALL: strike() draws a frame itself, ~85 ms in SwiftShader.
    const t = performance.now();
    const ok = window.__v3Atmo.strike();
    while (performance.now() - t < 80) { /* the attack */ }
    return { before, during: window.__substrateSample(grid), ok, s: window.__substrate() };
  }, GRID);
}
const STILL_STORM = reading({ cloudPct: 60, icon: "cloudy", code: 3 });
const STRIKES = { v3AtmoOverlay: true, v3AtmoLightning: true };

test("a strike LIGHTS the field, runs at 60, and puts the sky back DARK on a still day", async ({ page }) => {
  const errors = await bootV3(page, { ...ON, ...STRIKES }, { weather: STILL_STORM });
  const r = await flashAt(page);
  expect(r.ok, "__v3Atmo.strike() refused — the overlay host is not up").toBe(true);
  expect(r.s.striking).toBe(true);
  expect(r.s.capMs, "a strike in flight: the 60 fps cap").toBe(STRIKE_FRAME_MS);
  expect(mean(r.during), `before ${mean(r.before).toFixed(1)}`).toBeGreaterThan(mean(r.before) + 4);

  // Past the decay. The loop's own last frame must be dark, and it must stop.
  await page.waitForFunction(() => !window.__substrate().striking && !window.__substrate().animating,
    null, { timeout: 5000 });
  const after = await page.evaluate(stats);
  expect(after.lastStrike, "the field is HOLDING the flash — no settle draw after the decay").toBe(0);
  expect(after.capMs).toBe(LIFT_FRAME_MS);
  expect(errors).toEqual([]);
});

test("flag OFF: the same strike flashes the pane but NOT the field", async ({ page }) => {
  await bootV3(page, { ...OFF, ...STRIKES }, { weather: STILL_STORM });
  const r = await flashAt(page);
  expect(r.ok, "the pane's strike must still fire — this is the control").toBe(true);
  expect(r.s.striking, "the field took a strike with its weather tier off").toBe(false);
  expect(Math.abs(mean(r.during) - mean(r.before)), "the field flashed with the flag off").toBeLessThan(1.5);
});

/* ONE RAIN, NOT TWO. Seen by the owner on the live wall, 2026-09-22: the
   field's rain leaning with the wind and the pane's rain — its lean baked into
   its texture — leaning the other way. The pane stands down while the field
   draws rain, and ONLY then: flag off, or the mat opaque, it is the only rain. */
const paneRain = () => {
  const r = document.querySelector(".atmo-overlay__rain");
  return {
    present: Boolean(r),
    display: r ? getComputedStyle(r).display : null,
    raining: document.documentElement.dataset.atmoRaining ?? null
  };
};

test("ONE rain: the pane's stands down under the field's — and stays when the field cannot show it", async ({ browser }) => {
  const ctx = await browser.newContext();
  const read = async (flags, depth = 0) => {
    const p = await ctx.newPage();
    await bootV3(p, { ...PLAIN, v3AtmoOverlay: true, v3Archive: true, v3FieldMat: true, ...flags }, { weather: HEAVY });
    await p.waitForFunction(() => document.documentElement.dataset.atmoRaining === "1", null, { timeout: 5000 });
    if (depth) {
      await p.evaluate((d) => window.__setDepth(d, "spec"), depth);
      await p.waitForFunction((d) => document.documentElement.dataset.depth === String(d), depth, { timeout: 5000 });
    }
    const r = { ...(await p.evaluate(paneRain)), depth: await p.evaluate(() => document.documentElement.dataset.depth) };
    await p.close();
    return r;
  };
  const field = await read({ v3FieldWeather: true });
  const pane = await read({ v3FieldWeather: false });
  const opaque = await read({ v3FieldWeather: true, v3FieldMat: false });
  const unlifted = await read({ v3FieldWeather: true, v3FieldRender: false });
  /* ⚠ Depth 1+ brings the full-bleed photograph back over the field
     (css/archive.css), so the field's rain is HIDDEN there. Keyed on the flag
     markers alone, the pane stood down anyway: rain outside, none on the glass.
     Found by the contrast gate's archive-off variants on the flip, 2026-09-22. */
  const deep = await read({ v3FieldWeather: true }, 1);
  const noArchive = await read({ v3FieldWeather: true, v3Archive: false });
  await ctx.close();

  expect(field.depth).toBe("0");
  expect(deep.depth, "the depth change never landed — the deep read measures depth 0").toBe("1");
  expect(deep.display, "depth 1: the photograph covers the field, so the pane's rain must stay").not.toBe("none");
  expect(noArchive.display, "no archive: the field is never the backdrop, so the pane's rain must stay").not.toBe("none");

  for (const r of [field, pane, opaque, unlifted, deep, noArchive]) {
    expect(r.present, "the pane's rain node is not there — nothing below measures anything").toBe(true);
    expect(r.raining).toBe("1");
  }
  expect(pane.display, "control: flag off, the pane's rain is the only rain").not.toBe("none");
  expect(field.display, "TWO rains: the pane still falls over the field's").toBe("none");
  expect(opaque.display, "the mat is opaque — the field's rain is hidden, so the pane's must stay").not.toBe("none");
  expect(unlifted.display, "no lift, no field rain — the pane's must stay").not.toBe("none");
});

/* RAIN UNDER THE WORDS. The contrast gate cannot measure the field's rain —
   it animates, and MEASURE needs one still frame — so its `weather` variant
   measures the field DRY. This is the bound that makes that honest: under the
   hour, with the ink guard on as on the wall, heavy rain must never make the
   ground brighter than the dry field the gate measured. Rain streaks add light,
   but the reading also greys the sky (uRain) and the guard multiplies both.
   Measured 2026-09-22 (46k px, SwiftShader): dry max 20.4, heavy rain 16.0-16.2
   — rain DARKENS it here. Injected 12x streaks read 56.6 and went red. */
const UNDER_HOUR = [0.05, 0.77, 0.16, 0.14];   // #hour's box on the stage, as fractions
async function underHour(page) {
  const { lum: L } = await page.evaluate((r) => window.__substrateSampleRect(...r), UNDER_HOUR);
  const sorted = [...L].sort((a, b) => a - b);
  return { max: sorted[sorted.length - 1], p99: sorted[Math.floor(sorted.length * 0.99)], n: L.length };
}

test("rain never brightens the ground under the hour past the DRY field the gate measured", async ({ browser }) => {
  const ctx = await browser.newContext();
  const read = async (weather) => {
    const p = await ctx.newPage();
    await bootV3(p, { ...ON, v3FieldMat: true }, { weather });
    const guard = (await p.evaluate(stats)).inkGuard;
    const r = await underHour(p);
    await p.close();
    return { ...r, guard };
  };
  const dry = await read(reading({ cloudPct: 3 }));
  const wet = await read(HEAVY);
  await ctx.close();
  expect(dry.guard, "the ink guard is off — this would measure a ground the wall never shows").toBeGreaterThan(0);
  expect(dry.n).toBeGreaterThan(1000);
  expect(wet.max, `heavy rain brightened the ground under the hour (dry max ${dry.max.toFixed(1)})`).toBeLessThanOrEqual(dry.max + 1);
});

/* The mat's painted starfield stands down only when the field can show its own. */
const NIGHT_SKY = { v3AtmoOverlay: true, v3AtmoNightSky: true, v3Archive: true, v3FieldMat: true };
const matStars = () => {
  const a = document.querySelector(".archive");
  return {
    present: Boolean(a),
    image: a ? getComputedStyle(a).backgroundImage : null,
    twinkle: a ? getComputedStyle(a, "::before").display : null,
    nightSky: document.documentElement.dataset.atmoNightSky ?? null,
    fieldWeather: document.documentElement.dataset.fieldWeather ?? null
  };
};

test("the mat's painted stars stand DOWN under the field's — and stay up when it cannot show them", async ({ browser }) => {
  const ctx = await browser.newContext();
  const read = async (flags) => {
    const p = await ctx.newPage();
    await bootV3(p, { ...PLAIN, ...NIGHT_SKY, ...flags }, { weather: reading({ cloudPct: 0 }), at: MIDNIGHT });
    await p.waitForFunction(() => document.documentElement.dataset.atmoNightSky === "1", null, { timeout: 5000 });
    const r = await p.evaluate(matStars);
    await p.close();
    return r;
  };
  const standDown = await read({ v3FieldWeather: true });
  const keep = await read({ v3FieldWeather: false });
  const opaque = await read({ v3FieldWeather: true, v3FieldMat: false });
  // The weather flag on but the LIFT off: the v2 program draws no stars.
  const unlifted = await read({ v3FieldWeather: true, v3FieldRender: false });
  await ctx.close();

  // Assert the node and the night-sky state are THERE before what they paint.
  for (const r of [standDown, keep, opaque, unlifted]) {
    expect(r.present).toBe(true);
    expect(r.nightSky).toBe("1");
  }
  expect(keep.image, "control: the painted starfield must be up with the flag off").toMatch(/^url\(/);
  expect(standDown.fieldWeather).toBe("1");
  expect(standDown.image, "two star patterns: the mat still paints its own over the field's").toBe("none");
  expect(standDown.twinkle).toBe("none");
  expect(opaque.image, "the mat is opaque — the field's stars are hidden, so these must stay").toMatch(/^url\(/);
  expect(unlifted.fieldWeather, "stamped without the lift").toBe(null);
  expect(unlifted.image, "no lift, no field stars — the mat's must stay").toMatch(/^url\(/);
});
