import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildStrata, ARCHIVE_STRATA_ROWS, STRATA_ROWS } from "../src/js/services/dayModel.js";
import { captionParts, localHourOf } from "../src/js/services/photoMemory.js";

/**
 * The Ambient Archive — calm law v3 (docs/design/AMBIENT-ARCHIVE.md).
 *
 * Mode 0 as an instrument space: the memory as a lit card over the temporal
 * spine's day rendered in three dimensions — across is today, back is the
 * years. The archive absorbs the spine's job while it is up.
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
  caption: "2019 · Nudgee, Queensland · our niece Melanie",
  hour: 9.5
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
  await page.waitForFunction(
    () => !document.querySelector(".archive__plate").classList.contains("is-exchanging"),
    null,
    { timeout: 8000 }
  );
  return page.evaluate(() => window.__archive());
}

/* ───────────────────────────── the pure model ───────────────────────────── */

test.describe("the archive's reach", () => {
  test("the plane carries more years than the flat spine, without moving the spine's", () => {
    // A receding plane separates its rows by perspective as well as position,
    // so it holds more before it turns to mush (§6.3.3). The spine is
    // default-on and Pi-verified at three: the archive must not reach outside
    // its own flag to change that.
    expect(ARCHIVE_STRATA_ROWS).toBeGreaterThan(STRATA_ROWS);
    expect(STRATA_ROWS).toBe(3);

    const now = new Date("2026-07-06T19:05:00");
    const rows = buildStrata([], { now, count: ARCHIVE_STRATA_ROWS });
    expect(rows.length).toBe(ARCHIVE_STRATA_ROWS);
    expect(rows.map((r) => r.year)).toEqual([2025, 2024, 2023, 2022, 2021]);
    expect(rows.every((r) => !r.lit)).toBe(true);
  });

  test("a memory lights its own year-line at the hour it was taken", () => {
    const now = new Date("2026-07-06T19:05:00");
    const at = new Date(2026, 6, 6, 9, 30);
    const rows = buildStrata([{ year: 2022, at }], { now, count: ARCHIVE_STRATA_ROWS });
    const lit = rows.filter((r) => r.lit);
    expect(lit.map((r) => r.year)).toEqual([2022]);
    expect(lit[0].hour).toBeCloseTo(9.5, 3);
    expect(lit[0].t).toBeGreaterThan(0);
  });
});

test.describe("the hour a photograph was taken", () => {
  // The mark's whole job is being right about when. `localDateTime` carries a
  // trailing Z it does not mean, so reading it through Date would shift a 9am
  // photo to 7pm in Brisbane — a ten-hour lie on the one axis that must not
  // lie. Same trap `localMonthDay` already dodges, one field deeper.
  test("the wall-clock hour is read from the fields, never through Date", () => {
    expect(localHourOf("2011-04-06T09:03:43.000Z")).toBeCloseTo(9.05, 2);
    expect(localHourOf("2019-12-25T18:30:00.000Z")).toBeCloseTo(18.5, 3);
    expect(localHourOf("2019-12-25 06:15:00")).toBeCloseTo(6.25, 3);
    // Whatever the machine's zone, the answer is the one written down.
    const viaDate = new Date("2011-04-06T09:03:43.000Z").getHours();
    expect(localHourOf("2011-04-06T09:03:43.000Z")).toBeCloseTo(9.05, 2);
    if (viaDate !== 9) expect(Math.floor(localHourOf("2011-04-06T09:03:43.000Z"))).not.toBe(viaDate);
  });

  test("no usable time means no mark, not a guessed one", () => {
    expect(localHourOf(null)).toBe(null);
    expect(localHourOf("")).toBe(null);
    expect(localHourOf("2011-04-06")).toBe(null);
  });
});

