import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures/coverage.js";
import {
  dayLine,
  memoryHint,
  plateForFrame,
  skyLine,
  yearPositions
} from "../src/v3/core/archive.js";
import { cardRectFor, cardRectForPlane } from "../src/js/services/archiveModel.js";
// The house's own contrast maths, so the archive is judged by the same
// arithmetic the scrim solves with rather than by a second opinion.
import { contrastRatio } from "../src/v3/core/scrim.js";

/* THE AMBIENT ARCHIVE ON V3 — depth 0's other face, behind `v3Archive`.

   Three halves. The pure half pins the decisions that are arithmetic and
   language (where a year sits on the axis, what the plate is allowed to say,
   the card's rectangle) with no DOM and no network. The surface half pins the
   things that are only true on a page — that the flag-off build is a genuine
   no-op, that the layer is visible at depth 0 and nowhere else, that nothing
   grows across exchanges, and that ground.js's own soak metric is untouched.
   The CSS half is the guardrail: it reads the stylesheet as text and refuses a
   loop that is not bound to the cause that ends.

   ⚠ THE STRIP IS THE THIRD YEAR RAIL BUILT FOR THIS SURFACE. The first two were
   rejected on the panel. This one is here on the owner's instruction and the
   spec pins what makes it different: it draws the years the DATE reaches, and
   it lives above the card so the card keeps its full box. A future session
   reading only AMBIENT-ARCHIVE.md's "do not build a third" should read this
   file too. */

// ── The axis ────────────────────────────────────────────────────────────────

test("years are placed by VALUE, so a gap in the library shows as a gap", () => {
  const marks = yearPositions(["2011", "2012", "2023"], "2012");
  expect(marks.map((m) => m.year)).toEqual(["2011", "2012", "2023"]);

  // 2012 is one twelfth of the way from 2011 to 2023, and it must land there —
  // evenly spaced by index it would sit at the halfway point, which would be
  // the axis quietly claiming a year for every slot it draws.
  const [a, b, c] = marks.map((m) => m.x);
  expect((b - a) / (c - a)).toBeCloseTo(1 / 12, 5);
});

test("the axis ends carry headroom, and the numbers are PROJECTED not derived", () => {
  const marks = yearPositions(["2010", "2020"], "2020");
  /* ⚠ THESE ARE MEASURED, NOT CONVERTED — and the version of this test that
     shipped is exactly why. It asserted 228 and 1932 and explained them as
     "the strip bleeds 120px past the left edge, so frame x 108 is canvas x
     228". That arithmetic is wrong: the strip is a canvas on the DECK PLANE
     under the scene's 1400px perspective, which compresses its middle (canvas
     1080 lands at frame 962) and flares its ends. Canvas 1932 is frame 1912,
     eight pixels off the right edge of the glass, so the lit label of any
     memory from the pool's newest year — always the axis maximum — was painted
     half off the screen.

     320 -> frame 298 and 1689 -> frame 1614, probed on the wall. The gap to the
     safe margins (canvas 70 and 1849) is deliberate headroom: a year sitting ON
     the margin still reads as the ruler ending there. The projection itself is
     asserted in "the axis ends land inside the glass" below — this test only
     pins the two numbers so they cannot drift without someone re-measuring. */
  expect(marks[0].x).toBe(320);
  expect(marks[1].x).toBe(1689);
});

test("one year alone is centred, not pinned to the left margin", () => {
  const marks = yearPositions(["2019"], "2019");
  expect(marks).toHaveLength(1);
  // A single mark hard left reads as the start of a scale that has no end.
  expect(marks[0].x).toBe(320 + (1689 - 320) / 2);
  expect(marks[0].lit).toBe(true);
});


test("years are de-duplicated and sorted, and only the card's year is lit", () => {
  const marks = yearPositions(["2019", "2011", "2019", "2015"], "2015");
  expect(marks.map((m) => m.year)).toEqual(["2011", "2015", "2019"]);
  expect(marks.filter((m) => m.lit).map((m) => m.year)).toEqual(["2015"]);
});

test("an empty or unparseable pool draws no axis at all", () => {
  // A date with no memories has no year axis, and saying nothing is better than
  // inventing one.
  expect(yearPositions([], "2019")).toEqual([]);
  expect(yearPositions(null, null)).toEqual([]);
  expect(yearPositions(["", "not-a-year"], "")).toEqual([]);
});

// ── The plate ───────────────────────────────────────────────────────────────

const asset = (extra = {}) => ({
  id: "a",
  localDateTime: "2019-08-18T09:14:00Z",
  city: "Nudgee",
  country: "Australia",
  people: [],
  ...extra
});

test("the plate names the place, the year and who was there", () => {
  const plate = plateForFrame([asset({ people: ["Melanie"] })], new Date("2026-08-18"));
  expect(plate).toEqual({ year: "2019", title: "Nudgee", who: "Melanie" });
});

test("with no place the plate STILL SPEAKS — it says the year in words", () => {
  /* ⚠ The 2026-08-02 finding, re-learned here rather than re-derived: most of
     this library has no GPS and nobody named, so a place-only title left the
     plate absent on most days. A whole day's set captioned as bare years is not
     an edge case, it was 100% of the surface. */
  const plate = plateForFrame([asset({ city: null, country: null })], new Date("2026-08-18"));
  expect(plate).toEqual({ year: "2019", title: "Seven years ago today", who: null });
});

test("no year at all means no plate: silence is the default", () => {
  expect(plateForFrame([asset({ localDateTime: null })])).toBeNull();
  expect(plateForFrame([])).toBeNull();
  expect(plateForFrame(null)).toBeNull();
});

test("a diptych gets ONE plate, and its year is the earlier half", () => {
  const plate = plateForFrame(
    [asset({ localDateTime: "2019-08-18T09:00:00Z" }), asset({ id: "b", localDateTime: "2016-08-18T09:00:00Z" })],
    new Date("2026-08-18")
  );
  // The pair is one moment on the wall; two eyebrows would be the feature
  // announcing itself.
  expect(plate.year).toBe("2016");
});

test("a trip never reaches the engraved year — 'Mexico 2017' is a line, not a numeral", () => {
  const plate = plateForFrame([asset({ trip: "Mexico 2017", city: null, country: null })]);
  expect(plate.year).toBe("2019");
});

// ── The card's rectangle ────────────────────────────────────────────────────

test("a 16:9 memory lands on the shipped rectangle, to the pixel", () => {
  /* The hinge that makes this a PORT rather than a redesign of the geometry:
     the common landscape memory must sit exactly where the incumbent put it, so
     the two surfaces can be compared frame to frame. */
  expect(cardRectFor(16 / 9)).toMatchObject({ w: 1040, h: 585, left: 130, top: 212 });
});

test("a portrait gets a portrait card and nothing is cut", () => {
  expect(cardRectFor(3 / 4)).toMatchObject({ w: 457, h: 609, left: 130, top: 200 });
});

test("a diptych of two portraits fits as one wide card", () => {
  // Two 3:4 halves side by side = a combined aspect of 1.5, which is
  // height-bound: 609 tall, 913 wide, still inside the box.
  const rect = cardRectFor(0.75 + 0.75);
  expect(rect.h).toBe(609);
  expect(rect.w).toBe(914);
  expect(rect.left).toBe(130);
});

// ── ONE PLANE: what the glass says ──────────────────────────────────────────

/* The three lines depth 0 gained with `v3ArchivePlane`. All pure, all able to
   return NULL, and the null case is the one that matters: a wall that says
   "Unavailable" or "0 memories" is worse than a wall that says nothing. */

test("the day is the day, with no year on it", () => {
  // No comma, no year. The archive already engraves a year — the MEMORY's — and
  // two four-digit numbers meaning different things is the confusion the
  // deleted spine was making.
  /* ⚠ THE DESIGN CANVAS'S SPECIMEN READS "Thursday 4 September" AND 2026-09-04
     IS A FRIDAY. Caught here on the first run. A specimen is typeset to show
     the shape of a line, and copying its words into an assertion turns a
     drawing into a claim about the calendar. */
  expect(dayLine(new Date("2026-09-04T09:00:00"))).toBe("Friday 4 September");
  expect(dayLine(new Date("2026-01-01T09:00:00"))).toBe("Thursday 1 January");
  expect(dayLine(new Date("2026-12-31T23:30:00"))).toBe("Thursday 31 December");
});

test("the sky is one line: now, what it is doing, and the day's range", () => {
  expect(
    skyLine({
      now: { temp_c: 22.4, condition: { label: "Partly cloudy" } },
      day: { low_c: 13.6, high_c: 25.2 }
    })
  ).toBe("22° · partly cloudy · 14° / 25°");
});

test("the sky NEVER says the fetch failed — that is the pill's job", () => {
  /* ⚠ THE REAL FALLBACK SHAPE. `/api/weather/now` answers a 502 with every
     field null and the literal label "Unavailable", and rendering that spends a
     line of the calmest surface in the house telling the room about a fetch.
     The fault pill is already on this screen and already says it properly. */
  expect(
    skyLine({
      now: { temp_c: null, condition: { label: "Unavailable" } },
      day: { low_c: null, high_c: null }
    })
  ).toBeNull();
  expect(skyLine(null)).toBeNull();
  expect(skyLine({})).toBeNull();
});

test("the sky survives losing any part of itself", () => {
  // Each clause is added only if it is real, so a partial answer is still a
  // line rather than a line with a hole in it.
  expect(skyLine({ now: { temp_c: 19 }, day: {} })).toBe("19°");
  expect(skyLine({ now: {}, day: { low_c: 8, high_c: 17 } })).toBe("8° / 17°");
  // Half a range is not a range — it is a number nobody can place.
  expect(skyLine({ now: { temp_c: 19 }, day: { high_c: 17 } })).toBe("19°");
});

test("the spine's surviving sentence counts memories, and says nothing at zero", () => {
  expect(memoryHint(6)).toBe("six memories from this date");
  // One is still worth saying, and it is not "one memories".
  expect(memoryHint(1)).toBe("one memory from this date");
  // Past twelve the numeral is the calmer object.
  expect(memoryHint(17)).toBe("17 memories from this date");
  /* ⚠ ZERO IS NULL, NOT "no memories". The pool is empty before the day's fetch
     lands and on the random fallback, so a wall that renders this eagerly says
     "no memories from this date" over a photograph from this date. */
  expect(memoryHint(0)).toBeNull();
  expect(memoryHint(null)).toBeNull();
  expect(memoryHint(undefined)).toBeNull();
});

// ── ONE PLANE: the card's rectangle ─────────────────────────────────────────

