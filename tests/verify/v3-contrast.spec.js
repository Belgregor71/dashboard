import { test, expect } from "../fixtures/coverage.js";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { encodePng } from "../fixtures/png.js";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE V3 CONTRAST SWEEP — worst-case text legibility on the parallel surface.
 *
 * tests/verify/contrast.spec.js only ever visits `/`. That was a small gap when
 * V3 was an hour and one line; Phase 4 put eight depth-3 subjects on it — a
 * title, six rows, nine captioned photographs, prose — none of which any gate
 * has ever measured. This closes that.
 *
 * ── Why this is not the incumbent's sweep pointed at another URL ─────────────
 *
 * The incumbent varies the ATMOSPHERE TOKEN, because its backdrop is a photo
 * lit by a weather-driven tint and the tint is what changes. V3 does not work
 * that way. Its tokens hold L constant and rotate hue only (tokens.css), so a
 * tint change cannot move a contrast ratio. What moves it is
 *
 *   1. THE PHOTOGRAPH, because core/scrim.js SOLVES the scrim opacity per photo,
 *      and
 *   2. DAY vs NIGHT, because the night block redefines all three ink tokens.
 *
 * So the axes here are ground x phase, and the grounds are synthesised rather
 * than drawn from Immich: a sweep whose backdrop is whichever photograph
 * happened to be up is a different number on every run.
 *
 *   white  the bound. Worst case by construction — every real photograph is
 *          darker somewhere. This is the method the 2026-07-17 legibility sweep
 *          used, and it is what found the awake-photo clamp.
 *   sky    the flat veil's trap. Phase 4's subject veil applies the opacity the
 *          sampler solved for the TEXT BAND (the bottom ~46%) across the WHOLE
 *          frame. That carries the guarantee only while the top is no brighter
 *          than the band — a blown sky over a mid-tone foreground is exactly the
 *          photograph where it is not, and it is the commonest photograph there
 *          is.
 *
 * ── What it measures ────────────────────────────────────────────────────────
 *
 * Pixels, the same as the incumbent gate: collect every visible text node's box
 * and resolved colour, hide the glyphs, screenshot, and take the WORST backdrop
 * pixel in each box. Reasoning about the composite would be a guess — there is a
 * canvas substrate, a photograph, a solved gradient scrim and, at depth 3, a
 * flat veil between the ink and the ground.
 *
 * ── The bar ─────────────────────────────────────────────────────────────────
 *
 * WCAG AA is the GATE, matching the incumbent's, because a hard gate has to be
 * a bar everyone agrees on. But every size in V3 clears 24px by design (32px is
 * the documented floor), so AA-large at 3.0:1 is a low bar for a 32" panel read
 * from three metres — and the flip ceremony that lifted the voice rail's ink
 * proved exactly that: it PASSED the gate at 3.72:1 and was gloom on the wall.
 * So V3's own 7:1 target (core/scrim.js CONTRAST_TARGET) is measured and
 * reported alongside, and `__v3ContrastReport` carries the full table out.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before the contrast gate");
  }
});

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

/** V3's own target — see core/scrim.js CONTRAST_TARGET. Reported, not gated. */
const V3_TARGET = 7;

