import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { captionParts, localHourOf, relativeYearPhrase } from "../src/js/services/photoMemory.js";
import { plateFor } from "../src/js/services/archiveModel.js";

/**
 * The Ambient Archive — calm law v3 (docs/design/AMBIENT-ARCHIVE.md).
 *
 * Mode 0 as an instrument space: the memory as a lit card over ONE ruler —
 * today, low and near. The archive absorbs the spine's job while it is up.
 * There is deliberately no year ruler: two were built, both were rejected on
 * the panel, and the 400px ghost engraving already says the year.
 *
 * The four traps this file exists to catch, in the handover's own order:
 *   §4.1 the screensaver blank rule hides whatever you add — and every
 *        JS-level assertion still passes, because a probe reads its own
 *        bookkeeping, not paint. Assert PAINT.
 *   §4.2 a loop must hang off a selector its cause removes.
 *   §4.3 a tender memory reaches the wall with NO PLATE AT ALL.
 *   §4.5 never carry alpha in a colour that also sits under a dimming opacity.
 *
 * OFF (default) is byte-identical: no archive element, no body class, no hook,
 * and the spine is still the surface in Mode 0.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(here, "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

// Pin daytime: after sunset the screensaver auto-engages at boot and the night
// rules hide the plate by design, which would read as the tender invariant
// passing for the wrong reason (CLAUDE.md — time-of-day dependence).
const MIDDAY = new Date("2026-07-06T12:00:00");

function forceFlags(flags) {
  return (page) =>
    page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const lines = Object.entries(flags)
        .map(([k, v]) => `window.CONFIG.features.${k} = ${v};`)
        .join("\n");
      await route.fulfill({ response: res, body: (await res.text()) + "\n" + lines + "\n" });
    });
}

// The archive on, with the photo source pinned off so the async pool fetch
// never delays engage — the archive is a renderer and does not need real
// photos to be asserted about.
const ARCHIVE_ON = { ambientArchive: true, immichPhotos: false, dailyMemories: false, temporalSpine: true };
const ARCHIVE_OFF = { ambientArchive: false, immichPhotos: false, dailyMemories: false, temporalSpine: true };

// A Daily Memories frame exactly as loadDailyMemories shapes one: the caption
// is `year · place · who`, which IS the plate. Nothing is invented here.
const MEMORY = {
  src: "/photos/river.jpg",
  caption: "2019 · Nudgee, Queensland · our niece Melanie"
};

async function bootArchive(page, flags = ARCHIVE_ON) {
  await forceFlags(flags)(page);
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__engageScreensaver === "function");
}

// Mode 0 fades in over 1.8s and `checkVisibility({opacityProperty})` reads a
// mid-fade opacity as "not painted". Wait for the surface to actually be up
// before asserting anything about paint.
async function engaged(page) {
  await page.evaluate(() => window.__engageScreensaver());
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById("screensaver")).opacity === "1",
    null,
    { timeout: 8000 }
  );
}

// The exchange is staged, not instant: the card blurs for a beat, the plate and
// the ghost year stand down, and everything swaps at the 2.4s midpoint so the
// words never describe the wrong picture. Tests wait for the staging rather
// than reaching past it — the staging is half the feature.
async function settledPlate(page) {
  // Two stages, and missing the second one measures a half-faded plate: the
  // class comes off at the 2.4s midpoint, and only THEN does the 2.4s opacity
  // transition back in begin. Wait for the words to actually be on the wall.
  await page.waitForFunction(
    () => {
      const plate = document.querySelector(".archive__plate");
      const ghost = document.querySelector(".archive__ghost");
      if (plate.classList.contains("is-exchanging")) return false;
      const want = plate.classList.contains("is-visible") ? "1" : "0";
      return getComputedStyle(plate).opacity === want && getComputedStyle(ghost).opacity === "1";
    },
    null,
    { timeout: 12000 }
  );
  return page.evaluate(() => window.__archive());
}

/* ───────────────────────────── the pure model ───────────────────────────── */

