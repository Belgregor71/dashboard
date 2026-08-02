import { test, expect } from "@playwright/test";
import {
  photosForToday,
  buildOnThisDayMemory,
  memoryPhotoSrc,
  selectDailyMemories,
  captionFor,
  isTravel,
  givenName,
  nameSegment,
  ambiguousGivenNames,
  displayName
} from "../src/js/services/photoMemory.js";
import { slim, liveMotionEnabled } from "../server/services/immichClient.js";

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

// Drawn from the real library, which holds three Marks, two Laurens, a person
// split across two records ("Korina" / "Korina Newsome-Smith") and exact
// duplicates ("Chris" twice).
test.describe("ambiguousGivenNames — when a given name names nobody", () => {
  const ROSTER = [
    "Mark Sokes", "Mark Dee", "Mark Weber",
    "Lauren Sae-Tieo", "Lauren Black",
    "Korina Newsome-Smith", "Korina",
    "Chris", "Chris",
    "Joe Perry-McHugh",
    "Sooty Dee-Lewis"
  ];

  test("a given name shared by several people is ambiguous", () => {
    const amb = ambiguousGivenNames(ROSTER);
    expect(amb.has("Mark")).toBe(true);
    expect(amb.has("Lauren")).toBe(true);
  });

  test("a unique given name is not", () => {
    const amb = ambiguousGivenNames(ROSTER);
    expect(amb.has("Joe")).toBe(false);
    expect(amb.has("Sooty")).toBe(false);
  });

  test("a bare record beside a fuller one is a SECOND person, not a duplicate", () => {
    // Confirmed by the household: bare records are people whose surname nobody
    // could remember (two Andrews, two Damians), not split face clusters.
    expect(ambiguousGivenNames(ROSTER).has("Korina")).toBe(true);
  });

  test("same-name records collapse — nothing in a caption could tell them apart", () => {
    expect(ambiguousGivenNames(ROSTER).has("Chris")).toBe(false);
  });

  test("empty / malformed roster → nothing ambiguous, never a throw", () => {
    expect(ambiguousGivenNames([]).size).toBe(0);
    expect(ambiguousGivenNames(null).size).toBe(0);
    expect(ambiguousGivenNames(["", "   ", null]).size).toBe(0);
  });

  test("displayName picks given or full accordingly", () => {
    const amb = ambiguousGivenNames(ROSTER);
    expect(displayName("Joe Perry-McHugh", amb)).toBe("Joe");
    expect(displayName("Mark Dee", amb)).toBe("Mark Dee");
    expect(displayName("Korina Newsome-Smith", amb)).toBe("Korina Newsome-Smith");
    // The surname-less Korina can only ever be "Korina" — nothing else exists.
    expect(displayName("Korina", amb)).toBe("Korina");
  });
});

test.describe("nameSegment — disambiguation in context", () => {
  const RESIDENTS = ["Greg Dee", "Brett Lewis"];
  const AMB = ambiguousGivenNames([
    "Mark Sokes", "Mark Dee", "Lauren Sae-Tieo", "Lauren Black",
    "Korina Newsome-Smith", "Korina", "Joe Perry-McHugh"
  ]);

  test("only the colliding names carry a surname", () => {
    expect(nameSegment(["Joe Perry-McHugh", "Mark Dee"], RESIDENTS, AMB)).toBe("Joe and Mark Dee");
  });

  test("the two Laurens stay distinguishable", () => {
    expect(nameSegment(["Lauren Sae-Tieo"], RESIDENTS, AMB)).toBe("Lauren Sae-Tieo");
    expect(nameSegment(["Lauren Black"], RESIDENTS, AMB)).toBe("Lauren Black");
  });

  test("two Korinas in one photo stay two people, as far as the names allow", () => {
    expect(nameSegment(["Korina Newsome-Smith", "Korina"], RESIDENTS, AMB))
      .toBe("Korina Newsome-Smith and Korina");
  });

  test("two genuinely different Marks both stay in the caption", () => {
    expect(nameSegment(["Mark Dee", "Mark Sokes"], RESIDENTS, AMB)).toBe("Mark Dee and Mark Sokes");
  });

  test("no ambiguity set → given names, exactly as before this existed", () => {
    expect(nameSegment(["Mark Dee", "Joe Perry-McHugh"], RESIDENTS)).toBe("Mark and Joe");
  });

  test("an unknown roster qualifies everything (the fail-soft path)", () => {
    const everything = { has: () => true };
    expect(nameSegment(["Joe Perry-McHugh"], RESIDENTS, everything)).toBe("Joe Perry-McHugh");
  });
});