/* ── KNOWN OPEN ─────────────────────────────────────────────────────────────
   Three findings from this sweep's first run are real, are below AA, and are
   NOT bugs to be quietly fixed — each is a decision that costs something the
   owner has to weigh. They are carried here rather than excluded, so that:

     · they cannot be forgotten (they print on every run, with their number),
     · they cannot get WORSE without the gate firing — each carries the measured
       floor, and anything below it fails like any other regression, and
     · a NEW failure on the same node is not absorbed by an old excuse.

   ⚠ An entry here is a debt with a ceiling, not a suppression. Delete the row
   when the decision lands; do not raise a floor to make a run go green.

   `floor` is the worst measured across all four ground x phase combinations,
   with a little slack for renderer noise. Numbers taken 2026-08-08 and re-taken
   2026-08-10 against the rewritten MEASURE, which moved the two surviving
   entries by less than 0.1 (nothing is painted over either of them, which is
   the only case the old model got wrong). The third was withdrawn — see below.
─────────────────────────────────────────────────────────────────────────── */
const KNOWN_OPEN = [
  {
    /* MOSTLY PAID 2026-08-10, and the floor is raised to prove it stays paid.
       The scrim solves for the text band at y <= 0.46 and its own comment
       assumes the dominant line "bottom-aligns near y=0.32" — true of ONE line.
       A wrapped 132px line is ~280px tall, so its top reached y=0.59, above the
       band, where no opacity can help because the gradient is transparent by
       0.88 by design.

       The wrapped case now takes a flat veil at the solved opacity
       (compose.css `:has(.said[data-wrapped])`), driven by a Range's line-box
       count rather than the character estimate beside it — 132px holds 20
       characters and SAID_LONG_MAX is 40, so counting could not tell the two
       apart. The glance went 2.59:1 -> 13.59:1, and voice.js stopped writing
       this node's textContent behind setSaidText's back, which is what kept the
       veil off the surface right after it.

       ⚠ WHAT IS LEFT IS THE UNWRAPPED LINE, and it is a different finding
       wearing the same name: a single 132px line IS inside the solved band, and
       still measures 2.83:1 over the synthetic white ground at night, because
       the scrim is clamped at SCRIM_MAX and white is brighter than any
       photograph. That is the clamp being honest, not the band being wrong.
       Floor raised 1.5 -> 2.7 so the veil cannot silently stop working. */
    match: (m) => /^[12]-/.test(m.surface) && (m.selector === "#glance-said" || m.selector.startsWith("p.said")),
    floor: 2.7,
    why: "unwrapped 132px said line over the white bound (the wrapped case is veiled)"
  },
  /* ── CLOSED 2026-08-10: ".presence (z20) composites over .stage (z10)" ──────
     Registered at a floor of 1.15:1 and deleted rather than paid, because the
     defect was in this file. The entry was created from a number MEASURE
     produced by compositing the ink over a backdrop that already contained the
     rim — the ink treated as the last thing painted, when the whole point of
     the finding was that it is not. The rim tints the glyph as well as the
     ground. Same frame, same pixels, measured rather than modelled:

         reported   1.51:1 day / 1.22:1 night
         actual     8.07:1 day / 6.13:1 night
         no rim    12.38:1 day / 9.95:1 night

     So the rim is real and it costs real contrast — a third of it — and it was
     never within reach of AA. It is now reported on every run by the "painted
     OVER" block instead, which names any text with something above it and by
     how much, and the briefing prose measures 12.47:1 there.

     ⚠ The cost of getting this wrong was not the wrong number, it was the
     floor. Registered at 1.15:1, the entry told the gate that anything above
     1.15 was expected — so the most-looked-at prose on the wall could have
     decayed to 1.16:1 and four green runs would have said the debt was held.
     🔑 A debt recorded at a number the surface never occupied is not a debt,
     it is a hole shaped like one. */
  {
    /* MOSTLY PAID 2026-08-10 by lifting the token, which is what this entry
       always said the fix was: --ink-faint's CEILING — its contrast against a
       fully opaque scrim, the best it could ever reach over any photograph at
       any opacity — was 4.29 day / 3.16 night at L 0.55/0.48, so no scrim was
       ever going to be the answer. Lifted to 0.62 in both phases: 2.33 -> 3.12
       by day, 1.72 -> 3.12 at night, ceiling 5.74.

       ⚠ WHAT IS LEFT IS ONLY WHERE THE PRESENCE RIM OVERLAYS IT — `#heard` at
       depth 0 while the house is listening, 2.93:1, about 2% under the bar. The
       lift was calibrated against a backdrop measured without the rim, and this
       is the first time the rim's real cost to a glyph has been measurable at
       all (see the withdrawn entry above). The next 0.02 of token would close it
       and would put faint 0.02 from dim at night, which is the ramp collapsing
       to buy 2% — so it is recorded rather than spent. Floor 1.6 -> 2.8. */
    match: (m) => m.token === "--ink-faint",
    floor: 2.8,
    why: "--ink-faint under the presence rim (the token itself is lifted)"
  }
];

function knownOpen(m) {
  return KNOWN_OPEN.find((k) => k.match(m)) ?? null;
}

/* ── The grounds ────────────────────────────────────────────────────────────
   480x270 is the sampler's resolution problem, not ours: core/scrim.js
   downscales whatever it is given to a 16x9 grid, so a small source is a
   faithful one and costs nothing to encode.
─────────────────────────────────────────────────────────────────────────── */
const GROUND_W = 480;
const GROUND_H = 270;

const GROUNDS = {
  // Worst case by construction. Nothing real is this bright everywhere.
  white: () => [255, 255, 255],
  // A blown sky over a mid-tone foreground: bright where the scrim is thinnest
  // and the subject veil is solved somewhere else.
  sky: (x, y) => {
    const t = y / GROUND_H;
    return [Math.round(250 - 120 * t), Math.round(252 - 108 * t), Math.round(255 - 78 * t)];
  }
};

const PHASES = {
  // Pinned so suncalc lands the same side of the horizon every run — night is
  // driven by sun ALTITUDE in main.js, never by clock time, so the only way to
  // pin the ink set is to pin the sun.
  day: new Date("2026-07-06T12:00:00"),
  night: new Date("2026-07-06T23:30:00")
};

/* ── Fixtures the subjects need ─────────────────────────────────────────────
   Every /api/** is answered by this file. What a subject renders is a function
   of the house's real state, so a sweep that shares one with the developer's
   living room measures a different screen on every machine — the trap
   tests/v3-spread.spec.js paid for on its first run.
─────────────────────────────────────────────────────────────────────────── */
function calToday() {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [
    { title: "Dentist", start: `${ymd}T09:30:00` },
    { title: "Soccer at the Nudgee fields", start: `${ymd}T16:00:00` },
    { title: "Meal: Chicken Fajitas", start: `${ymd}T18:30:00` }
  ];
}

