import { test, expect } from "./fixtures/coverage.js";
import {
  decodeWorld,
  mapPlan,
  placeLine,
  namesLine,
  yearOf,
  photoFit
} from "../src/v3/core/journey-geo.js";
import { COUNTRIES } from "../src/v3/core/journey-world.js";

/* THE MEMORY JOURNEY — features.v3MemoryJourney (core/journey.js).

   The pure half pins what the wall may CLAIM: whether a map appears, at what
   precision, and which words. The surface half pins the page: the right reveal
   for the right memory, the words and the clock never colliding, nothing left
   running or growing, and every failure falling back to a photograph. */

const WORLD = decodeWorld(COUNTRIES);

/* ── What the wall may claim ─────────────────────────────────────────────── */

test("a geotagged memory abroad gets a pinned map; at home, none", () => {
  const samui = mapPlan({ country: "Thailand", lat: 9.53, lng: 100.06 }, WORLD);
  expect(samui.precision).toBe("point");
  expect(samui.country).toBe("Thailand");
  expect(samui.point).not.toBeNull();
  expect(mapPlan({ country: "Australia", lat: -27.47, lng: 153.02 }, WORLD)).toBeNull();
});

test("a country with no coordinates lights the country and claims NO point", () => {
  const p = mapPlan({ country: "France" }, WORLD);
  expect(p.precision).toBe("country");
  expect(p.point).toBeNull();
});

test("disagreement, the sea, null island and an unknown name are all refusals", () => {
  // Says Thailand, stands in Brisbane: the two disagree — not confident.
  expect(mapPlan({ country: "Thailand", lat: -27.47, lng: 153.02 }, WORLD)).toBeNull();
  // No country and the point is at sea: nothing to name.
  expect(mapPlan({ lat: -30, lng: 170 }, WORLD)).toBeNull();
  // No country, but the point is on land we can name — evidence, not a guess.
  expect(mapPlan({ lat: 35.0, lng: 135.77 }, WORLD)?.country).toBe("Japan");
  // (0,0) is a GPS fault: the country is trusted, the point is not.
  expect(mapPlan({ country: "Ghana", lat: 0, lng: 0 }, WORLD)).toMatchObject({ precision: "country", point: null });
  expect(mapPlan({ country: "Narnia" }, WORLD)).toBeNull();
  expect(mapPlan({}, WORLD)).toBeNull();
  // No world loaded (chunk failed): never a map.
  expect(mapPlan({ country: "Thailand", lat: 9.5, lng: 100 }, null)).toBeNull();
});

test("ISO long-form country names reach the right shape", () => {
  expect(mapPlan({ country: "United States", lat: 40.7, lng: -74 }, WORLD).country).toBe("United States of America");
  expect(mapPlan({ country: "Viet Nam" }, WORLD).country).toBe("Vietnam");
});

test("the place reads naturally and never repeats or overflows", () => {
  expect(placeLine({ city: "Ko Samui", state: "Surat Thani", country: "Thailand" })).toBe("Ko Samui, Thailand");
  expect(placeLine({ city: "Nudgee", state: "Queensland", country: "Australia" })).toBe("Nudgee, Queensland");
  expect(placeLine({ city: "Singapore", state: "Singapore", country: "Singapore" })).toBe("Singapore");
  expect(placeLine({ city: "A Very Long Resort Strip Name Indeed", state: "Île-de-France", country: "France" }))
    .toBe("Île-de-France, France");
  expect(placeLine({ state: "Queensland", country: "Australia" })).toBe("Queensland");
  expect(placeLine({})).toBeNull();
  expect(placeLine({ city: "  ", country: "" })).toBeNull();
});

test("names are joined with a dot, de-duplicated, capped, never invented", () => {
  expect(namesLine(["Greg", " Brett ", "Greg", ""])).toBe("Greg · Brett");
  expect(namesLine(["a", "b", "c", "d", "e"])).toBe("a · b · c and 2 others");
  expect(namesLine([])).toBeNull();
  expect(namesLine(undefined)).toBeNull();
});

test("the year comes from the ISO string only", () => {
  expect(yearOf({ localDateTime: "2019-08-18T09:00:00Z" })).toBe("2019");
  expect(yearOf({ localDateTime: 20190818 })).toBeNull();
  expect(yearOf({})).toBeNull();
});