test("the plane's card is a DIFFERENT box, and the two must not be merged", () => {
  /* The shipped card is laid out for three axes under a 1400px lens; the plane
     is one axis under 2800px with the perspective-origin and the plane's own
     transform-origin on the same point. Those are different projections, so the
     plane-space rectangle that lands where a person wants it is a different
     rectangle — and sharing constants would mean tuning one silently moved the
     other, while only one of them is ever on the glass. */
  expect(cardRectForPlane(16 / 9)).toEqual({ w: 978, h: 550, left: 88, top: 249 });
  expect(cardRectFor(16 / 9)).toMatchObject({ w: 1040, h: 585, left: 130 });

  /* ⚠ AND A WIDTH-BOUND ASPECT, WHICH IS THE ONLY ONE THAT CAN SEE `maxW`.
     Found by injecting the defect: raising PLANE_CARD_MAX_W from 1000 to 1040
     left the line above completely unmoved, because at 16:9 the card is
     HEIGHT-bound — 550 caps first and the width falls out of it. The hinge is
     1000/550 = 1.818, so anything wider than that is width-bound. A 2:1
     panorama is the case that reads the constant. */
  expect(cardRectForPlane(2)).toEqual({ w: 1000, h: 500, left: 88, top: 274 });
});

test("the plane's card follows the print too, and pins its left edge", () => {
  const portrait = cardRectForPlane(3 / 4);
  expect(portrait.h).toBe(550);
  expect(portrait.w).toBe(413);
  // PINNED, same reasoning as CARD_LEFT: a portrait simply does not reach as far
  // right, and nothing else on the wall shifts.
  expect(portrait.left).toBe(88);
  expect(cardRectForPlane(16 / 9).left).toBe(88);
  // Grown about one centre, so the card does not drop toward the hour.
  expect(portrait.top + portrait.h / 2).toBeCloseTo(524, 1);
});

test("the plane's card has no echo tile, because there is no tiled echo", () => {
  // One masked ghost covering a photograph, never a grid — so there is nothing
  // to size. A tileW here would be a constant with no reader.
  const rect = cardRectForPlane(16 / 9);
  expect(rect.tileW).toBeUndefined();
  expect(rect.tileH).toBeUndefined();
  expect(cardRectForPlane(0)).toBeNull();
  expect(cardRectForPlane(NaN)).toBeNull();
});

// ── On the page ─────────────────────────────────────────────────────────────

/* A 1x1 PNG: `load` must fire and naturalWidth must be non-zero so the card can
   measure a real aspect. Nothing here asserts what the picture looks like. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const POOL = [
  { id: "a", aspect: 1.78, localDateTime: "2011-08-18T09:00:00Z", city: "Nudgee", people: [] },
  { id: "b", aspect: 1.78, localDateTime: "2015-08-18T09:00:00Z", city: "Nudgee", people: [] },
  { id: "c", aspect: 1.78, localDateTime: "2019-08-18T09:00:00Z", city: "Nudgee", people: [] },
  { id: "d", aspect: 1.78, localDateTime: "2023-08-18T09:00:00Z", city: "Nudgee", people: [] }
];

/**
 * Boot V3 with the archive's flag PINNED, never inherited.
 *
 * Pinned because flipping it back is the rollback path, and the off state has
 * to keep being tested after the default moves — the ambientSubstrate lesson,
 * where a flip broke specs that had assumed the old default.
 */
/* ⚠ PIN THE CLOCK. `:root[data-night="1"]` hides #ground-caption outright, and
   V3 decides night off the sun's altitude — so on a machine running this after
   sunset the caption is invisible for a reason that has nothing to do with the
   archive, and the law-3 assertion below passes or fails by time of day. */
const MIDDAY = new Date("2026-07-06T12:00:00");

/* ⚠ `v3ArchivePlane` IS PINNED OFF BY DEFAULT, never inherited, for the reason
   the note below gives about `v3Archive`: flipping it back is the rollback path
   and the off state has to keep being tested after the default moves. Every
   test above the plane block runs the composition that is on the wall today;
   every test that passes `v3ArchivePlane: true` runs the rebuild. */
async function bootArchive(
  page,
  {
    v3Archive = true,
    v3ArchivePlane = false,
    groundMemories = true,
    groundDiptych = false,
    pool = POOL,
    weather = null
  } = {}
) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(MIDDAY);

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        `\nwindow.CONFIG.features.v3Archive = ${v3Archive};` +
        `\nwindow.CONFIG.features.v3ArchivePlane = ${v3ArchivePlane};` +
        `\nwindow.CONFIG.features.groundMemories = ${groundMemories};` +
        `\nwindow.CONFIG.features.groundDiptych = ${groundDiptych};\n`
    });
  });

  /* ⚠⚠ SEVER THE VOICE BUS. `voiceBus` is process-wide and initVoice is called
     with a hardcoded `enabled: true` (main.js), so EVERY V3 page in the suite
     subscribes to /api/voice/stream — and one transcript POSTed by a voice spec
     in another worker is delivered to all of them. That is what put
     "show me the driveway" on this spec's page and drove it off the depth this
     file had just set: it went red on a transcript it never sent.

     Answered with a non-`text/event-stream` body rather than aborted, because
     the EventSource spec fails the connection permanently on a wrong MIME type.
     An abort would look identical here and reconnect every three seconds for
     the life of the test. */
  await page.route("**/api/voice/stream", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "" })
  );

  /* ⚠ WITHOUT THIS THE SKY IS CORRECTLY SILENT. The suite runs with the
     upstreams stubbed off, so `/api/weather/now` answers its fallback — every
     field null, condition "Unavailable" — and `skyLine` refuses it, which is the
     behaviour the pure test above pins. A spec that wants to see the line on
     the glass has to hand the page a sky, and asserting the resulting TEXT is
     the only way to know the line came from this payload rather than from
     whatever else the page decided to put in that corner. */
  if (weather) {
    await page.route("**/api/weather/now", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(weather) })
    );
  }

  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: pool }) })
  );
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG })
  );

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__ground === "function");
  return pageErrors;
}

/* A sky the house actually knows, in the shape `/api/weather/now` answers. */
const WEATHER = {
  location: { name: "Brisbane", tz: "Australia/Brisbane" },
  now: {
    temp_c: 22.4,
    feels_like_c: 23.1,
    condition: { code: 2, label: "Partly cloudy", icon: "cloudy", intensity: null, thunder: false },
    wind_kph: 11,
    wind_bearing: 90,
    cloud_pct: 40,
    humidity_pct: 58,
    uv: 4,
    rain_chance_pct: 10
  },
  day: { high_c: 25.2, low_c: 13.6, sunrise: "06:05", sunset: "17:40" }
};

/* ⚠⚠ `weatherFallbackNow()`, COPIED FROM THE SERVER — every field null and the
   literal label "Unavailable". This exists because of an injected defect that
   came back GREEN: the "no sky" test below was serving nothing at all, so
   `/api/weather/now` 502'd, `loadWeather` returned on `!res.ok`, and
   `archiveSky` was never called. The test was passing because the line never
   arrived — not because `skyLine` refused it — so re-introducing the
   `Number(null) === 0` defect did not move it. A route that answers 200 with
   this is what actually reaches the refusal. */
const WEATHER_UNKNOWN = {
  location: { name: "Unavailable", tz: "UTC" },
  now: {
    temp_c: null,
    feels_like_c: null,
    condition: { code: null, label: "Unavailable", icon: null, intensity: null, thunder: false },
    wind_kph: null,
    wind_bearing: null,
    cloud_pct: null,
    humidity_pct: null,
    uv: null,
    rain_chance_pct: null
  },
  day: { high_c: null, low_c: null, sunrise: null, sunset: null }
};

const groundShown = (page) =>
  expect.poll(() => page.evaluate(() => window.__ground().shown), { timeout: 10_000 }).toBe(true);

test("flag OFF is a genuine no-op — no nodes, no marker, no hook", async ({ page }) => {
  const pageErrors = await bootArchive(page, { v3Archive: false });
  await groundShown(page);

  const probe = await page.evaluate(() => ({
    children: document.getElementById("archive").children.length,
    marker: document.documentElement.dataset.archive ?? null,
    hook: typeof window.__archive,
    // The host is in index.html either way; it must paint NOTHING, not even the
    // opaque background it carries when the flag is on.
    visible: document.getElementById("archive").checkVisibility({ opacityProperty: true }),
    captionVisible: document
      .getElementById("ground-caption")
      .checkVisibility({ opacityProperty: true }),
    layers: window.__ground().layers
  }));

  expect(probe.children).toBe(0);
  expect(probe.marker).toBeNull();
  expect(probe.hook).toBe("undefined");
  expect(probe.visible).toBe(false);
  // Depth 0 is exactly the surface that shipped: full-bleed photograph, scrim,
  // and the caption doing the talking.
  expect(probe.captionVisible).toBe(true);
  expect(probe.layers).toBe(1);

  expect(pageErrors).toEqual([]);
});

test("flag on: the composition is up at depth 0 and the caption stands down", async ({ page }) => {
  const pageErrors = await bootArchive(page);
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().lit)).toBeTruthy();

  const probe = await page.evaluate(() => ({
    ...window.__archive(),
    visible: document.getElementById("archive").checkVisibility({ opacityProperty: true }),
    captionVisible: document
      .getElementById("ground-caption")
      .checkVisibility({ opacityProperty: true }),
    layers: window.__ground().layers,
    imgs: window.__ground().imgs
  }));

  expect(probe.visible).toBe(true);
  expect(probe.ghosts).toBe(2);
  /* TWO slots, one photograph each, allocated once and never grown. It was
     four — two slots x two halves — while the card could hold a diptych. It
     cannot: a pair is unfolded into two exchanges instead. */
  expect(probe.slots).toBe(2);
  expect(probe.years).toEqual(["2011", "2015", "2019", "2023"]);
  expect(probe.years).toContain(probe.lit);
  expect(probe.plate).not.toBeNull();
  expect(probe.plate.title).toBe("Nudgee");

  /* A single photograph ARMS NOTHING. The half-hold timer exists only to unfold
     a pair, and a pending timer here — on the flag-off-diptych path, which is
     most days — would be one dangling `setTimeout` per rotation forever on a
     page that never reloads. That is the leak class this house has paid for
     twice, so it is asserted rather than reasoned about. */
  expect(probe.frame).toBe(1);
  expect(probe.half).toBe(0);
  expect(probe.pendingHalf).toBe(false);

  // The plate says who/where/when now, so the caption would be the same fact
  // told twice.
  expect(probe.captionVisible).toBe(false);

  /* ⚠ ground.js's own metric MUST BE UNTOUCHED. `layers` is what the soak reads
     to decide the ground is leaking; the archive's <img>s live in its own host
     precisely so this stays 1. */
  expect(probe.layers).toBe(1);
  expect(probe.imgs).toBe(1);

  expect(pageErrors).toEqual([]);
});

test("TWO ghosts, not thirty — and the strip is not one of them", async ({ page }) => {
  await bootArchive(page);
  await groundShown(page);

  const probe = await page.evaluate(() => ({
    /* offsetWidth, NOT getBoundingClientRect: the ghosts sit on a rotated plane
       under a 1400px perspective, so the client rect is the PROJECTION and a
       1060px ghost measures 630. The number that says "this is one big
       enlargement, not a 620px tile" is the layout width. */
    ghosts: [...document.querySelectorAll(".archive__ghost")].map((el) => ({
      w: el.offsetWidth,
      h: el.offsetHeight
    })),
    // A repeating background is exactly what "too many tiles" meant. Each ghost
    // is one photograph, covered — never tiled.
    repeats: [...document.querySelectorAll(".archive__ghost-skin")].map(
      (el) => getComputedStyle(el).backgroundRepeat
    )
  }));

  expect(probe.ghosts).toHaveLength(2);
  expect(probe.repeats.every((r) => r === "no-repeat")).toBe(true);
  // Big: each is a large fraction of a 1920-wide frame, not a 620px tile.
  for (const g of probe.ghosts) expect(g.w).toBeGreaterThan(700);
});

