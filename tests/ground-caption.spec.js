import { test, expect } from "@playwright/test";
import { captionFor } from "../src/v3/core/ground.js";

/* The line under the on-this-day photograph. Pure, so every shape the library
   can hand us is pinned here without a network or a DOM.

   The shapes matter because the library is uneven: measured on the live G11,
   today's 116 memories had 85 with a city and only 7 with a named face. A
   caption that assumed both would be blank most of the time, and one that
   printed empty separators would show "· · 2011" on the wall. */

test("who, where and when when the library knows all three", () => {
  expect(captionFor({
    people: ["Korina Newsome-Smith"],
    city: "Nudgee",
    country: "Australia",
    localDateTime: "2023-08-12T19:13:52.378Z"
  })).toBe("Korina Newsome-Smith · Nudgee · 2023");
});

test("two people read as a couple; three or more degrade to a count", () => {
  expect(captionFor({ people: ["Greg", "Brett"], localDateTime: "2017-08-12T00:00:00Z" }))
    .toBe("Greg & Brett · 2017");

  // A list of five names is not glanceable, which is the whole job of this line.
  expect(captionFor({ people: ["Greg", "Brett", "Sam", "Alex"], localDateTime: "2017-08-12T00:00:00Z" }))
    .toBe("Greg & 3 others · 2017");
});

test("the common case is place and year — most photographs have no named face", () => {
  expect(captionFor({ people: [], city: "Nudgee", localDateTime: "2011-08-12T00:00:00Z" }))
    .toBe("Nudgee · 2011");
});

test("country only when there is no city — a holiday still says something", () => {
  expect(captionFor({ people: [], city: null, country: "Italy", localDateTime: "2019-08-12T00:00:00Z" }))
    .toBe("Italy · 2019");
  // City wins when both exist: "Nudgee" says more than "Australia" in Nudgee.
  expect(captionFor({ people: [], city: "Nudgee", country: "Australia", localDateTime: "2019-08-12T00:00:00Z" }))
    .toBe("Nudgee · 2019");
});

test("a year alone is still worth saying", () => {
  expect(captionFor({ people: [], localDateTime: "2014-08-12T00:00:00Z" })).toBe("2014");
});

test("nothing known produces an empty line, never stray separators", () => {
  // The element hides on empty. A "· ·" here would be a visible defect on the
  // glass that no other assertion in this file would catch.
  expect(captionFor({ people: [], city: null, country: null, localDateTime: null })).toBe("");
  expect(captionFor({})).toBe("");
  expect(captionFor(null)).toBe("");
});

test("a malformed date contributes no year rather than a fragment", () => {
  // Slicing a bad string would otherwise put "not " or "" into the line.
  expect(captionFor({ people: [], city: "Nudgee", localDateTime: "not a date" })).toBe("Nudgee");
  expect(captionFor({ people: [], city: "Nudgee", localDateTime: 20230812 })).toBe("Nudgee");
});

test("blank names from the library are dropped, not printed", () => {
  // Immich returns a person record with an empty name for unnamed faces.
  expect(captionFor({ people: ["", "  "], city: "Nudgee", localDateTime: "2020-08-12T00:00:00Z" }))
    .toBe("Nudgee · 2020");
});

/* ── The trip, joined from the vault's dated notes ─────────────────────────
   Stage 2 of the severed-memory work. `trip` arrives on the asset already
   rendered by server/services/photoTrips.js — "Mexico 2017", year included —
   because note content is loopback-only and the browser gets a phrase, never
   the span table. */

test("a trip REPLACES the bare year — it already carries one", () => {
  // The line that made this worth building. Seen on the wall 2026-08-15 as
  // "our nephew Jeff · Playa del Carmen · 2017".
  expect(captionFor({
    people: ["our nephew Jeff"],
    city: "Playa del Carmen",
    localDateTime: "2017-08-15T17:07:08.067Z",
    trip: "Mexico 2017"
  })).toBe("our nephew Jeff · Playa del Carmen · Mexico 2017");

  // Never "· Mexico 2017 · 2017", which would be the feature announcing itself
  // rather than saying something.
  expect(captionFor({ people: [], city: "Nudgee", localDateTime: "2011-08-12T00:00:00Z", trip: "Tasmania 2011" }))
    .toBe("Nudgee · Tasmania 2011");
});

