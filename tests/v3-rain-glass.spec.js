import { test, expect } from "./fixtures/coverage.js";

/* RAIN ON THE GLASS — features.v3RainGlass (stage3d/journey-stage.js rain, journey.js
   syncRain). While it rains, drops sit on the glass in front of the journey photograph,
   drawn on Phase C's canvas in the top frame. Pinned: nothing exists flag off; drops and
   ONE texture while raining; the loop goes idle between bursts (rain lasts hours); dry,
   depth > 0 and a dark panel let go of the texture; an exchange mid-rain carries the
   drops onto the new photograph. Rain is driven the way the wall is driven by hand:
   window.__v3Atmo.force({ rain }). */

const NOON = new Date("2026-07-06T02:00:00Z");
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">${body}</svg>`;
const PHOTOS = {
  "p-1": svg(`<rect width="900" height="900" fill="#3a6ea5"/><circle cx="300" cy="600" r="220" fill="#f2c14e"/>`),
  "p-2": svg(`<rect width="900" height="900" fill="#2e8b57"/><rect x="100" y="500" width="700" height="300" fill="#f4f1de"/>`),
  "p-3": svg(`<rect width="900" height="900" fill="#6d597a"/><circle cx="450" cy="450" r="300" fill="#eaac8b"/>`)
};
const at = (id) => ({ id, aspect: 1, localDateTime: "2019-07-06T09:00:00Z", city: "Nudgee", state: "Queensland", country: "Australia", lat: -27.37, lng: 153.08, people: [] });

// Black and white stripes: every drop's lens sees white over black, so a drop that may
// lighten what is under it cannot hide.
const STRIPES = svg(`<rect width="900" height="900" fill="#101010"/>` +
  Array.from({ length: 30 }, (_, i) => `<rect x="${i * 30}" width="15" height="900" fill="#f4f4f4"/>`).join(""));

async function boot(page, { on, photos = PHOTOS }) {
  const errors = [];
  const chunks = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (/journey-stage/.test(r.url())) chunks.push(r.url()); });
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
        `\nwindow.CONFIG.features.v3AtmoOverlay = true;` +
        `\nwindow.CONFIG.features.v3GoldenHour = false;` +
        `\nwindow.CONFIG.features.v3PhotoTransitions = false;` +
        `\nwindow.CONFIG.features.v3JourneyGlobe = false;` +
        `\nwindow.CONFIG.features.v3RainGlass = ${on};\n`
    });
  });
  await page.route("**/api/voice/stream", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await page.route("**/api/immich/on-this-day", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: Object.keys(photos).map(at) }) }));
  await page.route("**/api/immich/asset/*/thumb", (r) => {
    const id = new URL(r.request().url()).pathname.split("/").at(-2);
    return r.fulfill({ contentType: "image/svg+xml", body: photos[id] ?? Object.values(photos)[0] });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__journey === "function" && typeof window.__v3Atmo?.force === "function");
  await expect.poll(async () => (await page.evaluate(() => window.__journey()))?.shownFrames ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  // The boot reveal must be over: rain waits for a reveal to end.
  await expect.poll(() => page.evaluate(() => window.__journey().timers.reveal), { timeout: 10_000 }).toBe(false);
  return { errors, chunks };
}

const rainState = (page) => page.evaluate(() => {
  const t = window.__journey().transition;
  return typeof t === "object" ? { ...t.rain, memory: t.memory, shown: t.shown } : t;
});

async function startRain(page, level = "heavy") {
  await page.evaluate((rain) => window.__v3Atmo.force({ rain }), level);
  await expect.poll(async () => (await rainState(page))?.on ?? false, { timeout: 10_000 }).toBe(true);
}

test("flag OFF: rain on the wall makes no canvas and never fetches the chunk", async ({ page }) => {
  const { errors, chunks } = await boot(page, { on: false });
  await page.evaluate(() => window.__v3Atmo.force({ rain: "heavy" }));
  expect(await page.evaluate(() => document.documentElement.dataset.atmoRaining)).toBe("1");
  await page.waitForTimeout(1000);
  const p = await page.evaluate(() => ({ canvases: document.querySelectorAll(".journey__gl").length, t: window.__journey().transition }));
  expect(p).toEqual({ canvases: 0, t: "idle" });
  expect(chunks).toEqual([]);
  expect(errors).toEqual([]);
});

test("flag ON, dry: the chunk loads but nothing is on the glass", async ({ page }) => {
  const { errors } = await boot(page, { on: true });
  await expect.poll(() => page.evaluate(() => typeof window.__journey().transition), { timeout: 10_000 }).toBe("object");
  expect(await page.evaluate(() => document.documentElement.dataset.atmoRaining ?? null)).toBe(null);
  const s = await rainState(page);
  expect(s).toMatchObject({ on: false, drops: 0, shown: false });
  expect(errors).toEqual([]);
});

test("flag ON, raining: drops on the glass in the top frame on ONE texture; dry lets go of everything", async ({ page }) => {
  const { errors } = await boot(page, { on: true });
  await startRain(page);
  const mid = await page.evaluate(() => {
    const c = document.querySelector(".journey__gl");
    return {
      node: Boolean(c),
      inTop: Boolean(c?.closest(".journey__frame.is-top")),
      display: c ? getComputedStyle(c).display : null,
      w: c ? Math.round(c.getBoundingClientRect().width) : 0,
      h: c ? Math.round(c.getBoundingClientRect().height) : 0
    };
  });
  expect(mid.node, "the canvas must exist before where it is is judged").toBe(true);
  expect(mid).toEqual({ node: true, inTop: true, display: "block", w: 1920, h: 1080 });
  const s = await rainState(page);
  expect(s.drops).toBeGreaterThan(0);
  expect(s.frames).toBeGreaterThan(0);
  expect(s.memory).toEqual({ geometries: 1, textures: 1 });

  await page.evaluate(() => window.__v3Atmo.force(null));
  await expect.poll(() => rainState(page), { timeout: 5_000 })
    .toMatchObject({ on: false, drops: 0, running: false, shown: false, memory: { geometries: 0, textures: 0 } });
  expect(errors).toEqual([]);
});

test("between bursts nothing renders: the loop goes idle while it rains", async ({ page }) => {
  await boot(page, { on: true });
  // Every draw of the dice says "yes": big drops, and the first burst (heavy: 3 s) slides one,
  // so the loop has RUN before idle is judged. Without this the test passes on a loop that
  // never started, which is how it first shipped (inject-defect, 11-14).
  await page.evaluate(() => { Math.random = () => 0.01; });
  await startRain(page, "heavy");
  await expect.poll(async () => { const s = await rainState(page); return s.sliding > 0 && s.running; }, { timeout: 10_000 }).toBe(true);
  // From here every draw says "no": no new slides, so idle must come.
  await page.evaluate(() => { Math.random = () => 0.99; });
  await expect.poll(async () => { const s = await rainState(page); return s.on && !s.running && s.sliding === 0; }, { timeout: 20_000 }).toBe(true);
  const f0 = (await rainState(page)).frames;
  await page.waitForTimeout(1500);
  const s = await rainState(page);
  // A 15 fps loop left running is ~22 frames here; one burst (heavy: every 3 s) is 1.
  expect(s.on).toBe(true);
  expect(s.frames - f0).toBeLessThanOrEqual(1);
});

test("a drop never lightens the wall: the words keep the contrast their shades were solved for", async ({ page }) => {
  await boot(page, { on: true, photos: { "s-1": STRIPES, "s-2": STRIPES } });
  await expect.poll(() => page.evaluate(() => typeof window.__journey().transition), { timeout: 10_000 }).toBe("object");
  // The rest ease finished, so the photograph holds still between the two shots.
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  const dry = await page.screenshot();
  // Drops spread over the wall by a fixed sequence, so the run is the same every time.
  await page.evaluate(() => { let i = 0; Math.random = () => ((i++ * 0.6180339887) % 1); });
  await startRain(page);
  expect((await rainState(page)).drops).toBeGreaterThan(10);
  const wet = await page.screenshot();
  const d = await page.evaluate(async ([a, b]) => {
    const px = async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const [x, y] = [await px(a), await px(b)];
    let lighter = 0, darker = 0, at = null, n = 0;
    for (let i = 0; i < x.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const v = y[i + k] - x[i + k];
        if (v > 12) n++;
        if (v > lighter) { lighter = v; at = [(i / 4) % 1920, Math.floor(i / 4 / 1920)]; }
        darker = Math.max(darker, -v);
      }
    }
    return { lighter, darker, at, n };
  }, [dry.toString("base64"), wet.toString("base64")]);
  // The drops are THERE (something darkened) before "nothing lightened" means anything.
  expect(d.darker, JSON.stringify(d)).toBeGreaterThan(30);
  // A glint or a lens over a brighter patch is >80; resampling noise is a few units.
  expect(d.lighter, JSON.stringify(d)).toBeLessThan(12);
});

