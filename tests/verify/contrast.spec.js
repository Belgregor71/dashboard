import { test, expect } from "@playwright/test";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Worst-case text legibility gate across every atmosphere token.
 *
 * Closes the per-token legibility sweep left open when ambientSubstrate went
 * default-on (c4516aa verified atmo-clear-golden only). The awake surface sits
 * over a real Immich photo lit by a weather-driven substrate tint, so the
 * effective backdrop of a caption is not any single CSS color — it is the
 * composite of photo + substrate ::before + card glass. Computing that from
 * computed styles would be a guess.
 *
 * So this measures pixels. For each token: screenshot with text visible,
 * screenshot with text hidden, then for every text node sample the actual
 * rendered backdrop pixels underneath it and keep the WORST contrast pair in
 * the box. Worst-case, not average — one illegible word on a bright patch of
 * sky is the failure mode this exists to catch.
 *
 * Thresholds are WCAG 2.1 AA: 4.5:1 body text, 3.0:1 large text
 * (>=24px, or >=18.66px bold).
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before the contrast gate");
  }
});

// Pin a deterministic daytime: away from the briefing catch-up windows (which
// steal the view) and not night (which auto-engages the screensaver and hides
// every card). The atmosphere token is forced explicitly below, so pinning the
// clock to midday does not limit which tokens get measured.
const MIDDAY = new Date("2026-07-06T12:00:00");

// The eight tokens atmosphere.js can map to (src/js/services/atmosphere.js).
// Kept in sync by the guard test at the bottom of this file.
const TOKENS = [
  "atmo-clear-day",
  "atmo-clear-golden",
  "atmo-cloudy",
  "atmo-rain",
  "atmo-storm",
  "atmo-fog",
  "atmo-night",
  "atmo-night-clear"
];

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

function enableFlags(page) {
  return page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body =
      (await res.text()) +
      "\nwindow.CONFIG.features.presenceRuntime = true;" +
      "\nwindow.CONFIG.features.attentionEngine = true;" +
      "\nwindow.CONFIG.features.ambientSubstrate = true;" +
      "\nwindow.CONFIG.features.leanInStack = true;" +
      "\nwindow.CONFIG.features.stackCards = true;\n";
    await route.fulfill({ response: res, body });
  });
}

// Stage the temporal spine's day (features.temporalSpine, default-on since
// 2026-08-01). The spine replaces the hero + stack as the awake surface, so from
// here on the text this gate is really protecting is the spine's: an 84px
// utterance and three 34px labels sitting low over a real photograph, which is
// the worst-case backdrop in the system.
//
// The suite stubs the calendar feeds empty, and the spine draws its marks from
// the calendar — so without this the DWELL surface renders one line and the
// sweep measures almost nothing. Routing a synthetic day exercises the real
// adapter path (dayModel.eventMark) rather than reaching past it with a hook.
// Must be registered before goto.
const SPINE_DAY = "2026-07-06"; // the MIDDAY pin's date
function stageSpineDay(page) {
  const ev = (h, m, title) => ({
    id: `spine-${h}${m}`,
    title,
    start: `${SPINE_DAY}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`,
    end: `${SPINE_DAY}T${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`,
    source: "contrast-gate"
  });
  return page.route("**/api/calendar/all*", (route) =>
    route.fulfill({
      json: [
        ev(6, 40, "Dog walk"),        // an ember, left of now
        ev(8, 5, "Drop-off"),         // an ember
        ev(14, 30, "Physio"),         // ahead — takes a label
        ev(17, 15, "Swim pickup"),    // ahead — takes a label
        ev(18, 30, "Meal: Stuffed Capsicums") // the warm anchor — takes the top label
      ]
    })
  );
}

// Stage the hero + stack so the DWELL surfaces actually exist to measure.
// Long text on the hero forces tier C (the smallest hero type, 72px) — the
// hero tier most likely to fail, not the most forgiving.
function stageCandidates(page) {
  return page.evaluate(() => {
    window.__forceCandidate([
      {
        id: "c-a",
        source: "test",
        score: 70,
        icon: "☂",
        text: "Rain likely from about four this afternoon, worth taking the washing in",
        title: "Rain likely from four",
        sub: "Take the washing in",
        meta: "Open-Meteo nowcast",
        cooldownMs: 0
      },
      {
        id: "c-b",
        source: "test",
        score: 60,
        icon: "🗓",
        text: "Dylan has football training at five",
        title: "Football training",
        sub: "Dylan, 5:00pm",
        meta: "Calendar",
        cooldownMs: 0
      },
      {
        id: "c-c",
        source: "test",
        score: 55,
        icon: "🗑",
        text: "Bins go out tonight",
        title: "Bins tonight",
        sub: "Recycling week",
        meta: "Bin schedule",
        cooldownMs: 0
      }
    ]);
  });
}

/**
 * Collect every visible text node's box + resolved text colour + type scale.
 * Runs in-page. Only leaf-ish elements with non-whitespace direct text are
 * measured, so a card does not get counted once per ancestor.
 */
