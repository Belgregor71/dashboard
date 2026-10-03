import { test, expect } from "@playwright/test";
import { captionParts, localHourOf, relativeYearPhrase } from "../src/js/services/photoMemory.js";
import { plateFor, cardRectFor, CARD_LEFT, CARD_MAX_W } from "../src/js/services/archiveModel.js";

/**
 * The archive's shared model — photoMemory.js and archiveModel.js, which V3's
 * archive (src/v3/core/archive.js) imports for the card geometry and the
 * photograph's hour.
 *
 * Split out of ambient-archive.spec.js on 2026-10-03, when the incumbent
 * surface that spec booted was retired. Its browser half drove /index.html and
 * the incumbent's ambient-archive.css and went with them; V3's archive is
 * covered on the wall by tests/v3-archive*.spec.js. These are the node-side
 * tests of the shared code, kept unchanged.
 */

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

/* ──────────────────── the card follows the print (geometry) ──────────────── */

/**
 * The archive card was a fixed 1040×585 = 1.78:1 rectangle with the photograph
 * `object-fit: cover` inside it, so a phone-shot library was shown through a
 * letterbox it was never composed for. Raised on the panel 2026-08-02.
 *
 * The ruling: the card follows the print. This half is arithmetic, so it is
 * tested as arithmetic — the panel is not the right instrument for asking
 * whether a portrait fouls the ruler.
 */
test.describe("the card follows the print", () => {
  const RULER_LINE_Y = 904;   // drawToday's line, with marks rising above it
  const CLOCK_FLOOR_Y = 190;  // the demoted 64px corner clock + its dateline

  // The hinge, and the reason this flag is safe to flip: 1040/609 = 1.708, so a
  // 16:9 memory is width-bound and lands on the shipped rectangle exactly. If
  // this ever drifts, flipping the flag silently moves the common landscape
  // memory on the wall.
  test("a 16:9 memory lands on the shipped rectangle, to the pixel", () => {
    expect(cardRectFor(16 / 9)).toMatchObject({ w: 1040, h: 585, left: 130, top: 212 });
    // …and so does its echo tile, which was hard-coded 620×349.
    expect(cardRectFor(16 / 9)).toMatchObject({ tileW: 620, tileH: 349 });
  });

  // The two shapes the complaint was actually about. Under `cover` these lost
  // ~25% and ~58% of their height respectively; now they lose nothing.
  test("a 4:3 landscape and a 3:4 portrait each get their own card", () => {
    expect(cardRectFor(4 / 3)).toMatchObject({ w: 812, h: 609, left: 130, top: 200 });
    expect(cardRectFor(3 / 4)).toMatchObject({ w: 457, h: 609, left: 130, top: 200 });
  });

  test("the left edge is pinned — a portrait shortens, it does not slide", () => {
    for (const a of [0.4, 0.5625, 0.75, 1, 1.33, 1.5, 1.78, 2.4, 4]) {
      expect(cardRectFor(a).left).toBe(CARD_LEFT);
    }
  });

  // The most likely place for a surprise (the topic file says so): the plate,
  // the ghost year and the ruler were all positioned against a fixed rectangle.
  // A card that grows must not reach any of them.
  test("no aspect makes the card foul the ruler or the clock", () => {
    for (let a = 0.2; a <= 6; a += 0.05) {
      const r = cardRectFor(a);
      expect(r.w, `aspect ${a.toFixed(2)} is wider than the frame allows`).toBeLessThanOrEqual(CARD_MAX_W);
      expect(r.top, `aspect ${a.toFixed(2)} reaches the corner clock`).toBeGreaterThanOrEqual(CLOCK_FLOOR_Y);
      expect(r.top + r.h, `aspect ${a.toFixed(2)} reaches the today ruler`).toBeLessThan(RULER_LINE_Y - 60);
      // The plate's own left edge is 1920 - 110 - 470 = 1340.
      expect(r.left + r.w, `aspect ${a.toFixed(2)} reaches the plate`).toBeLessThan(1340);
    }
  });

  // A true panorama or a sliver-thin scan would fit to a strip too slight to
  // read as a photograph at all, so those (rare) frames keep a modest crop.
  // Every phone portrait is inside the range and uncropped, which is the point.
  test("only genuinely extreme prints are clamped, and 9:16 is not one", () => {
    expect(cardRectFor(9 / 16).h).toBe(609);                 // uncropped
    expect(cardRectFor(9 / 16).w / cardRectFor(9 / 16).h).toBeCloseTo(9 / 16, 2);
    // A 10:1 panorama is clamped to 3.2:1 rather than becoming a 104px strip.
    expect(cardRectFor(10).w / cardRectFor(10).h).toBeCloseTo(3.2, 1);
  });

  // The echo is the same photograph tiled behind the card. A hard-coded 16:9
  // tile would stretch a portrait — the same lie one plane further back — and a
  // tile that grew with the aspect would change what the echo costs to paint.
  test("the echo tile follows the aspect at constant area", () => {
    const area = (a) => cardRectFor(a).tileW * cardRectFor(a).tileH;
    for (const a of [0.5625, 0.75, 1, 1.33, 1.78, 3]) {
      expect(area(a) / area(16 / 9)).toBeGreaterThan(0.98);
      expect(area(a) / area(16 / 9)).toBeLessThan(1.02);
    }
    expect(cardRectFor(3 / 4).tileW).toBeLessThan(cardRectFor(3 / 4).tileH);
  });

  // null means "leave the card alone", and the card it is left at is today's.
  test("an unmeasurable print reshapes nothing", () => {
    for (const bad of [0, -1, NaN, Infinity, null, undefined, "4:3"]) {
      expect(cardRectFor(bad)).toBe(null);
    }
  });
});
