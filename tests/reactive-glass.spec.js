import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Living Window Phase 2 — reactive glass (features.reactiveGlass).
 *
 * With the flag ON, <body> gets .reactive-glass and the atmo-* token retunes
 * the shared glass tokens (background.css): rain cools/darkens --glass-blur,
 * storm darker still, golden warms the border/sheen, night adds a cool glow.
 * A lightning strike briefly holds body.fx-lightning-active (atmoFx runtime),
 * raising --glass-sheen. OFF (default) is byte-identical: no body class, no
 * token variant matches, strikes never touch the body class.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

function forceReactiveGlass(value) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + `\nwindow.CONFIG.features.reactiveGlass = ${value};\n`;
      await route.fulfill({ response: res, body });
    });
}

// Unregistered custom properties keep the authored token stream — normalise
// whitespace and the minifier's dropped leading zeros (living-accent.spec).
function readGlassVar(page, name) {
  return page.evaluate((n) =>
    getComputedStyle(document.body)
      .getPropertyValue(n)
      .replace(/\s+/g, "")
      .replace(/0\./g, "."), name);
}

// Deterministic daytime (mirrors living-accent.spec / attention.spec).
const MIDDAY = new Date("2026-07-06T12:00:00");

function setAtmo(page, token) {
  return page.evaluate((t) => {
    document.body.classList.remove(
      "atmo-night", "atmo-clear-golden", "atmo-clear-day",
      "atmo-cloudy", "atmo-rain", "atmo-storm", "atmo-fog"
    );
    if (t) document.body.classList.add(t);
  }, token);
}

test("reactive glass on: the atmo token retunes the glass tokens", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceReactiveGlass(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body.classList.contains("reactive-glass"));

  // No token → the base glass (variables.css) stands untouched.
  await setAtmo(page, null);
  expect(await readGlassVar(page, "--glass-blur")).toBe("blur(18px)brightness(.87)");

  // Rain cools and darkens the glass; the sheen goes cool.
  await setAtmo(page, "atmo-rain");
  expect(await readGlassVar(page, "--glass-blur")).toBe("blur(18px)brightness(.8)");
  expect(await readGlassVar(page, "--glass-sheen")).toContain("rgba(190,214,245,.11)");

  // Storm darker still.
  await setAtmo(page, "atmo-storm");
  expect(await readGlassVar(page, "--glass-blur")).toBe("blur(18px)brightness(.74)");

  // Golden hour warms border + sheen but never touches the blur.
  await setAtmo(page, "atmo-clear-golden");
  expect(await readGlassVar(page, "--glass-border")).toContain("rgba(255,205,150,.16)");
  expect(await readGlassVar(page, "--glass-blur")).toBe("blur(18px)brightness(.87)");

  // Night adds the faint cool glow to the shadow.
  await setAtmo(page, "atmo-night");
  expect(await readGlassVar(page, "--glass-shadow")).toContain("rgba(90,140,220,.07)");

  expect(pageErrors).toEqual([]);
});

test("reactive glass on: a lightning strike pulses the sheen then releases", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceReactiveGlass(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => document.body.classList.contains("reactive-glass"));
  await page.waitForFunction(() => typeof window.__forceAtmoEpisode === "function");

  const type = await page.evaluate(() => window.__forceAtmoEpisode("lightning"));
  expect(type).toBe("lightning");

  // The strike lands synchronously: the pulse class is on and the sheen glints.
  await page.waitForFunction(() => document.body.classList.contains("fx-lightning-active"));
  expect(await readGlassVar(page, "--glass-sheen")).toContain("rgba(222,236,255,.32)");

  // Episode over (≤ 4s + settle) → pulse released, base sheen restored.
  await page.waitForFunction(() => window.__atmoFx().running === null, null, { timeout: 10_000 });
  expect(await page.evaluate(() => document.body.classList.contains("fx-lightning-active"))).toBe(false);
  expect(await readGlassVar(page, "--glass-sheen")).toContain("rgba(255,255,255,.07)");

  expect(pageErrors).toEqual([]);
});

test("reactive glass off (default): no body class, tokens and strikes leave the glass alone", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await forceReactiveGlass(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__forceAtmoEpisode === "function");

  expect(await page.evaluate(() => document.body.classList.contains("reactive-glass"))).toBe(false);

  const before = await readGlassVar(page, "--glass-blur");
  await setAtmo(page, "atmo-storm");
  expect(await readGlassVar(page, "--glass-blur")).toBe(before); // flag-off: storm changes nothing

  // Strikes never touch the body class when the flag is off.
  await page.evaluate(() => window.__forceAtmoEpisode("lightning"));
  expect(await page.evaluate(() => document.body.classList.contains("fx-lightning-active"))).toBe(false);
  await page.waitForFunction(() => window.__atmoFx().running === null, null, { timeout: 10_000 });
  expect(await page.evaluate(() => document.body.classList.contains("fx-lightning-active"))).toBe(false);

  expect(pageErrors).toEqual([]);
});
