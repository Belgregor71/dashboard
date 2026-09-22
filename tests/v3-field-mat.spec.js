import { test, expect } from "@playwright/test";

/* ═══════════════════════════════════════════════════════════════════════════
   THE FIELD AS THE MATTING — features.v3FieldMat.

   At depth 0 the archive paints an opaque `--surface` over the whole wall and
   the WebGL field one layer under it is deliberately PAUSED. Read off the live
   G11 on 2026-09-22, in the wall's own default state: `paused: true`, with the
   mat computing `oklch(0.16 0.012 65)` over it. This flag hands the matting to
   the field.

   What this file is here to catch, in the order the defects would actually
   happen:

     · the mat goes transparent but the field stays PAUSED  → a black rectangle
     · the mat goes transparent but the ground stays up     → the same
                                                               photograph twice
     · the `background` SHORTHAND is used                   → the night sky's
                                                               stars silently
                                                               deleted
     · narrowing "covered" eats the DARK-PANEL reason too   → a field animating
                                                               at 15fps all
                                                               night for nobody
     · reduced motion                                       → the archive is
                                                               display:none
                                                               there, so a
                                                               hidden ground
                                                               means NO
                                                               photograph at all
     · reduced motion                                       → the rAF loop is
                                                               not reachable
                                                               from a @media
                                                               block and ran
                                                               regardless until
                                                               2026-09-22

   Flag off must be indistinguishable from before the flag existed — that is
   what makes it a real rollback rather than a preference.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-09-11T02:00:00Z"); // local noon in Brisbane (+10)

/* A real reading, so `toCauses` produces a wind the field will actually move
   for. The default 503 stub leaves wind at 0, and `moving()` is false there —
   which would make "it does not animate" pass for want of a cause rather than
   because of the preference under test. */
const WINDY = {
  now: {
    wind_kph: 40,
    wind_bearing: 180,
    cloud_pct: 50,
    temp_c: 21,
    condition: { code: 0, icon: "clear", intensity: null, label: "Clear" }
  }
};

async function bootV3(page, flags, { weather = null } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(MIDDAY);
  /* ⚠ ORDER IS LOad-BEARING: page.route matches the LAST-REGISTERED handler
     first, so the catch-all goes FIRST and the specific weather stub LAST.
     Registered the other way round the 503 swallows the reading, wind stays 0,
     and `moving()` is false — which makes the reduced-motion test below pass
     for want of a cause rather than because of the preference it is testing.
     That is exactly what happened on the first run of this file. */
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  if (weather) {
    await page.route("**/api/weather/now", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(weather) })
    );
  }
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) +
      Object.entries(flags).map(([k, v]) => `\nwindow.CONFIG.features.${k} = ${JSON.stringify(v)};`).join("");
    await route.fulfill({ response: res, body });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

/* Computed values, never attributes. The attribute says the flag is on; only
   the computed style says the wall changed. */
const read = () => {
  const cs = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el) : null;
  };
  const archive = cs(".archive");
  const photo = cs(".photo");
  const scrim = cs(".scrim");
  const s = window.__substrate?.() ?? null;
  return {
    present: { archive: Boolean(archive), photo: Boolean(photo), scrim: Boolean(scrim) },
    depth: document.documentElement.dataset.depth ?? null,
    archiveAttr: document.documentElement.dataset.archive ?? null,
    matAttr: document.documentElement.dataset.fieldMat ?? null,
    matColor: archive ? archive.backgroundColor : null,
    matImage: archive ? archive.backgroundImage : null,
    archiveDisplay: archive ? archive.display : null,
    photoVis: photo ? photo.visibility : null,
    scrimVis: scrim ? scrim.visibility : null,
    photoImgs: document.querySelectorAll(".photo img").length,
    why: window.__v3().substratePause ?? null,
    paused: s ? s.paused : null,
    animating: s ? s.animating : null,
    frames: s ? s.frames : null,
    inkGuard: s ? s.inkGuard : null
  };
};

