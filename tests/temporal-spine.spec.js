import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  hourOf,
  onSpine,
  spineT,
  weightForScore,
  eventMark,
  triggerMark,
  binMark,
  rainMark,
  buildDay,
  buildStrata,
  languageBudget,
  labelledMarks,
  anchorFor,
  DAY_START_HOUR,
  DAY_END_HOUR,
  MAX_SLOTS,
  STRATA_ROWS,
  WEIGHT_MIN,
  WEIGHT_MAX
} from "../src/js/services/dayModel.js";

/**
 * "The Day, Rendered" v2 — the temporal spine (docs/design/TEMPORAL-SPINE.md).
 *
 * Two halves, matching the module split:
 *   1. dayModel.js is pure, so the geometry, the ember rule, the fixed slot
 *      budget and the language rationing all unit-test in plain node.
 *   2. The runtime is asserted structurally: the spine allocates nothing per
 *      mark, language is a fixed set of reused nodes, and the one continuous
 *      element is bound to a cause (DESIGN_SYSTEM.md §5.1).
 */

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.html");

test.beforeAll(() => {
  if (!existsSync(distIndex)) {
    throw new Error("dist/index.html missing — run `npm run build` before `npm test`");
  }
});

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

// Pin midday: after sunset the screensaver auto-engages at boot, which puts
// presence in AMBIENT and rations every word away (CLAUDE.md — time-of-day
// dependence is a known flake source).
const MIDDAY = new Date("2026-07-06T12:00:00");

/* ───────────────────────── the day model (pure) ───────────────────────── */

test.describe("spine geometry — a fixed day, not a feed", () => {
  test("the spine spans the panel's waking life, and nothing outside it has geometry", () => {
    expect(DAY_START_HOUR).toBe(5);
    expect(DAY_END_HOUR).toBe(24);
    expect(onSpine(5)).toBe(true);
    expect(onSpine(24)).toBe(true);
    expect(onSpine(4.9)).toBe(false);
    expect(onSpine(null)).toBe(false);
  });

  test("position is linear in time — mid-morning looks mid-morning", () => {
    expect(spineT(5)).toBe(0);
    expect(spineT(24)).toBe(1);
    expect(spineT(14.5)).toBeCloseTo((14.5 - 5) / 19, 6);
    // Equal spans of time occupy equal spans of wall.
    expect(spineT(12) - spineT(11)).toBeCloseTo(spineT(20) - spineT(19), 9);
  });

  test("hourOf reads fractional local hours", () => {
    expect(hourOf(new Date("2026-07-06T08:30:00"))).toBeCloseTo(8.5, 6);
    expect(hourOf("not a date")).toBe(null);
  });
});

test.describe("weight is the only hierarchy", () => {
  test("the existing attention score sets weight, and nothing else does", () => {
    expect(weightForScore(40)).toBeCloseTo(WEIGHT_MIN, 6);   // Low band
    expect(weightForScore(100)).toBeCloseTo(WEIGHT_MAX, 6);  // Interrupt band
    expect(weightForScore(70)).toBeGreaterThan(weightForScore(50));
    // Out of band, and absent, both clamp — a mark is never sized by accident.
    expect(weightForScore(9999)).toBeCloseTo(WEIGHT_MAX, 6);
    expect(weightForScore(undefined)).toBeCloseTo(WEIGHT_MIN, 6);
  });
});

