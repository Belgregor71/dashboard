import { test, expect } from "./fixtures/coverage.js";
import { emptyTrack, point, stepTrack } from "../server/services/robotTrack.js";
import { momentFor } from "../src/v3/core/diorama.js";
import { toPlate } from "../src/v3/core/robot-layer.js";
import { robotMoments } from "../src/v3/core/robot-watch.js";

/* The robot on the house plan (features.v3RobotPlan). The real plate and its
   calibration are gitignored, so the page gets fixtures. Coordinates are invented. */

const MIDDAY = new Date("2026-06-16T12:00:00+10:00");
// 3x2 solid PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGNkYGD4DwYMAA0YAgEQ3YTtAAAAAElFTkSuQmCC",
  "base64"
);
// A tenth of a plate pixel per millimetre, y flipped, origin at (700, 500).
const AFFINE = [0.1, 0, 700, 0, -0.1, 500];
const META = {
  width: 1500,
  height: 1000,
  upBearing: 22.5,
  cameras: {},
  diorama: {
    crop: [0, 400, 900, 506],
    cars: { "person.brett": { layer: "car-right", x: 250, y: 600, w: 164, h: 148 } },
    robot: { affine: AFFINE }
  }
};
const DOCKED = { state: "docked", startedAt: null, endedAt: null, robot: [0, 0], dock: [0, 0], trail: [] };
const OUT = { state: "cleaning", startedAt: 1000, endedAt: null, robot: [2000, 1000], dock: [0, 0], trail: [[0, 0], [1000, 0], [2000, 1000]] };

// ── The server's run ────────────────────────────────────────────────────────

const run = (readings, from = emptyTrack()) => readings.reduce(
  (track, [state, robot], i) => stepTrack(track, { state, robot, at: 100 + i }), from
);

test("a run starts on a change that was seen, and the trail follows the robot", () => {
  const track = run([["docked", [0, 0]], ["cleaning", [0, 0]], ["cleaning", [500, 0]], ["cleaning", [500, 900]]]);
  expect(track.startedAt).toBe(101);
  expect(track.endedAt).toBeNull();
  expect(track.trail).toEqual([[0, 0], [500, 0], [500, 900]]);
  expect(track.robot).toEqual([500, 900]);
});

test("the first reading is not a start: the server is finding out what is true", () => {
  const track = run([["cleaning", [100, 100]], ["cleaning", [900, 100]]]);
  expect(track.startedAt).toBeNull();
  // It is still out, so where it goes is still worth keeping.
  expect(track.trail).toEqual([[100, 100], [900, 100]]);
});

test("Home Assistant coming back is neither a start nor a finish", () => {
  const docked = run([["docked", [0, 0]], ["unavailable", null], ["docked", [0, 0]]]);
  expect(docked.startedAt).toBeNull();
  expect(docked.endedAt).toBeNull();
  // A real clean with a gap of each kind in it still starts once and ends once.
  const through = run([
    ["docked", null], ["cleaning", [0, 0]], ["unavailable", null], ["cleaning", [800, 0]], ["unknown", null], ["docked", [0, 0]]
  ]);
  expect(through.startedAt).toBe(101);
  expect(through.endedAt).toBe(105);
});

test("docking ends the run, keeps its trail, and the next clean starts a new one", () => {
  const home = run([["docked", null], ["cleaning", [0, 0]], ["cleaning", [900, 0]], ["returning", [400, 0]], ["docked", [0, 0]]]);
  expect(home.endedAt).toBe(104);
  expect(home.trail).toEqual([[0, 0], [900, 0], [400, 0], [0, 0]]);
  // Sitting on the dock adds nothing and ends nothing twice.
  const later = run([["docked", [0, 0]], ["docked", [0, 0]]], home);
  expect(later.endedAt).toBe(104);
  expect(later.trail).toHaveLength(4);

  const again = run([["cleaning", [50, 0]]], later);
  expect(again.startedAt).toBe(100);
  expect(again.endedAt).toBeNull();
  expect(again.trail).toEqual([[50, 0]]);
});