function onThisDay() {
  return {
    assets: Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`,
      localDateTime: `${2017 + i}-08-09T17:57:10.444Z`,
      city: "Nudgee"
    }))
  };
}

const ROUTES = {
  "/api/calendar/all": calToday,
  "/api/immich/random": () => ({ assets: [{ id: "ground-a" }, { id: "ground-b" }] }),
  "/api/immich/on-this-day": onThisDay,
  "/api/plex/sessions": () => ({ sessions: [{ title: "The Bear — Forks", thumb: "/library/art/1" }] }),
  "/api/recipe": () => ({
    title: "Chicken Fajitas",
    servings: "serves 4",
    ingredients: ["2 chicken breasts", "1 red capsicum", "1 brown onion", "8 tortillas"],
    steps: [
      "Slice the chicken and the capsicum into strips.",
      "Fry the chicken hot until it colours, then add the onion.",
      "Warm the tortillas and bring everything to the table."
    ]
  }),
  "/api/ai/brief": () => ({
    summary:
      "A cool start, clearing by lunch and warm by the middle of the afternoon. " +
      "Nothing on the calendar until four. The bins go out tonight, and the green one is due."
  }),
  "/api/weather/radar/meta": () => ({ z: 7, tiles: [{ x: 118, y: 74 }] }),
  /* Phase 6's readout. A degraded feed is included on purpose: a fault's detail
     line is the longest string this surface ever prints, so measuring a
     healthy house would measure the easy case. */
  "/api/system/health": () => ({
    overall: "error",
    updatedAt: Date.now(),
    feeds: [
      { id: "ha", label: "Home Assistant", level: "ok", detail: null },
      { id: "wan", label: "Internet", level: "error", detail: "internet is down" },
      { id: "motion", label: "Motion events", level: "warn", detail: "no success for 26h" },
      { id: "weather", label: "Weather", level: "ok", detail: null },
      { id: "calendar", label: "Calendar", level: "ok", detail: null },
      { id: "cameras", label: "Camera snapshots", level: "ok", detail: null },
      { id: "ai", label: "AI briefings", level: "ok", detail: null },
      { id: "tts", label: "Text-to-speech", level: "ok", detail: null }
    ],
    recoveries: [{ at: Date.now(), kind: "detection-switch", action: "re-armed switch.kitchen_motion_detection", ok: true }]
  }),
  "/api/system/metrics": () => ({
    cpuLoadPercent: 7, cpuCount: 8, uptimeSeconds: 90_000, tempC: 41.2, hostname: "g11"
  })
};

/* Anything image-shaped is served the SAME ground. The camera still, the nine
   plates and the album art are all photographs with text over them, and the
   worst case for each of them is the worst case for the ground. */
const IMAGE_PATH = /\/(thumb|snapshot|live|image|basemap|overlay|art)/;

/* ⚠⚠ FLAGS ARE PINNED ON, NOT INHERITED — and this is a hole this gate has
   already fallen through once. `#ground-caption` renders only behind
   groundMemories. With the flag off the element is EMPTY, COLLECT skips any
   element with no text of its own, and the sweep went green across four runs
   for a node it had never once looked at. When it was finally measured it came
   back at 1.02:1: it was painting beneath the scrim.

   🔑 A gate cannot fail on a surface a flag stops rendering, so a default-off
   flag is not a reason to leave the surface unmeasured — it is a reason to pin
   it. The same shape as the mutation that found "a fully covered glyph falls
   out as unmeasurable and the run stays green".

   Pinned ON here regardless of the shipped default, so the flip ceremony is a
   decision about the wall rather than the first time anyone measures it. */
const PINNED_FLAGS = { groundMemories: true };

async function bootV3(page, { ground, phase }) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = Object.entries(PINNED_FLAGS)
      .map(([k, v]) => `window.CONFIG.features.${k} = ${v};`)
      .join("\n");
    await route.fulfill({ response: res, body: `${await res.text()}\n${body}\n` });
  });

  const png = encodePng(GROUND_W, GROUND_H, GROUNDS[ground]);

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (IMAGE_PATH.test(url.pathname) || url.pathname.startsWith("/api/plex/image")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: png });
    }
    const key = Object.keys(ROUTES).find((k) => url.pathname.startsWith(k));
    if (key) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ROUTES[key](url))
      });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.clock.setFixedTime(PHASES[phase]);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");

  // Kill every transition ONCE, up front. Two reasons, and the second is the
  // trap the incumbent sweep documents: a running CSS transition sits ABOVE
  // author-!important in the cascade, so a colour still in flight cannot be
  // stripped and gets measured as its own backdrop — a perfect ~1:1 "failure"
  // that is pure artifact.
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }"
  });

  // The photograph has to be ON THE GLASS and SAMPLED before anything is
  // measured: until the scrim has solved, --scrim-opacity is still the 0.55
  // placeholder from tokens.css and every number below would describe a screen
  // that never existed.
  await expect.poll(() => page.evaluate(() => window.__ground?.().shown === true), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__scrim?.().reason)).toBe("measured");

  // The night ink set is the whole reason `phase` exists. Prove the pin took
  // rather than assuming it — a sweep that silently measured the day palette
  // twice would pass for the wrong reason.
  const isNight = await page.evaluate(() => document.documentElement.dataset.night === "1");
  expect(isNight, `phase pin failed: expected night=${phase === "night"}`).toBe(phase === "night");

  await page.evaluate(() => window.__v3Refresh?.());

  /* ⚠ PIN THE COLOUR RESOLUTION. Every ratio in this file rests on it, and the
     first version of this sweep got it wrong in a way that looked entirely
     plausible: a number regex over getComputedStyle().color read V3's
     "oklch(0.93 0.01 85)" as r=0.93 g=0.01 b=85 — a near-black — and reported
     the 168px hour at 1.52:1 against a dark scrim it actually clears at ~10:1.
     Twenty-five inventions, no error anywhere. The hour is the brightest ink on
     the surface; if it does not resolve bright, nothing below means anything. */
  const hourInk = (await page.evaluate(COLLECT)).find((i) => i.selector === "#hour");
  await page.evaluate(RESTORE);
  expect(hourInk, "the hour did not render — nothing else here is trustworthy").toBeTruthy();
  expect(hourInk.token, "the hour is not painted in --ink").toBe("--ink");
  expect(
    Math.min(...hourInk.ink),
    `--ink resolved to ${hourInk.ink} — the OKLCH resolution is broken, not the surface`
  ).toBeGreaterThan(150);

  return { pageErrors };
}

