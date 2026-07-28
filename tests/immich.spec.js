import { test, expect } from "@playwright/test";
import {
  photosForToday,
  buildOnThisDayMemory,
  memoryPhotoSrc,
  selectDailyMemories,
  captionFor,
  isTravel,
  givenName,
  nameSegment
} from "../src/js/services/photoMemory.js";

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

// ── Daily Memories set (features.dailyMemories) ────────────────
test.describe("selectDailyMemories — the curated per-day set, widened when thin", () => {
  test("exact-day only when there are already enough, nearest-year first", () => {
    const feed = [
      { id: "a", localDateTime: "2021-07-12T08:00:00.000Z" },
      { id: "b", localDateTime: "2019-07-12T08:00:00.000Z" },
      { id: "c", localDateTime: "2020-07-12T08:00:00.000Z" }
    ];
    const out = selectDailyMemories(feed, TODAY, { target: 3 });
    expect(out.map((p) => p.id)).toEqual(["a", "c", "b"]); // 2021, 2020, 2019
    expect(out.every((p) => p.offsetDays === 0)).toBe(true);
  });

  test("widens to the NEAREST neighbouring dates (day-before then day-after) to make up the target", () => {
    const feed = [
      { id: "exact", localDateTime: "2021-07-12T08:00:00.000Z" }, // offset 0
      { id: "after1", localDateTime: "2020-07-13T08:00:00.000Z" }, // +1
      { id: "before1", localDateTime: "2018-07-11T08:00:00.000Z" }, // -1
      { id: "after2", localDateTime: "2017-07-14T08:00:00.000Z" }  // +2 (not needed)
    ];
    const out = selectDailyMemories(feed, TODAY, { target: 3 });
    // exact first, then |offset| ascending with the day-before ahead of the day-after.
    expect(out.map((p) => p.id)).toEqual(["exact", "before1", "after1"]);
    expect(out.map((p) => p.offsetDays)).toEqual([0, 1, 1]);
  });

  test("caps at target, dedupes by id, empty/malformed feed → []", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      localDateTime: `20${String(10 + i).padStart(2, "0")}-07-12T08:00:00.000Z`
    }));
    expect(selectDailyMemories(many, TODAY, { target: 12 })).toHaveLength(12);
    const dup = [
      { id: "z", localDateTime: "2019-07-12T08:00:00.000Z" },
      { id: "z", localDateTime: "2020-07-11T08:00:00.000Z" } // same id, nearer day — still one entry
    ];
    expect(selectDailyMemories(dup, TODAY, { target: 12 }).map((p) => p.id)).toEqual(["z"]);
    expect(selectDailyMemories([], TODAY)).toEqual([]);
    expect(selectDailyMemories(null, TODAY)).toEqual([]);
  });

  test("crosses a month boundary correctly when widening (real-date arithmetic)", () => {
    const firstOfAug = new Date("2026-08-01T12:00:00");
    const feed = [{ id: "jul31", localDateTime: "2015-07-31T20:00:00.000Z" }]; // the day before Aug 1
    const out = selectDailyMemories(feed, firstOfAug, { target: 12 });
    expect(out.map((p) => p.id)).toEqual(["jul31"]);
    expect(out[0].offsetDays).toBe(1);
  });

  test("carries location fields through for the caption/map", () => {
    const feed = [{
      id: "loc", localDateTime: "2019-07-12T08:00:00.000Z",
      city: "Kyoto", state: "Kyoto Prefecture", country: "Japan", lat: 35.01, lng: 135.76
    }];
    const [p] = selectDailyMemories(feed, TODAY, { target: 12 });
    expect(p).toMatchObject({ id: "loc", year: 2019, city: "Kyoto", country: "Japan", lat: 35.01, lng: 135.76 });
  });

  test("carries named faces through, defaulting to [] when the feed has none", () => {
    const feed = [
      { id: "faces", localDateTime: "2019-07-12T08:00:00.000Z", people: ["Joe Perry-McHugh"] },
      { id: "bare", localDateTime: "2018-07-12T08:00:00.000Z" }
    ];
    const out = selectDailyMemories(feed, TODAY, { target: 12 });
    expect(out.find((p) => p.id === "faces").people).toEqual(["Joe Perry-McHugh"]);
    expect(out.find((p) => p.id === "bare").people).toEqual([]);
  });
});

test.describe("captionFor — year · place, region", () => {
  test("overseas photo uses the country as the region", () => {
    expect(captionFor({ year: 2019, city: "Kyoto", state: "Kyoto Prefecture", country: "Japan" }))
      .toBe("2019 · Kyoto, Japan");
  });

  test("Australian photo uses the state as the region", () => {
    expect(captionFor({ year: 2018, city: "Byron Bay", state: "NSW", country: "Australia" }))
      .toBe("2018 · Byron Bay, NSW");
  });

  test("region alone when the city is missing, year alone when there's no location", () => {
    expect(captionFor({ year: 2020, country: "Japan" })).toBe("2020 · Japan");
    expect(captionFor({ year: 2020, state: "QLD", country: "Australia" })).toBe("2020 · QLD");
    expect(captionFor({ year: 2020 })).toBe("2020");
  });
});

