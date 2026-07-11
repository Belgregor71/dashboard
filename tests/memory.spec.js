import { test, expect } from "@playwright/test";
import {
  pickMemory,
  toSurface,
  scoreFit,
  moodOf,
  MEMORY_SCORE
} from "../src/js/services/memoryEngine.js";
import { anticipationWarmth, afterglowFactor } from "../src/js/services/momentsEngine.js";
import { seasonOf, dayCharacterOf, deriveIntent } from "../src/js/services/houseModel.js";

// Pure unit tests — memoryEngine / momentsEngine / houseModel carry no DOM and no
// storage, so these run straight in the Playwright node process (routines.spec.js
// style). Phase 9: docs/vision/phase-9-remember.md.
//
// The phase's whole value is rarity + restraint, so the tests are mostly about
// what DOESN'T surface: the daily budget, the months-long cooldown, the context
// floor, and — the invariant that matters most — that a tender memory can never
// come back as a caption or an interrupt.

const WINTER_SUNDAY = new Date("2026-07-12T15:00:00"); // Brisbane winter, a grey Sunday afternoon
const WINTER_MONDAY = new Date("2026-07-13T15:00:00");
const SUMMER_DAY = new Date("2026-01-15T15:00:00");

const GREY_WINTER_CTX = { season: "winter", dayCharacter: "weekend", condition: "Overcast" };

// A gentle non-tender place memory tagged for a grey winter weekend.
const tasmania = {
  id: "tas", kind: "trip", date: "2021-07-14",
  title: "Tasmania", tags: ["winter", "grey", "weekend"], sensitivity: "normal", cooldownMonths: 6
};
// A tender pet memory — the case the gating exists for.
const brodie = {
  id: "brodie", kind: "pet",
  title: "Brodie", tags: ["winter", "grey"], sensitivity: "tender", cooldownMonths: 12
};
// A summer memory that does NOT fit a winter afternoon.
const summerSwim = {
  id: "swim", kind: "first", recurring: { month: 11, day: 3 },
  title: "First swim", tags: ["summer", "bright"], sensitivity: "normal"
};

test.describe("pickMemory — rarity is the feature", () => {
  test("nothing to remember → null (silence is the default)", () => {
    expect(pickMemory([], GREY_WINTER_CTX, {}, WINTER_SUNDAY)).toBeNull();
  });

  test("an ordinary day with no fitting memory stays silent (context floor)", () => {
    // Only the summer memory exists; on a winter afternoon it doesn't clear the floor.
    expect(pickMemory([summerSwim], GREY_WINTER_CTX, {}, WINTER_SUNDAY)).toBeNull();
  });

  test("a memory that fits the day surfaces as a Low-band, non-interrupt candidate", () => {
    const s = pickMemory([tasmania], GREY_WINTER_CTX, {}, WINTER_SUNDAY);
    expect(s).not.toBeNull();
    expect(s.source).toBe("memory");
    expect(s.score).toBe(MEMORY_SCORE);
    expect(s.score).toBeGreaterThanOrEqual(40);
    expect(s.score).toBeLessThanOrEqual(49);
    expect(s.interrupt).toBe(false);
  });

  test("the daily budget caps at one — a memory already shown today blocks the next", () => {
    const history = { lastSurfacedDay: `${WINTER_SUNDAY.getFullYear()}-${WINTER_SUNDAY.getMonth() + 1}-${WINTER_SUNDAY.getDate()}` };
    expect(pickMemory([tasmania], GREY_WINTER_CTX, history, WINTER_SUNDAY)).toBeNull();
  });

  test("a per-entry cooldown skips one entry and lets a different one through", () => {
    const other = { ...tasmania, id: "otago", title: "Otago" };
    const cooldowns = { "memory:tas": WINTER_SUNDAY.getTime() + 60 * 86_400_000 }; // Tasmania cooling for ~2 months
    const s = pickMemory([tasmania, other], GREY_WINTER_CTX, { cooldowns }, WINTER_SUNDAY);
    expect(s.entryId).toBe("otago"); // chosen, not silence — it "chooses"
  });

  test("an anniversary clears the floor on its own, whatever the weather", () => {
    // A birthday-style recurring entry anchored to today with NO fitting tags.
    const bland = { id: "wedding", kind: "occasion", recurring: { month: 7, day: 12 }, title: "Anniversary", tags: [] };
    const s = pickMemory([bland], { season: "winter", condition: "Clear" }, {}, WINTER_SUNDAY);
    expect(s).not.toBeNull();
    expect(s.entryId).toBe("wedding");
  });
});