/* ── Collect ────────────────────────────────────────────────────────────────
   Every visible leaf-ish element with its own text. Each is tagged with an
   index so the strip can be PROVEN to have taken on the exact nodes measured,
   rather than on a sample of ids that happened to be unique.
─────────────────────────────────────────────────────────────────────────── */
const COLLECT = () => {
  /* ⚠ COLOURS ARE RESOLVED BY PAINTING THEM, NEVER BY PARSING THEM.
     V3's whole palette is OKLCH, and Chromium's computed value for `color`
     PRESERVES THE COLOUR SPACE — getComputedStyle().color comes back as the
     literal string "oklch(0.93 0.01 85)", not as rgb(). The incumbent sweep's
     `css.match(/[\d.]+/g)` therefore reads that as r=0.93 g=0.01 b=85, which is
     a plausible-looking near-black, and every ratio computed from it is wrong in
     the direction that INVENTS failures. It reported the 168px hour at 1.52:1
     over rgb(54,53,52) — the true answer is ~10:1.

     Painting it into a 1x1 canvas is the same technique core/scrim.js uses, for
     the same reason: the renderer's answer is the one on the wall, and a
     hand-rolled OKLCH->sRGB conversion is a second opinion that can drift from
     it silently.

     Alpha is solved rather than read: a single fill cannot separate a
     translucent ink from a dark opaque one, so the colour is painted over black
     AND over white and the two are solved. */
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const pctx = probe.getContext("2d", { willReadFrequently: true });

  const paintOver = (css, under) => {
    pctx.fillStyle = under;
    pctx.fillRect(0, 0, 1, 1);
    pctx.fillStyle = css;
    pctx.fillRect(0, 0, 1, 1);
    return pctx.getImageData(0, 0, 1, 1).data;
  };

  const resolve = (css) => {
    if (!css) return null;
    const b = paintOver(css, "#000");
    const w = paintOver(css, "#fff");
    // A colour the renderer refused to parse leaves the ground untouched, so
    // the two reads are pure black and pure white. Bail rather than report a
    // confident number built on nothing.
    if (b[0] + b[1] + b[2] === 0 && w[0] + w[1] + w[2] === 765) return null;
    const a = Math.max(0, Math.min(1, 1 - (w[0] - b[0]) / 255));
    if (a < 0.004) return null;
    return { rgb: [b[0] / a, b[1] / a, b[2] / a].map((c) => Math.min(255, Math.round(c))), a };
  };

  // Resolve the ink tokens once so each finding can name the token that owns
  // it. "Which node is worst" is the question the voiceRail flip proved matters
  // more than the pass/fail.
  const cs = getComputedStyle(document.documentElement);
  const tokenOf = {};
  for (const token of ["--ink", "--ink-dim", "--ink-faint", "--warm", "--accent"]) {
    const r = resolve(cs.getPropertyValue(token).trim());
    if (r) tokenOf[r.rgb.join(",")] = token;
  }

  const out = [];
  let idx = 0;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walk.nextNode(); el; el = walk.nextNode()) {
    const hasOwnText = Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
    );
    if (!hasOwnText) continue;

    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") continue;
    if (parseFloat(s.opacity) === 0) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
    if (!el.offsetParent && s.position !== "fixed") continue;

    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;

    // Element opacity multiplies down the ancestor chain. V3's depth layers are
    // opacity-only exchanges, so this is not hypothetical here.
    let alpha = 1;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      alpha *= parseFloat(getComputedStyle(a).opacity);
    }
    if (alpha < 0.05) continue;

    const px = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const ink = resolve(s.color);
    if (!ink) continue;

    el.dataset.sweepIdx = String(idx);
    out.push({
      idx,
      selector:
        el.id
          ? `#${el.id}`
          : `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`,
      token: tokenOf[ink.rgb.join(",")] ?? null,
      sample: el.textContent.trim().slice(0, 44),
      color: s.color,
      ink: ink.rgb,
      inkAlpha: ink.a,
      alpha,
      fontSize: px,
      isLarge: px >= 24 || (px >= 18.66 && weight >= 700),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height }
    });
    idx += 1;
  }
  return out;
};

/* The shadow comes off for every frame. It is the design's second legibility
   mechanism and it genuinely helps on the wall, but WCAG gives it no credit and
   its dark halo would otherwise contaminate both the glyph search and the
   ground. Stripping it keeps this gate conservative and keeps every number
   comparable with the ones taken before the measurement was rewritten. */
const SHADOWLESS = () => {
  for (const el of document.querySelectorAll("*")) {
    el.style.setProperty("text-shadow", "none", "important");
  }
};

/* Paint only the MEASURED nodes in one flat colour. V3 uses `currentColor`
   nowhere (checked), so `color` moves glyph pixels and nothing else — which is
   what makes the pair of these two frames a clean readout of glyph coverage. */
const FORCE = (css) => {
  for (const el of document.querySelectorAll("[data-sweep-idx]")) {
    el.style.setProperty("-webkit-text-fill-color", css, "important");
    el.style.setProperty("color", css, "important");
  }
};

const STRIP = () => {
  for (const el of document.querySelectorAll("*")) {
    el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
    el.style.setProperty("color", "transparent", "important");
    el.style.setProperty("text-shadow", "none", "important");
  }
  // Which of the MEASURED nodes still paint. Empty is the only acceptable
  // answer: a node that survived the strip is measured against itself.
  return Array.from(document.querySelectorAll("[data-sweep-idx]"))
    .filter((el) => {
      const f = getComputedStyle(el).webkitTextFillColor;
      return !/rgba\(\d+,\s*\d+,\s*\d+,\s*0\)|transparent/.test(f);
    })
    .map((el) => el.dataset.sweepIdx);
};