test("a robot scrubbing one spot is one point, and a long run stays bounded", () => {
  const still = run([["docked", null], ["cleaning", [0, 0]], ["cleaning", [40, 30]], ["cleaning", [90, 0]]]);
  expect(still.trail).toEqual([[0, 0]]);

  const long = run([["docked", null], ...Array.from({ length: 4000 }, (_, i) => ["cleaning", [i * 200, 0]])]);
  expect(long.trail.length).toBeLessThanOrEqual(1500);
  expect(long.trail.length).toBeGreaterThan(700);
  expect(long.trail[0]).toEqual([0, 0]);   // halved, never beheaded
});

test("a stuck robot keeps its place", () => {
  const stuck = run([["docked", null], ["cleaning", [0, 0]], ["cleaning", [900, 0]], ["error", [1500, 0]]]);
  expect(stuck.state).toBe("error");
  expect(stuck.robot).toEqual([1500, 0]);
  expect(stuck.endedAt).toBeNull();
});

test("a position the robot calls invalid is no position", () => {
  expect(point({ x: 10, y: -20, invalid: 0 })).toEqual([10, -20]);
  expect(point({ x: 10, y: -20, invalid: 1 })).toBeNull();
  expect(point({ x: "10", y: 2 })).toBeNull();
  expect(point(undefined)).toBeNull();
});

// ── The page's reading of it ────────────────────────────────────────────────

test("millimetres land on the plate through the calibration", () => {
  expect(toPlate([0, 0], AFFINE)).toEqual([700, 500]);
  expect(toPlate([2000, 1000], AFFINE)).toEqual([900, 400]);
  // Both terms of each row count: a rotated map uses the cross terms.
  expect(toPlate([10, 20], [0, 1, 5, -1, 0, 7])).toEqual([25, -3]);
});

test("only a change between two readings is a moment", () => {
  const ids = (before, now) => robotMoments(before, now, 5000).map((c) => c.id);
  expect(ids(null, OUT)).toEqual([]);                 // the page loaded mid-clean
  expect(ids(DOCKED, DOCKED)).toEqual([]);
  expect(ids(DOCKED, OUT)).toEqual(["robot-start:1000"]);
  expect(ids(OUT, OUT)).toEqual([]);
  expect(ids(OUT, { ...DOCKED, startedAt: 1000, endedAt: 4000 })).toEqual(["robot-done:4000"]);
  expect(ids(DOCKED, null)).toEqual([]);              // a failed read is not news
});

test("stuck is announced when found, once, and withdrawn when it moves again", () => {
  const stuck = { ...OUT, state: "error" };
  const [found] = robotMoments(null, stuck, 5000);    // found on the first reading too
  expect(found.id).toBe("robot-stuck:vacuum");
  expect(found.text).toBe("The vacuum's stopped and needs a hand.");
  expect(found.expiresAt).toBeGreaterThan(5000);
  expect(found.score).toBeGreaterThanOrEqual(70);     // the high band: ahead of the day's readouts
  expect(found.interrupt).toBeUndefined();            // but it never takes an empty room

  expect(robotMoments(stuck, stuck, 6000)).toEqual([]);

  const [gone] = robotMoments(stuck, OUT, 7000);
  expect(gone.id).toBe("robot-stuck:vacuum");
  expect(gone.expiresAt).toBeLessThan(7000);
});

test("the diorama knows the robot's three moments and nothing like them", () => {
  expect(momentFor({ id: "robot-start:1000" })).toEqual({ robot: "start" });
  expect(momentFor({ id: "robot-done:4000" })).toEqual({ robot: "done" });
  expect(momentFor({ id: "robot-stuck:vacuum" })).toEqual({ robot: "stuck" });
  // The chore lane's own cards are not moments.
  expect(momentFor({ id: "robot-problem:stopped and needs a hand" })).toBeNull();
  expect(momentFor({ id: "robot-consumable:filter" })).toBeNull();
});