test("the place is dropped when the trip already said it", () => {
  // The vault's Singapore note spans a trip where every photograph's city IS
  // Singapore. The honest composition would stutter.
  expect(captionFor({ people: [], city: "Singapore", localDateTime: "2023-05-24T00:00:00Z", trip: "Singapore 2023" }))
    .toBe("Singapore 2023");
  // A city the trip does NOT name still earns its place — this is the common
  // shape and the rule must not eat it.
  expect(captionFor({ people: [], city: "Rome", localDateTime: "2017-03-08T00:00:00Z", trip: "Europe 2017" }))
    .toBe("Rome · Europe 2017");
});

test("a trip is worth saying even when nothing else is known", () => {
  expect(captionFor({ people: [], city: null, localDateTime: "2017-08-15T00:00:00Z", trip: "Mexico 2017" }))
    .toBe("Mexico 2017");
});

test("no trip is the common case and the caption is exactly what it was", () => {
  // Most days are not a trip, and 62 of 100 live assets carry only a city. The
  // absent key, an empty string and whitespace must all fall back to the year.
  for (const trip of [undefined, null, "", "   "]) {
    expect(captionFor({ people: [], city: "Nudgee", localDateTime: "2011-08-12T00:00:00Z", trip }))
      .toBe("Nudgee · 2011");
  }
});

test("the diptych merges trips the same way it merges years", async () => {
  const { captionForFrame } = await import("../src/v3/core/ground.js");
  const pair = [
    { people: [], city: "Playa del Carmen", localDateTime: "2017-08-15T17:07:00.090Z", trip: "Mexico 2017" },
    { people: [], city: "Playa del Carmen", localDateTime: "2017-08-15T17:07:08.067Z", trip: "Mexico 2017" }
  ];
  // Same moment, same trip — ONE line, not the same thing said twice.
  expect(captionForFrame(pair)).toBe("Playa del Carmen · Mexico 2017");

  /* A half on the trip and a half not can only reach here through the
     unknown-date bucket (the halves are chosen within minutes of each other).
     The line stays TRUE rather than lending one photograph the other's trip. */
  expect(captionForFrame([
    { people: [], city: "Nudgee", localDateTime: "2017-08-15T00:00:00Z", trip: "Mexico 2017" },
    { people: [], city: "Nudgee", localDateTime: "2017-08-15T00:00:00Z" }
  ])).toBe("Nudgee · 2017 & Mexico 2017");
});

/* ── The low-resolution guard ─────────────────────────────────────────────── */

test("low-resolution guard: small originals out, unknown dimensions IN", async () => {
  const { isLowResolution } = await import("../server/services/immichClient.js");

  // Under the 1200px long edge — upscaled mush on a 1920 panel.
  expect(isLowResolution({ exifInfo: { exifImageWidth: 800, exifImageHeight: 600 } })).toBe(true);
  // Portrait: the LONG edge is what matters, not the width.
  expect(isLowResolution({ exifInfo: { exifImageWidth: 900, exifImageHeight: 1600 } })).toBe(false);
  expect(isLowResolution({ exifInfo: { exifImageWidth: 1920, exifImageHeight: 1080 } })).toBe(false);

  /* ⚠ The one that matters. Zero dimensions mean the CALLER did not request
     withExif, not that the photograph is small. Failing closed here would empty
     the ambient pool on any code path that forgets the flag — silently, and
     looking exactly like "Immich is down". */
  expect(isLowResolution({ exifInfo: {} })).toBe(false);
  expect(isLowResolution({})).toBe(false);
  expect(isLowResolution(null)).toBe(false);
});