const RESTORE = () => {
  for (const el of document.querySelectorAll("*")) {
    el.style.removeProperty("-webkit-text-fill-color");
    el.style.removeProperty("color");
    el.style.removeProperty("text-shadow");
  }
  for (const el of document.querySelectorAll("[data-sweep-idx]")) delete el.dataset.sweepIdx;
};

/**
 * The worst contrast in each box, measured from THE PIXELS THAT ARE ACTUALLY ON
 * THE GLASS — the painted glyph against the ground beside it.
 *
 * ⚠⚠ THIS USED TO MODEL THE COMPOSITE INSTEAD, AND THE MODEL HAD THE STACKING
 * ORDER BACKWARDS FOR ANY LAYER THAT PAINTS OVER TEXT. It took one screenshot
 * with the glyphs stripped and composited the ink token over each backdrop
 * pixel — which silently assumes the ink is the LAST thing painted. `.presence`
 * is z-index 20 and `.stage` is 10, so the house's warm rim paints over the
 * text as well as over the ground, and the model credited the rim to the
 * backdrop only. Measured on the briefing prose, white ground:
 *
 *     model  1.51:1 day / 1.22:1 night      <- reported for three months
 *     true   8.07:1 day / 6.13:1 night      <- the same frame, the same pixels
 *     rim hidden entirely, model  12.38:1 day / 9.95:1 night
 *
 * So the rim does cost real contrast — 12.38 -> 8.07 — but nothing there was
 * ever within reach of AA, and KNOWN_OPEN carried it at a floor of 1.15:1. A
 * debt registered at a number the surface never occupied is not a debt; it is a
 * hole in the gate, because everything from 1.15 upward passed as "held".
 *
 * 🔑 A contrast model is a guess about paint order. The frame is not.
 *
 * ── The method ──────────────────────────────────────────────────────────────
 *
 * Three frames of the identical screen, all with text-shadow off, differing
 * ONLY in how the measured glyphs are filled: white (`lit`), black (`dark`),
 * and stripped away entirely (`bare`).
 *
 * Let T be whatever the layers ABOVE the text do to a pixel — for a stack of
 * translucent overlays that is an affine map, T(v) = A·C + (1-A)·v, whatever
 * their number and shape. At a pixel the glyph covers completely:
 *
 *     lit  = T(255)        dark = T(0)        bare = T(ground)
 *     =>   A·C = dark      and   (1-A) = (lit - dark) / 255
 *     =>   glyph = T(ink)  = dark + (lit - dark) · ink/255
 *
 * per channel, exactly, with nothing assumed about what is painted over the
 * text or how much of it there is. `bare` is the ground the eye compares that
 * glyph against, already carrying the same overlay.
 *
 * 🔑 `lit - dark` is ALSO the coverage mask, and that is the load-bearing part.
 * It is proportional to glyph coverage and INDEPENDENT OF THE BACKGROUND, so an
 * antialiased edge is identifiable as an edge even where ink and ground are the
 * same colour. Locating glyphs by "where the painted frame differs from the
 * stripped one" — the obvious method, and the one tried first — cannot do that:
 * its signal vanishes exactly where contrast is worst, so the pixels it fails
 * to find are precisely the ones the gate exists to catch. It also mistook the
 * top scanline of a letter for the letter and invented 18 failures.
 *
 * The glyph is compared against the worst ground pixel WITHIN ONE EM in the
 * same row. Locally, because the scrim and the rim are both gradients, and a
 * letter has no perceptual relationship with the ground 400px away.
 */
