import { test, expect } from "./fixtures/coverage.js";
import { containBox, diveOffset, fovCentre } from "../src/v3/subjects/camera-plan.js";

/* The plan over a camera (features.v3CameraPlan). The real plan is gitignored, so
   the page gets a fixture plate. Time is real: the dive and the locator are
   Web Animations and a timer, and those are what is being tested. */

const MIDDAY = new Date("2026-06-15T12:00:00+10:00");
// 3x2 solid PNG.
const PLATE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGNkYGD4DwYMAA0YAgEQ3YTtAAAAAElFTkSuQmCC",
  "base64"
);
const META = {
  width: 1500,
  height: 1000,
  upBearing: 22.5,
  cameras: {
    driveway: { fov: [[0.1, 0.5], [0, 0.4], [0.05, 0.9]] },
    doorbell: { fov: [[0.2, 0.5], [0, 0.3], [0, 0.6]] }
  }
};

async function bootV3(page, { on = true, plan = true } = {}) {
  const pageErrors = [];
  const planFetches = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(MIDDAY);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/house-plan")) planFetches.push(url.pathname);
    if (plan && url.pathname === "/api/house-plan") return route.fulfill({ json: META });
    if (plan && url.pathname === "/api/house-plan/image") {
      return route.fulfill({ status: 200, contentType: "image/png", body: PLATE });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({ response: res, body: `${await res.text()}\nwindow.CONFIG.features.v3CameraPlan = ${on};\n` });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  if (on && plan) await expect.poll(() => planFetches.length).toBe(2);
  // decode() finishes after the fetch, and the wall only draws a decoded plate.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  return { pageErrors, planFetches };
}

/* The real voice lane, not __v3Subject: that hook leaves the depth alone, so a plan
   laid by it sits hidden and "attached" proves nothing. */
const ask = (page, sentence) => page.evaluate((text) => {
  window.__v3Transcript(text);
}, sentence);

/* Read once, never `toHaveCount(0)`: that retries, and a wrongly laid plan removes
   itself within 3 s, so the retry passes against the very defect it is hunting. */
const planNow = (page) => page.locator(".plan").count();

const scaleOf = (page) => page.evaluate(() => {
  const world = document.querySelector(".plan__world");
  return world ? new DOMMatrix(getComputedStyle(world).transform).a : null;
});

test("the dive centres the middle of what the camera sees", () => {
  expect(fovCentre([[0, 0], [0.3, 0.6], [0.6, 0.3]])).toEqual([0.3, 0.3]);

  const box = containBox(1920, 1080, 1.5);
  expect(box).toEqual({ width: 1620, height: 1080, left: 150, top: 0 });

  const { x, y } = diveOffset([0.4, 0.6], box, 1920, 1080, 2);
  expect(150 + x + 0.4 * 1620 * 2).toBe(960);
  expect(y + 0.6 * 1080 * 2).toBeCloseTo(540);
});

test("the dive stops at the plate's edge rather than showing the void past it", () => {
  const box = containBox(1920, 1080, 1.5);
  const size = { width: 1620 * 2, height: 1080 * 2 };

  // The driveway's corner: centring this would leave the left of the wall black.
  const near = diveOffset([0, 0], box, 1920, 1080, 2);
  expect(box.left + near.x).toBe(0);
  expect(box.top + near.y).toBe(0);

  const far = diveOffset([1, 1], box, 1920, 1080, 2);
  expect(box.left + far.x + size.width).toBe(1920);
  expect(box.top + far.y + size.height).toBe(1080);
});

test("flag off: no plan is fetched and none is laid", async ({ page }) => {
  const { pageErrors, planFetches } = await bootV3(page, { on: false });
  await ask(page, "show me the driveway");
  await expect(page.locator(".subject--camera")).toBeVisible();
  expect(await planNow(page)).toBe(0);
  expect(planFetches).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("asking for a camera dives from the plan onto it, then leaves the camera", async ({ page }) => {
  const { pageErrors } = await bootV3(page);
  await ask(page, "show me the driveway");

  const dive = page.locator(".subject--camera .plan--dive");
  await expect(dive).toBeVisible();
  await expect(dive.locator("polygon")).toHaveAttribute("points", "10,50 0,40 5,90");
  // The camera is already underneath; the plan delays nothing.
  await expect(page.locator(".subject--camera .subject__frame")).toHaveCount(2);

  await expect.poll(() => scaleOf(page), { intervals: [50] }).toBeGreaterThan(1.5);

  await expect(dive).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator(".subject--camera .subject__frame")).toHaveCount(2);
  await expect(page.locator(".subject--camera .subject__caption")).toHaveText("The driveway");
  expect(pageErrors).toEqual([]);
});

test("the door gets the locator, never the dive, and it moves out of the way", async ({ page }) => {
  const { pageErrors } = await bootV3(page);
  await page.evaluate(() => { window.__v3Alert(); });

  const locator = page.locator(".subject--camera .plan--locator");
  await expect(locator).toBeVisible();
  await expect(page.locator(".plan--dive")).toHaveCount(0);
  await expect(locator.locator("polygon")).toHaveAttribute("points", "20,50 0,30 0,60");

  const size = page.viewportSize();
  const box = await locator.boundingBox();
  expect(box.width).toBeGreaterThan(100);
  expect(box.width / box.height).toBeCloseTo(1.5, 1);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width);
  expect(box.x).toBeGreaterThan(size.width / 2);
  expect(box.y + box.height).toBeLessThan(size.height / 2);

  await expect(locator).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".subject--camera")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a camera with no position shows as it always did", async ({ page }) => {
  const { pageErrors } = await bootV3(page);
  await ask(page, "show me the patio");
  await expect(page.locator(".subject--camera")).toBeVisible();
  await expect(page.locator(".subject__caption")).toHaveText("The patio");
  expect(await planNow(page)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("a box with no plan shows its cameras as it always did", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { plan: false });
  await ask(page, "show me the driveway");
  await expect(page.locator(".subject--camera")).toBeVisible();
  expect(await planNow(page)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("leaving mid-dive takes the plan with it", async ({ page }) => {
  const { pageErrors } = await bootV3(page);
  await ask(page, "show me the driveway");
  await expect(page.locator(".plan--dive")).toBeVisible();
  const image = await page.locator(".plan__image").elementHandle();
  await ask(page, "show me the patio");

  await expect(page.locator(".subject__caption")).toHaveText("The patio");
  expect(await planNow(page)).toBe(0);
  expect(await image.evaluate((node) => node.getAttribute("src"))).toBe("");
  expect(pageErrors).toEqual([]);
});
