import { test, expect } from "@playwright/test";
import { photosForToday, buildOnThisDayMemory, memoryPhotoSrc } from "../src/js/services/photoMemory.js";

// Pure unit tests for the Immich on-this-day mapping — Phase 9.5
// (docs/vision/photo-source-immich.md). photoMemory.js has no DOM/IO, so these
// run straight in the Playwright node process (memory.spec.js style). The server
// over-fetches a ±1-day window per past year; the exact match is HERE.

const TODAY = new Date("2026-07-12T15:00:00"); // 12 July

const assets = [
  { id: "a", localDateTime: "2021-07-12T08:00:00.000Z" }, // ✓ 2021
  { id: "b", localDateTime: "2019-07-12T20:00:00.000Z" }, // ✓ 2019
  { id: "c", localDateTime: "2020-07-13T09:00:00.000Z" }, // ✗ 13th (window edge)
  { id: "d", localDateTime: "2018-06-12T09:00:00.000Z" }, // ✗ June
  { id: "a", localDateTime: "2021-07-12T08:00:00.000Z" }  // dup id
];

test.describe("photosForToday — exact month/day on local capture time", () => {
  test("keeps only today's month/day, dedupes, newest year first", () => {
    const out = photosForToday(assets, TODAY);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]); // c/d dropped, dup collapsed, 2021 before 2019
    expect(out.map((p) => p.year)).toEqual([2021, 2019]);
  });

  test("reads the wall-clock fields, not a TZ-shifted Date (no midnight drift)", () => {
    // A late-evening local capture must still count as that calendar day.
    const late = [{ id: "x", localDateTime: "2015-07-12T23:30:00.000Z" }];
    expect(photosForToday(late, TODAY).map((p) => p.id)).toEqual(["x"]);
  });

  test("empty / malformed feed → empty (silence, never a throw)", () => {
    expect(photosForToday([], TODAY)).toEqual([]);
    expect(photosForToday(null, TODAY)).toEqual([]);
    expect(photosForToday([{ id: "n", localDateTime: "garbage" }], TODAY)).toEqual([]);
  });
});

test.describe("buildOnThisDayMemory — a photo-backed memory entry", () => {
  test("null when nothing was taken today in a past year", () => {
    expect(buildOnThisDayMemory([], TODAY)).toBeNull();
    expect(buildOnThisDayMemory([{ id: "d", localDateTime: "2018-06-12T09:00:00.000Z" }], TODAY)).toBeNull();
  });

  test("builds an entry anchored to today, photos as Immich refs, evocative title", () => {
    const entry = buildOnThisDayMemory(assets, TODAY);
    expect(entry.id).toBe("immich-otd:2026-7-12");
    expect(entry.recurring).toEqual({ month: 7, day: 12 });
    expect(entry.title).toBe("7 years ago"); // 2026 − oldest (2019)
    expect(entry.photos).toEqual([{ immich: "a" }, { immich: "b" }]);
    expect(entry.sensitivity).toBe("normal");
    expect(entry.tags).toContain("winter"); // Southern-Hemisphere July
  });
});

// The memory's picture reaches the awake card/hero as `image` (memoryRuntime
// withPhoto → focusHero's thumb slot). Before this, surface.photos was read only
// by the wordless tender lane, so a normal memory rode over an unrelated ground.
test.describe("memoryPhotoSrc — a photo ref → a URL", () => {
  test("Immich refs go through the asset proxy, ids encoded", () => {
    expect(memoryPhotoSrc({ immich: "597169b2-5315-4a67-8df8-509694364cd4" }))
      .toBe("/api/immich/asset/597169b2-5315-4a67-8df8-509694364cd4/thumb");
    expect(memoryPhotoSrc({ immich: "a b/c" })).toBe("/api/immich/asset/a%20b%2Fc/thumb");
  });

  test("authored paths: rooted/absolute as-is, bare names under /photos/", () => {
    expect(memoryPhotoSrc("/photos/x.jpg")).toBe("/photos/x.jpg");
    expect(memoryPhotoSrc("https://example.test/x.jpg")).toBe("https://example.test/x.jpg");
    expect(memoryPhotoSrc("tasmania/cradle mountain.jpg")).toBe("/photos/tasmania/cradle%20mountain.jpg");
  });

  test("no ref → null (the card keeps its glyph, never a broken <img>)", () => {
    expect(memoryPhotoSrc(undefined)).toBeNull();
    expect(memoryPhotoSrc(null)).toBeNull();
    expect(memoryPhotoSrc("")).toBeNull();
  });
});