const MEASURE = async ({ lit, dark, bare, items }) => {
  const load = (src) =>
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("contrast screenshot failed to decode"));
      i.src = src;
    });
  const [imgL, imgD, imgB] = await Promise.all([load(lit), load(dark), load(bare)]);

  const pixels = (img) => {
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, cv.width, cv.height).data;
  };
  const L = pixels(imgL);
  const D = pixels(imgD);
  const B = pixels(imgB);
  const W = imgL.width;
  const H = imgL.height;
  const scale = W / window.innerWidth;

  const srgb = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

  // Coverage, 0..255 summed over three channels. A fully covered pixel under no
  // overlay reads 765; the rim at its strongest takes maybe a quarter off that,
  // so the bar is deliberately low and the PLATEAU below is what proves full
  // coverage. Under this, the pixel is an edge or the box is empty here.
  const cover = (i) => L[i] - D[i] + (L[i + 1] - D[i + 1]) + (L[i + 2] - D[i + 2]);
  const MIN_COVER = 90;

  return items.map((it) => {
    const x0 = Math.max(0, Math.floor(it.rect.x * scale));
    const y0 = Math.max(0, Math.floor(it.rect.y * scale));
    const x1 = Math.min(W - 1, Math.ceil((it.rect.x + it.rect.w) * scale));
    const y1 = Math.min(H - 1, Math.ceil((it.rect.y + it.rect.h) * scale));

    const win = Math.max(24, it.fontSize) * scale;
    // Every row is scanned horizontally, so no stem is stepped over; rows go in
    // twos because a stem at V3's 32px floor is taller than that.
    const stepY = 2;

    let worst = Infinity;
    let worstBg = null;
    let rows = 0;
    // The LEAST-covered fully-covered row, i.e. the most heavily overlaid part
    // of this text. Taking the peak instead would answer a useless question:
    // most boxes reach outside the rim's 260px band somewhere, so the maximum
    // is 765 for nearly everything and the overlay would never show up at all.
    let minCover = Infinity;

    for (let y = y0; y <= y1; y += stepY) {
      let best = MIN_COVER;
      let gx = -1;
      for (let x = x0; x <= x1; x++) {
        const c = cover((y * W + x) * 4);
        if (c > best) {
          best = c;
          gx = x;
        }
      }
      if (gx < 0) continue;

      /* ⚠ THE PLATEAU TEST, and it is the difference between a measurement and
         an artefact. The topmost scanline of a letter is partially covered
         across its whole width, so it HAS a peak — and that peak is a blend of
         ink and ground, which is neither, and always worse than both. Inside a
         stem the coverage is flat in y; on the letter's top or bottom edge the
         neighbouring row is more covered. Requiring the local maximum in y
         therefore keeps stem interiors and drops edges, without ever looking at
         the background. */
      if (y > 0 && cover(((y - 1) * W + gx) * 4) > best) continue;
      if (y + 1 < H && cover(((y + 1) * W + gx) * 4) > best) continue;

      rows += 1;
      if (best < minCover) minCover = best;

      // glyph = dark + (lit - dark) * ink/255, per channel. Exact.
      const gi = (y * W + gx) * 4;
      const g = [0, 1, 2].map((k) => D[gi + k] + ((L[gi + k] - D[gi + k]) * it.ink[k]) / 255);
      const lg = lum(g[0], g[1], g[2]);

      const lo = Math.max(x0, Math.round(gx - win));
      const hi = Math.min(x1, Math.round(gx + win));
      for (let x = lo; x <= hi; x++) {
        const i = (y * W + x) * 4;
        const c = ratio(lg, lum(B[i], B[i + 1], B[i + 2]));
        if (c < worst) {
          worst = c;
          worstBg = `rgb(${B[i]}, ${B[i + 1]}, ${B[i + 2]})`;
        }
      }
    }

    /* No covered pixel anywhere in the box: the element reports a rect but puts
       nothing on the glass — clipped by an ancestor, scrolled out, or painted
       under something opaque. Worth SAYING rather than returning a number for a
       screen nobody is looking at. The caller counts these. */
    if (!rows) return { ...it, contrast: Infinity, worstBg: null, unpainted: true };

    return {
      ...it,
      contrast: Math.round(worst * 100) / 100,
      worstBg,
      rows,
      // 765 means nothing is painted over this text; less is an overlay, and
      // how much less is exactly how much of it.
      overlay: Math.round((1 - minCover / 765) * 100)
    };
  });
};

