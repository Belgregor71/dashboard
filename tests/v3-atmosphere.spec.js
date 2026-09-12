import { test, expect } from "@playwright/test";
import { rainLevel, RAIN_LEVEL, STRIKE_MS } from "../src/v3/core/atmosphere-fx.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE LIVING WINDOW — the overlay (features.v3AtmoOverlay).

   One layer at z4: above the archive card and its mat, below every word. Rain
   is a tiled texture moved by a compositor-only keyframe; the strike is the
   incumbent's 1.6 s curve; the warmth is a wash from above.

   Chosen on the wall 2026-09-12 over two other directions (the grade; the mat
   opened onto the substrate), both deleted on merge — the numbers that decided
   it are in docs/design/LIVING-WINDOW-VARIANTS.md.

   What is asserted, and the wrong answer each one names:
     · flag off: no attribute, node, handle or restyle  → a layer leaking onto
       the shipped wall
     · it rains only while it rains, and stops again    → a pane that animates
       on a dry day (§5.1's cause test), or one that never stops
     · it sits between the archive and the stage        → weather over text
     · a strike is one-shot and a TIMER removes it      → a flash left burning
       (animationend never fires under display:none)
     · forcing rain does not touch the substrate        → the overlay quietly
       driving the field as well
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe("the host's arithmetic", () => {
  test("rain is a level only while it rains or storms", () => {
    expect(rainLevel(null)).toBe(0);
    expect(rainLevel({ category: "clear", intensity: null })).toBe(0);
    expect(rainLevel({ category: "cloudy", intensity: "heavy" })).toBe(0);
    expect(rainLevel({ category: "rain", intensity: "moderate" })).toBe(RAIN_LEVEL.moderate);
    expect(rainLevel({ category: "storm", intensity: "heavy" })).toBe(RAIN_LEVEL.heavy);
    expect(rainLevel({ category: "rain", intensity: null })).toBe(RAIN_LEVEL.moderate);
  });
});

const MIDDAY = new Date("2026-09-11T02:00:00Z"); // local noon in Brisbane (+10)

async function boot(page, on) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.clock.setFixedTime(MIDDAY);
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()) + `\nwindow.CONFIG.features.v3AtmoOverlay = ${on};\n` });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  // The eases are the look; the claims are about the values they ease toward.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  return errors;
}

const rainPane = () => {
  const el = document.querySelector(".atmo-overlay__rain");
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { display: cs.display, anim: cs.animationName, opacity: Number(cs.opacity) };
};

test("flag off: the wall that shipped — no attribute, node, handle or restyle", async ({ page }) => {
  const errors = await boot(page, false);
  const r = await page.evaluate(() => {
    const root = document.documentElement;
    const archive = document.querySelector(".archive");
    return {
      archiveOn: root.dataset.archive ?? null,
      atmo: root.dataset.atmo ?? null,
      overlay: document.querySelectorAll(".atmo-overlay").length,
      handle: typeof window.__v3Atmo,
      rainVar: root.style.getPropertyValue("--atmo-rain"),
      archiveBg: archive ? getComputedStyle(archive).backgroundColor : null,
      photoVis: getComputedStyle(document.querySelector(".photo")).visibility
    };
  });
  // The archive must be there for "nothing was restyled" to mean anything.
  expect(r.archiveOn).toBe("1");
  expect(r.archiveBg).not.toBeNull();
  expect(r.atmo).toBeNull();
  expect(r.overlay).toBe(0);
  expect(r.handle).toBe("undefined");
  expect(r.rainVar).toBe("");
  expect(r.photoVis).toBe("visible");
  expect(errors).toEqual([]);
});

test("it rains only while it rains — a dry wall runs no animation, and the pane stops again", async ({ page }) => {
  const errors = await boot(page, true);
  expect(await page.evaluate(() => document.documentElement.dataset.atmo)).toBe("overlay");

  const dry = await page.evaluate(rainPane);
  expect(dry, "no rain pane was built").not.toBeNull();
  expect(dry.display).toBe("none");
  expect(dry.anim).toBe("none");

  await page.evaluate(() => window.__v3Atmo.force({ rain: "moderate" }));
  const wet = await page.evaluate(rainPane);
  expect(wet.display).toBe("block");
  expect(wet.anim).toBe("atmo-fall");
  expect(wet.opacity).toBeCloseTo(RAIN_LEVEL.moderate * 0.6, 2); // midday: amp 1

  await page.evaluate(() => window.__v3Atmo.force(null));
  const after = await page.evaluate(rainPane);
  expect(after.display).toBe("none");
  expect(after.anim).toBe("none");
  expect(errors).toEqual([]);
});

test("it sits above the card and the mat, and below every word", async ({ page }) => {
  await boot(page, true);
  const z = await page.evaluate(() => {
    const zOf = (sel) => {
      const el = document.querySelector(sel);
      return el ? Number(getComputedStyle(el).zIndex) : null;
    };
    return { overlay: zOf(".atmo-overlay"), archive: zOf(".archive"), caption: zOf(".ground-caption"), stage: zOf(".stage") };
  });
  expect(z.overlay, "no overlay layer").not.toBeNull();
  expect(z.overlay).toBeGreaterThan(z.archive);
  expect(z.overlay).toBeLessThan(z.caption);
  expect(z.overlay).toBeLessThan(z.stage);
});

test("a strike is one-shot, and a timer — not animationend — takes it down", async ({ page }) => {
  const errors = await boot(page, true);
  await page.evaluate(() => window.__v3Atmo.strike());
  const during = await page.evaluate(() => ({
    attr: document.documentElement.dataset.atmoStrike ?? null,
    anim: getComputedStyle(document.querySelector(".atmo-overlay__flash")).animationName
  }));
  expect(during).toEqual({ attr: "1", anim: "atmo-strike" });
  await page.waitForTimeout(STRIKE_MS + 400);
  expect(await page.evaluate(() => document.documentElement.dataset.atmoStrike ?? null)).toBeNull();
  expect(await page.evaluate(() => window.__v3Atmo().striking)).toBe(false);
  expect(errors).toEqual([]);
});

test("forced rain is drawn on the layer and NOT by the substrate", async ({ page }) => {
  // Still air, no rain (every /api is a 503): the field is drawn once and idle.
  await boot(page, true);
  expect(await page.evaluate(() => window.__substrate().animating)).toBe(false);
  await page.evaluate(() => window.__v3Atmo.force({ rain: "heavy" }));
  // The pane is raining…
  expect((await page.evaluate(rainPane)).display).toBe("block");
  // …and the field never woke up: the overlay owns the weather on this surface.
  expect(await page.evaluate(() => window.__substrate().animating)).toBe(false);
});
