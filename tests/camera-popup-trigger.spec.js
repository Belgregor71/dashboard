import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * The incumbent's camera popup trigger path — a camera fires, the overlay opens,
 * and the display comes up with it.
 *
 * WAS tests/motion-wake-gate.spec.js. `features.motionWakeGate` was retired
 * unflipped on 2026-08-15: it lived in cameraPopupOverlay.js, which V3 does not
 * import (0 occurrences in dist/assets/v3-*.js), so no value of it could change
 * what is on the wall. V3 enforces the same restraint structurally instead —
 * core/alerts.js is its only unasked wake path and it knows three entities, all
 * of them a ring or a person.
 *
 * The three cases the gate's spec asserted about the UNGATED path are kept, and
 * this is why: this is the only browser coverage anywhere of the trigger →
 * popup → wake chain, and that chain is the incumbent's whole security surface.
 * `V3_DEFAULT=0` is a documented one-line rollback, so it can be the wall again
 * on any evening it is needed, and it should not come back untested.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// A person trigger is live-worthy, so the popup asks for /api/camera/:id/live —
// which makes the server POST eufy_security.start_p2p_livestream at the REAL
// camera. Starting P2P is the single biggest battery drain on a Eufy battery
// camera (see the camera-battery-drain work), so the suite must never do it.
// Intercepted here: the request never leaves the browser.
async function stubLiveStream(page) {
  await page.route("**/api/camera/*/live*", (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "stubbed" })
  );
}

// playwright.config.js spreads `...process.env` into the test server and stubs
// only the AI and Kokoro upstreams — HA_HOST is passed through real. So
// /api/ha/stream carries LIVE house events into every browser spec, and this
// spec asserts on the camera popup, which those events drive directly: a real
// driveway motion (33/day, measured) landing inside the assertion window pops
// the popup and fails a run that is otherwise correct. Caught by the pre-push
// gate, not standalone, because it depends on the house doing something.
// Every trigger here is dispatched synthetically, so the stream is pure noise.
async function isolateFromRealHa(page) {
  await page.route("**/api/ha/stream", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: "" })
  );
}

// Pin Immich off so the async photo fetch never delays __engageScreensaver.
function stubConfig(page) {
  return page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) + "\nwindow.CONFIG.features.immichPhotos = false;\n";
    await route.fulfill({ response: res, body });
  });
}

// Pinned daytime: after sunset the screensaver auto-engages and re-engages
// after a wake, which would mask exactly the difference under test
// (CLAUDE.md — time-of-day dependence is a known flake source here).
const MIDDAY = new Date("2026-07-06T12:00:00");

const DRIVEWAY_MOTION = "binary_sensor.driveway_motion_detected";
const DRIVEWAY_PERSON = "binary_sensor.driveway_person_detected";

async function boot(page) {
  await isolateFromRealHa(page);
  await stubLiveStream(page);
  await stubConfig(page);
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/index.html");
  await page.waitForFunction(() => typeof window.__engageScreensaver === "function");
}

async function bootAsleep(page) {
  await boot(page);
  await page.evaluate(() => window.__engageScreensaver());
  await expect(page.locator("body")).toHaveClass(/screensaver-active/);
}

function fireTrigger(page, entityId) {
  return page.evaluate((id) => {
    document.dispatchEvent(new CustomEvent("ha:state-updated", {
      detail: { entity_id: id, state: "on" }
    }));
  }, entityId);
}

test("a person at the driveway wakes the panel and pops", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await bootAsleep(page);
  await fireTrigger(page, DRIVEWAY_PERSON);

  // The leg that must never regress — a security event reaching a sleeping wall
  // is the entire reason this path exists.
  await expect(page.locator("#camera-popup-overlay")).toHaveClass(/is-active/);
  await expect(page.locator("body")).not.toHaveClass(/screensaver-active/);
  expect(pageErrors).toEqual([]);
});

test("plain motion wakes the panel and pops too", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await bootAsleep(page);
  await fireTrigger(page, DRIVEWAY_MOTION);

  // Deliberately asserted, not merely tolerated: this is the incumbent being
  // less restrained than V3, and it should be visible in the suite rather than
  // rediscovered by an audit. See the retirement note in cameraPopupOverlay.js.
  await expect(page.locator("#camera-popup-overlay")).toHaveClass(/is-active/);
  await expect(page.locator("body")).not.toHaveClass(/screensaver-active/);
  expect(pageErrors).toEqual([]);
});

test("motion while AWAKE pops without touching the screensaver", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await boot(page);
  // Never engaged: the dashboard is awake, so a glance surface costs nothing.
  await expect(page.locator("body")).not.toHaveClass(/screensaver-active/);

  await fireTrigger(page, DRIVEWAY_MOTION);

  await expect(page.locator("#camera-popup-overlay")).toHaveClass(/is-active/);
  expect(pageErrors).toEqual([]);
});