/* ── The surfaces ───────────────────────────────────────────────────────────
   Every place V3 puts text. `requires` is not decoration: a drive that silently
   fails to mount would make this sweep report "no failures" for a screen it
   never looked at, which is worse than no sweep at all.
─────────────────────────────────────────────────────────────────────────── */
const SURFACES = [
  {
    id: "0-field",
    requires: "#hour",
    drive: (page) => page.evaluate(() => window.__setDepth(0, "sweep"))
  },
  {
    id: "1-glance",
    requires: "#glance-said",
    drive: (page) =>
      page.evaluate(() => {
        window.__v3Presence(true);
        window.__forceCandidate([
          {
            id: "sweep-hero",
            source: "weather",
            score: 95,
            interrupt: true,
            text: "Rain likely from about four this afternoon",
            title: "Rain likely from four",
            cooldownMs: 0
          }
        ]);
        window.__v3Tick();
      })
  },
  {
    id: "2-spread",
    requires: "#spread-lattice .cell",
    drive: (page) =>
      page.evaluate(() => {
        window.__v3Presence("dwell");
        window.__forceCandidate([
          { id: "s-a", source: "weather", score: 68, text: "Rain likely from about four", title: "Rain from four", sub: "Take the washing in", cooldownMs: 0 },
          { id: "s-b", source: "calendar", score: 62, text: "Soccer at four", title: "Soccer", sub: "Nudgee fields", cooldownMs: 0 },
          { id: "s-c", source: "tonightsMenu", score: 55, text: "Chicken fajitas tonight", title: "Chicken fajitas", sub: "Dinner", cooldownMs: 0 }
        ]);
        window.__v3Tick();
      })
  },
  {
    id: "2-vocabulary",
    requires: ".vocab__item",
    drive: (page) => page.evaluate(() => window.__v3Transcript("what can I say"))
  },
  /* ⚠ THE TRANSCRIPT AT THE SHALLOW DEPTHS, which is its worst case and the one
     a transcript-driven surface cannot reliably catch: `#heard` clears itself
     4.2s after the turn ends, so whether it is still up when the screenshot is
     taken depends on how fast the harness ran. It was present for five of the
     depth-3 surfaces and absent from a sixth on the same run.

     Written directly because showHeard() does exactly this — textContent and
     hidden=false, no class or style of its own — so what is measured is the same
     node in the same state, minus the race. It matters because at depths 0-2
     there is no veil: `.heard` sits at top:var(--safe), which is ~0.91 of the
     way UP the frame, and `--scrim` is transparent by 88% by design. Nothing is
     between that text and the photograph at all. */
  {
    id: "1-heard",
    requires: "#heard",
    drive: (page) =>
      page.evaluate(() => {
        window.__setDepth(1, "sweep");
        const h = document.getElementById("heard");
        h.textContent = "show me the front door";
        h.hidden = false;
      })
  },
  {
    id: "3-day",
    requires: ".subject--calendar .subject__row",
    drive: (page) => page.evaluate(() => window.__v3Transcript("show me my day"))
  },
  {
    id: "3-list",
    requires: ".subject--list .subject__row",
    drive: (page) =>
      page.evaluate(async () => {
        await window.__v3Subject("show.list", { list: "shopping" }, {
          todos: { shopping: ["milk", "sourdough", "coffee beans", "eggs", "butter", "pears"], tasks: null }
        });
        window.__setDepth(3, "sweep");
      })
  },
  {
    id: "3-recipe",
    requires: ".subject--recipe .subject__row",
    drive: (page) => page.evaluate(() => window.__v3Transcript("show me the recipe"))
  },
  {
    id: "3-year",
    requires: ".subject__caption-sm",
    drive: (page) => page.evaluate(() => window.__v3Transcript("show me the year"))
  },
  {
    id: "3-briefing",
    requires: ".subject--briefing .subject__prose",
    drive: (page) => page.evaluate(() => window.__v3Briefing({ force: true }))
  },
  {
    id: "3-media",
    requires: ".subject--media .subject__text",
    drive: (page) =>
      page.evaluate(async () => {
        await window.__v3Subject("show.media");
        window.__setDepth(3, "sweep");
      })
  },
  {
    /* Phase 6. The readout is the densest text V3 puts on a photograph — ten
       rows of two columns — so if the veil selector list is ever missed again
       this is the surface that shows it first. */
    id: "3-status",
    requires: ".subject--status .subject__row",
    drive: (page) =>
      page.evaluate(async () => {
        await window.__v3Subject("show.status");
        window.__setDepth(3, "sweep");
      })
  },
  {
    id: "3-camera",
    requires: ".subject--camera .subject__caption",
    drive: (page) =>
      page.evaluate(async () => {
        await window.__v3Subject("show.camera", { camera: "driveway" });
        window.__setDepth(3, "sweep");
      })
  },
  /* ⚠ THE HOUSE'S OWN LIGHT IS PAINTED OVER THE TEXT, NOT UNDER IT.
     `.presence` is z-index 20 and `.stage` is 10, so the warm rim — a radial
     gradient up to alpha 0.55 across the bottom 260px — composites ON TOP of
     whatever is in that band. And the bottom band is where V3 deliberately puts
     things: the hour bottom-left, the rail bottom-right, the camera and media
     captions, the bottom row of any composition.

     Its sibling `.presence-cool` is at z-index 5 and its comment says exactly
     why: "above the substrate and BELOW the content, so the field cools without
     tinting the text." The rim does not follow that rule.

     This is measured as its own surface rather than being allowed to leak in
     from whichever turn ran last — it was found by leaking, and a number that
     depends on the previous test's leftover phase is not a measurement. */
  {
    id: "0-field-listening",
    requires: "#hour",
    drive: (page) =>
      page.evaluate(() => {
        window.__setDepth(0, "sweep");
        /* Written directly rather than through __presenceLevel(), which starts
           a decay rAF: the rim's scaleY would then be a function of how long
           the screenshot took, and a number that moves with the harness is not
           a measurement. The glow itself is bound to the phase and holds. */
        document.documentElement.dataset.phase = "listening";
        document.documentElement.style.setProperty("--presence-level", "1");
      })
  }
];

/* The voice phase survives a turn, so a surface driven after a transcript would
   otherwise be measured under the previous surface's rim. Reset it explicitly —
   presence-light.js owns this attribute in production and nothing else may write
   it, which is why this is here and not a handle. */
const IDLE = () => {
  document.documentElement.dataset.phase = "idle";
  document.documentElement.style.setProperty("--presence-level", "0");
  delete document.documentElement.dataset.fail;
};

/** Drive one surface, measure it, and put the glyphs back. */
async function sweepSurface(page, surface) {
  await page.evaluate(IDLE);
  await surface.drive(page);
  await expect
    .poll(() => page.locator(surface.requires).count(), { timeout: 10_000 })
    .toBeGreaterThan(0);

  const items = await page.evaluate(COLLECT);
  expect(items.length, `${surface.id}: nothing visible to measure`).toBeGreaterThan(0);

  /* Three frames of one screen: glyphs white, glyphs black, glyphs gone. See
     MEASURE — the pair solves whatever is painted over the text, and their
     difference is a background-independent coverage mask. */
  await page.evaluate(SHADOWLESS);
  await page.evaluate(FORCE, "#fff");
  const lit = await page.screenshot({ type: "png" });
  await page.evaluate(FORCE, "#000");
  const dark = await page.screenshot({ type: "png" });

  const stillPainted = await page.evaluate(STRIP);
  expect(
    stillPainted,
    `${surface.id}: text strip failed on ${stillPainted.join(", ")} — measurements would be self-referential`
  ).toHaveLength(0);

  const bare = await page.screenshot({ type: "png" });
  const b64 = (b) => `data:image/png;base64,${b.toString("base64")}`;
  const measured = await page.evaluate(MEASURE, {
    lit: b64(lit),
    dark: b64(dark),
    bare: b64(bare),
    items
  });
  await page.evaluate(RESTORE);

  return measured.map((m) => ({ ...m, surface: surface.id }));
}

const line = (m) =>
  `    ${String(m.contrast).padStart(6)}:1  ${m.surface} ${m.selector} @${Math.round(m.fontSize)}px` +
  ` ${m.token ?? m.color} over ${m.worstBg}  "${m.sample}"`;