test.describe("the plate is relocated language, never new language", () => {
  test("year · place · who splits into the plate's three registers", () => {
    expect(captionParts("2019 · Nudgee, Queensland · our niece Melanie")).toEqual({
      year: "2019",
      title: "Nudgee, Queensland",
      who: "our niece Melanie"
    });
  });

  test("a caption with no people still makes a plate; a bare year makes none", () => {
    expect(captionParts("2019 · Otago Harbour, New Zealand")).toEqual({
      year: "2019",
      title: "Otago Harbour, New Zealand",
      who: null
    });
    // We know only the year — the ghost engraving already says it, so the plate
    // stays silent rather than repeating itself in a box.
    expect(captionParts("2019")).toBe(null);
    expect(captionParts(null)).toBe(null);
    expect(captionParts("")).toBe(null);
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
  // The deck: today, the archive's reach of years, and the deep drawer — all
  // allocated once, whatever the day or the album does.
  expect(probe.rows).toBe(ARCHIVE_STRATA_ROWS + 2);
  expect(probe.years).toEqual([2025, 2024, 2023, 2022, 2021]);
  expect(probe.nowHour).toBeCloseTo(12, 1);

  await page.evaluate(() => window.__wakeScreensaver());
  expect(await page.evaluate(() => document.body.classList.contains("fx-archive-active"))).toBe(false);
  expect(pageErrors).toEqual([]);
});

// §4.1. The spine shipped INVISIBLE in the one mode it exists for, and every
// JS assertion passed because the probe read its own bookkeeping. Only
// checkVisibility() on the panel disagreed. This asserts paint, not state.
test("the archive survives the screensaver blank rule — it is what Mode 0 IS", async ({ page }) => {
  await bootArchive(page);
  await engaged(page);

  const vis = await page.evaluate(() => {
    const opts = { opacityProperty: true, visibilityProperty: true };
    const archive = document.querySelector(".archive");
    const row = document.querySelector(".archive__row");
    const card = document.querySelector(".archive__card");
    return {
      blankRuleOn: document.body.classList.contains("screensaver-active"),
      archive: archive.checkVisibility(opts),
      row: row.checkVisibility(opts),
      card: card.checkVisibility(opts),
      // The rule must still be doing its job for everything else.
      hero: getComputedStyle(document.getElementById("focus-hero")).visibility
    };
  });

  expect(vis.blankRuleOn).toBe(true);
  expect(vis.archive).toBe(true);
  expect(vis.row).toBe(true);
  expect(vis.card).toBe(true);
  expect(vis.hero).toBe("hidden");
});

// §6.3.1. Two rulers, two perpendicular meanings, one screen region. The
// archive's plane takes the spine's axis, so the spine stands down — and it is
// HIDDEN, not deleted, which is what makes the flag a one-line rollback.
test("the spine stands down in Mode 0, and comes straight back out of it", async ({ page }) => {
  await bootArchive(page);
  const spineDisplay = () =>
    page.evaluate(() => getComputedStyle(document.getElementById("temporal-spine")).display);

  expect(await spineDisplay()).not.toBe("none");
  await page.evaluate(() => window.__engageScreensaver());
  expect(await spineDisplay()).toBe("none");
  // Still in the document, still keeping its day — only not drawn here.
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

  const awake = await clock();
  expect(awake.size).toBeGreaterThan(100); // the shipped 192px face

  await engaged(page);
  const ambient = await clock();
  // Instantly 64px, not eased into it: the shipped clock carries a
  // `font-size 1s ease` and animating a layout property for a reason the room
  // cannot see is exactly what §5.5 forbids. The demotion is a state.
  expect(ambient.size).toBe(64);
  // Top-left corner, not centred.
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
  expect(normal.plate).toEqual({ year: "2019", title: "Nudgee, Queensland", who: "our niece Melanie" });
  expect(normal.ghost).toBe("2019");
  // 2019 is deeper than the consecutive rows reach, so the deep drawer opened
  // and carries it — lit, at the hour the photograph was taken (§6.2's join).
  expect(normal.lit).toEqual([2019]);
  expect(normal.years.at(-1)).toBe(2019);

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
  expect(held.lit).toEqual([]);

  // And nothing anywhere in the archive is narrating it.
  const words = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".archive *"))
      .map((el) => el.textContent.trim())
      .filter(Boolean)
  );
  expect(words).toEqual([]);
});

// Live-verification regression, 2026-08-02. Every photo in that day's frozen
// set captioned as a bare "2022" — no location, nobody named — which correctly
// yields no plate, but ALSO dropped the year off the wall entirely, losing what
// the old bottom-left caption used to show. The year is read off the caption,
// not out of the plate's parts: the plate needs a place to have anything to
// say; the ghost and the year-line only ever needed the year.
test("a bare-year caption still lights the year, even with no plate to show", async ({ page }) => {
  await bootArchive(page);
  await engaged(page);

  await page.evaluate(() => window.__ssSetFrame({ src: "/photos/a.jpg", caption: "2022" }));
  const probe = await settledPlate(page);
  expect(probe.plate).toBe(null);   // nothing to say — silence is the default
  expect(probe.ghost).toBe("2022"); // …but we know the year, so we say the year
  expect(probe.lit).toEqual([2022]);

  // No caption at all is a different thing, and stays silent.
  await page.evaluate(() => window.__ssSetFrame("/photos/b.jpg"));
  const bare = await settledPlate(page);
  expect(bare.plate).toBe(null);
  expect(bare.ghost).toBe(null);
  expect(bare.lit).toEqual([]);
});

