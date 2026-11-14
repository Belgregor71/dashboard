import { test, expect } from "./fixtures/coverage.js";
import { transitionLook } from "../src/v3/core/journey-grade.js";

/* PHOTO TRANSITIONS — features.v3PhotoTransitions (stage3d/journey-stage.js, journey.js
   runTransition). A home memory's daytime exchange runs through a shader in a canvas
   inside the incoming journey frame. The page half pins: the canvas is THERE mid-exchange
   and gone after it with nothing held on the GPU; the first shader frame is the outgoing
   picture (no snap at the start); the photograph under it holds the scale the shader drew
   it at (no snap at the hand-off); and flag off never fetches the chunk. */

test("the light the photograph arrives in picks the transition", () => {
  expect(transitionLook("golden")).toBe("leak");
  expect(transitionLook("late")).toBe("leak");
  expect(transitionLook(null)).toBe("wipe");
  expect(transitionLook(undefined)).toBe("wipe");
  expect(transitionLook("dusk")).toBe("print");
  expect(transitionLook("rain")).toBe("print");
  expect(transitionLook("night")).toBe("print");
});

const NOON = new Date("2026-07-06T02:00:00Z"); // midday, 40° up: no grade, no night
// Square photos: contained on the wall, so the backdrop and the drop shadow are composed too.
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">${body}</svg>`;
const PHOTOS = {
  "p-1": svg(`<rect width="900" height="900" fill="#3a6ea5"/><circle cx="300" cy="600" r="220" fill="#f2c14e"/><rect x="520" y="80" width="300" height="300" fill="#e4572e"/>`),
  "p-2": svg(`<rect width="900" height="900" fill="#2e8b57"/><rect x="100" y="500" width="700" height="300" fill="#f4f1de"/><circle cx="650" cy="250" r="150" fill="#81b29a"/>`),
  "p-3": svg(`<rect width="900" height="900" fill="#6d597a"/><circle cx="450" cy="450" r="300" fill="#eaac8b"/>`)
};
const at = (id) => ({ id, aspect: 1, localDateTime: "2019-07-06T09:00:00Z", city: "Nudgee", state: "Queensland", country: "Australia", lat: -27.37, lng: 153.08, people: [] });

async function boot(page, { on }) {
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
        `\nwindow.CONFIG.features.v3GoldenHour = false;` +
        // v3RainGlass shares the chunk and the canvas: pinned off where the transition is the subject.
        `\nwindow.CONFIG.features.v3RainGlass = false;` +
        `\nwindow.CONFIG.features.v3PhotoTransitions = ${on};\n`
    });
  });
  await page.route("**/api/voice/stream", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "" }));
  await page.route("**/api/immich/on-this-day", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: Object.keys(PHOTOS).map(at) }) }));
  await page.route("**/api/immich/asset/*/thumb", (r) => {
    const id = new URL(r.request().url()).pathname.split("/").at(-2);
    return r.fulfill({ contentType: "image/svg+xml", body: PHOTOS[id] ?? PHOTOS["p-3"] });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__journey === "function");
  await expect.poll(async () => (await page.evaluate(() => window.__journey()))?.shownFrames ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  return { errors, chunks };
}

/** Exchange the photograph on the glass for the next one, at the ambient settle. */
async function exchange(page) {
  const before = await page.evaluate(() => window.__journey().seq);
  await page.evaluate(() => window.__groundDissolve(2600, 5_000));
  await expect.poll(() => page.evaluate(() => window.__journey().seq), { timeout: 10_000 }).toBeGreaterThan(before);
}

/** Max and mean per-channel difference between two PNG screenshots, decoded in the page. */
const diff = (page, a, b) => page.evaluate(async ([a, b]) => {
  const px = async (b64) => {
    // Not fetch(data:): the CSP's connect-src refuses it.
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const [x, y] = [await px(a), await px(b)];
  let max = 0, sum = 0, n = 0;
  for (let i = 0; i < x.length; i += 4) {
    for (let k = 0; k < 3; k++) { const d = Math.abs(x[i + k] - y[i + k]); max = Math.max(max, d); sum += d; n++; }
  }
  return { max, mean: sum / n };
}, [a.toString("base64"), b.toString("base64")]);

test("flag OFF: the wash as before, no canvas, and the chunk is never fetched", async ({ page }) => {
  const { errors, chunks } = await boot(page, { on: false });
  await exchange(page);
  await expect.poll(() => page.evaluate(() => window.__journey().mode), { timeout: 10_000 }).toBe("wash");
  const p = await page.evaluate(() => ({ canvases: document.querySelectorAll(".journey__gl").length, t: window.__journey().transition }));
  expect(p).toEqual({ canvases: 0, t: "idle" });
  expect(chunks).toEqual([]);
  expect(errors).toEqual([]);
});

test("flag ON: the shader carries the exchange inside the incoming frame, then lets go of everything", async ({ page }) => {
  const { errors, chunks } = await boot(page, { on: true });
  await expect.poll(() => page.evaluate(() => window.__journey().transition?.live ?? window.__journey().transition), { timeout: 10_000 })
    .not.toBe("loading");
  expect(chunks.length, "the stage chunk loads with the flag on").toBeGreaterThan(0);
  await exchange(page);
  await expect.poll(() => page.evaluate(() => window.__journey().transition.shown), { timeout: 10_000 }).toBe(true);
  const mid = await page.evaluate(() => {
    const c = document.querySelector(".journey__gl");
    return {
      node: Boolean(c),
      inTop: Boolean(c?.closest(".journey__frame.is-top")),
      shown: c ? getComputedStyle(c).display : null,
      w: c ? Math.round(c.getBoundingClientRect().width) : 0,
      h: c ? Math.round(c.getBoundingClientRect().height) : 0,
      mode: window.__journey().mode,
      t: window.__journey().transition
    };
  });
  expect(mid.node, "the canvas must exist before where it is is judged").toBe(true);
  expect(mid).toMatchObject({ inTop: true, shown: "block", w: 1920, h: 1080, mode: "gl" });
  expect(mid.t).toMatchObject({ running: true, shown: true, look: "wipe", dead: false });
  expect(mid.t.memory.textures).toBe(2);
  // Ends on its own deadline (2.6 s), and holds nothing.
  await expect.poll(() => page.evaluate(() => window.__journey().transition.running), { timeout: 6_000 }).toBe(false);
  const done = await page.evaluate(() => window.__journey().transition);
  expect(done).toMatchObject({ shown: false, lastEnd: "done", moments: 1, memory: { geometries: 0, textures: 0 } });
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".journey__gl")).display)).toBe("none");
  expect(errors).toEqual([]);
});