// ── On the wall ─────────────────────────────────────────────────────────────

async function bootV3(page, { on = true, calibrated = true, track = DOCKED } = {}) {
  const state = { track, trackFetches: 0, pageErrors: [] };
  page.on("pageerror", (err) => state.pageErrors.push(err.message));
  await page.clock.setFixedTime(MIDDAY);
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/house-plan") {
      return route.fulfill({ json: calibrated ? META : { ...META, diorama: { ...META.diorama, robot: undefined } } });
    }
    if (url.pathname.startsWith("/api/house-plan/layer/")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    }
    if (url.pathname === "/api/robot/track") {
      state.trackFetches += 1;
      return state.track
        ? route.fulfill({ json: state.track })
        : route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({
      response: res,
      body: `${await res.text()}\nwindow.CONFIG.features.v3Diorama = true;\nwindow.CONFIG.features.v3RobotPlan = ${on};\nwindow.CONFIG.features.v3DioramaDepth = false;\n`
    });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  await page.waitForFunction(() => window.__v3().diorama.ready);
  // The first reading only tells the page what is true; wait for it so the next one is a change.
  if (on) await page.waitForFunction(() => window.__v3().robot.polls >= 1);
  return state;
}

const poll = (page) => page.evaluate(() => window.__v3RobotPoll());
const dot = (page, root) => page.locator(`${root} .robot__dot`).evaluate((node) => ({
  cx: Number(node.getAttribute("cx")),
  cy: Number(node.getAttribute("cy")),
  state: node.closest("svg").dataset.state
}));

test("flag off: the track is never asked for and nothing of the robot is drawn", async ({ page }) => {
  const state = await bootV3(page, { on: false, track: OUT });
  expect(await page.evaluate(() => typeof window.__v3RobotPoll)).toBe("undefined");
  await page.evaluate(() => window.__v3Presence(true));
  await page.evaluate(() => window.__v3Transcript("where's the vacuum"));
  await page.waitForTimeout(1500);
  expect(state.trackFetches).toBe(0);
  expect(await page.locator(".robot").count()).toBe(0);
  expect(await page.evaluate(() => window.__v3().depth.depth)).not.toBe(3);

  // Nothing announces a robot moment with the flag off, so one is forced: the diorama itself must refuse it.
  await page.evaluate(() => {
    window.__forceCandidate({
      id: "robot-stuck:vacuum", source: "robot", text: "Forced.", score: 95, interrupt: true, expiresAt: Date.now() + 60000
    });
    window.__v3Tick();
  });
  await expect(page.locator("#glance-said")).toContainText("Forced.");
  await page.waitForTimeout(500);
  expect(state.trackFetches).toBe(0);
  expect(await page.locator(".diorama").count()).toBe(0);
  expect(state.pageErrors).toEqual([]);
});

test("heading out: the plan shows the robot where the calibration puts it, with its trail", async ({ page }) => {
  const state = await bootV3(page);
  await page.evaluate(() => window.__v3Presence(true));
  state.track = OUT;
  await poll(page);

  await expect(page.locator("#glance-said")).toContainText("heading out");
  await expect(page.locator(".diorama .robot__dot")).toBeVisible();
  expect(await dot(page, ".diorama")).toEqual({ cx: 900, cy: 400, state: "cleaning" });
  expect(await page.locator(".diorama .robot__trail").getAttribute("points"))
    .toBe("700.0,500.0 800.0,500.0 900.0,400.0");
  // The whole plate, since this fixture sets no crop of its own for the robot.
  const share = await page.locator(".diorama__world").evaluate(
    (world) => world.getBoundingClientRect().width / window.innerWidth
  );
  expect(share).toBeCloseTo(1, 1);

  // It leaves like any other moment, and the same reading does not bring it back.
  await page.waitForTimeout(6500);
  await poll(page);
  await page.evaluate(() => window.__v3Tick());
  expect(await page.locator(".diorama").count()).toBe(0);
  expect(await page.evaluate(() => window.__v3().diorama.played)).toBe(1);
  expect(state.pageErrors).toEqual([]);
});