test("a near-16:9 photograph fills the wall; anything else is shown whole", () => {
  expect(photoFit(16 / 9).mode).toBe("cover");
  expect(photoFit(1.5).mode).toBe("cover");
  const portrait = photoFit(0.75);
  expect(portrait).toMatchObject({ mode: "contain", w: 810, h: 1080, x: 555, y: 0 });
  expect(photoFit(4 / 3).mode).toBe("contain");
  const pano = photoFit(4.5);
  expect(pano.mode).toBe("contain");
  expect(pano.w).toBe(1920);
  expect(photoFit(null).mode).toBe("contain");
});

/* ── The page ───────────────────────────────────────────────────────────── */

const MIDDAY = new Date("2026-07-06T12:00:00");
/* After sunset but inside the display window: at 23:00 the panel is dark, and a
   dark panel correctly forces a plain cut — a different state from night. */
const NIGHT = new Date("2026-07-06T19:30:00");

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const PHOTOS = {
  bright: svg(1600, 900,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfdff"/><stop offset=".6" stop-color="#dfeefa"/><stop offset="1" stop-color="#f6ecd8"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/>`),
  dark: svg(1600, 900, `<rect width="1600" height="900" fill="#0b0c12"/><circle cx="1200" cy="300" r="60" fill="#3a3f55"/>`),
  portrait: svg(900, 1200,
    `<rect width="900" height="1200" fill="#c9774a"/><rect y="700" width="900" height="500" fill="#2f5d3a"/><circle cx="450" cy="420" r="160" fill="#f3d2a0"/>`),
  pano: svg(2400, 533, `<rect width="2400" height="533" fill="#5b88b5"/><rect y="330" width="2400" height="203" fill="#7a6a4c"/>`)
};
const kindOf = (id) => Object.keys(PHOTOS).find((k) => id.startsWith(k)) ?? "dark";

const at = (id, extra = {}) => ({
  id,
  aspect: kindOf(id) === "portrait" ? 0.75 : kindOf(id) === "pano" ? 4.5 : 1.778,
  localDateTime: "2019-07-06T09:00:00Z",
  city: null,
  state: null,
  country: null,
  lat: null,
  lng: null,
  people: [],
  ...extra
});
const SAMUI = { city: "Ko Samui", state: "Surat Thani", country: "Thailand", lat: 9.53, lng: 100.06 };
const NUDGEE = { city: "Nudgee", state: "Queensland", country: "Australia", lat: -27.37, lng: 153.08 };

async function boot(page, { pool, journey = true, clock = MIDDAY, thumbs = null, immichDown = false, worldDown = false, reduced = false } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(clock);
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        `\nwindow.CONFIG.features.v3Archive = true;` +
        `\nwindow.CONFIG.features.v3ArchivePlane = true;` +
        `\nwindow.CONFIG.features.v3MemoryJourney = ${journey};` +
        `\nwindow.CONFIG.features.groundMemories = true;` +
        `\nwindow.CONFIG.features.groundDiptych = false;\n`
    });
  });
  // Sever the process-wide voice bus (see v3-archive.spec.js for why).
  await page.route("**/api/voice/stream", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "" })
  );
  if (immichDown) {
    await page.route("**/api/immich/**", (route) => route.fulfill({ status: 503, body: "" }));
  } else {
    await page.route("**/api/immich/on-this-day", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: pool }) })
    );
    await page.route("**/api/immich/asset/*/thumb", (route) => {
      const id = decodeURIComponent(route.request().url().split("/asset/")[1].split("/")[0]);
      if (thumbs?.[id] === "broken") return route.fulfill({ status: 200, contentType: "image/png", body: "not a png" });
      return route.fulfill({ contentType: "image/svg+xml", body: PHOTOS[kindOf(id)] });
    });
  }
  if (worldDown) await page.route("**/journey-world*", (route) => route.abort());
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__ground === "function");
  if (reduced) expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  return pageErrors;
}

const journey = (page) => page.evaluate(() => window.__journey());