test.describe("how each domain lives on the spine", () => {
  const now = new Date("2026-07-06T12:00:00");

  test("a timed calendar event is a mark at its hour", () => {
    const m = eventMark({ id: "e1", title: "Swim pickup", start: new Date("2026-07-06T17:15:00") }, { now });
    expect(m.hour).toBeCloseTo(17.25, 6);
    expect(m.kind).toBe("calendar");
    expect(m.warm).toBe(false);
  });

  test("dinner is a structural anchor — always warm, always the heaviest", () => {
    const m = eventMark({ id: "e2", title: "Meal: Stuffed Capsicums", start: new Date("2026-07-06T18:30:00") }, { now });
    expect(m.warm).toBe(true);
    expect(m.weight).toBe(WEIGHT_MAX);
    expect(m.kind).toBe("meal");
  });

  test("the label is the plain name — no routing prefix, no category glyph", () => {
    // The spine has no icons and no categories, so authoring scaffolding that
    // other surfaces key off must not reach the wall.
    expect(eventMark({ id: "l1", title: "Meal: Stuffed Capsicums", start: new Date("2026-07-06T18:30:00") }, { now }).label)
      .toBe("Stuffed Capsicums");
    expect(eventMark({ id: "l2", title: "🏊 Swim pickup", start: new Date("2026-07-06T17:15:00") }, { now }).label)
      .toBe("Swim pickup");
    // A colon inside an ordinary title is not a prefix and survives intact.
    expect(eventMark({ id: "l3", title: "Physio", start: new Date("2026-07-06T14:30:00") }, { now }).label)
      .toBe("Physio");
  });

  test("an all-day event has no geometry — it lives in language", () => {
    expect(eventMark({ id: "e3", title: "Public holiday", isAllDay: true, start: now }, { now })).toBe(null);
  });

  test("another day's event is not on today's spine", () => {
    expect(eventMark({ id: "e4", title: "Physio", start: new Date("2026-07-07T14:30:00") }, { now })).toBe(null);
  });

  test("an event outside 05:00–24:00 has no geometry", () => {
    expect(eventMark({ id: "e5", title: "Red-eye", start: new Date("2026-07-06T03:10:00") }, { now })).toBe(null);
  });

  test("cameras are never scheduled — they happen, and they leave an ember", () => {
    const at = new Date("2026-07-06T14:14:00").getTime();
    const m = triggerMark({ name: "Front door", at, label: "2:14 pm" });
    expect(m.kind).toBe("camera");
    expect(m.label).toBe("Front door · 2:14 pm");
    // "someone at the door, 2:14" stays readable all afternoon.
    const afternoon = buildDay({ marks: [m], now: new Date("2026-07-06T17:00:00") });
    expect(afternoon.marks[0].spent).toBe(true);
  });

  test("bins are a small weekly evening anchor; no bin night, no mark", () => {
    expect(binMark({ due: true, binsText: "Yellow lid" }, { now }).kind).toBe("bins");
    expect(binMark({ due: false }, { now })).toBe(null);
  });

  test("rain places a mark only when it has a time", () => {
    expect(rainMark({ startsAt: new Date("2026-07-06T20:04:00"), label: "Rain" }).hour).toBeCloseTo(20.0667, 3);
    expect(rainMark({ startsAt: null })).toBe(null);
  });
});

test.describe("passage — the day as it actually went", () => {
  const now = new Date("2026-07-06T13:00:00");
  const at = (h, m = 0) => new Date(2026, 6, 6, h, m).getTime();

  test("marks left of now are embers; marks right of now are anticipation", () => {
    const day = buildDay({
      now,
      marks: [
        { id: "a", at: at(6, 40), hour: 6.67, weight: 1 },
        { id: "b", at: at(18, 30), hour: 18.5, weight: 3, warm: true }
      ]
    });
    expect(day.marks.map((m) => m.spent)).toEqual([true, false]);
  });

  test("an empty afternoon looks like an empty afternoon", () => {
    const day = buildDay({ now, marks: [] });
    expect(day.marks).toEqual([]);
    expect(day.nowT).toBeCloseTo(spineT(13), 6);
  });

  test("now leaves the spine outside the panel's waking life", () => {
    const day = buildDay({ now: new Date("2026-07-06T03:00:00"), marks: [] });
    expect(day.nowHour).toBe(null);
    expect(day.nowT).toBe(null);
  });
});

test.describe("the fixed slot budget — the spine allocates nothing", () => {
  const now = new Date("2026-07-06T13:00:00");

  function fill(n) {
    return Array.from({ length: n }, (_, i) => {
      const hour = 5 + (i / n) * 19;
      return { id: `m${i}`, at: new Date(2026, 6, 6, Math.floor(hour), Math.round((hour % 1) * 60)).getTime(), hour, weight: 1 };
    });
  }

  test("the day never exceeds its slot count", () => {
    expect(buildDay({ marks: fill(MAX_SLOTS + 40), now }).marks.length).toBe(MAX_SLOTS);
  });

  test("overflow evicts the oldest ember — the future is never dropped for the past", () => {
    const day = buildDay({ marks: fill(MAX_SLOTS + 10), now });
    // The very first (earliest, spent) marks are the ones that went.
    expect(day.marks.some((m) => m.id === "m0")).toBe(false);
    // Everything still ahead survived.
    const futureKept = day.marks.filter((m) => !m.spent).length;
    expect(futureKept).toBeGreaterThan(0);
    expect(day.marks.at(-1).spent).toBe(false);
  });

  test("re-reading the same sources overwrites in place rather than growing", () => {
    const marks = fill(10);
    const once = buildDay({ marks, now }).marks.length;
    const twice = buildDay({ marks: [...marks, ...marks], now }).marks.length;
    expect(twice).toBe(once);
  });
});