test.describe("the hour a photograph was taken", () => {
  // `localDateTime` carries a trailing Z it does not mean, so reading it
  // through Date would shift a 9am photo to 7pm in Brisbane. Same trap
  // `localMonthDay` already dodges, one field deeper.
  test("the wall-clock hour is read from the fields, never through Date", () => {
    expect(localHourOf("2011-04-06T09:03:43.000Z")).toBeCloseTo(9.05, 2);
    expect(localHourOf("2019-12-25T18:30:00.000Z")).toBeCloseTo(18.5, 3);
    expect(localHourOf("2019-12-25 06:15:00")).toBeCloseTo(6.25, 3);
    const viaDate = new Date("2011-04-06T09:03:43.000Z").getHours();
    if (viaDate !== 9) expect(Math.floor(localHourOf("2011-04-06T09:03:43.000Z"))).not.toBe(viaDate);
  });

  test("no usable time means no hour, not a guessed one", () => {
    expect(localHourOf(null)).toBe(null);
    expect(localHourOf("")).toBe(null);
    expect(localHourOf("2011-04-06")).toBe(null);
  });
});

test.describe("the plate is relocated language, never new language", () => {
  const NOW = new Date("2026-07-06T12:00:00");

  test("year · place · who splits into the plate's three registers", () => {
    expect(captionParts("2019 · Nudgee, Queensland · our niece Melanie")).toEqual({
      year: "2019",
      title: "Nudgee, Queensland",
      who: "our niece Melanie"
    });
    expect(plateFor("2019 · Nudgee, Queensland · our niece Melanie", NOW)).toEqual({
      year: "2019",
      title: "Nudgee, Queensland",
      who: "our niece Melanie"
    });
  });

  // Most of this library has no GPS and no named faces, so a bare year is the
  // COMMON case, not the edge one — on 2026-08-02 it was the whole day's set,
  // and the plate simply never appeared. It still speaks: it says the year in
  // words. Not invented data — the year is already a 400px engraving behind it.
  test("a bare year still earns a plate, said in words", () => {
    expect(plateFor("2022", NOW)).toEqual({ year: "2022", title: "Four years ago today", who: null });
    expect(plateFor("2025", NOW)).toEqual({ year: "2025", title: "One year ago today", who: null });
    expect(relativeYearPhrase(2022, NOW)).toBe("Four years ago today");
    expect(relativeYearPhrase(2026, NOW)).toBe(null); // this year is not "ago"
  });

  test("no year means no plate — silence is the default", () => {
    expect(plateFor(null, NOW)).toBe(null);
    expect(plateFor("", NOW)).toBe(null);
    expect(plateFor("Nudgee, Queensland", NOW)).toBe(null);
  });
});

/* ─────────────────────────── the surface (runtime) ─────────────────────── */

test("flag off: no archive, no body class, no hook — Mode 0 is the spine's", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await bootArchive(page, ARCHIVE_OFF);
  await page.evaluate(() => window.__engageScreensaver());

  expect(await page.locator(".archive").count()).toBe(0);
  expect(await page.evaluate(() => document.body.classList.contains("fx-archive-active"))).toBe(false);
  expect(await page.evaluate(() => document.body.classList.contains("ambient-archive-on"))).toBe(false);
  expect(await page.evaluate(() => typeof window.__archive)).toBe("undefined");
  // The surface the archive replaces is untouched: the spine still holds Mode 0
  // and the clock is still the big centred one.
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("temporal-spine")).display))
    .not.toBe("none");
  expect(await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector(".screensaver__time")).fontSize)))
    .toBeGreaterThan(100);
  expect(pageErrors).toEqual([]);
});

test("flag on: Mode 0 becomes the archive, and leaving it switches the cause off", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await bootArchive(page);

  // Built at init, but silent until Mode 0 — the marker is the cause, and the
  // cause has not happened yet.
  expect(await page.locator(".archive").count()).toBe(1);
  expect(await page.evaluate(() => document.body.classList.contains("fx-archive-active"))).toBe(false);

  await engaged(page);
  const probe = await page.evaluate(() => window.__archive());
  expect(probe.enabled).toBe(true);
  expect(probe.active).toBe(true);
  expect(probe.marker).toBe(true);
  expect(probe.nowHour).toBeCloseTo(12, 1);

  await page.evaluate(() => window.__wakeScreensaver());
  expect(await page.evaluate(() => document.body.classList.contains("fx-archive-active"))).toBe(false);
  expect(pageErrors).toEqual([]);
});