test("nobody in the room: a clean starting is not worth the wall", async ({ page }) => {
  const state = await bootV3(page);
  await page.evaluate(() => window.__v3Presence(false));
  state.track = OUT;
  await poll(page);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__v3().announced.map((c) => c.id))).toContain("robot-start:1000");
  expect(await page.locator(".diorama").count()).toBe(0);
});

test("stuck: waits for someone, is marked where it stopped, and is withdrawn when it moves", async ({ page }) => {
  const state = await bootV3(page);
  await page.evaluate(() => window.__v3Presence(false));
  state.track = { ...OUT, state: "error" };
  await poll(page);
  await page.waitForTimeout(500);
  expect(await page.locator(".diorama").count()).toBe(0);

  // Still stuck when someone walks in: no new reading is needed for it to show.
  await page.evaluate(() => { window.__v3Presence(true); window.__v3Tick(); });
  await expect(page.locator("#glance-said")).toContainText("needs a hand");
  await expect(page.locator(".diorama .robot__dot")).toBeVisible();
  expect((await dot(page, ".diorama")).state).toBe("error");

  state.track = OUT;
  await poll(page);
  expect(await page.evaluate(() => window.__v3().announced.map((c) => c.id))).not.toContain("robot-stuck:vacuum");
});

test("no calibration on the box: the card still shows, the plan does not", async ({ page }) => {
  const state = await bootV3(page, { calibrated: false });
  await page.evaluate(() => window.__v3Presence(true));
  state.track = { ...OUT, state: "error" };
  await poll(page);
  await expect(page.locator("#glance-said")).toContainText("needs a hand");
  await page.waitForTimeout(800);
  expect(await page.locator(".diorama").count()).toBe(0);
  expect(state.pageErrors).toEqual([]);
});

test("asked: the plan opens with the robot on it and follows it", async ({ page }) => {
  const state = await bootV3(page, { track: OUT });
  await page.evaluate(() => window.__v3Transcript("where's the vacuum"));

  await expect(page.locator(".robot-plan .robot__dot")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__v3().depth.depth)).toBe(3);
  expect(await dot(page, ".robot-plan")).toEqual({ cx: 900, cy: 400, state: "cleaning" });

  state.track = { ...OUT, robot: [3000, 1000], trail: [...OUT.trail, [3000, 1000]] };
  await expect.poll(async () => (await dot(page, ".robot-plan")).cx, { timeout: 15_000 }).toBe(1000);
  expect(await page.locator(".robot-plan .robot").count()).toBe(1);   // replaced, not stacked
  expect(state.pageErrors).toEqual([]);
});

test("leaving the plan stops the follow", async ({ page }) => {
  test.setTimeout(60_000);
  const state = await bootV3(page, { track: OUT });
  await page.evaluate(() => window.__v3Transcript("where's the vacuum"));
  await expect(page.locator(".robot-plan .robot__dot")).toBeVisible();

  /* An id nothing answers to still clears the stage. 21 s holds two 10 s
     refreshes and at most one of the watch's 30 s polls, so a follow left
     running reads 2 or more here. */
  await page.evaluate(() => window.__v3Subject("show.nothing-at-all"));
  expect(await page.locator(".robot-plan").count()).toBe(0);
  const before = state.trackFetches;
  await page.waitForTimeout(21_000);
  expect(state.trackFetches - before).toBeLessThanOrEqual(1);
  expect(state.pageErrors).toEqual([]);
});

test("asked with no robot to place: the words alone, and the wall is not left empty at depth 3", async ({ page }) => {
  const state = await bootV3(page, { track: null });
  await page.evaluate(() => window.__v3Transcript("where's the vacuum"));
  await page.waitForTimeout(1500);
  expect(await page.locator(".robot-plan").count()).toBe(0);
  expect(await page.evaluate(() => window.__v3().depth.depth)).not.toBe(3);
  expect(state.pageErrors).toEqual([]);
});
