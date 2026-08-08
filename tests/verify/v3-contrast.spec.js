import { test, expect } from "@playwright/test";
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
   with a little slack for renderer noise. Numbers taken 2026-08-08.
─────────────────────────────────────────────────────────────────────────── */
const KNOWN_OPEN = [
  {
    // The scrim solves for the text band at y <= 0.46 and its own comment
    // assumes the dominant line "bottom-aligns near y=0.32". A WRAPPED 132px
    // line is ~280px tall, so its top reaches y=0.59 — above the band it was
    // solved for. Fixing it means capping the line or covering the top
    // two-thirds, and the second costs the photograph at the most-looked-at
    // depth. Deferred by the owner 2026-08-08.
    match: (m) => /^[12]-/.test(m.surface) && (m.selector === "#glance-said" || m.selector.startsWith("p.said")),
    floor: 1.5,
    why: "dominant said line reaches above the band the scrim solved for"
  },
  {
    // `.presence` is z-index 20 and `.stage` is 10, so the house's own light
    // paints OVER the text rather than under it — unlike `.presence-cool`,
    // which is z5 precisely so "the field cools without tinting the text". The
    // briefing is the case that bites: it SPEAKS while it is on screen, so the
    // rim is up by definition. Moving it changes what the light looks like.
    match: (m) => m.surface === "3-briefing" && m.selector.startsWith("p.subject__prose"),
    floor: 1.15,
    why: ".presence (z20) composites over .stage (z10) while the house speaks"
  },
  {
    // The token decision that has been waiting since the voiceRail flip:
    // --ink-faint's ceiling is 4.29 day / 3.16 night against a fully opaque
    // scrim, so `.rail` and `.heard` can never reach V3's 7:1 at any opacity.
    // No scrim is the fix; the token is.
    match: (m) => m.token === "--ink-faint",
    floor: 1.6,
    why: "--ink-faint cannot reach the target at any scrim opacity — lift the token"
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

async function bootV3(page, { ground, phase }) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

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
 * For each box, the backdrop pixel that yields the LOWEST contrast against that
 * box's text colour. One getImageData for the whole frame — the per-pixel call
 * the incumbent sweep uses is ~3k round trips per surface and this runs eleven
 * surfaces per test.
 */
const MEASURE = async ({ shot, items }) => {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error("backdrop screenshot failed to decode"));
    img.src = shot;
  });
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const scale = img.width / window.innerWidth;

  const srgb = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

  return items.map((it) => {
    // Already sRGB: COLLECT resolved it by painting, because the computed value
    // of an OKLCH colour is an OKLCH string and cannot be parsed as rgb().
    const t = { r: it.ink[0], g: it.ink[1], b: it.ink[2] };
    const ta = it.inkAlpha * it.alpha;

    const x0 = Math.max(0, Math.floor(it.rect.x * scale));
    const y0 = Math.max(0, Math.floor(it.rect.y * scale));
    const x1 = Math.min(cv.width - 1, Math.ceil((it.rect.x + it.rect.w) * scale));
    const y1 = Math.min(cv.height - 1, Math.ceil((it.rect.y + it.rect.h) * scale));

    // Bounded but dense: 32x32 across the box, which for the widest thing on
    // this surface is a sample every ~50px and for a caption every 2px.
    const stepX = Math.max(1, Math.floor((x1 - x0) / 32));
    const stepY = Math.max(1, Math.floor((y1 - y0) / 32));

    let worst = Infinity;
    let worstBg = null;
    for (let y = y0; y <= y1; y += stepY) {
      for (let x = x0; x <= x1; x += stepX) {
        const i = (y * cv.width + x) * 4;
        const br = data[i], bg = data[i + 1], bb = data[i + 2];
        // Composite the (possibly translucent) ink over this pixel — what the
        // eye actually sees, not what the token says.
        const c = ratio(
          lum(t.r * ta + br * (1 - ta), t.g * ta + bg * (1 - ta), t.b * ta + bb * (1 - ta)),
          lum(br, bg, bb)
        );
        if (c < worst) {
          worst = c;
          worstBg = `rgb(${br}, ${bg}, ${bb})`;
        }
      }
    }
    return { ...it, contrast: Math.round(worst * 100) / 100, worstBg };
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

  const stillPainted = await page.evaluate(STRIP);
  expect(
    stillPainted,
    `${surface.id}: text strip failed on ${stillPainted.join(", ")} — measurements would be self-referential`
  ).toHaveLength(0);

  const shot = await page.screenshot({ type: "png" });
  const measured = await page.evaluate(MEASURE, {
    shot: `data:image/png;base64,${shot.toString("base64")}`,
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

      const below = all.filter((m) => m.contrast < (m.isLarge ? AA_LARGE : AA_NORMAL));
      const short = all.filter((m) => m.contrast < V3_TARGET);
      const worst = all.reduce((a, b) => (a.contrast < b.contrast ? a : b));

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

      console.log(
        `\n  v3 ${ground}/${phase}: ${all.length} text nodes across ${SURFACES.length} surfaces\n` +
          `    worst ${worst.contrast}:1 — ${worst.surface} ${worst.selector} (${worst.token ?? worst.color})\n` +
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