test("no snap at the start: the first shader frames are the outgoing picture as the wall showed it", async ({ page }) => {
  await boot(page, { on: true });
  await expect.poll(() => page.evaluate(() => typeof window.__journey().transition === "object"), { timeout: 10_000 }).toBe(true);
  // The boot photograph's 30 s rest ease, finished: the wall holds still for the reference.
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  // The noon wipe comes down from the top: the bottom half is untouched until uT ≈ 0.4.
  const clip = { x: 0, y: 600, width: 1920, height: 480 };
  const before = await page.screenshot({ clip });
  await page.evaluate(() => window.__groundDissolve(2600, 5_000));
  await expect.poll(() => page.evaluate(() => window.__journey().transition.shown), { timeout: 10_000 }).toBe(true);
  const early = await page.screenshot({ clip });
  const t = await page.evaluate(() => window.__journey().transition.t);
  expect(t, "the comparison must be taken while the front is still above the clip").toBeLessThan(0.4);
  const d = await diff(page, before, early);
  // A wrong fit, a missing backdrop or shadow, or the NEW picture drawn here, is >100 on max.
  expect(d.max, JSON.stringify(d)).toBeLessThan(40);
  expect(d.mean, JSON.stringify(d)).toBeLessThan(2);
});

test("no snap at the hand-off: the photograph under the canvas holds the shader's start scale", async ({ page }) => {
  await boot(page, { on: true });
  await expect.poll(() => page.evaluate(() => typeof window.__journey().transition === "object"), { timeout: 10_000 }).toBe(true);
  await exchange(page);
  await expect.poll(() => page.evaluate(() => window.__journey().transition.shown), { timeout: 10_000 }).toBe(true);
  const scale = () => page.evaluate(() => {
    const img = document.querySelector(".journey__frame.is-top .journey__photo");
    const t = getComputedStyle(img).transform;
    return t === "none" ? 1 : new DOMMatrix(t).a;
  });
  expect(await page.evaluate(() => window.__journey().transition.running)).toBe(true);
  expect(await scale()).toBeCloseTo(1.035, 3);
  await expect.poll(() => page.evaluate(() => window.__journey().transition.running), { timeout: 6_000 }).toBe(false);
  // Just after the canvas goes the ease has only begun: still at (or a hair under) the start scale.
  const s = await scale();
  expect(s).toBeLessThanOrEqual(1.035 + 1e-6);
  expect(s).toBeGreaterThan(1.03);
});