/* The strength main.js sends when the mat is live. Deliberately NOT imported:
   a spec that imports the constant it checks cannot notice the constant
   changing, which is how the sun-clock and scrim specs went blind. */
const GUARD_ON = 0.7;

const TRANSPARENT = "rgba(0, 0, 0, 0)";

test("flag ON: the mat is the field — transparent, ground down, and the field is LIVE", async ({ page }) => {
  const errors = await bootV3(page, { v3FieldMat: true, v3SubstrateCoveredPause: true, v3Archive: true });
  const r = await page.evaluate(read);

  // The nodes must be there before their state means anything. An absent
  // .archive reports null for every question below and satisfies all of them.
  expect(r.present, "a node under test is missing").toEqual({ archive: true, photo: true, scrim: true });
  expect(r.depth).toBe("0");
  expect(r.archiveAttr).toBe("1");
  expect(r.matAttr).toBe("1");

  expect(r.matColor, "the mat is still opaque — the field cannot be seen").toBe(TRANSPARENT);
  expect(r.photoVis, "the full-bleed ground is still up — the photograph would show twice").toBe("hidden");
  expect(r.scrimVis).toBe("hidden");

  // 🔑 The half that makes it a window rather than a black rectangle.
  expect(r.why).toEqual({ dark: false, covered: false });
  expect(r.paused).toBe(false);
  expect(r.frames, "the field is unpaused but has never drawn").toBeGreaterThan(0);

  /* The ink guard reaches the shader. Without it the sweep measured the 168px
     hour at 1.61:1 over a lit midday field, so this number is the difference
     between a legible wall and an illegible one — it is not a detail. */
  expect(r.inkGuard, "the field is the mat but the shader was told to guard nothing").toBe(GUARD_ON);
  expect(errors).toEqual([]);
});

test("flag OFF: byte-for-byte the wall as it was — opaque mat, ground up, field paused", async ({ page }) => {
  const errors = await bootV3(page, { v3FieldMat: false, v3SubstrateCoveredPause: true, v3Archive: true });
  const r = await page.evaluate(read);

  expect(r.present).toEqual({ archive: true, photo: true, scrim: true });
  expect(r.matAttr, "the root marker survives the flag being off").toBeNull();
  expect(r.matColor).not.toBe(TRANSPARENT);
  expect(r.photoVis).toBe("visible");
  expect(r.scrimVis).toBe("visible");
  expect(r.why).toEqual({ dark: false, covered: true });
  expect(r.paused).toBe(true);
  /* The other direction, and it is the half that matters: a guard applied
     unconditionally would darken the field on every surface that shows it,
     for a mat that is not live. One direction is half a test. */
  expect(r.inkGuard, "the field is guarding text it is not behind").toBe(0);
  expect(errors).toEqual([]);
});

test("⚠ the night sky SURVIVES — background-color, never the `background` shorthand", async ({ page }) => {
  const errors = await bootV3(page, { v3FieldMat: true, v3SubstrateCoveredPause: true, v3Archive: true });

  /* The stars are painted onto `.archive` itself as a background-IMAGE
     (css/atmosphere.css, the night sky). Forced here rather than driven through
     a clear night and the whole weather pipeline, because the hazard is a CSS
     cascade one and this states it directly: if the mat rule ever becomes the
     `background` shorthand, the image resets to `none` and this goes red. */
  const r = await page.evaluate(() => {
    const root = document.documentElement;
    root.dataset.atmo = "overlay";
    root.dataset.atmoNightSky = "1";
    root.style.setProperty("--atmo-stars", "url(data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)");
    const cs = getComputedStyle(document.querySelector(".archive"));
    return { image: cs.backgroundImage, color: cs.backgroundColor };
  });

  expect(r.image, "the starfield was deleted by a background shorthand").toContain("url(");
  expect(r.image).not.toBe("none");
  // ...and the mat is still transparent, so the stars sit on the living field.
  expect(r.color).toBe(TRANSPARENT);
  expect(errors).toEqual([]);
});

