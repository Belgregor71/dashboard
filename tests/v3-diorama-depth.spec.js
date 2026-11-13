import { test, expect } from "@playwright/test";
import { sunVector, coverDistance, shadowLength } from "../src/v3/stage3d/diorama-deep.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE DEEP DIORAMA — features.v3DioramaDepth (Phase 3 of the three.js stage).

   What is asserted, and why:
     · flag OFF: no height map, no stage chunk, the flat
       diorama as before                               → flag off = the build before
     · flag ON: the moment is the stage's world, not the
       DOM; the rolling car is short of its bay mid-roll
       and in it at the end; the camera pushes in,
       never out past the crop; walls cast a shadow    → a deep moment that draws
                                                          nothing that moves
     · bins drop in, the colours named                 → the bin moment lost on the stage
     · after every moment: info.memory 0/0, loop off,
       canvas hidden, ONE canvas                       → the GPU leak the handover
                                                          is built around
     · rain on a wet day, none on a dry one            → rain on the wrong day
     · no height map / reduced motion / a dead stage /
       the dogs holding it → the flat diorama          → a lost moment
     · the dogs cannot end the diorama, nor it the dogs → owners stopping each other
     · depth 3 takes the wall straight back             → a deep moment over a subject

   In the `isolated` project with v3-dog-fx: WebGL pages in parallel flake.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-06-16T12:00:00+10:00");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGNkYGD4DwYMAA0YAgEQ3YTtAAAAAElFTkSuQmCC",
  "base64"
);
const META = {
  width: 1500,
  height: 1000,
  upBearing: 22.5,
  cameras: {},
  diorama: {
    crop: [0, 400, 900, 506],
    cars: {
      "person.greg_dee": { layer: "car-left", x: 268, y: 748, w: 148, h: 137 },
      "person.brett": { layer: "car-right", x: 250, y: 600, w: 164, h: 148 }
    },
    bins: [{ x: 66, y: 874 }, { x: 106, y: 874 }],
    binSize: { w: 30, h: 38 },
    // Robot millimetres straight onto plate pixels.
    robot: { affine: [1, 0, 0, 0, 1, 0] }
  }
};
const CHUNK = /\/assets\/(stage|diorama-deep)-[^/]*\.js$/;

