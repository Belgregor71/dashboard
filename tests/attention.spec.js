import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Phase 2 attention-engine UI smoke (docs/vision/phase-2-attention-engine.md).
 *
 * With both flags ON, drives the presence mode over the debug hooks and
 * asserts the lean-in reveal: DWELL shows the top 3 (hero + a 2-item stack),
 * GLANCE collapses to 1, AMBIENT shows nothing unless a candidate is interrupt.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// Pin a deterministic daytime so isNight() is false. Otherwise, when the suite
// runs after sunset, initScreensaver()'s syncNight() auto-engages the dim clock
// at boot (screensaver.js), which hides #focus-hero and fails the DWELL reveal.
// Mirrors the pin already in presence.spec / ambient-clock.spec.
const MIDDAY = new Date("2026-07-06T12:00:00");

// Force both feature flags on by appending to the served (non-module) config.
function enableFlags(page) {
  return page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body =
      (await res.text()) +
      "\nwindow.CONFIG.features.presenceRuntime = true;" +
      "\nwindow.CONFIG.features.attentionEngine = true;" +
      // Pin the BOM warnings entity to one that never exists: a real live warning
      // (e.g. a QLD marine wind warning via HA) is an interrupt-band candidate (95)
      // that outranks the forced test candidates and breaks the queue assertions.
      // Must go through __DASH_CONFIG__ — core/config.js builds the module CONFIG
      // from it (window.CONFIG is the separate static config; bom.js never reads it).
      '\nwindow.__DASH_CONFIG__ = Object.assign({}, window.__DASH_CONFIG__,' +
      ' { weather: { bom: { warningsEntityId: "sensor.__no_live_warnings__" } } });\n';
    await route.fulfill({ response: res, body });
  });
}

test("dwell reveals the top 3; glance collapses to 1; ambient needs an interrupt", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__attention === "function" && typeof window.__forceCandidate === "function"
  );

  // Stage three non-interrupt candidates scored above any live DOM source.
  await page.evaluate(() => {
    window.__forceCandidate([
      { id: "t-a", source: "test", score: 70, icon: "🅰", text: "Alpha", cooldownMs: 0 },
      { id: "t-b", source: "test", score: 60, icon: "🅱", text: "Bravo", cooldownMs: 0 },
      { id: "t-c", source: "test", score: 55, icon: "🅲", text: "Charlie", cooldownMs: 0 }
    ]);
  });

  // DWELL → hero + a 2-item stack (3 visible in total).
  await page.evaluate(() => window.__presence("dwell"));
  await expect.poll(() => page.evaluate(() => window.__attention().stack.length)).toBe(3);
  await expect(page.locator("#focus-hero")).not.toHaveClass(/is-hidden/);
  await expect(page.locator("#focus-stack")).not.toHaveClass(/is-hidden/);
  expect(await page.locator("#focus-stack .focus-stack__item").count()).toBe(2);
  await expect(page.locator("#focus-hero-text")).toHaveText("Alpha");

  // GLANCE → collapse to the single hero.
  await page.evaluate(() => window.__presence("glance"));
  await expect.poll(() => page.evaluate(() => window.__attention().stack.length)).toBe(1);
  await expect(page.locator("#focus-stack")).toHaveClass(/is-hidden/);
  await expect(page.locator("#focus-hero-text")).toHaveText("Alpha");

  // AMBIENT → nothing, because none of these candidates are interrupt.
  await page.evaluate(() => window.__presence("ambient"));
  await expect.poll(() => page.evaluate(() => window.__attention().hero)).toBeNull();
  await expect(page.locator("#focus-hero")).toHaveClass(/is-hidden/);

  // An interrupt candidate overrides the AMBIENT floor.
  await page.evaluate(() => {
    window.__forceCandidate([
      { id: "t-int", source: "test", score: 95, interrupt: true, icon: "⚠️", text: "Storm warning", cooldownMs: 0 }
    ]);
    // Re-run the render at the current (ambient) mode via a mode round-trip.
    window.__presence("glance");
    window.__presence("ambient");
  });
  await expect.poll(() => page.evaluate(() => window.__attention().hero?.id)).toBe("t-int");
  await expect(page.locator("#focus-hero")).not.toHaveClass(/is-hidden/);
  await expect(page.locator("#focus-hero-text")).toHaveText("Storm warning");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

// Phase 3 (docs/vision/phase-3-anticipate.md): a short-lived predictive
// candidate decays out of the live queue on its own once expiresAt passes — no
// manual teardown. Boots with the predictiveCandidates flag on (clean boot).
test("a short-lived predictive candidate decays out of the queue", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body =
      (await res.text()) +
      "\nwindow.CONFIG.features.presenceRuntime = true;" +
      "\nwindow.CONFIG.features.attentionEngine = true;" +
      "\nwindow.CONFIG.features.predictiveCandidates = true;" +
      // Same live-BOM-warning pin as enableFlags above (this test rolls its own route).
      '\nwindow.__DASH_CONFIG__ = Object.assign({}, window.__DASH_CONFIG__,' +
      ' { weather: { bom: { warningsEntityId: "sensor.__no_live_warnings__" } } });\n';
    await route.fulfill({ response: res, body });
  });

  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__attention === "function" && typeof window.__forceCandidate === "function"
  );

  // Inject a rain-shaped candidate whose window starts in ~1.2s, then render it.
  await page.evaluate(() => {
    window.__forceCandidate([
      {
        id: "rain-incoming:test",
        source: "predictive",
        score: 78,
        icon: "🌧️",
        text: "Rain likely in about 15 min — 90% chance.",
        cooldownMs: 0,
        expiresAt: Date.now() + 1200
      }
    ]);
    window.__presence("glance");
    window.__presence("dwell");
  });
  await expect(page.locator("#focus-hero-text")).toHaveText("Rain likely in about 15 min — 90% chance.");

  // Once the window passes, a mode round-trip re-ranks and rankQueue drops it.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          window.__presence("glance");
          window.__presence("dwell");
          return window.__attention().queue.some((c) => c.id === "rain-incoming:test");
        }),
      { timeout: 5000 }
    )
    .toBe(false);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
