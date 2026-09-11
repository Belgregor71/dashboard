import { test, expect } from "@playwright/test";
import { rainLevel, causeOverrideFor, RAIN_LEVEL, STRIKE_MS } from "../src/v3/core/atmosphere-fx.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE LIVING WINDOW — three competing directions (design arc, step 2).

   One host, three renderers, each behind its own default-off flag:
     v3AtmoOverlay  A · a layer above the card and mat, below all text
     v3AtmoGrade    B · the mat and the card's grade move
     v3AtmoMat      C · the mat opens onto the live substrate

   What is asserted, and the wrong answer each one names:
     · all off: nothing — no attribute, node, handle, restyle  → a direction
       leaking into the shipped wall
     · A rains only while it rains, and stops                  → a pane that
       animates on a dry day (§5.1 cause test), or never stops
     · A sits between the archive and the stage                → weather over text
     · a strike is one-shot and its timer cleans it up         → a flash left on
     · B's mat turns cool in rain and warm at dusk, and darker, never lighter
     · C opens the mat, hides the full-bleed copy, and keeps the field running
       — and a forced probe reaches the substrate as a CAUSE, which A's must not
   Painted values are read with transitions off; the stylesheet's 20 s/60 s
   eases are the look, not the claim.
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

  test("a probe becomes substrate causes only for what the substrate can draw", () => {
    expect(causeOverrideFor(null)).toBeNull();
    expect(causeOverrideFor({ rain: "heavy" })).toEqual({ category: "rain", intensity: "heavy" });
    expect(causeOverrideFor({ warmth: 0.8 })).toEqual({ sunAltitudeDeg: 1 });
    // Thunder is a strike, which is a stylesheet one-shot — not a cause.
    expect(causeOverrideFor({ thunder: true })).toBeNull();
  });
});

const MIDDAY = new Date("2026-09-11T02:00:00Z"); // local noon in Brisbane (+10)

async function boot(page, flags = {}) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.clock.setFixedTime(MIDDAY);
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) +
      Object.entries(flags).map(([k, v]) => `\nwindow.CONFIG.features.${k} = ${JSON.stringify(v)};`).join("");
    await route.fulfill({ response: res, body });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  // The eases are the look; the claims are about the values they ease toward.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  return errors;
}

const ALL_OFF = { v3AtmoOverlay: false, v3AtmoGrade: false, v3AtmoMat: false };

test("every direction off: the wall that shipped — no attribute, node, handle or restyle", async ({ page }) => {
  const errors = await boot(page, ALL_OFF);
  const r = await page.evaluate(() => {
    const root = document.documentElement;
    const archive = document.querySelector(".archive");
    const probe = document.createElement("div");
    probe.style.background = "var(--surface)";
    document.body.appendChild(probe);
    const surface = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      archiveOn: root.dataset.archive ?? null,
      atmo: root.dataset.atmo ?? null,
      overlay: document.querySelectorAll(".atmo-overlay").length,
      handle: typeof window.__v3Atmo,
      rainVar: root.style.getPropertyValue("--atmo-rain"),
      archiveBg: archive ? getComputedStyle(archive).backgroundColor : null,
      surface,
      photoVis: getComputedStyle(document.querySelector(".photo")).visibility
    };
  });
  // The archive must be there for "its mat is untouched" to mean anything.
  expect(r.archiveOn).toBe("1");
  expect(r.archiveBg).not.toBeNull();
  expect(r.atmo).toBeNull();
  expect(r.overlay).toBe(0);
  expect(r.handle).toBe("undefined");
  expect(r.rainVar).toBe("");
  expect(r.archiveBg).toBe(r.surface);
  expect(r.photoVis).toBe("visible");
  expect(errors).toEqual([]);
});

/* ── A · the overlay ───────────────────────────────────────────────────────── */

const rainPane = () => {
  const el = document.querySelector(".atmo-overlay__rain");
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { display: cs.display, anim: cs.animationName, opacity: Number(cs.opacity) };
};