test.describe("strata — the same axis, years down", () => {
  const now = new Date("2026-07-06T19:05:00");

  test("previous years run as fainter parallel lines beneath", () => {
    const s = buildStrata([], { now });
    expect(s.length).toBe(STRATA_ROWS);
    expect(s.map((r) => r.year)).toEqual([2025, 2024, 2023]);
    expect(s.every((r) => r.lit === false && r.t === null)).toBe(true);
  });

  test("a surfacing memory brightens its own year-line at its hour", () => {
    const s = buildStrata([{ year: 2024, at: new Date("2024-07-06T19:05:00") }], { now });
    const lit = s.find((r) => r.lit);
    expect(lit.year).toBe(2024);
    expect(lit.t).toBeCloseTo(spineT(19.0833), 3);
    expect(s.filter((r) => r.lit).length).toBe(1);
  });

  test("a year with no geometry stays a plain line", () => {
    expect(buildStrata([{ year: 2025, at: new Date("2025-07-06T03:00:00") }], { now })
      .find((r) => r.year === 2025).t).toBe(null);
  });
});

test.describe("presence rations language; the spine never leaves", () => {
  const now = new Date("2026-07-06T13:00:00");
  const at = (h) => new Date(2026, 6, 6, h, 0).getTime();
  const marks = buildDay({
    now,
    marks: [
      { id: "past", at: at(8), hour: 8, weight: 2, label: "Drop-off" },
      { id: "dinner", at: at(18), hour: 18, weight: 3, warm: true, label: "Dinner" },
      { id: "physio", at: at(14), hour: 14, weight: 1.5, label: "Physio" },
      { id: "bins", at: at(19), hour: 19, weight: 2.5, label: "Bins out" },
      { id: "show", at: at(20), hour: 20, weight: 1, label: "The Bear" }
    ]
  }).marks;

  test("nobody home: the day as pure light — no words at all", () => {
    expect(languageBudget("ambient")).toEqual({ utterance: 0, labels: 0 });
  });

  test("passing: the spine speaks once", () => {
    expect(languageBudget("glance")).toEqual({ utterance: 1, labels: 0 });
  });

  test("staying: the next three earn short labels", () => {
    expect(languageBudget("dwell")).toEqual({ utterance: 1, labels: 3 });
  });

  test("voice: the spine holds and stills", () => {
    expect(languageBudget("voice")).toEqual({ utterance: 0, labels: 0 });
  });

  test("the labelled three are the nearest-heaviest ahead — never an ember", () => {
    const picked = labelledMarks(marks, { now });
    expect(picked.length).toBe(3);
    expect(picked.some((m) => m.spent)).toBe(false);
    expect(picked[0].id).toBe("dinner"); // heaviest first — rank is ink, not position
    expect(picked.map((m) => m.id)).not.toContain("past");
  });

  test("never more than three, never a queue", () => {
    expect(labelledMarks(marks, { now, limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  test("an utterance anchors to a real mark, so the hairline lands somewhere true", () => {
    expect(anchorFor(marks, { now }).id).toBe("dinner");
    expect(anchorFor([], { now })).toBe(null);
  });
});

/* ─────────────────────── the runtime (structural) ─────────────────────── */

test.describe("the spine surface", () => {
  test("flag off: no DOM, no body class, no hook — the hero surface is untouched", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await forceFlags({ temporalSpine: false })(page);
    await page.clock.setFixedTime(MIDDAY);
    await page.goto("/");
    await page.waitForFunction(() => Boolean(window.CONFIG));

    expect(await page.locator("#temporal-spine").count()).toBe(0);
    expect(await page.evaluate(() => document.body.classList.contains("temporal-spine-on"))).toBe(false);
    expect(await page.evaluate(() => typeof window.__spine)).toBe("undefined");
    // The surface the spine replaces is still governed by its own visibility
    // rules, not hidden by the spine's. (The hero carries .is-hidden whenever
    // the queue has no winner, so drop it before reading the computed display.)
    expect(await page.evaluate(() => {
      const hero = document.getElementById("focus-hero");
      hero.classList.remove("is-hidden");
      return getComputedStyle(hero).display;
    })).not.toBe("none");
    expect(pageErrors).toEqual([]);
  });

  test("flag on: the spine takes the surface and the centred hero stands down", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await forceFlags({ temporalSpine: true })(page);
    await page.clock.setFixedTime(MIDDAY);
    await page.goto("/");
    await page.waitForFunction(() => typeof window.__spine === "function");

    expect(await page.locator("#temporal-spine canvas.temporal-spine__canvas").count()).toBe(1);
    expect(await page.evaluate(() => document.body.classList.contains("temporal-spine-on"))).toBe(true);
    // The queue survives — it now allocates language, not presence. Both nodes
    // stand down because of the spine's rule, not because they happened to be
    // .is-hidden: drop that class and they must still be gone.
    expect(await page.evaluate(() => ["focus-hero", "focus-stack"].map((id) => {
      const el = document.getElementById(id);
      el.classList.remove("is-hidden");
      return getComputedStyle(el).display;
    }))).toEqual(["none", "none"]);

    const probe = await page.evaluate(() => window.__spine());
    expect(probe.slots).toBe(MAX_SLOTS);
    expect(probe.strata.length).toBe(STRATA_ROWS);
    expect(probe.nowHour).toBeCloseTo(12, 1); // now, placed on the fixed day
    expect(pageErrors).toEqual([]);
  });

  // Live-verification regression, 2026-08-01. The spine shipped invisible in the
  // one mode it exists for: screensaver.css blanks every body child except
  // #screensaver and .recipe-panel, and the spine is a body child. Every
  // JS-level assertion still passed — __spine() reported marks, the utterance
  // class was set — because the probe was reading its own bookkeeping, not paint.
  // Only the kiosk showed it. This asserts the exemption, not the state.
  test("the spine survives the screensaver blank rule — it never leaves", async ({ page }) => {
    await forceFlags({ temporalSpine: true })(page);
    await page.clock.setFixedTime(MIDDAY);
    await page.goto("/");
    await page.waitForFunction(() => typeof window.__spine === "function");

    const vis = await page.evaluate(() => {
      document.body.classList.add("screensaver-active");
      const spine = document.getElementById("temporal-spine");
      const el = document.querySelector(".temporal-spine__canvas");
      const out = {
        spine: getComputedStyle(spine).visibility,
        canvas: getComputedStyle(el).visibility,
        // The rule must still be doing its job for everything else.
        hero: getComputedStyle(document.getElementById("focus-hero")).visibility,
        painted: el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      };
      document.body.classList.remove("screensaver-active");
      return out;
    });

    expect(vis.spine).toBe("visible");
    expect(vis.canvas).toBe("visible");
    expect(vis.painted).toBe(true);
    expect(vis.hero).toBe("hidden"); // the blank rule still blanks everything else
  });

  test("nobody home renders no words and no breath", async ({ page }) => {
    await forceFlags({ temporalSpine: true })(page);
    await page.clock.setFixedTime(MIDDAY);
    await page.goto("/");
    await page.waitForFunction(() => typeof window.__spine === "function");

    await page.evaluate(() => window.__presence("ambient"));
    const probe = await page.evaluate(() => window.__spine());
    expect(probe.mode).toBe("ambient");
    expect(probe.utterance).toBe(null);
    expect(probe.labels).toEqual([]);
    // An empty room has no attention to spend: the one loop is not even armed.
    expect(probe.alive).toBe(false);
  });

  test("the breath is bound to its cause — no media playing, no loop", async ({ page }) => {
    await forceFlags({ temporalSpine: true })(page);
    await page.clock.setFixedTime(MIDDAY);
    await page.goto("/");
    await page.waitForFunction(() => typeof window.__spine === "function");

    // Silence the room FIRST, and mean it. This used to rely on "the stubbed
    // server serves no media" — which was never true: Home Assistant is a live
    // upstream here (unlike the calendars, stubbed 2026-07-31 for exactly this
    // reason), so the test passed only while nothing happened to be playing at
    // the house. With the TV on, `mediaAlive()` correctly returned true and the
    // spine correctly breathed; the assertion, not the spine, was wrong.
    //
    // The claim under test is the BINDING — no media, no loop — so the media
    // has to be removed rather than hoped for. Hiding the panels and then
    // moving presence re-runs update() with a genuinely quiet room.
    await page.evaluate(() => {
      for (const id of ["media-panel-1", "media-panel-2"]) {
        document.getElementById(id)?.classList.add("is-hidden", "is-collapsed");
      }
      window.__presence("dwell");
    });
    expect(await page.evaluate(() => document.body.classList.contains("spine-alive"))).toBe(false);
    expect(await page.evaluate(() =>
      getComputedStyle(document.querySelector(".spine-breath")).animationName)).toBe("none");
  });

  test("language is a fixed set of reused nodes — presence cycling never grows the DOM", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await forceFlags({ temporalSpine: true })(page);
    await page.clock.setFixedTime(MIDDAY);
    await page.goto("/");
    await page.waitForFunction(() => typeof window.__spine === "function");

    // Scoped to the spine's own subtree: this is an assertion about the spine's
    // allocation discipline, and a document-wide count would also be measuring
    // the focus stack's unrelated re-render churn.
    const shape = () => ({
      total: document.querySelectorAll("#temporal-spine *").length,
      labels: document.querySelectorAll(".spine-label").length,
      utterances: document.querySelectorAll(".spine-utterance").length,
      canvases: document.querySelectorAll(".temporal-spine__canvas").length
    });

    const before = await page.evaluate(shape);
    expect(before.labels).toBe(3);
    expect(before.utterances).toBe(1);

    await page.evaluate(() => {
      for (let i = 0; i < 20; i++) {
        window.__presence("ambient");
        window.__presence("glance");
        window.__presence("dwell");
        window.__spineStratum(2019);
        window.__spineStratum(null);
      }
    });

    // The 24/7 invariant: the spine draws its marks into a canvas and reuses its
    // five text nodes, so a day of cycling adds nothing to the document.
    expect(await page.evaluate(shape)).toEqual(before);
    expect(pageErrors).toEqual([]);
  });

  test("a named year lights exactly one stratum", async ({ page }) => {
    await forceFlags({ temporalSpine: true })(page);
    await page.clock.setFixedTime(MIDDAY);
    await page.goto("/");
    await page.waitForFunction(() => typeof window.__spine === "function");

    const year = await page.evaluate(() => new Date().getFullYear() - 2);
    await page.evaluate((y) => window.__spineStratum(y), year);
    const strata = await page.evaluate(() => window.__spine().strata);
    expect(strata.filter((r) => r.lit).map((r) => r.year)).toEqual([year]);

    await page.evaluate(() => window.__spineStratum(null));
    expect(await page.evaluate(() => window.__spine().strata.every((r) => !r.lit))).toBe(true);
  });
});

test.describe("spine css guardrail", () => {
  // The same cause test the atmosphere and atmo-fx guardrails now apply
  // (DESIGN_SYSTEM.md §5.1). The spine is allowed exactly one continuous
  // element, and it must be switched off by the absence of its cause.
  test("the only loop is the breath, and it hangs off body.spine-alive", () => {
    const cssPath = fileURLToPath(new URL("../src/css/components/temporal-spine.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

    const rules = css.match(/[^{}@]+\{[^}]*\}/g) || [];
    const looping = rules.filter((r) => /animation[^;]*\binfinite\b/.test(r));
    expect(looping.length).toBe(1); // one living element, and only one
    expect(looping[0].split("{")[0]).toContain("body.spine-alive");

    // Reduced motion still switches it off in full.
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css.slice(css.indexOf("prefers-reduced-motion"))).toMatch(/animation:\s*none/);

    // Amplitude follows the sun-altitude dim curve rather than a night gate.
    expect(css).toMatch(/--clock-dim/);
    expect(css).not.toMatch(/@media[^{]*prefers-color/); // no second night threshold
  });

  test("no layout-triggering property is animated", () => {
    const cssPath = fileURLToPath(new URL("../src/css/components/temporal-spine.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const transitions = css.match(/transition\s*:[^;]+;/g) || [];
    for (const t of transitions) {
      expect(t, `compositor properties only: ${t}`).not.toMatch(/\b(width|height|top|left|margin|padding)\b/);
    }
  });
});
