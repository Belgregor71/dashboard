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