// The photograph is the point of a screensaver. It had shrunk to 53% of the
// reference's area to make room for a stack of year-rows; two ruler planes need
// no such room. This pins the reference's own geometry so it cannot drift back.
test("the photograph keeps the reference's size — it is the point of the surface", async ({ page }) => {
  await bootArchive(page);
  await engaged(page);

  const card = await page.evaluate(() => {
    const el = document.querySelector(".archive__card-plane");
    const cs = getComputedStyle(el);
    return { w: parseFloat(cs.width), h: parseFloat(cs.height), left: parseFloat(cs.left), top: parseFloat(cs.top) };
  });
  expect(card).toEqual({ w: 1040, h: 585, left: 130, top: 212 });
  // Over half the 1920 frame's width — anything much less stops being the hero.
  expect(card.w / 1920).toBeGreaterThan(0.5);
});

// §4.1. The spine shipped INVISIBLE in the one mode it exists for, and every
// JS assertion passed because the probe read its own bookkeeping. Only
// checkVisibility() on the panel disagreed. This asserts paint, not state.
test("the archive survives the screensaver blank rule — it is what Mode 0 IS", async ({ page }) => {
  await bootArchive(page);
  await engaged(page);

  const vis = await page.evaluate(() => {
    const opts = { opacityProperty: true, visibilityProperty: true };
    return {
      blankRuleOn: document.body.classList.contains("screensaver-active"),
      archive: document.querySelector(".archive").checkVisibility(opts),
      today: document.querySelector(".archive__ruler--today").checkVisibility(opts),
      card: document.querySelector(".archive__card").checkVisibility(opts),
      // The rule must still be doing its job for everything else.
      hero: getComputedStyle(document.getElementById("focus-hero")).visibility
    };
  });

  expect(vis.blankRuleOn).toBe(true);
  expect(vis.archive).toBe(true);
  expect(vis.today).toBe(true);
  expect(vis.card).toBe(true);
  expect(vis.hero).toBe("hidden");
});

// The archive draws exactly ONE axis. Two versions of a year ruler were built
// and both were rejected on the panel: rows receding in Z read as a broken
// diagonal and cost the photograph half its size, and a horizontal shelf
// clashed with the card while telling the room nothing the 400px ghost
// engraving does not already say. A second ruler duplicating it is furniture.
test("one ruler, and it is today — the year is the engraving, not a shelf", async ({ page }) => {
  await bootArchive(page);
  await engaged(page);
  await page.evaluate((m) => window.__ssSetFrame(m), MEMORY);
  await settledPlate(page);

  const shape = await page.evaluate(() => ({
    rulers: document.querySelectorAll(".archive__ruler").length,
    todayZ: getComputedStyle(document.querySelector(".archive__ruler--today")).getPropertyValue("--row-z").trim(),
    ghost: document.querySelector(".archive__ghost").textContent,
    ghostPx: parseFloat(getComputedStyle(document.querySelector(".archive__ghost")).fontSize)
  }));

  expect(shape.rulers).toBe(1);
  expect(shape.todayZ).toBe("-40px");
  // The year IS on the wall — just not twice.
  expect(shape.ghost).toBe("2019");
  expect(shape.ghostPx).toBe(400);
});

// §6.3.1. The archive's plane takes the spine's axis, so the spine stands down
// — and it is HIDDEN, not deleted, which is what makes the flag a rollback.
test("the spine stands down in Mode 0, and comes straight back out of it", async ({ page }) => {
  await bootArchive(page);
  const spineDisplay = () =>
    page.evaluate(() => getComputedStyle(document.getElementById("temporal-spine")).display);

  expect(await spineDisplay()).not.toBe("none");
  await engaged(page);
  expect(await spineDisplay()).toBe("none");
  expect(await page.evaluate(() => Boolean(document.getElementById("temporal-spine")))).toBe(true);
  await page.evaluate(() => window.__wakeScreensaver());
  expect(await spineDisplay()).not.toBe("none");
});