async function boot(page, { on = true, depthMap = true } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  const layers = [];
  const chunks = [];
  page.on("request", (r) => { if (CHUNK.test(new URL(r.url()).pathname)) chunks.push(r.url()); });
  await page.clock.setFixedTime(MIDDAY);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/house-plan") return route.fulfill({ json: META });
    if (url.pathname.startsWith("/api/house-plan/layer/")) {
      const name = url.pathname.split("/").pop();
      layers.push(name);
      if (name === "plan-depth" && !depthMap) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({
      response: res,
      body: `${await res.text()}\nwindow.CONFIG.features.v3Diorama = true;\nwindow.CONFIG.features.v3DioramaDressed = false;\nwindow.CONFIG.features.v3DioramaDepth = ${on};\n`
    });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function" && window.__v3().diorama.ready);
  expect(await page.evaluate(() => window.CONFIG.features.v3DioramaDepth), "the flag reached the page").toBe(on);
  // The height map and the chunk load after `ready`.
  if (on && depthMap) await page.waitForFunction(() => window.__v3().diorama.deep?.ready, null, { timeout: 15_000 });
  else await page.waitForTimeout(500);
  return { errors, layers, chunks };
}

const diorama = (page) => page.evaluate(() => window.__v3().diorama);
const deepStage = async (page) => (await diorama(page)).deep?.stage;
const flatNow = (page) => page.locator(".diorama").count();

const arrive = (page, entity) => page.evaluate((id) => {
  window.__v3Arrival(id, "not_home");
  window.__v3Arrival(id, "home");
}, entity);

const bins = (page, id, text) => page.evaluate(([cid, words]) => {
  window.__forceCandidate({ id: cid, source: "predictive", text: words, score: 95, interrupt: true, expiresAt: Date.now() + 60000 });
  window.__v3Tick();
}, [id, text]);

async function expectEmptied(page, at, timeout = 10_000) {
  await expect.poll(() => deepStage(page), { timeout, message: `${at}: stage emptied` })
    .toMatchObject({ world: null, effect: null, running: false, shown: false, memory: { geometries: 0, textures: 0 } });
}

test("the sun turns with the plate, and the camera covers the crop", () => {
  // Sun due north at the horizon's floor, plate up = north: straight up the plate.
  const [x, y, z] = sunVector(Math.PI, 30, 0);
  expect(x).toBeCloseTo(0, 6);
  expect(y).toBeGreaterThan(0.8);
  expect(z).toBeCloseTo(0.5, 6);
  // The same sun on a plate whose up is east sits to the plate's left.
  expect(sunVector(Math.PI, 30, 90)[0]).toBeLessThan(-0.8);
  // Shadows: short under a high sun, long but capped under a low one.
  expect(shadowLength(sunVector(0, 80, 0))).toBeLessThan(4);
  expect(shadowLength(sunVector(0, 20, 0))).toBeGreaterThan(4);
  expect(shadowLength(sunVector(0, -20, 0))).toBe(48);
  // Below 8°, shadows would cross whole rooms: held at 8°.
  expect(sunVector(0, -20, 0)[2]).toBeCloseTo(Math.sin((8 * Math.PI) / 180), 6);
  // A crop wider than the wall covers on its height; taller, on its width.
  const tan = Math.tan((30 * Math.PI) / 360);
  expect(coverDistance(900, 400, 16 / 9)).toBeCloseTo(200 / tan, 6);
  expect(coverDistance(800, 600, 16 / 9)).toBeCloseTo(800 / (16 / 9) / 2 / tan, 6);
});

test.describe("v3DioramaDepth", () => {
  test("flag off: no height map, no stage chunk, the flat diorama as before", async ({ page }) => {
    const { errors, layers, chunks } = await boot(page, { on: false });
    await arrive(page, "person.brett");
    await expect(page.locator(".diorama")).toBeVisible();
    expect((await diorama(page)).deep).toBeNull();
    expect(layers).not.toContain("plan-depth");
    expect(chunks).toEqual([]);
    expect(await page.locator("canvas.stage3d").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test("flag on: the arrival rolls in on the stage, the bins drop, and the stage empties after each", async ({ page }) => {
    test.setTimeout(90_000);
    const { errors } = await boot(page);
    await page.evaluate(() => window.__emitHaState({ entity_id: "person.greg_dee", state: "home", attributes: {} }));
    await arrive(page, "person.brett");

    await expect.poll(() => deepStage(page), { timeout: 5000 })
      .toMatchObject({ owner: "diorama", running: true, shown: true, world: { name: "diorama", cars: 2, bins: 0, trail: false } });
    expect(await flatNow(page), "deep, not the DOM diorama as well").toBe(0);
    // Mid-roll: short of its bay. The push-in has begun, and the walls cast a shadow.
    await page.waitForTimeout(900);
    const mid = (await deepStage(page)).world;
    expect(mid.rolling).toBeLessThan(0);
    expect(mid.zoom).toBeGreaterThan(1);
    expect(mid.shadowPx).toBeGreaterThan(0);
    // Parked; the push-in never past 8% (zoom ≤ 1/0.92), never back out past the crop (zoom ≥ 1).
    await expect.poll(async () => (await deepStage(page)).world?.rolling, { timeout: 5000 }).toBe(0);
    const { zoom } = (await deepStage(page)).world;
    expect(zoom).toBeGreaterThanOrEqual(1);
    expect(zoom).toBeLessThanOrEqual(1.087);
    expect((await deepStage(page)).frames).toBeGreaterThan(10);
    await expectEmptied(page, "arrival");
    expect((await diorama(page)).showing).toBe(false);

    for (const [i, id] of ["bin-night:a", "bin-last-chance:b"].entries()) {
      await bins(page, id, i ? "Bins (Red) — last chance." : "Bins go out tonight (Red + Yellow).");
      await expect.poll(async () => (await deepStage(page))?.world?.bins, { timeout: 5000, message: id }).toBe(i ? 1 : 2);
      // Greg was set home above, so his car is parked; nobody rolls in on bin night.
      expect((await deepStage(page)).world).toMatchObject({ cars: 1, rolling: null });
      await expectEmptied(page, id);
    }
    const end = await diorama(page);
    expect(end.deep.shown).toBe(3);
    expect(end.deep.stage.moments).toBe(3);
    expect(await page.locator("canvas.stage3d").count(), "one canvas for the page's life").toBe(1);
    expect(await flatNow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("the robot's run is drawn on the plate, and a moment with no robot has no trail", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__dioramaShow({ robot: "start", track: { robot: [900, 400], trail: [[700, 500], [800, 500], [900, 400]], state: "cleaning" } }));
    await expect.poll(async () => (await deepStage(page))?.world, { timeout: 5000 }).toMatchObject({ name: "diorama", trail: true, cars: 0 });
    expect(await flatNow(page)).toBe(0);
    await expectEmptied(page, "robot");
    await page.evaluate(() => window.__dioramaShow({ bins: ["red"] }));
    await expect.poll(async () => (await deepStage(page))?.world, { timeout: 5000 }).toMatchObject({ name: "diorama", trail: false });
    await expectEmptied(page, "bins");
  });

  test("rain on a wet day only", async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page);
    await bins(page, "bin-night:dry", "Bins go out tonight (Green).");
    await expect.poll(async () => (await deepStage(page))?.world?.name, { timeout: 5000 }).toBe("diorama");
    expect((await deepStage(page)).effect).toBeNull();
    await expectEmptied(page, "dry");

    await page.evaluate(() => { document.documentElement.dataset.atmoRaining = "1"; });
    await bins(page, "bin-weather:wet", "Bins out tonight (Green) — rain's coming.");
    await expect.poll(async () => (await deepStage(page))?.effect, { timeout: 5000 }).toBe("rain");
    expect((await deepStage(page)).particles).toBe(320);
    await expectEmptied(page, "wet");
  });

  test("no height map on the box: the flat diorama", async ({ page }) => {
    const { errors, layers } = await boot(page, { depthMap: false });
    expect(layers).toContain("plan-depth");
    expect((await diorama(page)).deep).toBeNull();
    await arrive(page, "person.brett");
    await expect(page.locator(".diorama")).toBeVisible();
    expect(await page.locator("canvas.stage3d").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test("reduced motion: the flat diorama", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), "emulation landed").toBe(true);
    await arrive(page, "person.brett");
    await expect(page.locator(".diorama")).toBeVisible();
    expect((await deepStage(page)).moments).toBe(0);
  });

  test("a dead stage: the flat diorama", async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page);
    await bins(page, "bin-night:first", "Bins go out tonight (Red).");
    await expect.poll(async () => (await deepStage(page))?.running, { timeout: 5000 }).toBe(true);
    await page.evaluate(() => {
      const c = document.querySelector("canvas.stage3d");
      (c.getContext("webgl2") || c.getContext("webgl")).getExtension("WEBGL_lose_context").loseContext();
    });
    await expect.poll(async () => (await deepStage(page)).dead, { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(6500); // the first moment's slot runs out
    await bins(page, "bin-night:second", "Bins go out tonight (Yellow).");
    await expect(page.locator(".diorama")).toBeVisible();
  });

  test("the dogs and the diorama cannot end each other", async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page);
    await page.evaluate(() => { window.CONFIG.features.v3DogFx = true; });

    // The diorama holds the stage: a dog moment is refused, and its end() leaves the diorama be.
    await bins(page, "bin-night:held", "Bins go out tonight (Red).");
    await expect.poll(async () => (await deepStage(page))?.running, { timeout: 5000 }).toBe(true);
    await page.evaluate(() => window.dogFx.begin("christmas"));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.dogFx.end());
    await page.waitForTimeout(800); // past the stage's 600 ms fade: a wrongful stop has emptied it by now
    const held = await deepStage(page);
    expect(held).toMatchObject({ owner: "diorama", effect: null, running: true });
    expect(held.world.name).toBe("diorama");
    await expectEmptied(page, "held");

    // The dogs hold the stage: the diorama plays flat, and the snow keeps falling.
    await page.evaluate(() => window.dogFx.begin("christmas"));
    await expect.poll(async () => (await deepStage(page)).effect, { timeout: 5000 }).toBe("snow");
    await bins(page, "bin-night:dogs", "Bins go out tonight (Yellow).");
    await expect(page.locator(".diorama")).toBeVisible();
    expect(await deepStage(page)).toMatchObject({ owner: "dogs", effect: "snow", world: null });
    await page.evaluate(() => window.dogFx.end());
  });

  test("a subject asked for takes the wall straight back", async ({ page }) => {
    await boot(page);
    await arrive(page, "person.brett");
    await expect.poll(async () => (await deepStage(page))?.running, { timeout: 5000 }).toBe(true);
    await page.evaluate(() => window.__v3Transcript("show me the driveway"));
    await expect.poll(() => page.evaluate(() => window.__v3().depth.depth)).toBe(3);
    // Within the 600 ms fade, not the stage's own deadline seconds later.
    await expectEmptied(page, "depth 3", 1500);
    expect((await diorama(page)).showing).toBe(false);
  });
});
