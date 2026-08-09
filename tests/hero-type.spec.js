import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design study 02 "The Hero Line" (docs/design/homeos-hero-type.html).
 *
 * With heroType (+ the attention flags to drive the hero) ON, force candidates
 * of known length and assert the length-responsive tier class the hero carries:
 *   ≤16 chars → tier-a · 17–40 → tier-b · 41+ → tier-c (the legibility floor).
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

function enableFlags(page) {
  return page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body =
      (await res.text()) +
      "\nwindow.CONFIG.features.presenceRuntime = true;" +
      "\nwindow.CONFIG.features.attentionEngine = true;" +
      "\nwindow.CONFIG.features.heroType = true;" +
      // The temporal spine (default-on since 2026-08-01) hides #focus-hero — the
      // tier sizes below would still compute on a display:none node and pass while
      // measuring nothing anyone sees. Pin it off: this spec covers the rollback
      // surface, and that is the honest thing for it to be asserting.
      "\nwindow.CONFIG.features.temporalSpine = false;" +
      // Pin the BOM warnings entity to one that never exists: a real live warning
      // (via HA) is an interrupt-band candidate (95) that outranks the forced test
      // candidates and breaks the tier assertions. Must go through __DASH_CONFIG__ —
      // core/config.js builds the module CONFIG from it (bom.js never reads window.CONFIG).
      '\nwindow.__DASH_CONFIG__ = Object.assign({}, window.__DASH_CONFIG__,' +
      ' { weather: { bom: { warningsEntityId: "sensor.__no_live_warnings__" } } });\n';
    await route.fulfill({ response: res, body });
  });
}

async function showLine(page, text) {
  await page.evaluate((t) => {
    window.__forceCandidate([{ id: "hero-type-probe", source: "test", score: 90, icon: "🌧", text: t, cooldownMs: 0 }]);
    // Round-trip the mode so the final transition into GLANCE always fires a
    // presence:changed re-render (re-entering the same mode is a no-op).
    window.__presence("ambient");
    window.__presence("glance");
  }, text);
  await expect(page.locator("#focus-hero-text")).toHaveText(text);
}

test("the hero line picks its type tier from character count", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(page);

  await page.goto("/index.html");
  await page.waitForFunction(
    () => typeof window.__forceCandidate === "function" && typeof window.__heroType === "function"
  );

  const hero = page.locator("#focus-hero");
  await expect(hero).toHaveClass(/hero-type/); // feature marker present when the flag is on

  // ≤16 chars → tier A (headline)
  await showLine(page, "21° and clear."); // 14
  await expect(hero).toHaveClass(/focus-hero--tier-a/);

  // 17–40 chars → tier B (the default)
  await showLine(page, "Rain likely in about 15 minutes."); // 32
  await expect(hero).toHaveClass(/focus-hero--tier-b/);
  await expect(hero).not.toHaveClass(/focus-hero--tier-a/); // old tier is swapped off, never stacked

  // 41+ chars → tier C (the legibility floor)
  await showLine(page, "Leave by 8:20 — 20 minute drive, 6 in traffic."); // 46
  await expect(hero).toHaveClass(/focus-hero--tier-c/);

  // the probe agrees with the DOM
  expect(await page.evaluate(() => window.__heroType().tier)).toBe("c");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