// §6.4. The most visible change in the package: the thing on screen twenty
// hours a day. Mode 0 only — the awake top-row time is untouched.
test("the Mode-0 clock is demoted to the corner numeral, and nothing else moves", async ({ page }) => {
  await bootArchive(page);
  const clock = () =>
    page.evaluate(() => {
      const el = document.querySelector(".screensaver__time");
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { size: parseFloat(cs.fontSize), x: r.x, y: r.y };
    });

  expect((await clock()).size).toBeGreaterThan(100); // the shipped 192px face

  await engaged(page);
  const ambient = await clock();
  // Instantly 64px, not eased into it: the shipped clock carries a
  // `font-size 1s ease` and animating a layout property for a reason the room
  // cannot see is exactly what §5.5 forbids. The demotion is a state.
  expect(ambient.size).toBe(64);
  expect(ambient.x).toBeLessThan(200);
  expect(ambient.y).toBeLessThan(200);

  // Mode 0 only. Leave it and the big face comes straight back — that is the
  // shape of the ruling, and of the rollback.
  await page.evaluate(() => window.__wakeScreensaver());
  expect((await clock()).size).toBeGreaterThan(100);
});

// §4.3. The easiest thing in the whole package to break silently, and it is a
// code-not-taste invariant (DESIGN_SYSTEM.md §9).
test("a tender memory reaches the archive with no plate at all", async ({ page }) => {
  await bootArchive(page, { ...ARCHIVE_ON, ambientMemory: true });
  await engaged(page);

  // A normal captioned memory DOES get the plate — otherwise the tender case
  // below would pass for the wrong reason.
  await page.evaluate((m) => window.__ssSetFrame(m), MEMORY);
  const normal = await settledPlate(page);
  expect(normal.plate).toEqual({
    eyebrow: "On this day · 2019",
    title: "Nudgee, Queensland",
    who: "our niece Melanie"
  });
  expect(normal.ghost).toBe("2019");
  expect(normal.lit).toBe(2019);

  // Now the tender lane. Wordless: no plate, no ghost year, no caption anywhere.
  const tender = await page.evaluate(() =>
    window.__forceAmbientMemory({
      id: "memory:brodie",
      sensitivity: "tender",
      ambientOnly: true,
      caption: null,
      text: "",
      photos: ["/photos/brodie/by-the-heater.jpg"],
      holdMs: 22000
    })
  );
  expect(tender.markVisible).toBe(true);
  expect(tender.photo).toContain("brodie");

  const held = await settledPlate(page);
  expect(held.plate).toBe(null);
  expect(held.ghost).toBe(null);
  expect(held.lit).toBe(null);

  // And nothing anywhere in the archive is narrating it. (The vertical
  // engraving is the frame's own label, not the memory's — excluded.)
  const words = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".archive *:not(.archive__word)"))
      .map((el) => el.textContent.trim())
      .filter(Boolean)
  );
  expect(words).toEqual([]);
});