test("leaving depth 0 releases the texture and keeps the drops; coming back puts them back", async ({ page }) => {
  await boot(page, { on: true });
  await startRain(page);
  const drops = (await rainState(page)).drops;
  await page.evaluate(() => window.__setDepth(2, "test"));
  await expect.poll(() => rainState(page), { timeout: 5_000 })
    .toMatchObject({ on: false, shown: false, memory: { geometries: 0, textures: 0 } });
  expect((await rainState(page)).drops, "the glass is still wet").toBeGreaterThanOrEqual(Math.min(drops, 1));
  await page.evaluate(() => window.__setDepth(0, "test"));
  await expect.poll(async () => (await rainState(page)).on, { timeout: 5_000 }).toBe(true);
  expect((await rainState(page)).memory).toEqual({ geometries: 1, textures: 1 });
});

test("an exchange mid-rain carries the drops onto the new photograph", async ({ page }) => {
  const { errors } = await boot(page, { on: true });
  await startRain(page);
  const slot0 = await page.evaluate(() => document.querySelector(".journey__gl").closest(".journey__frame").dataset.slot);
  const before = await page.evaluate(() => window.__journey().seq);
  await page.evaluate(() => window.__groundDissolve(2600, 5_000));
  await expect.poll(() => page.evaluate(() => window.__journey().seq), { timeout: 10_000 }).toBeGreaterThan(before);
  // During the reveal the rain stands down...
  await expect.poll(async () => (await rainState(page)).on, { timeout: 5_000 }).toBe(false);
  // ...and comes back on the new top frame with one texture.
  await expect.poll(async () => (await rainState(page)).on, { timeout: 10_000 }).toBe(true);
  const after = await page.evaluate(() => {
    const c = document.querySelector(".journey__gl");
    return { slot: c.closest(".journey__frame").dataset.slot, inTop: Boolean(c.closest(".journey__frame.is-top")) };
  });
  expect(after.inTop).toBe(true);
  expect(after.slot).not.toBe(slot0);
  expect((await rainState(page)).memory).toEqual({ geometries: 1, textures: 1 });
  expect(errors).toEqual([]);
});