test("the strip takes the empty top band and never reaches the card or the hour", async ({ page }) => {
  await bootArchive(page);
  await groundShown(page);

  const probe = await page.evaluate(() => {
    const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
      strip: rect(".archive__strip"),
      card: rect(".archive__card-plane"),
      hour: document.getElementById("hour").getBoundingClientRect()
    };
  });

  /* THE WHOLE REASON THE STRIP TOOK THE HIGH SLOT. Build 1's year axis was
     rejected partly for shrinking the card to 53% of its area to make room;
     this one costs the photograph nothing because at depth 0 the top band holds
     nothing at all. Measured as PAINTED boxes, not as stylesheet numbers — both
     planes are rotated and the projection is what a person sees. */
  expect(probe.strip.bottom).toBeLessThanOrEqual(probe.card.top);
  expect(probe.strip.top).toBeGreaterThan(0);
  // The hour keeps its 168px bottom-left corner, untouched by any of this.
  expect(probe.strip.bottom).toBeLessThan(probe.hour.top);
  // And the card is still the hero: the shipped 1040-wide box, or taller-and-
  // narrower for a portrait, never a strip of one.
  expect(probe.card.height).toBeGreaterThan(400);
});

test("the axis ends land inside the glass, with the lit label whole", async ({ page }) => {
  /* ⚠⚠ THE GUARD THE SHIPPED SURFACE DID NOT HAVE, and the reason it shipped
     broken: every other number in core/archive.js's geometry block was measured
     against the projection, but the axis was DERIVED in canvas space
     (`MARGIN - STRIP_LEFT`) as though the strip mapped 1:1 to the frame. It
     does not — it is a canvas on the deck plane under a 1400px perspective —
     and a unit test on canvas coordinates cannot tell. So this one projects.

     What it is really protecting: the pool's newest year is ALWAYS the axis
     maximum, so if that end sits at the frame edge, every memory from the most
     recent year gets its 48px lit label painted half off the screen. That is a
     defect a person sees on the wall and no canvas-space assertion can. */
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  // The public seam gives the endpoints: two years an axis apart put a mark on
  // each end, whatever the constants happen to be.
  const [x0, x1] = yearPositions(["2000", "2100"], "2000").map((m) => m.x);

  const ends = await page.evaluate(([a, b]) => {
    const s = document.querySelector(".archive__strip");
    const cs = getComputedStyle(s);
    /* A div carrying the strip's own box and transform, so its children project
       exactly as canvas pixels do. Inserted and removed inside one evaluate —
       nothing observes the subtree, and nothing is left on the page. */
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;left:${cs.left};top:${cs.top};` +
      `width:${cs.width};height:${cs.height};transform:${cs.transform};pointer-events:none;`;
    for (const x of [a, b]) {
      const m = document.createElement("i");
      m.style.cssText = `position:absolute;left:${x}px;top:0;width:1px;height:1px;`;
      probe.appendChild(m);
    }
    s.parentNode.appendChild(probe);
    const out = [...probe.children].map((c) => c.getBoundingClientRect().left);
    probe.remove();
    return out;
  }, [x0, x1]);

  const FRAME = 1920;
  const SAFE = 108;              // V3's safe margin, the same one every surface uses
  const LIT_HALF = 58;           // half a four-digit label at 48px tabular

  // 1 — the whole lit label, at either end, inside the safe margin. This is the
  //     assertion the shipped axis failed: its right end projected to 1912.
  expect(ends[0] - LIT_HALF, `left end projects to ${Math.round(ends[0])}`)
    .toBeGreaterThanOrEqual(SAFE);
  expect(ends[1] + LIT_HALF, `right end projects to ${Math.round(ends[1])}`)
    .toBeLessThanOrEqual(FRAME - SAFE);

  // 2 — and headroom beyond that, so the outermost year does not read as the
  //     ruler stopping. The ruling itself still runs off both edges.
  expect(ends[0]).toBeGreaterThanOrEqual(SAFE + 150);
  expect(FRAME - ends[1]).toBeGreaterThanOrEqual(SAFE + 150);

  expect(pageErrors).toEqual([]);
});

test("the layer is depth 0's, and recedes to the full-bleed photograph above it", async ({ page }) => {
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  /* ⚠ POLLED, NOT SLEPT. This was `waitForTimeout(500)` against a 350ms
     `--m-calm` — 150ms of slack — and the layer's `visibility` flips on a
     `transition: visibility 0s linear var(--m-calm)`, i.e. at exactly 350ms
     after the class lands. Under full-suite load that 500ms is a budget for the
     whole browser rather than for this transition, and the check ran while the
     layer was still visible: seen red at depth 1 on 2026-09-05. A fixed sleep
     compared to an exact value is a test that passes on an idle machine, which
     is the flake class this repo root-causes rather than retries. */
  const at = async (depth, shown) => {
    await page.evaluate((d) => window.__setDepth(d, "spec"), depth);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.getElementById("archive").checkVisibility({ opacityProperty: true })
        )
      )
      .toBe(shown);
  };

  await at(0, true);
  /* Depth 1+ is BYTE-IDENTICAL to today's backdrop — the full-bleed photograph
     and the solved scrim — which is also the flag-off state. That is why the
     rollback is exercised in production on every doorbell rather than only at
     revert time. */
  await at(1, false);
  await at(3, false);
  // And it comes back, because recession is always automatic and always
  // downhill: nothing can get stuck deep.
  await at(0, true);

  expect(pageErrors).toEqual([]);
});

test("nothing grows across exchanges, and one timer never becomes many", async ({ page }) => {
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  const count = () => page.evaluate(() => window.__archive().nodes);
  const before = await count();

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__groundDissolve(20, 200));
    await expect.poll(() => page.evaluate(() => window.__ground().inFlight)).toBe(false);
  }
  /* ⚠ PAST THE EXCHANGE CLEANUP (settle 20 + 2000 buffer) AND PAST THE BLUR'S
     RECOVERY. `getAnimations()` counts CSS TRANSITIONS, not only keyframe
     animations, so the card's `transition: filter 2.8s` — armed when the
     exchange blur comes off at 300ms — is a sixth entry until ~3.1s. It read
     six here the moment the blur landed. Sampling inside that window would pin
     a number that means "we happened to look while the card was un-blurring",
     which is the timing-dependence the `anims` comment below warns about. */
  await page.waitForTimeout(3400);

  /* A page that runs for weeks may not grow. Every node the archive will ever
     have is built once; an exchange swaps `src` and two class names. */
  expect(await count()).toBe(before);

  const probe = await page.evaluate(() => ({
    ...window.__archive(),
    layers: window.__ground().layers,
    /* Exactly one PAINTING slot once the settle is over. Both would mean the
       outgoing layer is compositing for nobody, forever.
       ⚠ `:not([data-blank="1"])` matters: a slot that has never held a
       photograph keeps its classes off but is display:none either way, and this
       keeps the count about pictures rather than about elements. */
    top: document.querySelectorAll('.archive__img.is-top:not([data-blank="1"])').length,
    shown: document.querySelectorAll('.archive__img.is-shown:not([data-blank="1"])').length
  }));

  expect(probe.slots).toBe(2);
  expect(probe.ghosts).toBe(2);
  expect(probe.layers).toBe(1);
  /* The soak's own numbers, pinned so a later change cannot move them silently.

     ⚠ THE SAMPLE POINT IS NOW PART OF THE ASSERTION. arch-kenburns became a
     SETTLE — a 96s one-shot that restarts on every exchange (archive.css) — so
     `anims` counts five while a photograph is coming to rest and four once it
     has. We are 2.2s past the last exchange, mid-settle, so five.

     ⚠ AND `anims` COUNTS TRANSITIONS TOO — see the wait above. Five here means
     four loops plus the settle, with the blur's recovery already finished.

     `loops` is the number that does not move with the clock: the animations
     that never end on their own. FOUR at depth 0 in daylight, three after dark
     (the engraved year is hidden then and must not animate for nobody). It read
     five before the settle landed, and that fifth forever-loop was the whole of
     depth 0's 2.4-point overage against §5.4's 25% ceiling — 6.3 points on the
     wall, measured A/B/A. If it ever reads five again, that is the regression. */
  expect(probe.anims).toBe(5);
  expect(probe.loops).toBe(4);
  expect(probe.top).toBe(1);
  expect(probe.shown).toBe(1);

  expect(pageErrors).toEqual([]);
});

/* ── A pair is UNFOLDED, never laid side by side ─────────────────────────────
   `ground.js` pairs portraits behind `groundDiptych` and the full-bleed wall at
   depths 1-3 shows them side by side. The CARD does not, and never did anything
   else with them before 2026-08-22: it re-presented whatever arrived, so a pair
   landed as two 457px prints either side of a seam — a collage of a collage.

   These two specs pin the SPLIT: ground still pairs (`imgs` 2) while the card
   holds one (`shown` 1), and the partner is not thrown away, it takes the card
   on its own timer with its own words. Showing only half one would be a smaller
   diff and would quietly cost depth 0 half of every portrait in the library. */

/* Two same-year pairs, both morning-then-evening, so the SHUFFLE cannot make
   the order ambiguous: pairing sorts each year's group by time, so half one is
   always the morning frame and half two always the evening one — and they carry
   different cities so the plate has something to be wrong about.
   ⚠ Ids are long and distinct on purpose. A single-letter id is a substring of
   every URL in the fixture, which is how an assertion here has gone green
   against an injected defect before; these are matched WHOLE, never contained. */
const PAIR_POOL = [
  { id: "pair-alpha-morning", aspect: 0.75, localDateTime: "2015-08-18T08:00:00Z", city: "Nudgee", people: [] },
  { id: "pair-alpha-evening", aspect: 0.75, localDateTime: "2015-08-18T19:00:00Z", city: "Sandgate", people: [] },
  { id: "pair-beta-morning", aspect: 0.75, localDateTime: "2019-08-18T08:00:00Z", city: "Nudgee", people: [] },
  { id: "pair-beta-evening", aspect: 0.75, localDateTime: "2019-08-18T19:00:00Z", city: "Sandgate", people: [] }
];
const pairOf = (id) => id.split("-")[1];

test("a diptych pair reaches the card ONE PHOTOGRAPH AT A TIME", async ({ page }) => {
  const pageErrors = await bootArchive(page, { groundDiptych: true, pool: PAIR_POOL });
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().lit)).toBeTruthy();

  const probe = await page.evaluate(() => ({
    ...window.__archive(),
    groundImgs: window.__ground().imgs,
    layers: window.__ground().layers
  }));

  /* ⚠⚠ THIS PAIR OF NUMBERS IS THE WHOLE FEATURE, and neither means anything
     alone. `groundImgs` 2 says the full-bleed diptych is still being built —
     lose that and this stopped being a change to the archive and became a
     removal of the diptych. `shown` 1 says the card took one of them. */
  expect(probe.groundImgs).toBe(2);
  expect(probe.frame).toBe(2);
  expect(probe.shown).toBe(1);

  // Half one is up and its partner is owed, not dropped.
  expect(probe.half).toBe(0);
  expect(probe.pendingHalf).toBe(true);

  /* AND THE CARD IS SHAPED FOR ONE PHOTOGRAPH. The fit reads the decoded
     rendition, and the fixture decodes 1x1 — so a card built for the pair would
     ask for `cardRectFor(2)`, a 1040-wide landscape plate, and a card built for
     one asks for `cardRectFor(1)`. The rectangle is what makes this a real
     re-composition rather than a hidden second half. */
  expect(probe.card.wanted).toEqual(cardRectFor(1));
  expect(probe.card.wanted).not.toEqual(cardRectFor(2));

  // ground.js's soak metric is still counting photographs, not elements.
  expect(probe.layers).toBe(1);

  expect(pageErrors).toEqual([]);
});

test("the partner takes the card on its own timer, and the words go with it", async ({ page }) => {
  /* ⚠ OBSERVED, NEVER SAMPLED — the same rule the blur and the plate specs
     below run on. Half one holds the card for a bounded window and polling for
     "what is up at t=400ms" is a race with the thing under test. Both sequences
     are recorded by mutation, so the assertion is about ORDER and cannot pass
     by looking at the right moment. */
  const pageErrors = await bootArchive(page, { groundDiptych: true, pool: PAIR_POOL });
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().frame)).toBe(2);

  /* Half a rotation is five minutes on the wall, which is not a test. The lever
     is the same shape as __archiveGain/__archiveGhost and takes effect on the
     NEXT frame, so the dissolve below is what actually exercises it. 2000ms is
     comfortably past the plate's own swap (~300ms) — at a shorter hold half one
     would be replaced before its words ever landed, which would make this spec
     pass for the wrong reason. */
  expect(await page.evaluate(() => window.__archiveHalfHold(2000))).toBe(2000);

  await page.evaluate(() => {
    window.__cardIds = [];
    window.__plateTitles = [];
    const card = document.querySelector(".archive__card");
    new MutationObserver((recs) => {
      for (const r of recs) {
        const id = r.target.src?.match(/\/asset\/([^/]+)\/thumb/)?.[1];
        if (id && window.__cardIds.at(-1) !== id) window.__cardIds.push(id);
      }
    }).observe(card, { subtree: true, attributes: true, attributeFilter: ["src"] });

    const title = document.querySelector(".archive__title");
    new MutationObserver(() => {
      const t = title.textContent;
      if (t && window.__plateTitles.at(-1) !== t) window.__plateTitles.push(t);
    }).observe(title, { subtree: true, childList: true, characterData: true });
  });

  // A fresh frame, briskly, so the recorded sequence starts at a known point.
  await page.evaluate(() => window.__groundDissolve(60, 200));

  await expect.poll(() => page.evaluate(() => window.__archive().half), {
    timeout: 10_000,
    message: "half two never took the card — a pair the wall shows once is a pair it half-loses"
  }).toBe(1);
  // And nothing is still owed once it has: one timer per frame, not a chain.
  await expect.poll(() => page.evaluate(() => window.__archive().pendingHalf)).toBe(false);

  const ids = await page.evaluate(() => window.__cardIds);
  expect(ids).toHaveLength(2);
  const [first, second] = ids;
  expect(first).toMatch(/-morning$/);
  expect(second).toMatch(/-evening$/);
  // The SAME pair, unfolded — not two frames arriving early.
  expect(pairOf(second)).toBe(pairOf(first));

  /* THE WORDS BELONG TO THE PHOTOGRAPH, NOT TO THE FRAME. `plateForFrame` takes
     the earliest year and joins the places when it is handed a pair, which is
     what a SHARED caption needed; handing it the whole pair here would leave
     half two captioned "Nudgee & Sandgate" — a line true of neither picture on
     the card. */
  await expect.poll(() => page.evaluate(() => window.__plateTitles)).toEqual([
    "Nudgee",
    "Sandgate"
  ]);

  // Still one photograph painting once the second exchange has settled.
  await expect.poll(() => page.evaluate(() => window.__archive().shown)).toBe(1);

  expect(pageErrors).toEqual([]);
});

test("the card's exchange is CLAMPED — the wallpaper's minute is not the card's", async ({ page }) => {
  /* ⚠⚠ THIS SPEC EXISTS BECAUSE THE SURFACE WENT GREEN WHILE READING WRONG.
     `ground.js` hands `meta.settleMs` down and its ambient value is
     `DISSOLVE_MS` = SIXTY SECONDS. The archive used it raw, so the card — the
     SUBJECT of the composition, not the wallpaper — cross-faded over a full
     minute. Measured on the wall 2026-08-22: the incoming slot climbed
     0.60 → 1.00 across 27.5s with three slots opaque the whole way, which is a
     half-minute double exposure rather than a transition.

     Nothing caught it because every existing assertion here drives dissolves at
     20ms. A settle UNDER the ceiling is exactly the case a clamp cannot fail,
     so the suite could only ever have seen the fixed state. The number under
     test is the AMBIENT one, and it has to be driven explicitly. */
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  const exch = () => page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--arch-exchange"));

  // The ambient rotation's own settle, at full length.
  await page.evaluate(() => window.__groundDissolve(60_000, 200));
  await expect.poll(exch, {
    message: "a 60s wallpaper settle must not become a 60s card crossfade"
  }).toBe("2600ms");

  await expect.poll(() => page.evaluate(() => window.__ground().inFlight)).toBe(false);

  /* ⚠ A CEILING, NOT A FIXED VALUE — and this half is the reason to say so. A
     veto settles briskly BECAUSE someone just spoke, and that briskness is
     information the room can read. Clamping to a constant would throw it away,
     and the throwing-away would be invisible: the surface would still look
     fine, it would just stop distinguishing "you rejected this" from "ten
     minutes passed". */
  await page.evaluate(() => window.__groundDissolve(900, 200));
  await expect.poll(exch, {
    message: "a settle already under the ceiling must pass through untouched"
  }).toBe("900ms");

  expect(pageErrors).toEqual([]);
});

test("the exchange is MARKED by a blur, and the blur is an event with an end", async ({ page }) => {
  /* The one catchable thing on this surface. `AMBIENT-ARCHIVE.md` puts pivot,
     drift and zoom all deliberately below the threshold of perception and names
     the exchange and its 300ms blur as the exceptions — so this is not polish,
     it is the entire visible motion budget of depth 0.

     ⚠ IT SHIPPED IN THE INCUMBENT AND WAS NEVER PORTED TO V3. The rebuild took
     the crossfade and left the blur, and no spec noticed because no spec ever
     asked whether the exchange was marked at all.

     ⚠ OBSERVED, NEVER SAMPLED. The class lives for 300ms; polling for it is a
     race with the thing under test. An attribute observer scoped to the one
     element records that it happened without depending on when we look. */
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  await page.evaluate(() => {
    const card = document.querySelector(".archive__card");
    window.__blurSeen = false;
    new MutationObserver(() => {
      if (card.classList.contains("is-exchanging")) window.__blurSeen = true;
    }).observe(card, { attributes: true, attributeFilter: ["class"] });
  });

  await page.evaluate(() => window.__groundDissolve(900, 200));
  await expect.poll(() => page.evaluate(() => window.__blurSeen), {
    message: "an exchange with nothing marking it is the smear this fixed"
  }).toBe(true);

  /* And it CLEARS. A blur that stuck would be far worse than none: the card is
     the photograph, and `filter` on it re-rasterises every frame the Ken Burns
     settle is still scaling. Left on, it would be a permanent cost against the
     §5.4 ceiling that no `anims`/`loops` count can see, because it is not an
     animation at all. */
  await expect.poll(
    () => page.evaluate(() => document.querySelector(".archive__card").className),
    { message: "the blur must come off on its own timer" }
  ).not.toContain("is-exchanging");

  expect(pageErrors).toEqual([]);
});

test("the words NEVER change while they are readable", async ({ page }) => {
  /* The plate names ONE photograph, and an exchange puts two on the glass. The
     rebuild swapped all four pieces of language — plate rows, engraved numeral,
     the strip's lit year, the pool — the instant `archivePhoto()` ran, while the
     picture itself took the whole crossfade to arrive. So the caption described
     the INCOMING memory over a card still showing the OUTGOING one. At the 60s
     settle that shipped, it did so for most of a minute.

     ⚠ THE ASSERTION IS THE INVARIANT, NOT A TIMING. Polling for "what does the
     plate say at t=400ms" would pin the current swap ratio and re-break the
     moment anyone tuned it. What must hold at ANY ratio is that the words are
     invisible at the instant they change — so this observes every text mutation
     and records the plate's opacity AT THAT MOMENT. Instant swap records 1;
     riding the exchange records 0. It cannot pass against the defect. */
  const pageErrors = await bootArchive(page);
  await groundShown(page);
  // Past the first frame's own swap, so the records below belong to the
  // exchange this test drives and not to the arrival that preceded it.
  await page.waitForTimeout(1800);

  await page.evaluate(() => {
    const plate = document.querySelector(".archive__plate");
    window.__swaps = [];
    new MutationObserver(() => {
      window.__swaps.push(+getComputedStyle(plate).opacity);
    }).observe(plate, { subtree: true, childList: true, characterData: true });
  });

  await page.evaluate(() => window.__groundDissolve(900, 200));
  await expect.poll(() => page.evaluate(() => window.__swaps.length)).toBeGreaterThan(0);

  const swaps = await page.evaluate(() => window.__swaps);
  for (const o of swaps) {
    expect(o, `the plate changed its words at opacity ${o} — the room can read that`)
      .toBeLessThan(0.05);
  }

  /* And it comes BACK — a plate that stood down and never returned would pass
     the loop above perfectly. */
  await expect.poll(
    () => page.evaluate(() => +getComputedStyle(document.querySelector(".archive__plate")).opacity),
    { message: "the words must return once the memory has arrived" }
  ).toBeGreaterThan(0.9);

  expect(pageErrors).toEqual([]);
});

test("the photograph's move ENDS, and it ends where the element rests", async ({ page }) => {
  /* The settle is what keeps depth 0 inside §5.4: four forever-loops measure
     21.5% of a core on the wall, five measure 27.4% against a 25% ceiling.
     Driven rather than read off the stylesheet, because the two ways this gets
     silently undone are both invisible to a text match for "forwards" — an
     `infinite` creeping back onto a DIFFERENT selector for the same keyframes,
     and a keyframe list that comes to rest somewhere other than the element's
     own transform. */
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  const timing = await page.evaluate(() => {
    const a = document.getAnimations().find((x) => x.animationName === "arch-kenburns");
    if (!a) return null;
    const t = a.effect.getComputedTiming();
    return { iterations: t.iterations, fill: t.fill };
  });
  expect(timing, "arch-kenburns is not running at depth 0 at all").not.toBeNull();
  expect(timing).toMatchObject({ iterations: 1, fill: "forwards" });

  /* ⚠ THE ANTI-POP INVARIANT, and the reason the move shrinks rather than
     grows. The next exchange takes `is-top` away and the animation goes with
     it, so wherever the move ENDS is where the photograph jumps FROM. Ending
     scaled up — the shape the old loop had — pops the outgoing frame 15% at
     amp 2, at full opacity, while the incoming one is still transparent.
     Finishing the move and then stripping the class must change nothing. */
  const { settled, bare } = await page.evaluate(() => {
    const img = document.querySelector('.archive__img.is-top:not([data-blank="1"])');
    document.getAnimations().find((x) => x.animationName === "arch-kenburns").finish();
    const settled = getComputedStyle(img).transform;
    img.classList.remove("is-top");
    const bare = getComputedStyle(img).transform;
    img.classList.add("is-top");
    return { settled, bare };
  });
  const atRest = (t) => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
  expect(atRest(settled), `the move rests at ${settled}, so every exchange will pop`).toBe(true);
  expect(atRest(bare), `the resting transform is ${bare}, not the element's own`).toBe(true);

  expect(pageErrors).toEqual([]);
});

test("a late hand-off from a superseded exchange never puts an old photo back up", async ({ page }) => {
  /* ⚠ A REAL DEFECT, found by driving this rather than by reading it. ground.js
     fires its second onPhoto from a timer armed a whole settle earlier, so two
     exchanges inside one settle+buffer window — a veto answered by another
     veto — deliver the OLD frame's hand-off after the new one's. Both
     subscribers acted on it: the scrim re-solved for a photograph that had
     gone, and the archive put it back on top of the card. On the wall that is
     the picture the room just rejected reappearing a few seconds later.

     Pinned here because this is where it was visible: the card's top slot must
     always name whatever ground.js currently has up. */
  const pageErrors = await bootArchive(page);
  await groundShown(page);

  /* ⚠ THE SETTLES MUST DIFFER, and evenly-spaced exchanges do NOT reproduce
     this — the stale hand-offs then arrive in the same order they were armed
     and the end state comes out right anyway. Proven by injecting the defect
     and watching a three-exchange version stay green.

     This is the shape that bites, and it is the real one: a SLOW ambient
     dissolve (60s on the wall) interrupted by a BRISK veto (1.2s), because
     someone said "not this one" while the wall was mid-drift. The veto's
     hand-off lands first and the ambient one lands after it, naming a
     photograph that is two frames stale.

     ⚠ THE GAP BETWEEN THE TWO SETTLES HAS TO SWAMP THE POLL. Each hand-off is
     armed settleMs + 2s after its OWN settle, so with the two settles close
     together the firing order depends on how long the poll between them took —
     and the first version of this test passed and failed on the same build for
     exactly that reason. 3000 against 20 puts the slow hand-off 5s out and the
     brisk one ~2s out whatever the poll does. */
  await page.evaluate(() => window.__groundDissolve(3000, 8000));
  await expect.poll(() => page.evaluate(() => window.__ground().inFlight)).toBe(false);
  await page.evaluate(() => window.__groundDissolve(20, 200));
  await expect.poll(() => page.evaluate(() => window.__ground().inFlight)).toBe(false);
  await page.waitForTimeout(6000);   // past BOTH armed hand-offs, in either order

  const probe = await page.evaluate(() => {
    const top = document.querySelector('.archive__img.is-top:not([data-blank="1"])');
    /* ⚠ THE ID IS PULLED OUT AS A PATH SEGMENT, never matched as a substring.
       `expect(path).toContain(id)` looked right and was worthless: the fixture
       ids are single letters and "/api/immich/asset/b/thumb" contains "a", "c"
       and "d" as well. It reported green against a build with the defect
       deliberately injected, twice. */
    const seg = top ? /\/asset\/([^/]+)\//.exec(new URL(top.src).pathname)?.[1] : null;
    return {
      groundAsset: window.__ground().assetId,
      topAsset: seg ?? null,
      lit: window.__archive().lit
    };
  });

  expect(probe.topAsset).toBe(probe.groundAsset);
  expect(probe.lit).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

test("the card takes the print's own shape from the DECODED rendition", async ({ page }) => {
  await bootArchive(page);
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().card?.w)).toBeGreaterThan(0);

  const card = await page.evaluate(() => window.__archive().card);
  // The fixture PNG is 1x1, i.e. square, and a square is height-bound: 609 tall.
  expect(card.h).toBe(609);
  expect(card.w).toBe(609);
  expect(card.left).toBe(130);
  // Vertical centre held at 504.5, so the card grows about where it has always
  // sat rather than dropping toward the bottom of the frame.
  expect(card.top + card.h / 2).toBeCloseTo(504.5, 1);
});

test("every word on the plate clears WCAG AA over its own backdrop", async ({ page }) => {
  /* ⚠ WHY THIS LIVES HERE AND NOT IN tests/verify/v3-contrast.spec.js. That
     sweep boots ONE page per (ground, phase) and drives every surface across
     it, so a pinned `v3Archive` would apply to all of them — and at depth 0 the
     archive hides #ground-caption, which would silently retire the measurement
     of the caption's own hard-won 5.29:1. Pinning the flag there buys the plate
     and loses the caption. Measured here instead, against the real painted
     stack, and the sweep is left exactly as it is.

     ⚠ AND A GAP WORTH NAMING RATHER THAN LEAVING IMPLICIT: the strip's year
     labels are drawn into a CANVAS, so no DOM text sweep can ever see them.
     They are the one piece of archive text no automated gate covers — the
     32px/48px sizes and the ink alphas in core/archive.js are the whole
     defence, and the panel is the only real check. */
  await bootArchive(page);
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().plate)).not.toBeNull();

  const rows = await page.evaluate(() => {
    /* ⚠ oklch() DOES NOT RESOLVE THROUGH `ctx.fillStyle` ALONE. Assigning an
       oklch() string and reading the property straight back returns the SAME
       oklch() string in this Chromium, so a probe built that way parses nothing
       and reports null — which is how this test failed first time round. The
       colour has to be PAINTED and the pixel read back:

         fillStyle = css; fillRect(...); getImageData(...)

       Painting the layers in order also does the alpha compositing for free, so
       the numbers below are the real stack — archive ground, then the plate's
       0.72 backdrop, then the ink — rather than ink over an assumed black. */
    const px = (...layers) => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      for (const css of layers) {
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
      }
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] / 255, d[1] / 255, d[2] / 255];
    };

    const ground = getComputedStyle(document.getElementById("archive")).backgroundColor;
    return [...document.querySelectorAll(".archive__plate > p")]
      .filter((el) => el.textContent.trim() && el.dataset.blank !== "1")
      .map((el) => {
        const cs = getComputedStyle(el);
        return {
          cls: el.className.split(" ")[0],
          fontSize: parseFloat(cs.fontSize),
          backdrop: px(ground, cs.backgroundColor),
          ink: px(ground, cs.backgroundColor, cs.color)
        };
      });
  });

  // eyebrow + title, and `who` too when the frame names anybody.
  expect(rows.length).toBeGreaterThanOrEqual(2);

  for (const row of rows) {
    const ratio = contrastRatio(row.ink, row.backdrop);
    expect(ratio, `${row.cls} at ${row.fontSize}px reads ${ratio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(4.5);
    // The legibility FLOOR, which is a separate law from contrast: below
    // --t-rail the text is not received at 3-4m however well it contrasts.
    expect(row.fontSize, `${row.cls} is under the 32px floor`).toBeGreaterThanOrEqual(32);
  }
});

// ── ONE PLANE, on the page ──────────────────────────────────────────────────

/* The rebuild behind `v3ArchivePlane`. Every test here boots the SAME page as
   the block above with one flag flipped, so anything that reads differently is
   the composition and not the harness.

   ⚠⚠ WHAT THESE ARE REALLY GUARDING is that the three things the owner pointed
   at on 2026-09-04 are gone and cannot come back quietly: a compound rotation,
   a ruler projected onto a receding deck, and two hard-edged ghosts. The first
   is asserted against the computed MATRIX rather than the stylesheet text,
   because a matrix cannot be talked around. */

const planeProbe = (page) =>
  page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().toJSON() : null;
    };
    const plane = document.querySelector(".archive__plane");
    const scene = document.querySelector(".archive__scene");
    return {
      ...window.__archive(),
      marker: document.documentElement.dataset.archPlane ?? null,
      hasPlane: Boolean(plane),
      hasStrip: Boolean(document.querySelector(".archive__strip")),
      // Everything with an angle is INSIDE the one plane, and nothing else is.
      inPlane: plane
        ? [...plane.children].map((c) => c.className.split(" ")[0]).sort()
        : [],
      transform: plane ? getComputedStyle(plane).transform : null,
      transformOrigin: plane ? getComputedStyle(plane).transformOrigin : null,
      perspective: scene ? getComputedStyle(scene).perspective : null,
      perspectiveOrigin: scene ? getComputedStyle(scene).perspectiveOrigin : null,
      /* ⚠ `*Rect`, NOT `card`/`sky`. `window.__archive()` already answers `card`,
         `sky`, `day` and `hint`, and a rect spread over the top of one of them
         is a probe quietly measuring a different question than the assertion
         reads — `expect(probe.sky).toBeNull()` passed a 0x0 rect and failed on
         "nothing said", which is the same fact wearing the wrong name. */
      cardRect: r(".archive__card-plane"),
      dateRect: r(".archive__date"),
      skyRect: r(".archive__sky"),
      hourRect: r("#hour")
    };
  });

test("the plane's flag OFF leaves the shipped composition exactly as it is", async ({ page }) => {
  /* The rollback, asserted as a state rather than reasoned about. `v3Archive`
     is ON here — this is not the archive's own off switch, it is the rebuild's,
     and what it must leave behind is the surface that is on the wall today. */
  const pageErrors = await bootArchive(page, { v3ArchivePlane: false });
  await groundShown(page);

  const probe = await planeProbe(page);
  expect(probe.plane).toBe(false);
  expect(probe.marker).toBeNull();
  expect(probe.hasPlane).toBe(false);
  // The year strip, the two ghosts and the three-axis deck, all still there.
  expect(probe.hasStrip).toBe(true);
  expect(probe.ghosts).toBe(2);
  expect(probe.dateRect).toBeNull();
  expect(probe.skyRect).toBeNull();
  // Not merely unpainted — never built, so there is nothing to say either.
  expect(probe.day).toBeNull();
  expect(probe.sky).toBeNull();
  expect(probe.hint).toBeNull();
  // And the fault pill keeps the corner it has always had.
  const faultTop = await page.evaluate(() => {
    const f = document.getElementById("fault");
    return getComputedStyle(f).top;
  });
  expect(faultTop).toBe("96px");

  expect(pageErrors).toEqual([]);
});

test("ONE axis: the plane yaws and does nothing else", async ({ page }) => {
  /* 🔑 THE WHOLE COMPLAINT, IN ONE ASSERTION. `--arch-plane` is
     `rotateY(-12deg) rotateX(8deg) rotateZ(2deg)`, and the rotateZ is what
     reads as crooked: a 2 degree ROLL has no cause a room can see, so the eye
     files it as a mistake rather than as perspective.

     Read off the computed MATRIX, not the stylesheet. A pure rotateY leaves the
     matrix's second row and column as the identity — m[1], m[4], m[6] and m[9]
     are zero and m[5] is one — and there is no way to write a roll or a pitch
     that does not disturb them. A text assertion could be satisfied by a
     `rotate3d` or a `matrix3d` spelling the same three axes. */
  const pageErrors = await bootArchive(page, { v3ArchivePlane: true });
  await groundShown(page);

  const probe = await planeProbe(page);
  expect(probe.plane).toBe(true);
  expect(probe.marker).toBe("1");
  expect(probe.hasPlane).toBe(true);

  const m = probe.transform.match(/matrix3d\(([^)]+)\)/);
  expect(m, `not a 3D matrix: ${probe.transform}`).not.toBeNull();
  const v = m[1].split(",").map(Number);
  // rotateZ shows up here…
  expect(Math.abs(v[1]), "the plane carries a ROLL").toBeLessThan(1e-6);
  expect(Math.abs(v[4]), "the plane carries a ROLL").toBeLessThan(1e-6);
  // …and rotateX here.
  expect(Math.abs(v[6]), "the plane carries a PITCH").toBeLessThan(1e-6);
  expect(Math.abs(v[9]), "the plane carries a PITCH").toBeLessThan(1e-6);
  expect(v[5]).toBeCloseTo(1, 6);
  // And it IS turned — an identity matrix would pass every line above.
  expect(Math.abs(v[0])).toBeLessThan(1);
  expect(Math.abs(v[2])).toBeGreaterThan(0.1);

  expect(pageErrors).toEqual([]);
});

test("the lens and the plane pivot about the SAME point", async ({ page }) => {
  /* 🔑🔑 THE DIFFERENCE BETWEEN "TILTED" AND "SKEWED". A plane rotated about one
     point and projected from another is sheared — its far edge is not merely
     smaller, it is displaced — and no amount of tuning the angle fixes that.
     Both are written as the same percentage of the same box in archive.css;
     this measures that they RESOLVE to the same pixel, which is the thing a
     later edit could break while the stylesheet still looked right. */
  await bootArchive(page, { v3ArchivePlane: true });
  await groundShown(page);

  const probe = await planeProbe(page);
  const nums = (s) => s.split(/\s+/).map(parseFloat);
  const [px, py] = nums(probe.perspectiveOrigin);
  const [tx, ty] = nums(probe.transformOrigin);
  expect(tx, `transform-origin x ${tx} vs perspective-origin x ${px}`).toBeCloseTo(px, 1);
  expect(ty, `transform-origin y ${ty} vs perspective-origin y ${py}`).toBeCloseTo(py, 1);

  // A longer lens: same depth cue, far less wide-angle distortion.
  expect(parseFloat(probe.perspective)).toBe(2800);
});

test("everything with an angle is inside the plane, and nothing readable is", async ({ page }) => {
  /* THE OTHER HALF OF THE REDESIGN. On the shipped surface the year strip is
     text a person is meant to read, drawn on a receding deck. Here the room
     holds the memory and the glass holds what the house says, and the two do
     not mix — which is also why the plate is measured for contrast and nothing
     inside the plane is. */
  await bootArchive(page, { v3ArchivePlane: true });
  await groundShown(page);

  const probe = await planeProbe(page);
  expect(probe.inPlane).toEqual(["archive__card-plane", "archive__ghost", "archive__year"]);

  const flat = await page.evaluate(() =>
    [".archive__date", ".archive__sky", ".archive__plate", ".hour", ".fault"].map((sel) => {
      const el = document.querySelector(sel);
      return {
        sel,
        // Inside the angled wrapper at any depth? That is the failure.
        angled: Boolean(el?.closest(".archive__plane")),
        // A 2D centring translate is fine; a 3D matrix is not.
        transform: el ? getComputedStyle(el).transform : null
      };
    })
  );
  for (const node of flat) {
    expect(node.angled, `${node.sel} is on the receding plane`).toBe(false);
    expect(node.transform, `${node.sel} carries a 3D transform`).not.toMatch(/matrix3d/);
  }
});

test("the year spine is DELETED — not hidden, not empty", async ({ page }) => {
  /* ⚠⚠ THE POINT IS THAT THE GEOMETRY IS UNREACHABLE. The strip's ~120 lines of
     hand-probed projection constants produced two shipped defects, both of them
     a lit label landing somewhere a person could see was wrong: the newest
     year's 48px label half off the right edge (2026-08-20), and the 2011 at the
     left end sitting on the card's own corner with the fault pill painted over
     it (2026-09-04). Code that cannot run cannot regress. */
  const pageErrors = await bootArchive(page, { v3ArchivePlane: true });
  await groundShown(page);

  const probe = await planeProbe(page);
  expect(probe.hasStrip).toBe(false);
  expect(await page.locator("canvas.archive__strip").count()).toBe(0);

  /* And what it was saying is still on the wall. The pool is four memories, so
     the sentence is the count and not a year list — asserted as the TEXT rather
     than as "something is there", because a surface driven by a scored lane can
     put someone else's words in a node the spec never wrote. */
  await expect
    .poll(() => page.evaluate(() => window.__archive().hint))
    .toBe("four memories from this date");

  expect(pageErrors).toEqual([]);
});

test("ONE ghost, lifted rather than crushed, and with no edge to read", async ({ page }) => {
  /* ⚠⚠ A GHOST WITH A CORNER IS NOT A GHOST, IT IS A RECTANGLE. Two
     `.archive__ghost` under the crush stack (`grayscale(1) brightness(0.22)
     contrast(1.18)`) map every input luminance into roughly [0, 0.17], so over
     a dark photograph they are flat near-black fields with four hard edges, two
     of them across the middle of the composition. That is most of what read as
     "haphazard".

     Three things make this a ghost instead, and each is separately injectable:
     there is one of them, the filter LIFTS (brightness > 1) rather than
     crushes, and the mask reaches full transparency so no boundary exists. */
  await bootArchive(page, { v3ArchivePlane: true });
  await groundShown(page);

  const probe = await page.evaluate(() => {
    const ghosts = [...document.querySelectorAll(".archive__ghost")];
    const skin = document.querySelector(".archive__ghost-skin");
    const cs = ghosts[0] ? getComputedStyle(ghosts[0]) : null;
    return {
      count: ghosts.length,
      opacity: cs ? parseFloat(cs.opacity) : null,
      mask: cs ? cs.maskImage || cs.webkitMaskImage : null,
      filter: skin ? getComputedStyle(skin).filter : null
    };
  });

  expect(probe.count).toBe(1);
  // Faint enough that the card is unambiguously the subject.
  expect(probe.opacity).toBeGreaterThan(0);
  expect(probe.opacity).toBeLessThanOrEqual(0.3);

  /* LIFTED, NOT CRUSHED — the whole reason a dark photograph still resolves as
     a photograph here. A brightness at or below 1 is the crush coming back. */
  const brightness = parseFloat(/brightness\(([\d.]+)\)/.exec(probe.filter ?? "")?.[1]);
  expect(brightness, `filter is ${probe.filter}`).toBeGreaterThan(1);

  // And no boundary anywhere: a radial mask that actually reaches zero alpha.
  expect(probe.mask, `mask is ${probe.mask}`).toMatch(/radial-gradient/);
  expect(probe.mask).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)|transparent/);
});

test("the card's PAINTED rect clears the pill's furthest reach and the hour", async ({ page }) => {
  /* 🔑 THE CARD'S TOP EDGE IS SET BY HOW FAR THE FAULT PILL CAN REACH, NOT BY
     TASTE. The first draft of this design put the card at y152 and the pill
     landed on its corner — the original complaint, reproduced.

     ⚠⚠ MEASURED, NOT COMPUTED. Under this lens the card's far half is NEARER
     the eye than the origin, so the painted box is a few percent LARGER than
     the CSS numbers in both axes; sizing from the stylesheet alone puts the
     card through the hour.

     ⚠ AND THE PILL IS FORCED VISIBLE. It is `hidden` on a healthy house, so a
     rect taken as-is is 0x0 and this test would pass against a card sitting on
     top of a fault nobody had yet. */
  const pageErrors = await bootArchive(page, { v3ArchivePlane: true, weather: WEATHER });
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().sky)).not.toBeNull();

  const probe = await page.evaluate(() => {
    const fault = document.getElementById("fault");
    document.getElementById("fault-label").textContent = "MOTION COVERAGE DOWN";
    fault.hidden = false;
    const r = (sel) => document.querySelector(sel).getBoundingClientRect().toJSON();
    return {
      date: r(".archive__date"),
      sky: r(".archive__sky"),
      fault: r("#fault"),
      card: r(".archive__card-plane"),
      hour: r("#hour")
    };
  });

  // The top-left stack: date, a gap, then the pill stepped down to make room.
  expect(probe.date.top).toBe(96);
  expect(probe.date.bottom).toBeCloseTo(152, 0);
  expect(probe.fault.top).toBe(168);
  expect(probe.fault.bottom).toBeLessThanOrEqual(240);

  // Nothing lands on the pill's corner, and the pill never lands on the card's.
  expect(
    probe.card.top,
    `card paints at y${Math.round(probe.card.top)}, pill ends at y${Math.round(probe.fault.bottom)}`
  ).toBeGreaterThan(probe.fault.bottom);
  expect(probe.card.left).toBeGreaterThanOrEqual(96);

  // And it still clears the hour, which owns the bottom-left corner.
  expect(
    probe.card.bottom,
    `card ends at y${Math.round(probe.card.bottom)}, hour starts at y${Math.round(probe.hour.top)}`
  ).toBeLessThan(probe.hour.top);

  /* THE PHOTOGRAPH IS STILL THE HERO. A build that shrank the card to make room
     for something else is precisely what the panel rejected once already.

     ⚠ THE FIXTURE IS A 1x1 PNG, so its aspect is 1 and the card is HEIGHT-bound
     — 550 square in plane space, not the 978-wide box a landscape memory gets.
     Asserting a width here would be asserting the fixture, which is how a
     geometry test passes for a reason that has nothing to do with the
     geometry. The hero WIDTH is pinned in the pure test above, against
     cardRectForPlane(16/9); what is worth measuring on the page is that the
     projection magnifies rather than shrinks. */
  expect(probe.card.height).toBeGreaterThan(550);
  expect(probe.card.width).toBeGreaterThan(530);

  // The sky keeps the far corner and does not reach back across the frame.
  expect(probe.sky.right).toBeCloseTo(1824, 0);
  expect(probe.sky.left).toBeGreaterThan(probe.date.right);

  expect(pageErrors).toEqual([]);
});

test("the day and the sky are on the glass, in the house's own voice", async ({ page }) => {
  const pageErrors = await bootArchive(page, { v3ArchivePlane: true, weather: WEATHER });
  await groundShown(page);

  /* ⚠ ASSERT THE TEXT, NOT THAT SOMETHING IS THERE. This wall composes from a
     scored queue and a spec that only counts nodes can measure a line it never
     wrote — the finding of 2026-09-02, where a score-72 announce substituted
     itself for the contrast sweep's own fixture for a month. These two strings
     can only have come from the clock this spec pinned and the payload it
     served. */
  await expect
    .poll(() => page.evaluate(() => window.__archive().sky))
    .toBe("22° · partly cloudy · 14° / 25°");

  const probe = await planeProbe(page);
  // The clock is pinned to MIDDAY on 2026-07-06, a Monday.
  expect(probe.day).toBe("Monday 6 July");

  expect(pageErrors).toEqual([]);
});

test("with no sky to report, the band is not there at all", async ({ page }) => {
  /* ⚠ THE REAL FALLBACK, END TO END. `/api/weather/now` answers a 502 with every
     field null and the literal label "Unavailable" — which is exactly what the
     suite's own stubbed-off upstreams produce, so this is the DEFAULT boot
     rather than a contrived one. `Number(null)` is 0, and the first version of
     `skyLine` rounded before it tested: the wall said "0° · 0° / 0°", stating
     three temperatures nobody had measured. The line must be absent, and the
     day above it must not move.

     ⚠ THE PAYLOAD IS SERVED AT 200, NOT LEFT TO THE SERVER. Found by injecting
     the defect: with no route the test server answers 502, `loadWeather`
     returns on `!res.ok`, and `archiveSky` is never called — so the band was
     empty for a reason that had nothing to do with what this test claims to
     measure, and the "0°" defect could be re-introduced without turning it red.
     Serving the fallback is what puts the refusal on the path. */
  const pageErrors = await bootArchive(page, {
    v3ArchivePlane: true,
    weather: WEATHER_UNKNOWN
  });
  await groundShown(page);

  const probe = await planeProbe(page);
  expect(probe.sky).toBeNull();          // window.__archive().sky — nothing said
  expect(probe.day).toBe("Monday 6 July");

  const band = await page.evaluate(() => {
    const el = document.querySelector(".archive__sky");
    return {
      blank: el.dataset.blank,
      display: getComputedStyle(el).display,
      date: document.querySelector(".archive__date").getBoundingClientRect().toJSON()
    };
  });
  expect(band.blank).toBe("1");
  expect(band.display).toBe("none");
  // Absolutely positioned, so the day is where it always is.
  expect(band.date.top).toBe(96);

  expect(pageErrors).toEqual([]);
});

test("the sky stands down the moment the house is listening", async ({ page }) => {
  /* ⚠⚠ THE TOP-RIGHT CORNER BELONGS TO THE TRANSCRIPT. compose.css keeps the
     list of who owns which corner and it has been violated twice already. The
     sky takes it on exactly the terms the deleted year strip took it. */
  await bootArchive(page, { v3ArchivePlane: true, weather: WEATHER });
  await groundShown(page);

  /* ⚠ POLLED TO A SETTLED VALUE, NOT SLEPT AND COMPARED TO EXACTLY 0. The
     stand-down is a --m-calm ease, and a fixed 500ms wait caught it mid-flight
     at 3.4972e-14 under full-suite load — a number that is visually zero and is
     not `0`. Sleep-then-assert-exact is a test that passes on an idle machine
     and fails on a busy one, which is the flake class this repo root-causes
     rather than retries. */
  const settled = async (phase, percent) => {
    await page.evaluate((p) => {
      document.documentElement.dataset.phase = p;
    }, phase);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.round(
            parseFloat(getComputedStyle(document.querySelector(".archive__sky")).opacity) * 100
          )
        )
      )
      .toBe(percent);
  };

  await settled("idle", 100);
  await settled("listening", 0);
  await settled("speaking", 0);
  // And it comes back, because standing down is never a one-way door.
  await settled("idle", 100);
});

test("after dark the wall is a photograph and an hour, not an instrument panel", async ({ page }) => {
  /* The night rule the plate and the engraved year already obey, extended to
     the two lines the plane added. A dimmed label is a label somebody still
     tries to read, so these go out entirely.

     ⚠ DRIVEN BY THE ATTRIBUTE, NOT BY THE CLOCK. V3 decides night off the sun's
     altitude, so pinning a time here would make the test pass or fail by
     latitude and season. `data-night` is what the stylesheet actually reads.

     ⚠ AND THE HOUR MUST SURVIVE IT. It always has — the wall's constant is not
     part of the instrument panel — and a night rule written one selector too
     wide is exactly how the household loses its clock at 2am. */
  await bootArchive(page, { v3ArchivePlane: true, weather: WEATHER });
  await groundShown(page);

  const read = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [".archive__date", ".archive__sky", ".archive__plate", ".hour"].map((sel) => [
          sel,
          parseFloat(getComputedStyle(document.querySelector(sel)).opacity)
        ])
      )
    );

  const day = await read();
  expect(day[".archive__date"]).toBe(1);
  expect(day[".archive__sky"]).toBe(1);

  await page.evaluate(() => {
    document.documentElement.dataset.night = "1";
  });
  await page.waitForTimeout(500);

  const night = await read();
  expect(night[".archive__date"]).toBe(0);
  expect(night[".archive__sky"]).toBe(0);
  expect(night[".archive__plate"]).toBe(0);
  // The clock stays.
  expect(night[".hour"]).toBe(1);
});

test("the frame does not move — only the image inside it", async ({ page }) => {
  /* 🔑 `arch-pivot` slides the card toward and away from the eye, and on a
     surface whose complaint was "the photo looks askew" that is
     indistinguishable from the print being crooked. The Ken Burns settle is
     untouched: it moves the picture INSIDE a fixed mask.

     Asserted off the live animation list rather than the stylesheet, because
     "which loops are actually running at depth 0" is the soak's own question
     and an expected count that is quietly wrong makes every future reading
     wrong. */
  await bootArchive(page, { v3ArchivePlane: true });
  await groundShown(page);

  const running = await page.evaluate(() =>
    document.getAnimations().map((a) => ({
      name: a.animationName,
      target: a.effect?.target?.className ?? null,
      forever: a.effect?.getComputedTiming().iterations === Infinity
    }))
  );
  const names = running.map((a) => a.name);

  expect(names).not.toContain("arch-pivot");
  // The three loops the plane keeps, and no fourth.
  expect(names.filter((n) => n === "arch-breathe")).toHaveLength(1);
  expect(names.filter((n) => n === "arch-plane-drift")).toHaveLength(1);
  expect(names.filter((n) => n === "arch-plane-year")).toHaveLength(1);
  // The strip is gone, so nothing that belonged to it can be running either.
  expect(names).not.toContain("arch-ghost-b");

  /* ⚠ FOUR RUNNING, THREE FOREVER. `arch-kenburns` is a settle and simply stops
     — the distinction that took depth 0 back inside the calm law's 25% ceiling,
     and the number a soak should watch for a fifth forever-loop appearing. */
  const forever = running.filter((a) => a.forever).map((a) => a.name).sort();
  expect(forever).toEqual(["arch-breathe", "arch-plane-drift", "arch-plane-year"]);
});

test("the plane's own words clear WCAG AA over the surface they sit on", async ({ page }) => {
  /* Same arithmetic and the same painted-stack method as the plate's test
     above — see its note on why oklch() has to be painted and read back rather
     than parsed. What is new here is the top band: `--scrim` is `to top` and
     transparent by 88%, so on every OTHER V3 surface there is nothing between
     text at `top: var(--safe)` and the photograph. It does not bite here only
     because `.archive` is an opaque `--surface` layer — which is a property of
     this composition and is exactly what this measures.

     ⚠ A SKY IS SERVED ON PURPOSE. Without one the band is `display: none` and
     this sweep would report two rows and pass — measuring the sky's legibility
     by never looking at it, which is the failure mode `v3-contrast.spec.js`
     already carries a guard against. */
  await bootArchive(page, { v3ArchivePlane: true, weather: WEATHER });
  await groundShown(page);
  await expect.poll(() => page.evaluate(() => window.__archive().hint)).not.toBeNull();
  await expect.poll(() => page.evaluate(() => window.__archive().sky)).not.toBeNull();

  const rows = await page.evaluate(() => {
    const px = (...layers) => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      for (const css of layers) {
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
      }
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] / 255, d[1] / 255, d[2] / 255];
    };
    const ground = getComputedStyle(document.getElementById("archive")).backgroundColor;
    return [".archive__date", ".archive__sky", ".archive__hint"]
      .map((sel) => document.querySelector(sel))
      .filter((el) => el && el.textContent.trim() && el.dataset.blank !== "1")
      .map((el) => {
        const cs = getComputedStyle(el);
        return {
          cls: el.className.split(" ")[0],
          fontSize: parseFloat(cs.fontSize),
          backdrop: px(ground, cs.backgroundColor),
          ink: px(ground, cs.backgroundColor, cs.color)
        };
      });
  });

  // All three, and the count is the guard: a row that went silent would drop
  // out of this list and take its own measurement with it.
  expect(rows.map((r) => r.cls).sort())
    .toEqual(["archive__date", "archive__hint", "archive__sky"]);
  for (const row of rows) {
    const ratio = contrastRatio(row.ink, row.backdrop);
    expect(ratio, `${row.cls} at ${row.fontSize}px reads ${ratio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(4.5);
    expect(row.fontSize, `${row.cls} is under the 32px floor`).toBeGreaterThanOrEqual(32);
  }
});