test("⚠ narrowing `covered` did NOT eat the dark-panel reason", async ({ page }) => {
  const errors = await bootV3(page, {
    v3FieldMat: true, v3SubstrateCoveredPause: true, v3Archive: true, v3EnergySaver: true
  });
  expect((await page.evaluate(read)).paused).toBe(false);

  // 21:00. A transparent mat in front of a powered-down panel is still nothing
  // anyone can see, and a field animating for it all night is the exact waste
  // the panel pause exists to stop.
  await page.evaluate(() => window.__v3PanelDark(true));
  const dark = await page.evaluate(read);
  expect(dark.why).toEqual({ dark: true, covered: false });
  expect(dark.paused).toBe(true);

  // 05:00.
  await page.evaluate(() => window.__v3PanelDark(false));
  expect((await page.evaluate(read)).paused).toBe(false);
  expect(errors).toEqual([]);
});

test("leaving depth 0 brings the photograph back, and returning hands the mat over again", async ({ page }) => {
  const errors = await bootV3(page, { v3FieldMat: true, v3SubstrateCoveredPause: true, v3Archive: true });
  expect((await page.evaluate(read)).photoVis).toBe("hidden");

  await page.evaluate(() => window.__setDepth(1, "test"));
  const up = await page.evaluate(read);
  expect(up.depth).toBe("1");
  expect(up.photoVis, "the ground never came back — depth 1 has no photograph").toBe("visible");
  expect(up.paused).toBe(false);

  await page.evaluate(() => window.__setDepth(0, "test"));
  const back = await page.evaluate(read);
  expect(back.photoVis).toBe("hidden");
  expect(back.matColor).toBe(TRANSPARENT);
  expect(back.paused).toBe(false);
  expect(errors).toEqual([]);
});

test.describe("reduced motion", () => {
  /* ⚠ `test.use({ reducedMotion })` DOES NOT REACH THE PAGE in this repo's
     Playwright — matchMedia stays false and every negative assertion below
     would pass against a browser with no such preference. emulateMedia works,
     and the preference is asserted before anything is concluded from it. */
  const emulate = async (page) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
      "the emulation never landed — every assertion below would be vacuous"
    ).toBe(true);
  };

  test("⚠ the archive stands down, so the PHOTOGRAPH must come back", async ({ page }) => {
    const errors = await bootV3(page, { v3FieldMat: true, v3SubstrateCoveredPause: true, v3Archive: true });
    await emulate(page);
    const r = await page.evaluate(read);

    // data-archive is still "1" here — it says the flag is on, not that the
    // surface is painting — so the mat rules still match while .archive is gone.
    expect(r.archiveAttr).toBe("1");
    expect(r.archiveDisplay).toBe("none");
    expect(r.photoVis, "no archive AND no ground: the wall has no photograph at all").toBe("visible");
    expect(r.scrimVis).toBe("visible");
    expect(r.photoImgs, "nothing to show even if it were visible").toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("⚠ the field PAINTS but does not LOOP — a @media block cannot reach a rAF loop", async ({ page }) => {
    const errors = await bootV3(
      page,
      { v3FieldMat: true, v3SubstrateCoveredPause: true, v3Archive: true },
      { weather: WINDY }
    );

    // Positive control FIRST, in the same page, with the same wind: without the
    // preference this field really does loop. Without this half, "it does not
    // animate" is satisfied by a cause that was never there.
    await page.waitForFunction(() => window.__substrate?.()?.animating === true);
    const moving = await page.evaluate(read);
    expect(moving.animating).toBe(true);

    await emulate(page);
    // Nudge the causes so moving() is re-asked; the preference alone does not
    // interrupt a loop that is already scheduled.
    await page.evaluate(() => window.__setDepth(1, "test"));
    await page.evaluate(() => window.__setDepth(0, "test"));
    await page.waitForFunction(() => window.__substrate?.()?.animating === false);

    const still = await page.evaluate(read);
    expect(still.animating, "the rAF loop ignored the preference").toBe(false);
    // Still PAINTED: the weather is information, and a still field showing rain
    // is the reduced-motion answer, not a blank one.
    expect(still.paused, "reduced motion is not a pause").toBe(false);
    expect(still.frames).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
