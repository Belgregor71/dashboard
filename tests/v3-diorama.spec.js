import { test, expect } from "./fixtures/coverage.js";
import { cropBox, momentFor, parkedCars } from "../src/v3/core/diorama.js";

/* The diorama (features.v3Diorama). The real plate is gitignored, so the page gets
   a fixture. Time is real: the moment is Web Animations and a timer. */

const MIDDAY = new Date("2026-06-16T12:00:00+10:00");
// 3x2 solid PNG.
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
    dressed: { birthday: "plan-birthday", christmas: "plan-christmas", easter: "plan-easter" }
  }
};

async function bootV3(page, { on = true, diorama = true, dress = false, date = MIDDAY, birthdays = [], broken = [] } = {}) {
  const pageErrors = [];
  const layers = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(date);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/house-plan") {
      return route.fulfill({ json: diorama ? META : { ...META, diorama: undefined } });
    }
    if (url.pathname === "/api/dogs/birthdays") return route.fulfill({ json: { days: birthdays } });
    if (url.pathname.startsWith("/api/house-plan/layer/")) {
      const name = url.pathname.split("/").pop();
      layers.push(name);
      if (broken.includes(name)) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({
      response: res,
      body: `${await res.text()}\nwindow.CONFIG.features.v3Diorama = ${on};\nwindow.CONFIG.features.v3DioramaDressed = ${dress};\n`
    });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  if (on && diorama) await page.waitForFunction(() => window.__v3().diorama.ready);
  // The dressed plates decode after `ready`, and the birthday list arrives on its own fetch.
  if (dress) await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  return { pageErrors, layers };
}

const plateNow = (page) => page.locator(".diorama__plate").evaluate(
  (plate) => new URL(plate.src).pathname.split("/").pop()
);

// The first call makes the state an observed transition; an unknown absence is long enough.
const arrive = (page, id) => page.evaluate((entity) => {
  window.__v3Arrival(entity, "not_home");
  window.__v3Arrival(entity, "home");
}, id);

const home = (page, id, state = "home") => page.evaluate(
  ([entity_id, value]) => window.__emitHaState({ entity_id, state: value, attributes: {} }),
  [id, state]
);

// `.count()` once, never `toHaveCount(0)`: that retries past a moment that removes itself.
const dioramaNow = (page) => page.locator(".diorama").count();
const carsNow = (page) => page.locator(".diorama__car").evaluateAll(
  (cars) => cars.map((car) => new URL(car.src).pathname.split("/").pop()).sort()
);

test("what a candidate on the glass asks for", () => {
  expect(momentFor({ id: "arrival:person.brett" })).toEqual({ rolling: "person.brett" });
  expect(momentFor({ id: "bin-night:2026-6-16", text: "Bins go out tonight (Red + Yellow)." }))
    .toEqual({ bins: ["red", "yellow"] });
  expect(momentFor({ id: "bin-last-chance:x", text: "Bins (Red) — last chance, the truck's due." }))
    .toEqual({ bins: ["red"] });
  expect(momentFor({ id: "bin-weather:x", text: "Bins out tonight (Green) — rain's coming." }))
    .toEqual({ bins: ["green"] });
  // No colours is no picture, not a guess at which bins.
  expect(momentFor({ id: "bin-night:x", text: "Bins go out tonight." })).toBeNull();
  expect(momentFor({ id: "rain-incoming:x", text: "Red sky" })).toBeNull();
});

test("the rolling car is never parked, and neither is anyone out", () => {
  const cars = { a: {}, b: {} };
  expect(parkedCars(cars, "a", () => "home")).toEqual(["b"]);
  expect(parkedCars(cars, "a", () => "not_home")).toEqual([]);
  expect(parkedCars(cars, undefined, (id) => (id === "a" ? "home" : "not_home"))).toEqual(["a"]);
});

test("the crop covers the wall from its own corner", () => {
  expect(cropBox([100, 200, 960, 540], 1920, 1080)).toEqual({ scale: 2, left: -200, top: -400 });
  // A taller crop than the wall still covers it, on its width.
  expect(cropBox([0, 0, 800, 600], 1600, 900).scale).toBe(2);
});

