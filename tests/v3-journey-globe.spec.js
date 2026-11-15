import { test, expect } from "./fixtures/coverage.js";
import { SphereGeometry } from "three";
import { lonLatVec, subsolar, arcDeg, globeBeats, diveDistance, GLOBE_NEAR } from "../src/v3/core/journey-geo.js";

/* THE GLOBE FLIGHT — features.v3JourneyGlobe (journey.js runGlobe, stage3d/journey-stage.js
   globe()). An overseas memory by day flies in on a globe on Phase C's canvas; everything
   else keeps its own reveal. The pure half pins the geometry against three's own sphere and
   the terminator against a known date; the page half pins: the globe runs for an overseas
   photo and only for one, the pin lands inside the lit country, the bloom opens from it,
   memory is back to 0 after, and flag off never fetches the chunk or the home route. */

test("a lat/lng lands where three's sphere puts that point of an equirect texture", () => {
  // SphereGeometry's uv (u, v) is lon = u*360 - 180, lat = v*180 - 90 on the canvas we paint.
  const g = new SphereGeometry(1, 8, 4);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  let checked = 0;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (v <= 0.01 || v >= 0.99) continue; // the poles: every longitude is the same point
    const p = lonLatVec(v * 180 - 90, u * 360 - 180);
    expect(p[0]).toBeCloseTo(pos.getX(i), 5);
    expect(p[1]).toBeCloseTo(pos.getY(i), 5);
    expect(p[2]).toBeCloseTo(pos.getZ(i), 5);
    checked++;
  }
  expect(checked).toBeGreaterThan(20);
});

test("the terminator: the sun is overhead where the photo's moment says", () => {
  // Equinox noon at Greenwich: overhead at about 0°, 0°.
  const eq = subsolar("2026-03-20T12:00:00.000Z", 0);
  expect(Math.abs(eq.lat)).toBeLessThan(1.5);
  expect(Math.abs(eq.lng)).toBeLessThan(0.01);
  // June solstice: the sun is over the Tropic of Cancer; at 18:00 local it is 90° west of the place.
  const june = subsolar("2017-06-21T18:00:00.000Z", 10);
  expect(june.lat).toBeGreaterThan(23);
  expect(june.lng).toBeCloseTo(-80, 5);
  // Wrapped into [-180, 180).
  expect(subsolar("2017-06-21T00:00:00.000Z", 170).lng).toBeCloseTo(-10, 5);
  expect(subsolar(null, 10)).toBeNull();
  expect(subsolar("not a date", 10)).toBeNull();
});

test("a long hop turns longer and lifts; a short hop does neither, and arrives sooner", () => {
  const brisbane = { lat: -27, lng: 153 };
  const italy = arcDeg(brisbane, { lat: 44.1, lng: 9.7 });
  const nz = arcDeg(brisbane, { lat: -36.8, lng: 174.8 });
  expect(italy).toBeGreaterThan(130);
  expect(nz).toBeLessThan(25);
  const long = globeBeats(italy);
  const short = globeBeats(nz);
  // A long hop lands on the flat map's own 3.8 s.
  expect(long).toMatchObject({ turnFrom: 300, turnMs: 1400, diveFrom: 1700, bloomFrom: 2300, total: 3800 });
  expect(long.lift).toBeGreaterThan(0);
  expect(short.lift).toBe(0);
  expect(short.turnMs).toBeLessThan(long.turnMs);
  expect(short.total).toBeLessThan(long.total);
});

test("the dive never goes deeper than the approved still", () => {
  expect(diveDistance(1, 44)).toBe(GLOBE_NEAR);
  expect(diveDistance(0, 0)).toBe(GLOBE_NEAR);
  expect(diveDistance(NaN, 0)).toBe(GLOBE_NEAR);
  expect(diveDistance(58, 38)).toBeGreaterThan(GLOBE_NEAR);
  expect(diveDistance(300, 0)).toBe(2.6);
});

/* ── The page ─────────────────────────────────────────────────────────────── */

