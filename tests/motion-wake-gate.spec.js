import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * features.motionWakeGate — audit M5.
 *
 * Camera motion reaches the display through cameraPopupOverlay's unconditional
 * wakeScreensaver(), and the popup fires for all six outdoor cameras on motion
 * AND person: 61 wakes measured in 24h, 49 of them plain motion. With the gate
 * ON, a plain-motion trigger arriving while Mode 0 is up is dropped outright —
 * no wake, no popup, no snapshot fetch. Person and doorbell still come through.
 * OFF (default) is today's behaviour exactly: motion wakes and pops.
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

function forceGate(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        `\nwindow.CONFIG.features.motionWakeGate = ${value};` +
        // Pin Immich off so the async photo fetch never delays __engageScreensaver.
        `\nwindow.CONFIG.features.immichPhotos = false;\n`;
      await route.fulfill({ response: res, body });
    });
}

// Pinned daytime: after sunset the screensaver auto-engages and re-engages
// after a wake, which would mask exactly the difference under test
// (CLAUDE.md — time-of-day dependence is a known flake source here).
const MIDDAY = new Date("2026-07-06T12:00:00");

const DRIVEWAY_MOTION = "binary_sensor.driveway_motion_detected";
const DRIVEWAY_PERSON = "binary_sensor.driveway_person_detected";

async function bootAsleep(page, gateOn) {
  await isolateFromRealHa(page);
  await stubLiveStream(page);
  await forceGate(gateOn)(page);
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/index.html");
  await page.waitForFunction(() => typeof window.__engageScreensaver === "function");
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

test("gate ON: plain motion neither wakes nor pops while asleep", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await bootAsleep(page, true);
  await fireTrigger(page, DRIVEWAY_MOTION);

  // Give the handler a real chance to run — asserting "still absent" needs a
  // wait, or it passes trivially before the listener has been called at all.
  await page.waitForTimeout(600);

  await expect(page.locator("body")).toHaveClass(/screensaver-active/);
  await expect(page.locator("#camera-popup-overlay")).not.toHaveClass(/is-active/);
  expect(pageErrors).toEqual([]);
});

test("gate ON: a person still wakes and pops", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await bootAsleep(page, true);
  await fireTrigger(page, DRIVEWAY_PERSON);

  // This is the leg that must not regress — the gate is only acceptable if the
  // events that matter still get through.
  await expect(page.locator("#camera-popup-overlay")).toHaveClass(/is-active/);
  await expect(page.locator("body")).not.toHaveClass(/screensaver-active/);
  expect(pageErrors).toEqual([]);
});

test("gate OFF (default): plain motion wakes and pops, as it does today", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await bootAsleep(page, false);
  await fireTrigger(page, DRIVEWAY_MOTION);

  await expect(page.locator("#camera-popup-overlay")).toHaveClass(/is-active/);
  await expect(page.locator("body")).not.toHaveClass(/screensaver-active/);
  expect(pageErrors).toEqual([]);
});

test("gate ON: motion while AWAKE still pops — the gate is asleep-only", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await isolateFromRealHa(page);
  await stubLiveStream(page);
  await forceGate(true)(page);
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/index.html");
  await page.waitForFunction(() => typeof window.__engageScreensaver === "function");
  // Never engaged: the dashboard is awake, so a glance surface costs nothing.
  await expect(page.locator("body")).not.toHaveClass(/screensaver-active/);

  await fireTrigger(page, DRIVEWAY_MOTION);

  await expect(page.locator("#camera-popup-overlay")).toHaveClass(/is-active/);
  expect(pageErrors).toEqual([]);
});