test("the plane recedes with everything else, and nothing grows across exchanges", async ({ page }) => {
  /* The 24/7 rule, re-asserted on the rebuild rather than inherited from the
     composition above: this is a different node count and a different set of
     per-exchange writers, so "nothing is allocated per photograph" has to be
     true of THIS build too. */
  const pageErrors = await bootArchive(page, { v3ArchivePlane: true });
  await groundShown(page);

  const nodes = () => page.evaluate(() => window.__archive().nodes);
  const before = await nodes();

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__groundDissolve(20, 200));
    await expect.poll(() => page.evaluate(() => window.__ground().inFlight)).toBe(false);
  }
  // Past the exchange cleanup (settle 20 + 2000 buffer) and past the blur's
  // 2.8s recovery, which getAnimations() counts as a transition until it ends.
  await page.waitForTimeout(3400);
  expect(await nodes()).toBe(before);

  const probe = await page.evaluate(() => ({
    ...window.__archive(),
    layers: window.__ground().layers,
    top: document.querySelectorAll('.archive__img.is-top:not([data-blank="1"])').length
  }));
  expect(probe.slots).toBe(2);
  expect(probe.ghosts).toBe(1);
  expect(probe.layers).toBe(1);
  expect(probe.top).toBe(1);
  /* THREE forever-loops, not four: the card-wrap's Z pivot is gone because the
     FRAME does not move here. `anims` is four — those three plus the Ken Burns
     settle, which is still running 2.2s into a fresh memory. A fifth
     forever-loop appearing here is the regression that put depth 0 over the
     calm law's ceiling once already. */
  expect(probe.loops).toBe(3);
  expect(probe.anims).toBe(4);

  // And it is still depth 0's alone. Polled for the reason the recession test
  // above gives: the layer's visibility flips at --m-calm, not before it.
  await page.evaluate(() => window.__setDepth(1, "spec"));
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getElementById("archive").checkVisibility({ opacityProperty: true })
      )
    )
    .toBe(false);

  expect(pageErrors).toEqual([]);
});