/** Wait for the first photograph to be up and its words painted. */
async function firstUp(page) {
  await expect.poll(async () => (await journey(page))?.shownFrames ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  await atRest(page);
}

async function atRest(page) {
  await expect
    .poll(async () => {
      const j = await journey(page);
      return j.reveal === null && !j.timers.reveal && !j.timers.meta && j.meta === "in";
    }, { timeout: 15_000 })
    .toBe(true);
}

/* Drive the NEXT memory at the ambient settle (2600 ms → a full reveal; a
   veto's brisk 1200 would be a plain cut). Verified, not assumed — see
   nextMemory in v3-archive.spec.js. */
async function next(page, settleMs = 2600) {
  const before = await page.evaluate(() => window.__ground().assetId);
  await expect
    .poll(async () => {
      const now = await page.evaluate(() => window.__ground().assetId);
      if (now === before) await page.evaluate((ms) => window.__groundDissolve(ms, 5_000), settleMs);
      return now;
    }, { timeout: 15_000, intervals: [0, 1_000] })
    .not.toBe(before);
}

test("flag OFF: no journey node, no marker — the plane is built as before", async ({ page }) => {
  const errors = await boot(page, { pool: [at("dark-1"), at("dark-2")], journey: false });
  await expect.poll(() => page.evaluate(() => window.__ground().shown), { timeout: 10_000 }).toBe(true);
  const p = await page.evaluate(() => ({
    journey: document.querySelectorAll(".journey").length,
    marker: document.documentElement.dataset.journey ?? null,
    hook: typeof window.__journey,
    plane: window.__archive().plane,
    card: document.querySelectorAll(".archive__card-plane").length
  }));
  expect(p).toEqual({ journey: 0, marker: null, hook: "undefined", plane: true, card: 1 });
  expect(errors).toEqual([]);
});

test("flag ON: the journey replaces the plane, and today is on the glass", async ({ page }) => {
  const errors = await boot(page, { pool: [at("dark-1", NUDGEE), at("dark-2", NUDGEE)] });
  await firstUp(page);
  const p = await page.evaluate(() => ({
    marker: document.documentElement.dataset.journey,
    plane: window.__archive().plane,
    card: document.querySelectorAll(".archive__card-plane, .archive__ghost, .archive__plate").length,
    hour: document.getElementById("hour").checkVisibility({ opacityProperty: true })
  }));
  expect(p).toEqual({ marker: "1", plane: false, card: 0, hour: true });
  const j = await journey(page);
  expect(j.today).toBe("Monday 6 July");
  expect(j.world).toBe("ready");
  // The first photograph after boot is a plain cut — the panel may have just woken.
  expect(j.mode).toBe("cut");
  expect(j.words).toEqual({ year: "2019", place: "Nudgee, Queensland", who: null });
  expect(errors).toEqual([]);
});

test("home: the colour wash, no map, no mini map", async ({ page }) => {
  await boot(page, { pool: [at("bright-1", NUDGEE), at("bright-2", NUDGEE)] });
  await firstUp(page);
  await next(page);
  await expect.poll(async () => (await journey(page)).mode).toBe("wash");
  const during = await journey(page);
  expect(during.plan).toBeNull();
  await atRest(page);
  const j = await journey(page);
  expect(j.mini).toBe(false);
  expect(j.words.place).toBe("Nudgee, Queensland");
});

test("abroad: the map, a point, then the photograph and a mini map that stays", async ({ page }) => {
  const errors = await boot(page, { pool: [at("dark-1", SAMUI), at("dark-2", SAMUI)] });
  await firstUp(page);
  await next(page);
  await expect.poll(async () => (await journey(page)).reveal, { timeout: 5_000 }).toBe("map");
  const during = await page.evaluate(() => ({
    j: window.__journey(),
    paths: document.querySelectorAll(".journey__zoom path").length,
    lit: [...document.querySelectorAll(".journey__zoom path")].filter((p) => p.getAttribute("fill").includes("214")).length,
    hour: document.getElementById("hour").checkVisibility({ opacityProperty: true }),
    meta: getComputedStyle(document.querySelector(".journey__memory")).opacity
  }));
  expect(during.j.mode).toBe("map");
  expect(during.j.plan).toEqual({ precision: "point", country: "Thailand", pin: true });
  expect(during.paths).toBeGreaterThan(1);
  expect(during.lit).toBe(1);
  // The clock is on the glass DURING the journey; the words wait.
  expect(during.hour).toBe(true);
  expect(Number(during.meta)).toBeLessThan(0.5);

  await atRest(page);
  const rest = await page.evaluate(() => ({
    j: window.__journey(),
    zoomPaths: document.querySelectorAll(".journey__zoom path").length,
    miniDot: document.querySelectorAll(".journey__mini-dot").length
  }));
  expect(rest.j.words.place).toBe("Ko Samui, Thailand");
  expect(rest.j.mini).toBe(true);
  expect(rest.miniDot).toBe(1);
  // The big map is gone, not hidden: its SVG is released.
  expect(rest.zoomPaths).toBe(0);
  expect(errors).toEqual([]);
});

test("abroad with only a country: lit country, no pin anywhere", async ({ page }) => {
  const FR = { country: "France" };
  await boot(page, { pool: [at("dark-1", FR), at("dark-2", FR)] });
  await firstUp(page);
  await next(page);
  await expect.poll(async () => (await journey(page)).plan?.precision).toBe("country");
  const j = await journey(page);
  expect(j.plan.pin).toBe(false);
  await atRest(page);
  expect(await page.locator(".journey__mini-dot").count()).toBe(0);
  expect((await journey(page)).words.place).toBe("France");
});

test("no place and nobody named: the year alone, still a composition", async ({ page }) => {
  await boot(page, { pool: [at("dark-1"), at("dark-2")] });
  await firstUp(page);
  const j = await journey(page);
  expect(j.words).toEqual({ year: "2019", place: null, who: null });
  // No empty rows are laid out: only the year paragraph takes space.
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".journey__words > p")].filter((p) => p.getBoundingClientRect().height > 0).length);
  expect(rows).toBe(1);
});