test("flag off: an arrival lays no diorama and fetches none of it", async ({ page }) => {
  const layers = [];
  page.on("request", (req) => { if (req.url().includes("/house-plan/layer")) layers.push(req.url()); });
  const { pageErrors } = await bootV3(page, { on: false });
  await arrive(page, "person.brett");
  await expect(page.locator("#glance-said")).toContainText("home");
  expect(await dioramaNow(page)).toBe(0);
  expect(layers).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("an arrival rolls that person's car in beside whoever is home, then leaves", async ({ page }) => {
  const { pageErrors } = await bootV3(page);
  await home(page, "person.greg_dee");
  await arrive(page, "person.brett");

  await expect(page.locator(".diorama")).toBeVisible();
  expect(await carsNow(page)).toEqual(["car-left", "car-right"]);
  expect(await page.locator(".diorama__bin").count()).toBe(0);

  // Mid-roll: the arriving car is short of its bay, the parked one is in it.
  await page.waitForTimeout(700);
  const offsets = await page.locator(".diorama__car").evaluateAll((cars) => Object.fromEntries(cars.map((car) => [
    new URL(car.src).pathname.split("/").pop(),
    new DOMMatrix(getComputedStyle(car).transform).e
  ])));
  expect(offsets["car-right"]).toBeLessThan(0);
  expect(offsets["car-left"]).toBe(0);

  // Six seconds and it has gone, with the line still on the glass beneath it.
  await page.waitForTimeout(6000);
  expect(await dioramaNow(page)).toBe(0);
  await expect(page.locator("#glance-said")).toContainText("Brett");
  expect(pageErrors).toEqual([]);
});

test("nobody else home: only the arriving car", async ({ page }) => {
  await bootV3(page);
  await home(page, "person.greg_dee", "not_home");
  await arrive(page, "person.brett");
  await expect(page.locator(".diorama")).toBeVisible();
  expect(await carsNow(page)).toEqual(["car-right"]);
});

test("a candidate that stays on the glass plays once", async ({ page }) => {
  await bootV3(page);
  await arrive(page, "person.brett");
  await expect(page.locator(".diorama")).toBeVisible();
  await page.waitForTimeout(6500);
  await page.evaluate(() => window.__v3Tick());
  expect(await page.evaluate(() => window.__v3().diorama.played)).toBe(1);
  expect(await dioramaNow(page)).toBe(0);
});

test("bin night puts out the bins it names", async ({ page }) => {
  const { pageErrors } = await bootV3(page);
  await page.evaluate(() => window.__forceCandidate({
    id: "bin-night:2026-6-16",
    source: "predictive",
    text: "Bins go out tonight (Red + Yellow).",
    score: 95,
    interrupt: true,
    expiresAt: Date.now() + 60000
  }));
  await page.evaluate(() => window.__v3Tick());
  await expect(page.locator(".diorama")).toBeVisible();
  expect(await page.locator(".diorama__bin").evaluateAll((bins) => bins.map((b) => b.dataset.colour)))
    .toEqual(["red", "yellow"]);
  expect(await carsNow(page)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("a subject asked for takes the wall straight back", async ({ page }) => {
  await bootV3(page);
  await arrive(page, "person.brett");
  await expect(page.locator(".diorama")).toBeVisible();
  await page.evaluate(() => window.__v3Transcript("show me the driveway"));
  await expect.poll(() => page.evaluate(() => window.__v3().depth.depth)).toBe(3);
  expect(await dioramaNow(page)).toBe(0);
});

test("the wall is not interrupted at depth 3", async ({ page }) => {
  await bootV3(page);
  await page.evaluate(() => window.__v3Transcript("show me the driveway"));
  await expect.poll(() => page.evaluate(() => window.__v3().depth.depth)).toBe(3);
  await arrive(page, "person.brett");
  await page.waitForTimeout(300);
  expect(await dioramaNow(page)).toBe(0);
});

const CHRISTMAS = new Date("2026-12-20T12:00:00+10:00");

test("in a season with a dressed plate, the moment wears it and the cars still park", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { dress: true, date: CHRISTMAS });
  await home(page, "person.greg_dee");
  await arrive(page, "person.brett");
  await expect(page.locator(".diorama")).toBeVisible();
  expect(await plateNow(page)).toBe("plan-christmas");
  expect(await carsNow(page)).toEqual(["car-left", "car-right"]);
  expect(pageErrors).toEqual([]);
});

test("a birthday wins over the season", async ({ page }) => {
  await bootV3(page, { dress: true, date: CHRISTMAS, birthdays: [{ month: 12, day: 20, dogs: [], family: true }] });
  await arrive(page, "person.brett");
  await expect(page.locator(".diorama")).toBeVisible();
  expect(await plateNow(page)).toBe("plan-birthday");
});

test("an ordinary day stays plain", async ({ page }) => {
  await bootV3(page, { dress: true });
  await arrive(page, "person.brett");
  await expect(page.locator(".diorama")).toBeVisible();
  expect(await plateNow(page)).toBe("plan-empty");
});

test("a season with no dressed plate stays plain", async ({ page }) => {
  await bootV3(page, { dress: true, date: new Date("2026-10-20T12:00:00+10:00") });
  await arrive(page, "person.brett");
  await expect(page.locator(".diorama")).toBeVisible();
  expect(await plateNow(page)).toBe("plan-empty");
});

test("a broken dressed plate costs that occasion only", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { dress: true, date: CHRISTMAS, broken: ["plan-christmas"] });
  expect(await page.evaluate(() => window.__v3().diorama.dressed)).toEqual(["birthday", "easter"]);
  await arrive(page, "person.brett");
  await expect(page.locator(".diorama")).toBeVisible();
  expect(await plateNow(page)).toBe("plan-empty");
  expect(pageErrors).toEqual([]);
});

test("flag off: the dressed plates are not fetched and the season stays plain", async ({ page }) => {
  const { layers } = await bootV3(page, { date: CHRISTMAS });
  await arrive(page, "person.brett");
  await expect(page.locator(".diorama")).toBeVisible();
  expect(await plateNow(page)).toBe("plan-empty");
  expect(layers.filter((name) => name.startsWith("plan-") && name !== "plan-empty")).toEqual([]);
});

test("no diorama in the data: an arrival is just the line", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { diorama: false });
  await arrive(page, "person.brett");
  await expect(page.locator("#glance-said")).toContainText("Brett");
  expect(await dioramaNow(page)).toBe(0);
  expect(pageErrors).toEqual([]);
});
