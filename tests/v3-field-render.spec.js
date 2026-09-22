import { test, expect } from "@playwright/test";
import { frameDue, FRAME_MS, LIFT_FRAME_MS } from "../src/v3/substrate/gl.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE RENDER LIFT — features.v3FieldRender (Living Window 2.0, Stage 2).

   The field gets a real horizon and two cloud decks in perspective, on the
   full-panel store, at a delivered 15 fps. What this file is here to catch:

     · the lifted program fails to COMPILE          → GLSL errors are runtime
                                                      only; the wall silently
                                                      drops to canvas 2D
     · the lift never reaches the shader            → the flag resizes a
                                                      canvas and draws v2 on it
     · the store never grows, or never SHRINKS back → off is not the measured
                                                      480x270; the rollback
                                                      is not a rollback
     · a live flip does not resize                  → the rollback needs a
                                                      reload it was promised
                                                      it would not
     · the context-loss clone keeps the big store   → canvas 2D at 1920x1080,
                                                      a CPU fill, on the night
                                                      the GPU already failed
     · clouds that ignore the cloud reading         → decoration wearing the
                                                      costume of a cause
     · a frame cap that sheds frames to jitter      → asked 15, delivered
                                                      14.2 on the live wall

   Pixels are read back from the GL buffer in the same task as a draw
   (window.__substrateSample) — a frame counter only says draw() was entered.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-09-11T02:00:00Z"); // local noon in Brisbane (+10)

const weatherWith = (cloudPct, windKph = 20) => ({
  now: {
    wind_kph: windKph,
    wind_bearing: 200,
    cloud_pct: cloudPct,
    temp_c: 21,
    condition: { code: 0, icon: cloudPct > 70 ? "cloudy" : "clear", intensity: null, label: "x" }
  }
});