test("names are shown as the server sent them", async ({ page }) => {
  await boot(page, { pool: [at("dark-1", { people: ["Greg", "Brett"] }), at("dark-2", { people: ["Greg", "Brett"] })] });
  await firstUp(page);
  expect((await journey(page)).words.who).toBe("Greg · Brett");
});

test("the memory, today and the hour never overlap — measured, with real text", async ({ page }) => {
  const LONG = { ...SAMUI, people: ["Greg", "Brett", "Melanie", "Sam"] };
  await boot(page, { pool: [at("bright-1", LONG), at("bright-2", LONG)] });
  await firstUp(page);
  const r = await page.evaluate(() => {
    const box = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, text: el.textContent };
    };
    return {
      memory: box(document.querySelector(".journey__memory")),
      today: box(document.querySelector(".journey__today")),
      hour: box(document.getElementById("hour"))
    };
  });
  // Assert the nodes are THERE before asserting where they are.
  for (const k of ["memory", "today", "hour"]) {
    expect(r[k].w, k).toBeGreaterThan(50);
    expect(r[k].h, k).toBeGreaterThan(20);
  }
  expect(r.memory.text).toContain("Ko Samui, Thailand");
  expect(r.today.text).toBe("Monday 6 July");
  const apart = (a, b) => a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y;
  expect(apart(r.memory, r.today)).toBe(true);
  expect(apart(r.memory, r.hour)).toBe(true);
  expect(apart(r.today, r.hour)).toBe(true);
  // Inside the glass.
  expect(r.memory.r).toBeLessThanOrEqual(1920);
  expect(r.memory.y).toBeGreaterThanOrEqual(0);
});

test("a bright photograph earns a darker shade than a dark one", async ({ browser }) => {
  const shade = async (kind) => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await boot(page, { pool: [at(`${kind}-1`, NUDGEE), at(`${kind}-2`, NUDGEE)] });
    await firstUp(page);
    const s = (await journey(page)).shades;
    await page.close();
    return s;
  };
  const bright = await shade("bright");
  const dark = await shade("dark");
  expect(bright.memory).toBeGreaterThan(dark.memory + 0.3);
  expect(bright.today).toBeGreaterThan(dark.today + 0.3);
});

test("portrait and panorama are shown whole on their own colour", async ({ page }) => {
  await boot(page, { pool: [at("portrait-1"), at("portrait-2")] });
  await firstUp(page);
  const p = await page.evaluate(() => {
    const f = document.querySelector(".journey__frame.is-top");
    const img = f.querySelector("img").getBoundingClientRect();
    return { fit: f.dataset.fit, w: Math.round(img.width), h: Math.round(img.height), backdrop: f.querySelector("canvas").checkVisibility() };
  });
  // 0.75 → 810 x 1080, centred, backdrop showing either side (the rest scale
  // may still be easing, so allow its 3.5 %).
  expect(p.fit).toBe("contain");
  expect(p.backdrop).toBe(true);
  expect(p.h).toBeGreaterThanOrEqual(1080);
  expect(p.h).toBeLessThanOrEqual(1080 * 1.036);
  expect(p.w / p.h).toBeCloseTo(0.75, 2);
});