// Named faces in the caption. The suppression list doubles as the switch, so the
// first thing pinned is that an unset list leaves every caption exactly as it was.
test.describe("nameSegment — who is in the photo", () => {
  const RESIDENTS = ["Greg Dee", "Brett Lewis"];

  test("no hide list → no names at all (the lane is off, and this is the rollback)", () => {
    expect(nameSegment(["Joe Perry-McHugh"], [])).toBe("");
    expect(nameSegment(["Joe Perry-McHugh"])).toBe("");
    expect(nameSegment(["Joe Perry-McHugh"], ["", "  "])).toBe("");
  });

  test("residents are never named; everyone else gets their given name", () => {
    expect(nameSegment(["Greg Dee", "Brett Lewis"], RESIDENTS)).toBe("");
    expect(nameSegment(["Greg Dee", "Joe Perry-McHugh"], RESIDENTS)).toBe("Joe");
    expect(nameSegment(["Joe Perry-McHugh", "Lee Heyes"], RESIDENTS)).toBe("Joe and Lee");
  });

  test("matching is case/space-insensitive on the FULL name", () => {
    expect(nameSegment(["  greg   dee  "], ["Greg Dee"])).toBe("");
    // The household has two Bretts — hiding one must not silence the other.
    expect(nameSegment(["Brett Abdul"], RESIDENTS)).toBe("Brett");
  });

  test("duplicate Immich person records collapse on the given name", () => {
    expect(nameSegment(["Korina Newsome-Smith", "Korina"], RESIDENTS)).toBe("Korina");
  });

  test("a crowd is capped, not listed", () => {
    const crowd = ["Joe Perry-McHugh", "Lee Heyes", "Troy Hinchscliff"];
    expect(nameSegment(crowd, RESIDENTS)).toBe("Joe, Lee and 1 other");
    expect(nameSegment([...crowd, "Dean Rohde", "Kym Burgess"], RESIDENTS))
      .toBe("Joe, Lee and 3 others");
  });

  test("empty / malformed people → silence, never a throw", () => {
    expect(nameSegment([], RESIDENTS)).toBe("");
    expect(nameSegment(null, RESIDENTS)).toBe("");
    expect(nameSegment(["", "   ", null, undefined], RESIDENTS)).toBe("");
  });

  test("givenName takes the first token", () => {
    expect(givenName("Joe Perry-McHugh")).toBe("Joe");
    expect(givenName("Korina")).toBe("Korina");
    expect(givenName("  Lauren  Sae-Tieo ")).toBe("Lauren");
    expect(givenName("")).toBe("");
    expect(givenName(null)).toBe("");
  });
});

test.describe("captionFor — names appended after the place", () => {
  const RESIDENTS = ["Greg Dee", "Brett Lewis"];

  test("names come last, after year · place", () => {
    expect(captionFor(
      { year: 2018, city: "Byron Bay", state: "NSW", country: "Australia", people: ["Joe Perry-McHugh", "Lee Heyes"] },
      { hideNames: RESIDENTS }
    )).toBe("2018 · Byron Bay, NSW · Joe and Lee");
  });

  test("each part falls away independently", () => {
    expect(captionFor({ year: 2011, people: ["Joe Perry-McHugh"] }, { hideNames: RESIDENTS }))
      .toBe("2011 · Joe");
    expect(captionFor({ year: 2019, city: "Kyoto", country: "Japan", people: ["Greg Dee"] }, { hideNames: RESIDENTS }))
      .toBe("2019 · Kyoto, Japan");
    expect(captionFor({ people: ["Joe Perry-McHugh"] }, { hideNames: RESIDENTS })).toBe("Joe");
  });

  test("with no hide list every caption is byte-identical to the pre-names build", () => {
    const photo = { year: 2018, city: "Byron Bay", state: "NSW", country: "Australia", people: ["Joe Perry-McHugh"] };
    expect(captionFor(photo)).toBe("2018 · Byron Bay, NSW");
    expect(captionFor(photo)).toBe(captionFor({ ...photo, people: [] }));
  });
});

test.describe("isTravel — country present and not Australia", () => {
  test("overseas → true, Australia (any case) → false, no country → false", () => {
    expect(isTravel({ country: "Japan" })).toBe(true);
    expect(isTravel({ country: "Australia" })).toBe(false);
    expect(isTravel({ country: "australia" })).toBe(false);
    expect(isTravel({ country: null })).toBe(false);
    expect(isTravel({})).toBe(false);
  });
});
