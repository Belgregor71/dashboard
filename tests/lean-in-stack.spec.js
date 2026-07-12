import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Design study 01 "The Lean-in stack" (docs/design/homeos-component-studies.html),
 * WP2 of docs/design/PLAN.md.
 *
 * With features.leanInStack ON, the DWELL stack cards carry the full 5-token
 * glass system together: the #focus-stack gets .lean-in-glass and each
 * .focus-stack__item composites a gradient + backdrop blur + shadow/inset sheen
 * (on top of the border + radius the base rule already sets). OFF (default) is
 * byte-identical: flat cards, no .lean-in-glass, no backdrop blur.
 *
 * The reveal/collapse contract (DWELL → 3, GLANCE → 1) is unchanged — glass is
 * a restyle of the cards renderStack already produces, not a new path.
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// Pin a deterministic daytime so isNight() is false and the screensaver does
// not auto-engage at boot (it would hide the stack). Mirrors presence.spec.
const MIDDAY = new Date("2026-07-06T12:00:00");

function enableFlags(leanIn) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body =
        (await res.text()) +
        "\nwindow.CONFIG.features.presenceRuntime = true;" +
        "\nwindow.CONFIG.features.attentionEngine = true;" +
        `\nwindow.CONFIG.features.leanInStack = ${leanIn};\n`;
      await route.fulfill({ response: res, body });
    });
}

// The three non-interrupt candidates the DWELL reveal lays out (hero + 2-stack).
function stageCandidates(page) {
  return page.evaluate(() => {
    window.__forceCandidate([
      { id: "t-a", source: "test", score: 70, icon: "🅰", text: "Alpha", cooldownMs: 0 },
      { id: "t-b", source: "test", score: 60, icon: "🅱", text: "Bravo", cooldownMs: 0 },
      { id: "t-c", source: "test", score: 55, icon: "🅲", text: "Charlie", cooldownMs: 0 }
    ]);
  });
}

test("lean-in on: DWELL stack cards carry the full glass; GLANCE collapses to 1", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(true)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(
    () =>
      typeof window.__attention === "function" &&
      typeof window.__forceCandidate === "function" &&
      typeof window.__leanInStack === "function"
  );
  await stageCandidates(page);

  await page.evaluate(() => window.__presence("dwell"));
  await expect.poll(() => page.evaluate(() => window.__attention().stack.length)).toBe(3);

  const stack = page.locator("#focus-stack");
  await expect(stack).toHaveClass(/lean-in-glass/);
  await expect(stack).not.toHaveClass(/is-hidden/);
  expect(await page.locator("#focus-stack .focus-stack__item").count()).toBe(2);

  // The five tokens travel together: shadow+sheen and the backdrop blur are the
  // two the base flat rule does not carry — assert both landed on the cards.
  const probe = await page.evaluate(() => window.__leanInStack());
  expect(probe.enabled).toBe(true);
  expect(probe.marked).toBe(true);
  expect(probe.items).toBe(2);
  expect(probe.boxShadow).not.toBe("none");
  expect(probe.backdropFilter).toContain("blur");

  // Reveal/collapse contract unchanged: GLANCE drops to the single hero.
  await page.evaluate(() => window.__presence("glance"));
  await expect.poll(() => page.evaluate(() => window.__attention().stack.length)).toBe(1);
  await expect(stack).toHaveClass(/is-hidden/);

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});

test("lean-in off: DWELL stack cards stay flat (byte-identical)", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await enableFlags(false)(page);
  await page.clock.setFixedTime(MIDDAY);

  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__attention === "function" && typeof window.__forceCandidate === "function"
  );
  await stageCandidates(page);

  await page.evaluate(() => window.__presence("dwell"));
  await expect.poll(() => page.evaluate(() => window.__attention().stack.length)).toBe(3);

  await expect(page.locator("#focus-stack")).not.toHaveClass(/lean-in-glass/);
  const backdrop = await page.evaluate(() => {
    const item = document.querySelector("#focus-stack .focus-stack__item");
    const cs = getComputedStyle(item);
    return cs.backdropFilter || cs.webkitBackdropFilter;
  });
  expect(backdrop).toBe("none");
  expect(await page.evaluate(() => typeof window.__leanInStack)).toBe("undefined");

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
});