const NOON = new Date("2026-07-06T02:00:00Z"); // midday at home: no night, no grade
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">${body}</svg>`;
const PHOTO = svg(`<rect width="1600" height="900" fill="#3a6ea5"/><circle cx="500" cy="600" r="220" fill="#f2c14e"/>`);
const SAMUI = { city: "Ko Samui", state: "Surat Thani", country: "Thailand", lat: 9.53, lng: 100.06 };
const FRANCE = { city: null, state: null, country: "France", lat: null, lng: null };
const NUDGEE = { city: "Nudgee", state: "Queensland", country: "Australia", lat: -27.37, lng: 153.08 };
const AT_SEA = { city: null, state: null, country: null, lat: -30, lng: 170 };
const at = (id, place) => ({ id, aspect: 1.778, localDateTime: "2019-07-06T14:00:00.000Z", people: [], ...place });

async function boot(page, { on, pool, home = { lat: -27, lng: 153 } }) {
  const errors = [];
  const fetched = { chunk: 0, home: 0 };
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/journey-stage/.test(r.url())) fetched.chunk++;
    if (/\/api\/weather\/home/.test(r.url())) fetched.home++;
  });
  await page.clock.setFixedTime(NOON);
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
        // These share the chunk: pinned off so "flag off never fetches it" is the globe's alone.
        `\nwindow.CONFIG.features.v3RainGlass = false;` +
        `\nwindow.CONFIG.features.v3PhotoTransitions = false;` +
        `\nwindow.CONFIG.features.v3JourneyGlobe = ${on};\n`
    });
  });
  await page.route("**/api/voice/stream", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await page.route("**/api/weather/home", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ home }) }));
  await page.route("**/api/immich/on-this-day", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: pool }) }));
  await page.route("**/api/immich/asset/*/thumb", (r) => r.fulfill({ contentType: "image/svg+xml", body: PHOTO }));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__journey === "function");
  await expect.poll(async () => (await page.evaluate(() => window.__journey()))?.shownFrames ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  if (on) {
    await expect.poll(() => page.evaluate(() => {
      const j = window.__journey();
      return typeof j.transition === "object" && j.home !== "loading" && j.home !== "idle";
    }), { timeout: 10_000 }).toBe(true);
  }
  return { errors, fetched };
}

const journey = (page) => page.evaluate(() => window.__journey());

async function exchange(page) {
  const before = await page.evaluate(() => window.__journey().seq);
  await page.evaluate(() => window.__groundDissolve(2600, 5_000));
  await expect.poll(() => page.evaluate(() => window.__journey().seq), { timeout: 10_000 }).toBeGreaterThan(before);
  await expect.poll(async () => (await journey(page)).mode, { timeout: 10_000 }).not.toBe("cut");
}

async function atRest(page) {
  await expect.poll(async () => {
    const j = await journey(page);
    return j.reveal === null && !j.timers.reveal && !j.timers.meta && j.meta === "in";
  }, { timeout: 15_000 }).toBe(true);
}

test("flag OFF: an overseas memory keeps the flat map, and neither the chunk nor home is fetched", async ({ page }) => {
  const { errors, fetched } = await boot(page, { on: false, pool: [at("s-1", SAMUI), at("s-2", SAMUI)] });
  await exchange(page);
  const j = await journey(page);
  expect(j.mode).toBe("map");
  expect(j.plan).toEqual({ precision: "point", country: "Thailand", pin: true });
  expect(j.transition).toBe("idle");
  expect(await page.evaluate(() => document.querySelectorAll(".journey__gl").length)).toBe(0);
  expect(fetched).toEqual({ chunk: 0, home: 0 });
  expect(errors).toEqual([]);
});