const COLLECT = () => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walk.nextNode(); el; el = walk.nextNode()) {
    const hasOwnText = Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
    );
    if (!hasOwnText) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (parseFloat(cs.opacity) === 0) continue;

    // Ancestor-aware visibility. Most of this dashboard is hidden most of the
    // time (popups, retired views, the screensaver in awake mode) and a hidden
    // node measures as 1:1 against its own unpainted backdrop — noise that
    // would drown the real findings.
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) {
      continue;
    }
    if (!el.offsetParent && cs.position !== "fixed") continue;

    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;

    // Effective alpha: element opacity multiplies down the ancestor chain, and
    // a 0.42-opacity eyebrow over a photo is exactly the case that has bitten
    // this dashboard before. Fold it into the text colour.
    let alpha = 1;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      alpha *= parseFloat(getComputedStyle(a).opacity);
    }
    // Effectively invisible after folding the chain — nothing to read, so
    // nothing to measure.
    if (alpha < 0.05) continue;

    const px = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    out.push({
      selector:
        el.id
          ? `#${el.id}`
          : `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`,
      sample: el.textContent.trim().slice(0, 40),
      color: cs.color,
      alpha,
      fontSize: px,
      isLarge: px >= 24 || (px >= 18.66 && weight >= 700),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height }
    });
  }
  return out;
};