test.describe("nameSegment — what the house calls someone", () => {
  const RESIDENTS = ["Greg Dee", "Brett Lewis"];
  const REL = new Map([
    ["melanie webber", "our niece"],
    ["matt lewis", "Brett's brother"],
    ["sooty dee-lewis", "our dog"]
  ]);
  const AMB = ambiguousGivenNames(["Matt Lewis", "Matt Bell", "Melanie Webber"]);

  test("a person alone in the photo gets their relationship", () => {
    expect(nameSegment(["Melanie Webber"], RESIDENTS, AMB, REL)).toBe("our niece Melanie");
  });

  test("a label beats a surname — it disambiguates harder and reads shorter", () => {
    // "Matt" is ambiguous (Matt Lewis / Matt Bell), so without a label it would
    // render "Matt Lewis"; "Brett's brother Matt" is unmistakable without it.
    expect(nameSegment(["Matt Lewis"], RESIDENTS, AMB, REL)).toBe("Brett's brother Matt");
    expect(nameSegment(["Matt Bell"], RESIDENTS, AMB, REL)).toBe("Matt Bell");
  });

  test("two people is a list, not an inventory of relationships", () => {
    expect(nameSegment(["Melanie Webber", "Matt Bell"], RESIDENTS, AMB, REL))
      .toBe("Melanie and Matt Bell");
  });

  test("someone with no entry is unaffected", () => {
    expect(nameSegment(["Joe Perry-McHugh"], RESIDENTS, AMB, REL)).toBe("Joe");
  });

  test("no map at all → exactly the pre-relationship behaviour", () => {
    expect(nameSegment(["Melanie Webber"], RESIDENTS, AMB)).toBe("Melanie");
    expect(nameSegment(["Melanie Webber"], RESIDENTS, AMB, null)).toBe("Melanie");
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

/**
 * The Live Photo motion knob, at the one place it changes the payload.
 *
 * `slim()` is the whitelist that decides what leaves the server, so this is the
 * server-side byte-identity check: with IMMICH_LIVE_MOTION unset, the object
 * must carry exactly the eight keys it has always carried. A ninth key appearing
 * by accident would ship a Live Photo id to every browser on the LAN.
 */
test.describe("slim — the motion id rides only when the knob is on", () => {
  const ASSET = {
    id: "0f4a",
    localDateTime: "2022-08-04T09:00:00.000Z",
    livePhotoVideoId: "dfeab25a-2e67-4ec5-9288-153c530b33da",
    exifInfo: { city: "Nudgee", state: "Queensland", country: "Australia", latitude: -27.3, longitude: 153.07 },
    people: [{ name: "Joe Perry-McHugh" }]
  };
  const BASE_KEYS = ["id", "localDateTime", "city", "state", "country", "lat", "lng", "people"];

  const withKnob = (value, fn) => {
    const prev = process.env.IMMICH_LIVE_MOTION;
    if (value === null) delete process.env.IMMICH_LIVE_MOTION;
    else process.env.IMMICH_LIVE_MOTION = value;
    try { fn(); } finally {
      if (prev === undefined) delete process.env.IMMICH_LIVE_MOTION;
      else process.env.IMMICH_LIVE_MOTION = prev;
    }
  };

  test("unset → exactly the eight keys, and no motion id anywhere", () => {
    withKnob(null, () => {
      expect(liveMotionEnabled()).toBe(false);
      const out = slim(ASSET);
      expect(Object.keys(out).sort()).toEqual([...BASE_KEYS].sort());
      expect(JSON.stringify(out)).not.toContain("dfeab25a");
    });
  });

  test("on → the same eight plus motionId, nothing else moved", () => {
    withKnob("1", () => {
      expect(liveMotionEnabled()).toBe(true);
      const out = slim(ASSET);
      expect(Object.keys(out).sort()).toEqual([...BASE_KEYS, "motionId"].sort());
      expect(out.motionId).toBe("dfeab25a-2e67-4ec5-9288-153c530b33da");
      // Everything else is untouched — the knob adds, it never rewrites.
      withKnob(null, () => {
        const off = slim(ASSET);
        for (const k of BASE_KEYS) expect(out[k]).toEqual(off[k]);
      });
    });
  });

  test("on, but a still with no motion half → motionId is null, never undefined", () => {
    withKnob("1", () => {
      const { livePhotoVideoId, ...plain } = ASSET;
      expect(slim(plain).motionId).toBe(null);
    });
  });

  // Read INSIDE the function, never at module load: ES imports hoist above
  // server.js's dotenv.config(), which is how a documented knob ends up
  // permanently frozen to its default (the KOKORO_VOICE trap).
  test("the knob is read per call, so .env is not frozen at import time", () => {
    withKnob(null, () => expect(liveMotionEnabled()).toBe(false));
    withKnob("1", () => expect(liveMotionEnabled()).toBe(true));
    withKnob(null, () => expect(liveMotionEnabled()).toBe(false));
  });
});