test("A rains only while it rains — a dry wall runs no animation, and the pane stops again", async ({ page }) => {
  const errors = await boot(page, { ...ALL_OFF, v3AtmoOverlay: true });
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

test("A sits above the card and the mat, and below every word", async ({ page }) => {
  await boot(page, { ...ALL_OFF, v3AtmoOverlay: true });
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
  const errors = await boot(page, { ...ALL_OFF, v3AtmoOverlay: true });
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

/* ── B · the grade ─────────────────────────────────────────────────────────── */

const matColour = () => {
  const bg = getComputedStyle(document.querySelector(".archive")).backgroundColor;
  const m = bg.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  return m ? { raw: bg, l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) } : { raw: bg };
};

test("B turns the mat cool and a shade darker in rain, and warm at dusk", async ({ page }) => {
  const errors = await boot(page, { ...ALL_OFF, v3AtmoGrade: true });
  const dry = await page.evaluate(matColour);
  expect(dry.l, `unparsed mat colour: ${dry.raw}`).toBeDefined();

  await page.evaluate(() => window.__v3Atmo.force({ rain: "heavy" }));
  const wet = await page.evaluate(matColour);
  expect(wet.h).toBeCloseTo(235, 0);
  expect(wet.l).toBeLessThan(dry.l);

  await page.evaluate(() => window.__v3Atmo.force({ warmth: 1 }));
  const dusk = await page.evaluate(matColour);
  expect(dusk.h).toBeCloseTo(48, 0);
  expect(dusk.c).toBeGreaterThan(dry.c);
  // Dusk moves the hue, never the lightness — contrast on the mat is untouched.
  expect(dusk.l).toBeCloseTo(dry.l, 3);

  await page.evaluate(() => window.__v3Atmo.force(null));
  expect((await page.evaluate(matColour)).raw).toBe(dry.raw);
  expect(errors).toEqual([]);
});

test("B's strike lights the whole archive at once", async ({ page }) => {
  await boot(page, { ...ALL_OFF, v3AtmoGrade: true });
  await page.evaluate(() => window.__v3Atmo.strike());
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".archive")).animationName))
    .toBe("atmo-grade-strike");
});

/* ── C · the mat as a window ───────────────────────────────────────────────── */

const matState = () => {
  const archive = getComputedStyle(document.querySelector(".archive"));
  return {
    depth: document.documentElement.dataset.depth,
    archiveBg: archive.backgroundColor,
    photo: getComputedStyle(document.querySelector(".photo")).visibility,
    scrim: getComputedStyle(document.querySelector(".scrim")).visibility,
    why: window.__v3().substratePause,
    paused: window.__substrate?.().paused ?? null
  };
};

test("C opens the mat, hides the full-bleed copy, and keeps the field running", async ({ page }) => {
  const errors = await boot(page, { ...ALL_OFF, v3AtmoMat: true, v3SubstrateCoveredPause: true });
  const at0 = await page.evaluate(matState);
  expect(at0.paused, "no substrate").not.toBeNull();
  expect(at0.depth).toBe("0");
  // A part-transparent mat: the computed colour carries an alpha below 1.
  expect(at0.archiveBg).toMatch(/\/\s*0?\.4[0-9]*\)$/);
  expect(at0.photo).toBe("hidden");
  expect(at0.scrim).toBe("hidden");
  // The cover-pause stands aside: the field is what this direction shows.
  expect(at0.why.covered).toBe(false);
  expect(at0.paused).toBe(false);

  // Above depth 0 the photograph is the ground again, exactly as today.
  await page.evaluate(() => window.__setDepth(1, "test"));
  const at1 = await page.evaluate(matState);
  expect(at1.photo).toBe("visible");
  expect(at1.scrim).toBe("visible");
  expect(errors).toEqual([]);
});

test("C's probe reaches the substrate as a cause; A's does not", async ({ page }) => {
  // Still air, no rain (every /api is a 503): the field is drawn once and idle.
  await boot(page, { ...ALL_OFF, v3AtmoMat: true });
  expect(await page.evaluate(() => window.__substrate().animating)).toBe(false);
  await page.evaluate(() => window.__v3Atmo.force({ rain: "heavy" }));
  // Rain is a moving cause — the loop starts because the substrate was TOLD.
  expect(await page.evaluate(() => window.__substrate().animating)).toBe(true);
});

test("…and A's forced rain leaves the substrate alone", async ({ page }) => {
  await boot(page, { ...ALL_OFF, v3AtmoOverlay: true, v3SubstrateCoveredPause: false });
  expect(await page.evaluate(() => window.__substrate().animating)).toBe(false);
  await page.evaluate(() => window.__v3Atmo.force({ rain: "heavy" }));
  expect(await page.evaluate(() => window.__substrate().animating)).toBe(false);
});

test("C's strike brightens the field itself", async ({ page }) => {
  await boot(page, { ...ALL_OFF, v3AtmoMat: true });
  await page.evaluate(() => window.__v3Atmo.strike());
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".substrate")).animationName))
    .toBe("atmo-mat-strike");
});