test("flag ON: abroad flies in on the globe, the pin lands in the lit country, the bloom opens from it, then nothing is held", async ({ page }) => {
  const { errors, fetched } = await boot(page, { on: true, pool: [at("s-1", SAMUI), at("s-2", SAMUI)] });
  expect(fetched.chunk).toBeGreaterThan(0);
  expect(fetched.home).toBe(1);
  await exchange(page);
  const first = await page.evaluate(() => {
    const c = document.querySelector(".journey__gl");
    return {
      node: Boolean(c),
      inTop: Boolean(c?.closest(".journey__frame.is-top")),
      shown: c ? getComputedStyle(c).display : null,
      w: c ? Math.round(c.getBoundingClientRect().width) : 0,
      j: window.__journey()
    };
  });
  expect(first.node, "the canvas must exist before where it is is judged").toBe(true);
  expect(first).toMatchObject({ inTop: true, shown: "block", w: 1920 });
  expect(first.j.mode).toBe("globe");
  expect(first.j.reveal).toBe("globe");
  expect(first.j.transition.globe).toMatchObject({ on: true, pin: true });
  // Earth, outgoing, incoming. The flat map's SVG is never built.
  expect(first.j.transition.memory.textures).toBe(3);
  expect(await page.evaluate(() => document.querySelectorAll(".journey__zoom path").length)).toBe(0);

  // Arrived (Brisbane → Ko Samui ≈ 63°: the bloom starts at ~2.1 s). The pin is on the glass inside
  // Thailand's box, and the bloom's origin IS the pin.
  await expect.poll(async () => (await journey(page)).transition.globe.t ?? 0, { timeout: 8_000 }).toBeGreaterThan(2150);
  const g = (await journey(page)).transition.globe;
  expect(g.on, "still flying when judged").toBe(true);
  expect(g.countryBox, "Thailand must be on the near side of the globe").not.toBeNull();
  const [x0, y0, x1, y1] = g.countryBox;
  expect(g.origin[0]).toBeGreaterThan(x0);
  expect(g.origin[0]).toBeLessThan(x1);
  expect(g.origin[1]).toBeGreaterThan(y0);
  expect(g.origin[1]).toBeLessThan(y1);
  // The camera looks straight at the place once it has arrived: the pin sits mid-wall.
  expect(Math.abs(g.origin[0] - 960)).toBeLessThan(30);
  expect(Math.abs(g.origin[1] - 540)).toBeLessThan(30);

  await expect.poll(async () => (await journey(page)).transition.globe.on, { timeout: 6_000 }).toBe(false);
  const done = (await journey(page)).transition;
  expect(done.globe).toMatchObject({ lastEnd: "done", moments: 1 });
  expect(done.memory).toEqual({ geometries: 0, textures: 0 });
  expect(done.shown).toBe(false);
  await atRest(page);
  const rest = await journey(page);
  expect(rest.words.place).toBe("Ko Samui, Thailand");
  expect(rest.mini).toBe(true);
  expect(errors).toEqual([]);
});

test("a country with no point: the country lights, no pin, the bloom opens from its middle", async ({ page }) => {
  const { errors } = await boot(page, { on: true, pool: [at("f-1", FRANCE), at("f-2", FRANCE)] });
  await exchange(page);
  expect((await journey(page)).mode).toBe("globe");
  await expect.poll(async () => (await journey(page)).transition.globe.t ?? 0, { timeout: 8_000 }).toBeGreaterThan(2350);
  const g = (await journey(page)).transition.globe;
  expect(g).toMatchObject({ on: true, pin: false });
  expect(g.countryBox).not.toBeNull();
  const [x0, y0, x1, y1] = g.countryBox;
  expect(g.origin[0] > x0 && g.origin[0] < x1 && g.origin[1] > y0 && g.origin[1] < y1, JSON.stringify(g)).toBe(true);
  expect(errors).toEqual([]);
});

test("home and at sea never start the globe, flag on", async ({ page }) => {
  const { errors } = await boot(page, { on: true, pool: [at("h-1", NUDGEE), at("h-2", AT_SEA), at("h-3", NUDGEE)] });
  for (let i = 0; i < 2; i++) {
    await exchange(page);
    const j = await journey(page);
    expect(j.mode).toBe("wash");
    expect(j.plan).toBeNull();
    await atRest(page);
  }
  expect((await journey(page)).transition.globe.moments).toBe(0);
  expect(errors).toEqual([]);
});

test("no home from the server: the flat map, as before", async ({ page }) => {
  const { errors } = await boot(page, { on: true, home: null, pool: [at("s-1", SAMUI), at("s-2", SAMUI)] });
  expect((await journey(page)).home).toBe("none");
  await exchange(page);
  const j = await journey(page);
  expect(j.mode).toBe("map");
  expect(j.transition.globe.moments).toBe(0);
  expect(errors).toEqual([]);
});