/**
 * Draw the "text hidden" screenshot into a canvas and, for each measured box,
 * find the backdrop pixel that yields the LOWEST contrast against that box's
 * text colour. Sampling is a bounded grid (<=12x12 per box) so a full-screen
 * sweep across 8 tokens stays inside a sane runtime.
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
  cv.getContext("2d").drawImage(img, 0, 0);
  const ctx = cv.getContext("2d");
  const scale = img.width / window.innerWidth;

  const srgb = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const parse = (css) => {
    const m = css.match(/[\d.]+/g).map(Number);
    return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
  };

  return items.map((it) => {
    const t = parse(it.color);
    const ta = t.a * it.alpha;

    const x0 = Math.max(0, Math.floor(it.rect.x * scale));
    const y0 = Math.max(0, Math.floor(it.rect.y * scale));
    const x1 = Math.min(cv.width - 1, Math.ceil((it.rect.x + it.rect.w) * scale));
    const y1 = Math.min(cv.height - 1, Math.ceil((it.rect.y + it.rect.h) * scale));

    const stepX = Math.max(1, Math.floor((x1 - x0) / 12));
    const stepY = Math.max(1, Math.floor((y1 - y0) / 12));

    let worst = Infinity;
    let worstBg = null;
    for (let y = y0; y <= y1; y += stepY) {
      for (let x = x0; x <= x1; x += stepX) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        // Composite the (possibly translucent) text over this backdrop pixel —
        // this is what the eye actually sees.
        const fr = t.r * ta + d[0] * (1 - ta);
        const fg = t.g * ta + d[1] * (1 - ta);
        const fb = t.b * ta + d[2] * (1 - ta);
        const c = ratio(lum(fr, fg, fb), lum(d[0], d[1], d[2]));
        if (c < worst) {
          worst = c;
          worstBg = `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
        }
      }
    }
    return { ...it, contrast: Math.round(worst * 100) / 100, worstBg };
  });
};

for (const token of TOKENS) {
  test(`contrast: ${token} — every card clears WCAG AA worst-case`, async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await enableFlags(page);
    await stageSpineDay(page);
    await page.clock.setFixedTime(MIDDAY);

    await page.goto("/index.html");
    await page.waitForFunction(
      () =>
        typeof window.__attention === "function" &&
        typeof window.__forceCandidate === "function" &&
        typeof window.__presence === "function"
    );
    await stageCandidates(page);

    // DWELL is the deepest surface — the utterance and all three spine labels on
    // screen at once (and, with the spine reverted, the hero + stack cards).
    await page.evaluate(() => window.__presence("dwell"));
    await expect.poll(() => page.evaluate(() => window.__attention().stack.length)).toBe(3);
    // The spine draws asynchronously off calendar:refreshed, so wait for the day
    // to have actually landed before measuring. Skipped when the flag is off.
    if (await page.evaluate(() => typeof window.__spine === "function")) {
      await expect.poll(() => page.evaluate(() => window.__spine().labels.length)).toBe(3);

      /* ⚠ AND THEN WAIT FOR THEM TO SETTLE — existing is not the same as shown.
         `.spine-label` fades in over 700ms (opacity 0 → the rank ladder
         1.0/0.88/0.76), and the sampler above multiplies every ancestor opacity
         into the text's effective alpha. A screenshot taken mid-fade therefore
         measures an alpha NOBODY EVER READS, and reports it as a contrast
         defect in the surface.

         That is not hypothetical: this gate failed a full-suite pre-push run at
         `a=0.63` on .spine-label__time (4.43:1, needs 4.5) and then passed 3/3
         in isolation at 4.58-4.73. 0.63 is on none of the ladder and is not a
         product of any pair of it — it is 82% of the way through the fade to
         0.76. A loaded machine simply lands earlier in the transition, which is
         why the everyday suite never saw it and the pre-push gate did.

         Asked of the browser rather than slept for: a CSS transition IS an
         Animation, and a finished one is no longer returned by
         `getAnimations()` — so an empty list means settled. `.spine-label`
         carries no infinite animation (only `.spine-breath` does), so this
         cannot hang waiting on a loop. */
      await page.waitForFunction(() => {
        const labels = [...document.querySelectorAll(".spine-label")];
        return (
          labels.length > 0 &&
          labels.every((el) => el.getAnimations().every((a) => a.playState === "finished"))
        );
      });
    }

    // Force the token directly rather than waiting on real weather: the whole
    // point is to measure all eight regardless of what the sky is doing.
    await page.evaluate((t) => {
      const body = document.body;
      [...body.classList].filter((c) => c.startsWith("atmo-")).forEach((c) => body.classList.remove(c));
      body.classList.add("substrate", t);
      // The token settles over --atmo-settle (60s in prod). Kill the transition
      // so the measurement reflects the settled state immediately.
      document.documentElement.style.setProperty("--atmo-settle", "0ms");
    }, token);
    await page.waitForTimeout(400);

    const items = await page.evaluate(COLLECT);
    expect(items.length, "found no visible text to measure — the view did not render").toBeGreaterThan(5);

    // Hide the glyphs (not the boxes) so the screenshot shows what is *behind*
    // the text. Layout is untouched, so the rects collected above stay valid.
    //
    // Two traps here, both learned the hard way:
    //   1. A stylesheet `color: transparent !important` DOES NOT WIN. Running
    //      CSS transitions sit ABOVE author-!important in the cascade, and this
    //      dashboard keeps a 60s --atmo-settle colour transition in flight
    //      (livingAccent). The clock stayed fully painted and got measured as
    //      its own backdrop — a perfect 1.2:1 "failure" that was pure artifact.
    //   2. So: stop transitions/animations FIRST, then strip via
    //      -webkit-text-fill-color, which nothing here transitions. Inline
    //      declarations also outrank any stylesheet.
    await page.evaluate(() => {
      const kill = document.createElement("style");
      kill.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
      document.head.appendChild(kill);
      document.querySelectorAll("*").forEach((el) => {
        el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
        el.style.setProperty("color", "transparent", "important");
        el.style.setProperty("text-shadow", "none", "important");
      });
    });
    await page.waitForTimeout(250);

    // Prove the strip actually took: if any measured element still paints its
    // glyphs, every number below is meaningless. Fail loudly instead of
    // reporting a confident wrong answer.
    const stillPainted = await page.evaluate(
      (sels) =>
        sels.filter((s) => {
          const el = document.querySelector(s);
          if (!el) return false;
          const f = getComputedStyle(el).webkitTextFillColor;
          return !/rgba\(\d+,\s*\d+,\s*\d+,\s*0\)|transparent/.test(f);
        }),
      items.map((i) => i.selector).filter((s) => s.startsWith("#")).slice(0, 40)
    );
    expect(stillPainted, `text strip failed on ${stillPainted.join(", ")} — measurements would be self-referential`).toHaveLength(0);

    const shot = await page.screenshot({ type: "png" });

    const measured = await page.evaluate(MEASURE, {
      shot: `data:image/png;base64,${shot.toString("base64")}`,
      items
    });

    const failures = measured.filter((m) => m.contrast < (m.isLarge ? AA_LARGE : AA_NORMAL));
    const worst = measured.reduce((a, b) => (a.contrast < b.contrast ? a : b));

    const report = failures
      .map(
        (f) =>
          `  ${f.contrast}:1 (needs ${f.isLarge ? AA_LARGE : AA_NORMAL}) ` +
          `${f.selector} @${Math.round(f.fontSize)}px\n` +
          `    text ${f.color} a=${f.alpha.toFixed(2)} over ${f.worstBg}\n` +
          `    "${f.sample}"`
      )
      .join("\n");

    expect(
      failures,
      `${token}: ${failures.length} element(s) below WCAG AA.\n${report}\n` +
        `  (worst overall: ${worst.contrast}:1 on ${worst.selector})`
    ).toHaveLength(0);

    console.log(`  ${token}: ${measured.length} text nodes, worst ${worst.contrast}:1 on ${worst.selector}`);
    expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
  });
}

test("token list is in sync with the atmosphere mapper", async () => {
  // If atmosphere.js gains a token and this list does not, the sweep silently
  // stops covering it. Fail loudly instead. Imported from source (not the
  // bundle) because the mapper is a pure module with no imports.
  const { ATMOSPHERE_TOKENS } = await import("../../src/js/services/atmosphere.js");
  expect([...ATMOSPHERE_TOKENS].sort()).toEqual([...TOKENS].sort());
});