test.describe("tender-gating — the invariant that matters most", () => {
  test("a tender entry is ambient-only, holds longer, and never carries a caption", () => {
    const s = toSurface(brodie, WINTER_SUNDAY);
    expect(s.sensitivity).toBe("tender");
    expect(s.caption).toBeNull();   // no words put to grief
    expect(s.text).toBe("");        // nothing to render as a text line
    expect(s.ambientOnly).toBe(true);
    expect(s.interrupt).toBe(false);
    expect(s.holdMs).toBeGreaterThan(toSurface(tasmania, WINTER_SUNDAY).holdMs);
  });

  test("a normal entry does carry a quiet caption and is not ambient-restricted", () => {
    const s = toSurface(tasmania, WINTER_SUNDAY);
    expect(typeof s.caption).toBe("string");
    expect(s.caption.length).toBeGreaterThan(0);
    expect(s.ambientOnly).toBe(false);
    expect(s.interrupt).toBe(false); // no memory ever interrupts
  });
});

test.describe("scoreFit / moodOf — the 'right kind of afternoon'", () => {
  test("a grey condition reads as a wistful mood; clear reads bright", () => {
    expect(moodOf("Overcast")).toBe("grey");
    expect(moodOf("Light rain")).toBe("wistful");
    expect(moodOf("Clear")).toBe("bright");
    expect(moodOf("")).toBeNull();
  });

  test("a season + mood + day match scores higher than a bare entry", () => {
    const fitted = scoreFit(tasmania, GREY_WINTER_CTX, WINTER_SUNDAY);
    const bare = scoreFit({ id: "x", tags: [] }, GREY_WINTER_CTX, WINTER_SUNDAY);
    expect(fitted).toBeGreaterThan(bare);
    expect(bare).toBe(0);
  });

  test("afterglow: a just-passed dated occasion scores, and fades as days pass", () => {
    const trip = { id: "wknd", kind: "trip", date: "2026-07-10", tags: [] }; // ended 2 days before Sunday
    const fresh = scoreFit(trip, {}, new Date("2026-07-11T12:00:00")); // 1 day after
    const older = scoreFit(trip, {}, new Date("2026-07-14T12:00:00")); // 4 days after
    expect(fresh).toBeGreaterThan(older);
    expect(older).toBeGreaterThanOrEqual(0);
  });
});

test.describe("momentsEngine — anticipation & afterglow (the timeline)", () => {
  test("anticipation warms as a tagged event nears", () => {
    const now = new Date("2026-08-01T09:00:00");
    const far = anticipationWarmth([{ start: "2026-08-25", category: { id: "travel" } }], now);
    const near = anticipationWarmth([{ start: "2026-08-04", category: { id: "travel" } }], now);
    expect(near.warmth).toBeGreaterThan(far.warmth);
    expect(near.warmth).toBeLessThanOrEqual(1);
  });

  test("an untagged event is not anticipated (ordinary calendar noise is ignored)", () => {
    const now = new Date("2026-08-01T09:00:00");
    expect(anticipationWarmth([{ start: "2026-08-03" }], now).warmth).toBe(0);
  });

  test("afterglowFactor decays 1 → 0 across its window, then stays 0", () => {
    expect(afterglowFactor(0, 5)).toBe(1);
    expect(afterglowFactor(2.5, 5)).toBeCloseTo(0.5, 5);
    expect(afterglowFactor(5, 5)).toBe(0);
    expect(afterglowFactor(9, 5)).toBe(0); // past the window
    expect(afterglowFactor(-1, 5)).toBe(0); // not yet passed
  });
});

test.describe("houseModel — day-character & season feed distinct tone inputs", () => {
  test("Southern-Hemisphere season mapping (July is winter, January summer)", () => {
    expect(seasonOf(WINTER_SUNDAY)).toBe("winter");
    expect(seasonOf(SUMMER_DAY)).toBe("summer");
    expect(seasonOf(new Date("2026-04-10"))).toBe("autumn");
    expect(seasonOf(new Date("2026-10-10"))).toBe("spring");
  });

  test("dayCharacter tells a weekend from a weekday, and a holiday overrides", () => {
    expect(dayCharacterOf(WINTER_SUNDAY)).toBe("weekend");
    expect(dayCharacterOf(WINTER_MONDAY)).toBe("weekday");
    expect(dayCharacterOf(WINTER_MONDAY, { holiday: true })).toBe("holiday");
  });

  test("deriveIntent emits dayCharacter + season — Sunday≠Monday, winter≠summer", () => {
    const sun = deriveIntent({ presence: "glance", peopleHome: 1, now: WINTER_SUNDAY });
    const mon = deriveIntent({ presence: "glance", peopleHome: 1, now: WINTER_MONDAY });
    const summer = deriveIntent({ presence: "glance", peopleHome: 1, now: SUMMER_DAY });
    expect(sun.dayCharacter).toBe("weekend");
    expect(mon.dayCharacter).toBe("weekday");
    expect(sun.season).toBe("winter");
    expect(summer.season).toBe("summer");
  });
});