// ── The CSS guardrail ───────────────────────────────────────────────────────

/* Comments stripped first: every rule below is DESCRIBED in a comment right
   next to it, and a guardrail that reads its own documentation as code passes
   for the wrong reason. */
const cssPath = fileURLToPath(new URL("../src/v3/css/archive.css", import.meta.url));
const css = () => readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = () => css().match(/[^{}@]+\{[^}]*\}/g) || [];

test("every looping animation hangs off the cause that ends", () => {
  const looping = rules().filter((r) => /animation[^;]*\binfinite\b/.test(r));
  // If this ever reads zero the assertion has stopped testing anything.
  expect(looping.length).toBeGreaterThan(0);

  for (const rule of looping) {
    const selector = rule.slice(0, rule.indexOf("{"));
    /* Depth 0 IS the cause. Something arriving switches the motion off rather
       than hiding it, which is the difference between a surface that stops and
       a surface that is merely invisible while it burns a core. */
    expect(selector, `not bound to depth 0: ${selector.trim()}`).toContain('[data-depth="0"]');
    expect(selector, `not bound to the flag: ${selector.trim()}`).toContain("[data-archive=");
    /* DPMS fires no visibilitychange, so without this the loops run all night
       to a dark panel. The incumbent archive never had it. */
    expect(selector, `not gated on the panel: ${selector.trim()}`)
      .toContain(':not([data-panel-dark="1"])');
  }

  // An iteration count is a loop wearing a different name.
  expect(css()).not.toMatch(/animation-iteration-count/);
});