async function bootV3(page, flags, { weather = weatherWith(50), clock = "fixed" } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  if (clock === "fixed") await page.clock.setFixedTime(MIDDAY);
  else await page.clock.install({ time: MIDDAY });
  /* ⚠ Catch-all FIRST: page.route matches the last-registered handler first,
     so registered the other way round the 503 swallows the reading and every
     cloud assertion below measures the category fallback instead. */
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

/* The mat and its guard are pinned OFF: the guard darkens the corners and the
   top band, and this file measures the SKY, not the guard (v3-field-mat.spec
   owns that). The covered pause is off so the field is also live. */
const PLAIN = { v3FieldMat: false, v3SubstrateCoveredPause: false };

const state = () => {
  const s = window.__substrate();
  const c = document.getElementById("substrate");
  return { backend: s.backend, lift: s.lift, store: s.store, shader: s.shader, el: [c.width, c.height] };
};

test("flag ON: the lifted program compiles, and draws on the full-panel store", async ({ page }) => {
  const errors = await bootV3(page, { ...PLAIN, v3FieldRender: true });
  const r = await page.evaluate(state);
  // A GLSL error is only discoverable at runtime, and the wall's answer to one
  // is a silent drop to canvas 2D — so "still webgl2" IS the compile check.
  expect(r.backend, "the lifted shader failed to compile — the wall fell back to 2D").toBe("webgl2");
  expect(r.shader).toBe(3);
  expect(r.lift).toBe(1);
  expect(r.store).toEqual([1920, 1080]);
  expect(r.el, "the stats say lifted but the element is still the base store").toEqual([1920, 1080]);
  expect(errors).toEqual([]);
});

test("flag OFF: the measured tier — v2 on the 480x270 store", async ({ page }) => {
  const errors = await bootV3(page, { ...PLAIN, v3FieldRender: false });
  const r = await page.evaluate(state);
  expect(r.backend).toBe("webgl2");
  expect(r.lift).toBe(0);
  expect(r.store).toEqual([480, 270]);
  expect(r.el).toEqual([480, 270]);
  expect(errors).toEqual([]);
});

/* Center column, fractions of the panel, y down. HZ is 0.12 from the bottom,
   so the horizon is fy 0.88: 0.84 sits just above it, 0.97 in the land. */
const HORIZON = [0.5, 0.84];
const LAND = [0.5, 0.97];
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test("the lift reaches the SHADER: land darker than the horizon — v2 is brightest at the bottom", async ({ page }) => {
  /* The discriminating read. Both programs are warm-low / cool-high, so a
     warm-vs-cool assertion passes on v2 as well and cannot see a lift that
     never reached the GPU. Only the lift has a horizon with land under it. */
  await bootV3(page, { ...PLAIN, v3FieldRender: true }, { weather: weatherWith(5) });
  const [hor, land] = await page.evaluate((pts) => window.__substrateSample(pts), [HORIZON, LAND]);
  expect(lum(land), `land ${land} vs horizon ${hor}`).toBeLessThan(lum(hor) * 0.8);

  // …and the same read on v2 goes the other way, which is what makes the
  // assertion above about the lift rather than about the fixture.
  const page2 = await page.context().newPage();
  await bootV3(page2, { ...PLAIN, v3FieldRender: false }, { weather: weatherWith(5) });
  const [hor2, land2] = await page2.evaluate((pts) => window.__substrateSample(pts), [HORIZON, LAND]);
  expect(lum(land2), `v2 land ${land2} vs horizon ${hor2}`).toBeGreaterThan(lum(hor2));
  await page2.close();
});

/* A row across the open sky right of the card, above the horizon.

   ⚠ NOT max-minus-min. The first version of this test measured spread, and a
   CLEAR sky read 18 — the sun's glow, the forward scatter and the vignette
   are all smooth gradients along any row, so spread measures the lighting and
   not the cloud. Roughness is the mean absolute SECOND difference: a linear or
   gently curved ramp scores ~0 however steep it is, and only structure at the
   sample spacing — cloud edges — scores. */
const N = 24;
const ROW = [0.5, 0.62, 0.74].flatMap((fy) => Array.from({ length: N }, (_, i) => [0.56 + i * 0.015, fy]));
// Per row: a second difference taken ACROSS two rows measures the row gap.
const roughness = (px) => {
  const l = px.map(lum);
  let s = 0, n = 0;
  for (let i = 0; i < l.length; i++) {
    if (i % N === 0 || i % N === N - 1) continue;
    s += Math.abs(l[i - 1] - 2 * l[i] + l[i + 1]);
    n++;
  }
  return s / n;
};

test("the cloud decks follow the READING — clear is clear, broken is broken", async ({ page }) => {
  /* Wind 0, so the drift term is 0 and the decks sit where they sit: with
     wind the field moves between the two reads and the numbers wander. */
  await bootV3(page, { ...PLAIN, v3FieldRender: true }, { weather: weatherWith(3, 0) });
  const clear = roughness(await page.evaluate((pts) => window.__substrateSample(pts), ROW));

  const page2 = await page.context().newPage();
  await bootV3(page2, { ...PLAIN, v3FieldRender: true }, { weather: weatherWith(55, 0) });
  const broken = roughness(await page2.evaluate((pts) => window.__substrateSample(pts), ROW));
  await page2.close();

  /* Measured (SwiftShader, wind 0): clear 0.53–0.88, which is the 8-bit dither
     and nothing else; 55% cloud 2.38–2.51. */
  expect(clear, "a clear reading drew cloud").toBeLessThan(1.3);
  expect(broken, "a 55% reading drew no cloud structure").toBeGreaterThan(1.9);
});

test("a LIVE flip resizes in place, both ways — the rollback needs no reload", async ({ page }) => {
  /* A STILL day: no wind, no rain, so moving() is false and no rAF loop runs.
     With wind, 61 s of installed-clock time replays ~900 full-panel draws in
     SwiftShader and the test times out measuring nothing. */
  const still = { now: { ...weatherWith(50).now, wind_kph: 0 } };
  const errors = await bootV3(page, { ...PLAIN, v3FieldRender: true }, { clock: "install", weather: still });
  expect((await page.evaluate(state)).store).toEqual([1920, 1080]);

  await page.evaluate(() => { window.CONFIG.features.v3FieldRender = false; });
  await page.clock.runFor(61_000);
  const off = await page.evaluate(state);
  expect(off.store, "flag flipped off in-page but the store stayed lifted").toEqual([480, 270]);
  expect(off.lift).toBe(0);

  await page.evaluate(() => { window.CONFIG.features.v3FieldRender = true; });
  await page.clock.runFor(61_000);
  expect((await page.evaluate(state)).store).toEqual([1920, 1080]);
  expect(errors).toEqual([]);
});

test("⚠ a context lost while LIFTED lands on a 2D field at the BASE store", async ({ page }) => {
  const errors = await bootV3(page, { ...PLAIN, v3FieldRender: true });
  expect((await page.evaluate(state)).el).toEqual([1920, 1080]);
  const asked = await page.evaluate(() => {
    const ext = document.getElementById("substrate").getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (!ext) return false;
    ext.loseContext();
    return true;
  });
  expect(asked, "WEBGL_lose_context is unavailable — the loss was never injected").toBe(true);
  await page.waitForFunction(() => window.__substrate().backend !== "webgl2", null, { timeout: 5000 });
  const r = await page.evaluate(() => {
    const c = document.getElementById("substrate");
    return { backend: window.__substrate().backend, el: c ? [c.width, c.height] : null };
  });
  expect(r.backend).toBe("canvas2d");
  expect(r.el, "the fallback inherited the lifted store — a 1920x1080 CPU fill").toEqual([480, 270]);
  expect(errors).toEqual([]);
});

/* ── The frame cap, driven by synthetic vsyncs ──────────────────────────────
   60 Hz with a given peak-to-peak jitter on the rAF timestamp. Node-side: pure
   arithmetic, no browser, no timing flake.

   ⚠ THE "ASKS 15, GETS 12" FINDING WAS THE PROBE'S, NOT THE SUBSTRATE'S.
   G11-GPU-CEILING-2026-09-22.md read 12 fps from field-ceiling.cjs's OWN loop.
   The real substrate on the same wall read 1105 frames / 74.7 s (14.8) and 325
   / 22.9 s (14.2). This model says why those two numbers differ: jitter alone
   costs the 66 ms cap 0.1–1.7 fps and never gets it to 12. The live 14.2–14.8
   sits where 1.4–2 ms of jitter puts it. So the lift's 60 ms buys a steady 15
   out of a wandering 14-and-a-bit — real, and small. */
function deliveredFps(lift, jitterMs, seconds = 10) {
  let seed = 7;
  const jitter = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * jitterMs; };
  let last = 0;
  let drawn = 0;
  for (let i = 1; i <= seconds * 60; i++) {
    const now = i * (1000 / 60) + jitter();
    if (frameDue(now, last, lift)) { last = now; drawn++; }
  }
  return drawn / seconds;
}

const JITTERS = [0.4, 1.4, 2, 3, 6];

test("the lift DELIVERS 15 fps at every jitter — and never more", () => {
  for (const j of JITTERS) {
    const fps = deliveredFps(true, j);
    expect(fps, `lift at ${j} ms jitter`).toBeGreaterThanOrEqual(14.9);
    // A cap that slipped to every third vsync is 20 fps — a third more cost
    // than the budget row was measured at.
    expect(fps, `lift at ${j} ms jitter`).toBeLessThanOrEqual(15.1);
  }
  expect(LIFT_FRAME_MS).toBeGreaterThan(1000 / 60 * 3);  // never every third vsync
  expect(LIFT_FRAME_MS).toBeLessThan(1000 / 60 * 4);     // always catches the fourth
});

test("the base tier is untouched — 66 ms, and it sheds frames as jitter grows", () => {
  /* Flag off must stay the measured tier. And the model has to show the defect
     the lift fixes, or the 60 above is a number with no reason behind it: at
     the jitter that matches the live 14.2, the base tier is visibly short. */
  expect(FRAME_MS).toBe(66);
  expect(deliveredFps(false, 0.4)).toBeGreaterThan(14.8);
  expect(deliveredFps(false, 2)).toBeLessThan(14.5);
});
