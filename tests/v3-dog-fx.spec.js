import { test, expect } from "@playwright/test";
import { EFFECT_FOR, DEADLINE_MS } from "../src/v3/core/dog-fx.js";

/* ═══════════════════════════════════════════════════════════════════════════
   DOG FX — features.v3DogFx: a three.js stage over the dog peeks.

   What is asserted, and why:
     · flag OFF: the stage chunk is never requested, no
       canvas, readout says not loaded                 → the flag-off build must
                                                          be the build before it
     · flag ON: each occasion plays ITS effect, and the
       last frame really drew every particle at a
       visible alpha, in front of the dogs             → a loop that counts frames
                                                          but draws nothing
     · after every show: info.memory 0/0, the loop
       stopped, the canvas hidden; ONE canvas and one
       chunk fetch for the page's life                 → the context/GPU leak the
                                                          handover is built around
     · generic and reduced motion get no effect        → effects where none is cued
     · a moment whose end() never comes dies at the
       deadline                                        → a forever 30 fps loop
     · an end() before the chunk arrives plays nothing → a late load starting an
                                                          effect after the dogs left
     · a lost context kills the stage; the dogs carry on → one GPU fault ending dogs

   In the `isolated` project: WebGL pages in parallel already flake
   (v3-field-weather.spec.js). The clock is fixed at midday (no screensaver).
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-09-11T02:00:00Z");
const CHUNK = /\/assets\/stage-[^/]*\.js$/;
const COUNTS = { snow: 260, confetti: 220, fireworks: 360, bats: 9 };
const stage = (page) => page.evaluate(() => window.__v3().stage);

async function open(page, on, { clock = false } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  const chunks = [];
  page.on("request", (r) => { if (CHUNK.test(new URL(r.url()).pathname)) chunks.push(r.url()); });
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({ response: res, body: `${await res.text()}\nwindow.CONFIG.features.v3DogFx = ${on};\n` });
  });
  if (clock) await page.clock.install({ time: MIDDAY });
  else await page.clock.setFixedTime(MIDDAY);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function" && typeof window.dogFx?.begin === "function");
  expect(await page.evaluate(() => window.CONFIG.features.v3DogFx), "the flag reached the page").toBe(on);
  return { errors, chunks };
}

async function expectEmptied(page, at) {
  await expect.poll(() => stage(page), { timeout: 5000, message: `${at}: stage emptied` })
    .toMatchObject({ effect: null, running: false, shown: false, memory: { geometries: 0, textures: 0 } });
}

test.describe("v3DogFx stage", () => {
  test("flag off: no chunk, no canvas, the dogs as before", async ({ page }) => {
    const { errors, chunks } = await open(page, false);
    await page.evaluate(() => { window.dogOccasion.show("christmas", { dogs: ["benji"] }); });
    await expect.poll(() => page.evaluate(() => window.dogOccasion.state().dogs.length), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1500);
    expect(await stage(page)).toMatchObject({ loaded: false, loading: false });
    expect(await page.locator("canvas.stage3d").count()).toBe(0);
    expect(chunks).toEqual([]);
    await page.evaluate(() => window.dogOccasion.hide());
    expect(errors).toEqual([]);
  });

  test("flag on: each occasion plays its effect in front of the dogs, then the stage empties", async ({ page }) => {
    test.setTimeout(90_000);
    const { errors, chunks } = await open(page, true);
    expect(Object.keys(EFFECT_FOR).sort()).toEqual(["birthday", "christmas", "halloween", "newYear"]);

    let moments = 0;
    for (const [occasion, effect] of Object.entries(EFFECT_FOR)) {
      await page.evaluate((o) => { window.dogOccasion.show(o, { dogs: ["benji"] }); }, occasion);
      await expect.poll(() => stage(page), { timeout: 15_000, message: `${occasion} → ${effect}` })
        .toMatchObject({ effect, running: true, shown: true });
      moments += 1;
      // Past the 0.8 s fade-in, so the alpha is the effect's own.
      await expect.poll(async () => (await stage(page)).alpha, { timeout: 5000 }).toBe(1);
      const s = await stage(page);
      expect(s.particles, `${effect} particle count`).toBe(COUNTS[effect]);
      expect(s.drawnPoints, `${effect}: the last frame drew every particle`).toBe(COUNTS[effect]);
      expect(s.frames).toBeGreaterThan(10);
      expect(s.moments).toBe(moments);
      const z = await page.evaluate(() => {
        const dogs = document.querySelector(".dogs");
        const c = document.querySelector("canvas.stage3d");
        return { dogs: dogs && Number(getComputedStyle(dogs).zIndex), stage: c && Number(getComputedStyle(c).zIndex) };
      });
      expect(z.dogs, "the dogs are on the glass").not.toBeNull();
      expect(z.stage, "the stage is over the dogs").toBeGreaterThan(z.dogs);

      await page.evaluate(() => window.dogOccasion.hide());
      await expectEmptied(page, occasion);
      expect((await stage(page)).lastEnd).toBe("stopped");
    }

    // An occasion with no cue: the dogs show, the stage stays empty.
    await page.evaluate(() => { window.dogOccasion.show("generic", { dogs: ["benji"] }); });
    await expect.poll(() => page.evaluate(() => window.dogOccasion.state().dogs.length), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1500);
    expect(await stage(page)).toMatchObject({ effect: null, running: false, moments });
    await page.evaluate(() => window.dogOccasion.hide());

    expect(await page.locator("canvas.stage3d").count(), "one canvas for the page's life").toBe(1);
    expect(chunks.length, "the chunk is fetched once").toBe(1);
    expect(errors).toEqual([]);
  });

  test("reduced motion: the still portrait, and no stage", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { errors, chunks } = await open(page, true);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), "emulation landed").toBe(true);
    await page.evaluate(() => { window.dogOccasion.show("christmas", { dogs: ["benji"] }); });
    await expect.poll(() => page.evaluate(() => window.dogOccasion.state().still), { timeout: 10_000 }).toBe(true);
    await page.waitForTimeout(1500);
    expect(await stage(page)).toMatchObject({ loaded: false });
    expect(chunks).toEqual([]);
    // And begin() refuses it directly, not only because the still path skips it.
    expect(await page.evaluate(() => window.dogFx.begin("christmas"))).toBe(false);
    await page.evaluate(() => window.dogOccasion.hide());
    expect(errors).toEqual([]);
  });

  test("a moment whose end never comes is torn down at the deadline", async ({ page }) => {
    test.setTimeout(120_000);
    const { errors } = await open(page, true, { clock: true });
    expect(await page.evaluate(() => window.dogFx.begin("christmas"))).toBe(true);
    await expect.poll(() => stage(page), { timeout: 15_000 }).toMatchObject({ effect: "snow", running: true });
    await page.clock.runFor(DEADLINE_MS - 1000);
    expect(await stage(page), "still playing before the deadline").toMatchObject({ effect: "snow", running: true });
    expect((await stage(page)).frames, "the loop ran under the test's clock").toBeGreaterThan(100);
    await page.clock.runFor(2000);
    expect(await stage(page)).toMatchObject({ effect: null, running: false, shown: false, lastEnd: "deadline", memory: { geometries: 0, textures: 0 } });
    expect(errors).toEqual([]);
  });

  test("an end before the chunk arrives plays nothing", async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route(CHUNK, async (route) => { await gate; await route.continue(); });
    const { errors, chunks } = await open(page, true);
    expect(await page.evaluate(() => window.dogFx.begin("christmas"))).toBe(true);
    await expect.poll(() => chunks.length).toBe(1);
    expect(await stage(page)).toMatchObject({ loaded: false, loading: true });
    await page.evaluate(() => window.dogFx.end());
    release();
    await expect.poll(async () => (await stage(page)).loaded, { timeout: 10_000 }).toBe(true);
    await page.waitForTimeout(500);
    expect(await stage(page)).toMatchObject({ effect: null, running: false, moments: 0 });
    expect(await page.locator("canvas.stage3d").count(), "not even a renderer").toBe(0);
    expect(errors).toEqual([]);
  });

  test("a lost context kills the stage; the dogs carry on", async ({ page }) => {
    const { errors } = await open(page, true);
    await page.evaluate(() => { window.dogOccasion.show("christmas", { dogs: ["benji"] }); });
    await expect.poll(() => stage(page), { timeout: 15_000 }).toMatchObject({ effect: "snow", running: true });
    await page.evaluate(() => {
      const c = document.querySelector("canvas.stage3d");
      (c.getContext("webgl2") || c.getContext("webgl")).getExtension("WEBGL_lose_context").loseContext();
    });
    await expect.poll(() => stage(page), { timeout: 5000 }).toMatchObject({ dead: true, effect: null, running: false, lastEnd: "context-lost" });
    await page.evaluate(() => window.dogOccasion.hide());

    await page.evaluate(() => { window.__dogDone = window.dogOccasion.show("christmas", { dogs: ["benji"] }); });
    await expect.poll(() => page.evaluate(() => window.dogOccasion.state().dogs.length), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1000);
    expect(await stage(page)).toMatchObject({ dead: true, effect: null, running: false, moments: 1 });
    await page.evaluate(() => window.dogOccasion.hide());
    // three logs its own warning on a lost context; anything else is ours.
    expect(errors.filter((e) => !/CONTEXT_LOST|Context Lost/i.test(e))).toEqual([]);
  });
});
