import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design-system rollout WP-C (docs/design/DESIGN_ROLLOUT.md) — the un-chromed hero.
 *
 * With features.bareHero ON, <body> gets .bare-hero: the #focus-hero container box
 * is stripped (no background/border) and the line is fixed-centred; the idle
 * concierge fallback carries a .concierge class so it renders matte (no glyph
 * glow, lower ink). The stack is bottom-anchored. OFF (default) is byte-identical.
 *
 * Driven through the attention hooks (presence + attention on) so we can force a
 * scored hero vs the concierge fallback deterministically.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

const MIDDAY = new Date("2026-07-06T12:00:00");

function enableFlags(bareHero) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        "\nwindow.CONFIG.features.presenceRuntime = true;" +
        "\nwindow.CONFIG.features.attentionEngine = true;" +
        `\nwindow.CONFIG.features.bareHero = ${bareHero};\n`;
      await route.fulfill({ response: res, body });
    });
}

test("bare hero on: container stripped, scored glyph glows, concierge goes matte", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__attention === "function" && typeof window.__forceCandidate === "function"
  );

  await expect(page.locator("body")).toHaveClass(/bare-hero/);

  // A scored hero: the container box is gone and the glyph carries the glow.
  await page.evaluate(() => {
    window.__forceCandidate([{ id: "t-a", source: "test", score: 80, icon: "🌧️", text: "Rain soon", cooldownMs: 0 }]);
    window.__presence("dwell");
  });
  await expect.poll(() => page.evaluate(() => window.__attention().hero?.id)).toBe("t-a");
  const hero = page.locator("#focus-hero");
  await expect(hero).not.toHaveClass(/is-hidden/);
  await expect(hero).not.toHaveClass(/concierge/);

  const scored = await page.evaluate(() => {
    const h = document.getElementById("focus-hero");
    const cs = getComputedStyle(h);
    const glyph = getComputedStyle(document.getElementById("focus-hero-icon"));
    return { bg: cs.backgroundImage, borderTop: cs.borderTopStyle, position: cs.position, glyphFilter: glyph.filter };
  });
  expect(scored.bg).toBe("none");          // no glass gradient behind the line
  expect(scored.borderTop).toBe("none");   // no container border
  expect(scored.position).toBe("fixed");   // centred, out of flow
  expect(scored.glyphFilter).toContain("drop-shadow"); // borrowed-light glow

  // The matte concierge variant (the AI upstream is stubbed off in tests, so add
  // the class directly and assert the CSS: lower ink + the glyph loses its glow).
  const matte = await page.evaluate(() => {
    const h = document.getElementById("focus-hero");
    h.classList.add("concierge");
    const text = getComputedStyle(document.getElementById("focus-hero-text")).color;
    const glyph = getComputedStyle(document.getElementById("focus-hero-icon")).filter;
    h.classList.remove("concierge");
    return { text, glyph };
  });
  expect(matte.text).toBe("rgba(238, 243, 251, 0.78)"); // matte ink .78
  expect(matte.glyph).toBe("none");                     // no glow on the concierge glyph

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("bare hero off: container intact, no concierge class (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__forceCandidate === "function");

  await expect(page.locator("body")).not.toHaveClass(/bare-hero/);

  await page.evaluate(() => {
    window.__forceCandidate([{ id: "t-a", source: "test", score: 80, icon: "🌧️", text: "Rain soon", cooldownMs: 0 }]);
    window.__presence("glance");
  });

  const off = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById("focus-hero"));
    return { position: cs.position, hasConcierge: document.getElementById("focus-hero").classList.contains("concierge") };
  });
  expect(off.position).not.toBe("fixed"); // still in flow
  expect(off.hasConcierge).toBe(false);   // no concierge class off-flag

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("the attention surface is scoped to home — hidden on the force-only views", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__forceCandidate === "function" && typeof window.__switchView === "function");

  // A hero is up on home.
  await page.evaluate(() => {
    window.__forceCandidate([{ id: "t-a", source: "test", score: 80, icon: "🌧️", text: "Rain soon", cooldownMs: 0 }]);
    window.__presence("dwell");
  });
  await expect.poll(() => page.evaluate(() => window.__attention().hero?.id)).toBe("t-a");
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("focus-hero")).display)).not.toBe("none");

  // Force-navigate to the status view: the hero + stack must not bleed over it.
  await page.evaluate(() => window.__switchView("status", { force: true }));
  await expect.poll(() => page.evaluate(() => document.body.dataset.view)).toBe("status");
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("focus-hero")).display)).toBe("none");
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("focus-stack")).display)).toBe("none");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
