import { test, expect } from "./fixtures/coverage.js";

/* features.v3ChoreFirst on a real page. tests/v3-chore-first.spec.js proves the
   rule in the composer; this proves the wall CONSULTS it — spread.js is the only
   caller, and a caller that never passed the flag would leave every node test
   green while the wall ranked by score alone. */

const NOW = new Date("2026-06-16T17:00:00+10:00");

async function boot(page, on) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({ response: res, body: `${await res.text()}\nwindow.CONFIG.features.v3ChoreFirst = ${on};\n` });
  });
  await page.clock.setFixedTime(NOW);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

// The shapes predictiveRules.js produces (role, score, expiresAt), at 75 min out.
const RAIN = { id: "spec:rain", source: "predictive", role: "forecast", score: 76, cooldownMs: 0,
  text: "Rain in about 75 min — 83% chance.", expiresAt: NOW.getTime() + 75 * 60_000 };
const BINS = { id: "spec:bins", source: "predictive", role: "chore", score: 50, cooldownMs: 0,
  text: "Bins go out tonight (yellow)." };

const dominantText = (page) => page.evaluate(() => {
  window.__forceCandidate(window.__specCands);
  window.__v3Presence("dwell");
  window.__v3Tick();
  return document.querySelector("#spread-lattice .cell--dominant p:not(.cell__label)")?.textContent ?? null;
});

for (const on of [false, true]) {
  test(`${on ? "ON" : "OFF"}: rain 75 min out ${on ? "gives the dominant cell to the bins" : "takes the dominant cell by score"}`, async ({ page }) => {
    const errors = await boot(page, on);
    await page.evaluate((c) => { window.__specCands = c; }, [RAIN, BINS]);
    const text = await dominantText(page);
    expect(text, "no dominant cell mounted").not.toBeNull();
    expect(text).toBe(on ? BINS.text : RAIN.text);
    expect(errors).toEqual([]);
  });
}