test("nothing animates an element the night rule has already hidden", () => {
  /* ⚠ FOUND ON THE REAL WALL AFTER DARK, not by a spec: five loops were running
     and only four had anything on the glass. `:root[data-night="1"]` takes the
     engraved year to opacity 0, and a hidden element on a drift loop composites
     every frame for nobody — the same waste the Ken Burns rule avoids by keying
     on `is-top` rather than on every opaque slot.

     Generalised rather than hard-coded to the year: anything the night rule
     hides outright must not carry a loop that night leaves running. */
  const text = css();
  const hidden = [...text.matchAll(/:root\[data-night="1"\]([^{]*)\{[^}]*opacity:\s*0[^}]*\}/g)]
    .flatMap((m) => (m[0].slice(0, m[0].indexOf("{")).match(/\.archive__[\w-]+/g) || []));
  expect(hidden.length, "the night rule hid nothing — has it moved?").toBeGreaterThan(0);

  for (const rule of rules()) {
    const selector = rule.slice(0, rule.indexOf("{"));
    if (!/\binfinite\b/.test(rule)) continue;
    for (const cls of hidden) {
      if (!selector.includes(cls)) continue;
      expect(selector, `${cls} loops through the night it is hidden in`)
        .toContain(':not([data-night="1"])');
    }
  }
});