test("a photograph that fails to load leaves the wall as it was", async ({ page }) => {
  const errors = await boot(page, { pool: [at("dark-1", NUDGEE), at("dark-2", NUDGEE)] });
  await firstUp(page);
  const before = await journey(page);
  const id = await page.evaluate(() => window.__ground().assetId);
  // From now on every photograph is broken (last-registered route wins).
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: "not a png" }));
  await page.evaluate(() => window.__groundDissolve(2600, 3_000));
  await page.waitForTimeout(4_500);
  const after = await journey(page);
  expect(await page.evaluate(() => window.__ground().assetId)).toBe(id);
  expect(after.seq).toBe(before.seq);
  expect(after.shownFrames).toBe(1);
  expect(after.words).toEqual(before.words);
  expect(after.meta).toBe("in");
  expect(errors).toEqual([]);
});

test("Immich down: the clock and today stand alone, no errors", async ({ page }) => {
  const errors = await boot(page, { pool: [], immichDown: true });
  await expect.poll(async () => (await journey(page))?.today ?? null, { timeout: 10_000 }).toBe("Monday 6 July");
  const j = await journey(page);
  expect(j.shownFrames).toBe(0);
  expect(await page.evaluate(() => document.getElementById("hour").checkVisibility({ opacityProperty: true }))).toBe(true);
  expect(errors).toEqual([]);
});

test("map data unavailable: abroad falls back to the colour wash", async ({ page }) => {
  const errors = await boot(page, { pool: [at("dark-1", SAMUI), at("dark-2", SAMUI)], worldDown: true });
  await firstUp(page);
  await next(page);
  await expect.poll(async () => (await journey(page)).mode).toBe("wash");
  const j = await journey(page);
  expect(j.world).toBe("failed");
  expect(j.plan).toBeNull();
  await atRest(page);
  expect((await journey(page)).words.place).toBe("Ko Samui, Thailand");
  expect(errors).toEqual([]);
});

test("reduced motion: the journey stays up as a plain crossfade, no map", async ({ page }) => {
  await boot(page, { pool: [at("dark-1", SAMUI), at("dark-2", SAMUI)], reduced: true });
  await firstUp(page);
  await next(page);
  await expect.poll(async () => (await journey(page)).seq).toBeGreaterThan(1);
  await atRest(page);
  const j = await journey(page);
  expect(j.mode).toBe("cut");
  expect(j.resting).toBe(false);
  expect(await page.evaluate(() => document.querySelector(".journey").checkVisibility())).toBe(true);
  expect(await page.evaluate(() => window.__archiveFocus())).not.toBeNull();
});

test("night: no map journey, but the mini map, the words and the date stay", async ({ page }) => {
  await boot(page, { pool: [at("dark-1", SAMUI), at("dark-2", SAMUI)], clock: NIGHT });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.night ?? null)).toBe("1");
  expect(await page.evaluate(() => document.documentElement.dataset.panelDark ?? "0")).toBe("0");
  await firstUp(page);
  await next(page);
  await expect.poll(async () => (await journey(page)).mode).toBe("wash");
  await atRest(page);
  const j = await journey(page);
  expect(j.mini).toBe(true);
  expect(j.words.place).toBe("Ko Samui, Thailand");
  expect(await page.evaluate(() => document.querySelector(".journey__today").checkVisibility({ opacityProperty: true }))).toBe(true);
});

test("leaving depth 0 mid-journey ends it at once; nothing accumulates", async ({ page }) => {
  const errors = await boot(page, { pool: [at("dark-1", SAMUI), at("dark-2", SAMUI)] });
  await firstUp(page);
  await next(page);
  await expect.poll(async () => (await journey(page)).reveal, { timeout: 5_000 }).toBe("map");
  await page.evaluate(() => window.__setDepth(1, "spec"));
  const left = await journey(page);
  expect(left.reveal).toBeNull();
  expect(left.revealAnims).toBe(0);
  expect(left.timers.reveal).toBe(false);
  expect(left.timers.meta).toBe(false);
  expect(left.resting).toBe(false);
  await page.evaluate(() => window.__setDepth(0, "spec"));

  const sample = async () => {
    await atRest(page);
    await expect.poll(async () => (await journey(page)).timers.cleanup, { timeout: 10_000 }).toBe(false);
    const j = await journey(page);
    const anims = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.effect?.target?.closest?.(".journey") && a.playState !== "idle").length);
    return { nodes: j.nodes, shown: j.shownFrames, anims };
  };
  const first = await sample();
  for (let i = 0; i < 4; i++) await next(page);
  const last = await sample();
  expect(last.nodes).toBe(first.nodes);
  expect(last.shown).toBe(1);
  // At rest at most the one 30 s settle runs inside the journey.
  expect(last.anims).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