for (const ground of Object.keys(GROUNDS)) {
  for (const phase of Object.keys(PHASES)) {
    test(`v3 contrast: ${ground} ground, ${phase} — every surface clears WCAG AA worst-case`, async ({ page }) => {
      test.setTimeout(240_000);
      const { pageErrors } = await bootV3(page, { ground, phase });

      const all = [];
      for (const surface of SURFACES) all.push(...(await sweepSurface(page, surface)));

      expect(all.length, "the sweep measured nothing at all").toBeGreaterThan(20);

      /* A node COLLECT judged visible that puts no pixel on the glass. It has no
         contrast ratio, so it cannot be measured — but it must not therefore be
         WAIVED, which is what dropping it quietly would do.

         ⚠ THIS IS THE HOLE THE MUTATION FOUND. Replacing the presence rim with
         a flat opaque block — the most complete legibility failure available,
         the hour erased outright — left the whole sweep green to the digit,
         because a glyph that is entirely covered has zero coverage and fell out
         of `measured` as "unmeasurable". A gate that stays green precisely
         BECAUSE the text disappeared is worse than no gate.

         COLLECT has already excluded everything legitimately not on screen —
         display:none, visibility:hidden, zero opacity, an empty rect, offscreen.
         Anything that survives all of that and still paints nothing is a defect
         by construction, so it fails here. */
      const unpainted = all.filter((m) => m.unpainted);
      const measured = all.filter((m) => !m.unpainted);
      expect(measured.length, "every measured node came back unpainted").toBeGreaterThan(20);
      expect(
        unpainted.map((m) => `${m.surface} ${m.selector} "${m.sample}"`),
        `${ground}/${phase}: ${unpainted.length} visible text node(s) put NO pixel on the glass — ` +
          "covered by something opaque, or clipped away entirely"
      ).toHaveLength(0);

      /* Proof that the pin took and the caption was actually looked at. Without
         this the coverage is silent: a flag pin that stops working, or a caption
         that stops rendering, restores the exact blind spot this gate just
         closed — and it restores it GREEN. Night is exempt because the caption
         is opacity:0 after dark by design, which COLLECT correctly skips. */
      if (phase === "day") {
        expect(
          measured.filter((m) => m.selector === "#ground-caption").length,
          "the ground caption was never measured — the groundMemories pin did not take"
        ).toBeGreaterThan(0);
      }

      const below = measured.filter((m) => m.contrast < (m.isLarge ? AA_LARGE : AA_NORMAL));
      const short = measured.filter((m) => m.contrast < V3_TARGET);
      const worst = measured.reduce((a, b) => (a.contrast < b.contrast ? a : b));

      /* A known-open node fails only if it has got WORSE than the floor it was
         registered at. Anything else below AA is a regression, including a node
         that merely LOOKS like a registered one — the matchers are deliberately
         narrow for that reason. */
      const failures = [];
      const carried = [];
      for (const m of below) {
        const open = knownOpen(m);
        if (!open) failures.push(m);
        else if (m.contrast < open.floor) failures.push({ ...m, regressed: open });
        else carried.push({ ...m, open });
      }

      // The report is the deliverable even on a pass. "Passes the gate" has
      // already been shown, twice, not to mean "legible on this wall" — so the
      // numbers go to the console whatever the verdict is.
      const byToken = {};
      for (const m of short) {
        const k = m.token ?? m.color;
        if (!byToken[k] || byToken[k].contrast > m.contrast) byToken[k] = m;
      }
      // Known-open debts print on EVERY run, at their real number. A debt nobody
      // sees is a debt nobody pays.
      const debts = {};
      for (const m of carried) {
        if (!debts[m.open.why] || debts[m.open.why].contrast > m.contrast) debts[m.open.why] = m;
      }

      /* Text with something painted OVER it. This is printed because it is the
         one class of finding the old modelled measurement could not see at all,
         and because a NEW entry appearing here means a layer just moved above
         the stage — which is a design change, whatever its contrast comes out
         at. `over` is how much of the glyph the overlay owns. */
      const overlaid = measured
        .filter((m) => m.overlay >= 2)
        .sort((a, b) => b.overlay - a.overlay);

      console.log(
        `\n  v3 ${ground}/${phase}: ${measured.length} text nodes across ${SURFACES.length} surfaces` +
          (unpainted.length
            ? `\n    ⚠ ${unpainted.length} node(s) reported a rect but painted nothing: ` +
              unpainted.map((m) => `${m.surface} ${m.selector}`).join(", ")
            : "") +
          (overlaid.length
            ? `\n    painted OVER (overlay owns n% of the glyph):\n` +
              overlaid
                .slice(0, 6)
                .map((m) => `      ${String(m.overlay).padStart(3)}%  ${m.surface} ${m.selector} — measures ${m.contrast}:1`)
                .join("\n")
            : "") +
          `\n    worst ${worst.contrast}:1 — ${worst.surface} ${worst.selector} (${worst.token ?? worst.color})\n` +
          `    below V3's own ${V3_TARGET}:1 target: ${short.length}\n` +
          `    worst per ink:\n` +
          Object.values(byToken).map(line).join("\n") +
          (carried.length
            ? `\n    known open (${carried.length} node(s), floors held):\n` +
              Object.values(debts)
                .map((m) => `${line(m)}\n         ↳ ${m.open.why} — floor ${m.open.floor}:1`)
                .join("\n")
            : "")
      );

      expect(
        failures,
        `${ground}/${phase}: ${failures.length} element(s) below WCAG AA.\n` +
          failures
            .map((f) => line(f) + (f.regressed ? `\n         ↳ REGRESSED past its known-open floor of ${f.regressed.floor}:1` : ""))
            .join("\n")
      ).toHaveLength(0);

      expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
    });
  }
}