// The 24/7 invariant. The archive allocates nothing per mark, per year or per
// memory: two ruler canvases, two images, two echoes, one plate, created once.
test("cycling memories and days never grows the DOM", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await bootArchive(page);
  await engaged(page);

  const shape = () => ({
    total: document.querySelectorAll(".archive *").length,
    rulers: document.querySelectorAll(".archive__ruler").length,
    imgs: document.querySelectorAll(".archive__img").length,
    echoes: document.querySelectorAll(".archive__echo").length,
    plates: document.querySelectorAll(".archive__plate").length
  });

  const before = await page.evaluate(shape);
  expect(before.rulers).toBe(1);
  expect(before.imgs).toBe(2);
  expect(before.echoes).toBe(2);
  expect(before.plates).toBe(1);

  await page.evaluate(() => {
    for (let i = 0; i < 25; i++) {
      window.__ssSetFrame({ src: `/photos/m${i}.jpg`, caption: `${2008 + (i % 18)} · Place ${i} · Someone` });
      window.__ssSetFrame("/photos/bare.jpg");
    }
  });

  expect(await page.evaluate(shape)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

/* ───────────────────────────── the CSS guardrails ──────────────────────── */

test.describe("archive css guardrail", () => {
  const cssPath = path.join(here, "..", "src", "css", "views", "ambient-archive.css");
  const css = () => readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  // §4.2 — the same cause test the atmosphere, atmo-fx and spine guardrails
  // apply (DESIGN_SYSTEM.md §5.1). The archive's cause is "Mode 0 is running",
  // and `body.fx-archive-active` is set on entry and removed on exit, so the
  // marker IS the honest binding rather than a workaround. It also matches the
  // `fx-[a-z0-9-]+-(active|live)` shape the atmo-fx guardrail already allows.
  const CAUSE_BOUND = /\.fx-archive-active\b/;

  test("every looping animation hangs off the cause that ends", () => {
    const rules = css().match(/[^{}@]+\{[^}]*\}/g) || [];
    const looping = rules.filter((r) => /animation[^;]*\binfinite\b/.test(r));
    expect(looping.length).toBeGreaterThan(0); // the archive lives
    for (const rule of looping) {
      const selector = rule.slice(0, rule.indexOf("{"));
      expect(
        CAUSE_BOUND.test(selector),
        `a looping effect must be bound to a cause that ends. Offending selector: ${selector.trim()}`
      ).toBe(true);
    }
    // A loop wearing a number is still a loop nobody can attribute.
    expect(css()).not.toMatch(/animation-iteration-count/);
  });

  test("the ruler never moves — a sliding axis lies about what it measures", () => {
    // The reference drifts its strips ±80px, which was fine when they were
    // decoration. This one carries the hour axis: ±80px on it is a ~50-minute lie.
    const rules = css().match(/[^{}@]+\{[^}]*\}/g) || [];
    for (const rule of rules) {
      const selector = rule.slice(0, rule.indexOf("{"));
      if (!/\.archive__ruler\b/.test(selector)) continue;
      expect(rule, `a ruler must not animate: ${selector.trim()}`).not.toMatch(/animation\s*:/);
    }
  });

  test("amplitude follows the sun-altitude curve, with no second night threshold", () => {
    expect(css()).toMatch(/--clock-dim/);   // §5.2 — reuse the curve
    expect(css()).toMatch(/--arch-amp/);    // …applied to displacement
    expect(css()).toMatch(/--arch-gain/);   // …with one number the owner turns
    expect(css()).not.toMatch(/@media[^{]*prefers-color/);
    // Duration must not be what scales: a slow effect that still travels far is
    // what wakes someone up.
    expect(css()).not.toMatch(/animation-duration[^;]*var\(--clock-dim/);
    // The periods stay the reference's, whatever the gain does.
    expect(css()).toMatch(/arch-echo 130s/);
    expect(css()).toMatch(/arch-pivot 84s/);
    expect(css()).toMatch(/arch-kenburns 96s/);
    expect(css()).toMatch(/arch-ghost 92s/);
  });

  test("reduced motion switches the whole surface off", () => {
    const source = css();
    expect(source).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(source.slice(source.indexOf("prefers-reduced-motion"))).toMatch(/animation:\s*none/);
  });

  test("no layout-triggering property is animated", () => {
    for (const t of css().match(/transition\s*:[^;]+;/g) || []) {
      expect(t, `compositor properties only: ${t}`).not.toMatch(/\b(width|height|top|left|margin|padding)\b/);
    }
  });

  // The other guardrail this change had to stay clear of: insights.spec.js
  // forbids `infinite` anywhere in screensaver.css that is not bound to a
  // weather condition token, and the archive's cause is not the weather. That
  // is why this stylesheet is a separate file, and it must stay one.
  test("no archive loop leaked into screensaver.css", () => {
    const ss = readFileSync(path.join(here, "..", "src", "css", "views", "screensaver.css"), "utf8");
    expect(ss).not.toMatch(/fx-archive-active/);
    expect(ss.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\binfinite\b/);
  });
});

// §4.5 — the spine's third label hit 1.96:1 against AA 4.5 because a rank
// opacity multiplied into a colour that already carried alpha. The archive has
// the same shape everywhere, so the rule is asserted structurally rather than
// waiting for the pre-push pixel sweep to catch it late.
test("no archive text sits under a dimming opacity", async ({ page }) => {
  await bootArchive(page);
  await engaged(page);
  await page.evaluate((m) => window.__ssSetFrame(m), MEMORY);
  await settledPlate(page);

  const offenders = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".archive *")) {
      const hasText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
      );
      if (!hasText) continue;
      let alpha = 1;
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        alpha *= parseFloat(getComputedStyle(a).opacity);
      }
      if (alpha < 0.999) out.push({ sel: el.className, alpha, text: el.textContent.trim().slice(0, 30) });
    }
    return out;
  });

  expect(offenders).toEqual([]);
});