// §6.2's payload: the lit year-line joining forward to today. The album reaches
// back further than the consecutive rows do, so the deck opens one deep drawer
// — and only when it has to. A year already on the deck must not appear twice.
test("the deep drawer opens for a year out of reach, and stays shut for one in it", async ({ page }) => {
  await bootArchive(page);
  await engaged(page);

  // 2023 is on the deck (2025…2021): its own row lights, no drawer.
  await page.evaluate(() =>
    window.__ssSetFrame({ src: "/photos/a.jpg", caption: "2023 · Otago Harbour, New Zealand", hour: 17.2 })
  );
  const near = await settledPlate(page);
  expect(near.lit).toEqual([2023]);
  expect(near.years).toEqual([2025, 2024, 2023, 2022, 2021]);
  expect(near.years.filter((y) => y === 2023).length).toBe(1);

  // 2019 is not: the drawer opens past the gap and carries it.
  await page.evaluate(() =>
    window.__ssSetFrame({ src: "/photos/b.jpg", caption: "2019 · Chiang Mai, Thailand", hour: 9.5 })
  );
  const far = await settledPlate(page);
  expect(far.lit).toEqual([2019]);
  expect(far.years).toEqual([2025, 2024, 2023, 2022, 2021, 2019]);
  expect(await page.evaluate(() =>
    document.querySelector(".archive__row--deep").classList.contains("is-visible"))).toBe(true);

  // …and shuts again behind it.
  await page.evaluate(() =>
    window.__ssSetFrame({ src: "/photos/c.jpg", caption: "2024 · Nudgee, Queensland" })
  );
  const back = await settledPlate(page);
  expect(back.years).toEqual([2025, 2024, 2023, 2022, 2021]);
  expect(await page.evaluate(() =>
    document.querySelector(".archive__row--deep").classList.contains("is-visible"))).toBe(false);
});

// The 24/7 invariant. The archive allocates nothing per mark and nothing per
// memory: six canvases, two images, two echoes, one plate, created once.
test("cycling memories and days never grows the DOM", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await bootArchive(page);
  await engaged(page);

  const shape = () => ({
    total: document.querySelectorAll(".archive *").length,
    rows: document.querySelectorAll(".archive__row").length,
    imgs: document.querySelectorAll(".archive__img").length,
    echoes: document.querySelectorAll(".archive__echo").length,
    plates: document.querySelectorAll(".archive__plate").length
  });

  const before = await page.evaluate(shape);
  expect(before.rows).toBe(ARCHIVE_STRATA_ROWS + 2);
  expect(before.imgs).toBe(2);
  expect(before.echoes).toBe(2);
  expect(before.plates).toBe(1);

  await page.evaluate((m) => {
    for (let i = 0; i < 25; i++) {
      window.__ssSetFrame({ ...m, src: `/photos/m${i}.jpg`, caption: `20${10 + (i % 9)} · Place ${i} · Someone` });
      window.__ssSetFrame("/photos/bare.jpg");
    }
  }, MEMORY);

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

  test("the ruler never moves — a sliding hour axis is a lie about the time", () => {
    // Once the plane means time of day, the reference's ±80px strip drift
    // misreads as ~50 minutes. Nothing that carries the axis may animate.
    const rules = css().match(/[^{}@]+\{[^}]*\}/g) || [];
    for (const rule of rules) {
      const selector = rule.slice(0, rule.indexOf("{"));
      if (!/\.archive__(row|deck)\b/.test(selector)) continue;
      expect(rule, `the deck must not animate: ${selector.trim()}`).not.toMatch(/animation\s*:/);
    }
  });

  test("amplitude follows the sun-altitude curve, with no second night threshold", () => {
    expect(css()).toMatch(/--clock-dim/);           // §5.2 — reuse the curve
    expect(css()).toMatch(/--arch-amp/);            // …applied to displacement
    expect(css()).not.toMatch(/@media[^{]*prefers-color/);
    // Duration must not be what scales: a slow effect that still travels far is
    // what wakes someone up.
    expect(css()).not.toMatch(/animation-duration[^;]*var\(--clock-dim/);
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