test("the year strip NEVER moves", () => {
  /* Once the plane means "which years this date reaches", sliding it is a lie
     about what it measures. The reference drifts its strips +-80px, which was
     fine when they were texture and is not fine now. */
  for (const rule of rules()) {
    const selector = rule.slice(0, rule.indexOf("{"));
    if (!/\.archive__strip\b/.test(selector)) continue;
    expect(rule, `the strip must not animate: ${selector.trim()}`).not.toMatch(/animation\s*:/);
  }
});

test("the five periods are pinned, and night scales displacement not duration", () => {
  /* ⚠ FIVE PERIODS, but only FOUR LOOPS. The incumbent ran four periods because
     its background was ONE tiled echo; this one has two ghosts. The fifth,
     arch-kenburns, is a settle rather than a loop — it keeps its 96s and simply
     stops at the end of it, which is what took depth 0 back inside §5.4.
     Counted off the real wall (`document.getAnimations()` at depth 0) rather
     than off the stylesheet, because "how many should be running" is the soak's
     own question and an expected count that is quietly wrong makes every future
     reading wrong. */
  const text = css();
  expect(text).toMatch(/animation:\s*arch-ghost-a 130s/);
  expect(text).toMatch(/animation:\s*arch-ghost-b 104s/);
  expect(text).toMatch(/animation:\s*arch-year 92s/);
  expect(text).toMatch(/animation:\s*arch-pivot 84s/);
  expect(text).toMatch(/animation:\s*arch-kenburns 96s/);

  /* §5.2: at 2am the wall drifts less FAR, never less often. --arch-day is the
     only thing night touches, and it appears nowhere near a duration. */
  expect(text).toMatch(/--arch-amp:\s*calc\(var\(--arch-gain\)/);
  expect(text).toMatch(/\[data-night="1"\]\s*\{\s*--arch-day:/);
  for (const m of text.match(/animation:[^;]+;/g) || []) {
    expect(m, `a period must not vary: ${m}`).not.toMatch(/var\(--arch-(amp|gain|day)\)/);
  }
});

test("no layout-triggering property is transitioned", () => {
  /* §5.5. The card's width/height/top DO change — they are written instantly by
     applyRect, riding the exchange that is already happening. Transitioning
     them would put layout on the compositor's critical path sixty times a
     second for a minute. */
  for (const t of css().match(/transition\s*:[^;]+;/g) || []) {
    expect(t, `compositor properties only: ${t}`)
      .not.toMatch(/\b(width|height|top|left|margin|padding)\b/);
  }
});

test("reduced motion takes the layer OFF the glass, not merely to zero opacity", () => {
  /* At opacity 0 the layer is still composited and every loop still runs. The
     incumbent's guardrail asserts the same distinction, and it is the reason
     that one is worded this way. */
  const reduced = css().slice(css().indexOf("prefers-reduced-motion"));
  expect(reduced).toMatch(/\.archive\s*\{\s*display:\s*none/);
});

test("the archive's loops live in their own stylesheet", () => {
  /* Not tidiness. tests/insights.spec.js forbids an unbound `infinite` in the
     incumbent's shared sheets for the same reason: a stylesheet everything
     loads is where a continuous loop gets added without anyone noticing. */
  const compose = readFileSync(
    fileURLToPath(new URL("../src/v3/css/compose.css", import.meta.url)),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  expect(compose).not.toMatch(/\binfinite\b/);
  expect(compose).not.toMatch(/\.archive__/);
});

// ── The CSS guardrail, on the plane ─────────────────────────────────────────

test("the plane's periods are pinned too, and night still scales displacement", () => {
  /* THREE loops here against the shipped composition's four. `arch-pivot` is
     switched off because the FRAME does not move — only the image inside it —
     and that is the one loop the rebuild deletes rather than replaces. */
  const text = css();
  expect(text).toMatch(/animation:\s*arch-breathe 90s/);
  expect(text).toMatch(/animation:\s*arch-plane-drift 130s/);
  expect(text).toMatch(/animation:\s*arch-plane-year 92s/);
  // The settle is shared: the plane keeps the Ken Burns exactly as it is.
  expect(text).toMatch(/animation:\s*arch-kenburns 96s/);
});

test("the plane's yaw breathes by DISPLACEMENT, never by duration", () => {
  /* §5.2, applied to a rotation for the first time on this wall: at 2am the
     plane turns less FAR, not less often. --arch-amp is the only thing night
     touches and it appears inside the keyframe, never in the period. */
  const text = css();
  expect(text).toMatch(/--arch-yaw:\s*-?[\d.]+deg/);
  expect(text).toMatch(/rotateY\(calc\(var\(--arch-yaw\)[\s\S]*?var\(--arch-amp\)/);
  for (const m of text.match(/animation:[^;]+;/g) || []) {
    expect(m, `a period must not vary: ${m}`).not.toMatch(/var\(--arch-(amp|gain|day)\)/);
  }
});

test("the plane carries ONE rotation and the stylesheet cannot smuggle in a second", () => {
  /* The matrix assertion on the page is the real gate; this is the cheap one
     that fails on a diff rather than on a run. `.archive__plane` and its
     keyframe are the only two places a rotation may be written in plane mode,
     and both may only write yaw. */
  const text = css();
  const planeRules = rules().filter((r) => /\.archive__plane\b/.test(r.slice(0, r.indexOf("{"))));
  expect(planeRules.length, "the plane's rules have moved").toBeGreaterThan(0);
  for (const rule of planeRules) {
    expect(rule, `a pitch on the plane: ${rule}`).not.toMatch(/rotateX|rotate3d|rotateZ|\brotate\(/);
  }
  // And the plane's nodes must not inherit the deck's compound rotation either.
  const planeScoped = rules().filter((r) => /\[data-arch-plane="1"\]/.test(r.slice(0, r.indexOf("{"))));
  for (const rule of planeScoped) {
    expect(rule, `the deck's plane leaked into plane mode: ${rule}`)
      .not.toMatch(/var\(--arch-(plane|deck-plane)\)/);
  }
});

test("the plane's whole rollback is one attribute", () => {
  /* ⚠⚠ EVERY RULE THE REBUILD ADDS IS KEYED ON `[data-arch-plane="1"]`, which
     is what makes flipping the flag off a real rollback rather than a hope. The
     three class names below are the rebuild's own nodes, and a rule for one of
     them that is NOT scoped would paint on the shipped surface — where those
     nodes do not exist, so nobody would notice until one of them did.

     The ONE exception is stated rather than excluded by pattern: `display: none`
     on a row that is deliberately silent cannot paint anything anywhere, so it
     is allowed to stand unscoped beside the `[data-blank]` rules the shipped
     composition already carries. */
  const OWN = ["archive__plane", "archive__date", "archive__sky", "archive__hint"];
  for (const rule of rules()) {
    const selector = rule.slice(0, rule.indexOf("{"));
    if (!OWN.some((cls) => selector.includes(cls))) continue;
    if (/\[data-blank="1"\]/.test(selector)) continue;   // display:none on a silent row
    expect(selector, `not scoped to the plane flag: ${selector.trim()}`)
      .toMatch(/\[data-arch-plane="1"\]/);
  }
});

test("the frame does not move: the card-wrap's pivot is switched OFF, not re-timed", () => {
  /* A slower pivot is still a moving frame, and on a surface whose complaint
     was "the photo looks askew" a moving frame is indistinguishable from a
     crooked print. The rule must say `none`. */
  const rule = rules().find(
    (r) =>
      /\[data-arch-plane="1"\]/.test(r.slice(0, r.indexOf("{"))) &&
      /\.archive__card-wrap\b/.test(r.slice(0, r.indexOf("{")))
  );
  expect(rule, "nothing switches the pivot off in plane mode").toBeTruthy();
  expect(rule).toMatch(/animation:\s*none/);
});

test("the pill's step-down is undone under reduced motion", () => {
  /* ⚠ THE ONE THING THIS COMPOSITION CHANGES OUTSIDE ITS OWN LAYER. Reduced
     motion takes `.archive` off the glass entirely, so the date that the pill
     stepped down for is not there — and a pill sitting 72px low over a
     full-bleed photograph with nothing above it is a defect with no author.
     The reduced-motion surface IS the flag-off surface, so anything the plane
     reaches outside itself has to be answered twice. */
  const reduced = css().slice(css().lastIndexOf("prefers-reduced-motion"));
  expect(reduced).toMatch(/\.fault\s*\{\s*top:\s*var\(--safe\)/);
});
