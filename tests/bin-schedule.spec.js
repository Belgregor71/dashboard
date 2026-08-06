import { test, expect } from "@playwright/test";

import {
  EVE_FROM_HOUR,
  LAST_CHANCE_UNTIL_HOUR,
  binWindow,
  collectionsFromCalendar,
  collectionsFromDateMath,
  colourForWord,
  parseDayNumber,
  parseLocalDate
} from "../server/services/binSchedule.js";

// Pure unit tests — binSchedule's schedule parsing and window rule carry no HTTP
// and no DOM, so they run straight in the Playwright node process.
//
// Every date here is written as a LOCAL date deliberately. The single most
// dangerous bug in this module is a UTC-midnight parse making the day-before rule
// off by one, so the tests must not accidentally use the same wrong idiom.

const localDate = (y, m, d, hour = 0) => new Date(y, m - 1, d, hour, 0, 0, 0);

// Shape as returned live by calendar.brisbane_city_council (measured 2026-08-06).
const councilEvents = [
  { start: { date: "2026-08-06" }, end: { date: "2026-08-07" }, summary: "Rubbish" },
  { start: { date: "2026-08-06" }, end: { date: "2026-08-07" }, summary: "Recycling" },
  { start: { date: "2026-08-13" }, end: { date: "2026-08-14" }, summary: "Rubbish" },
  { start: { date: "2026-08-13" }, end: { date: "2026-08-14" }, summary: "Garden" }
];

test.describe("parseLocalDate", () => {
  test("parses an all-day date string as LOCAL midnight, not UTC", () => {
    const parsed = parseLocalDate("2026-08-06");
    // The whole day-before rule depends on these three being the local calendar
    // day. `new Date("2026-08-06")` would be UTC midnight and can land on the 5th.
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    expect(parsed.getDate()).toBe(6);
    expect(parsed.getHours()).toBe(0);
  });

  test("rejects junk rather than producing an Invalid Date", () => {
    expect(parseLocalDate("")).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate("not-a-date")).toBeNull();
    expect(parseLocalDate("2026-8-6")).toBeNull(); // unpadded is not the HA shape
  });
});

test.describe("colour mapping", () => {
  test("maps the council's three words", () => {
    expect(colourForWord("Rubbish")).toBe("red");
    expect(colourForWord("Recycling")).toBe("yellow");
    expect(colourForWord("Garden")).toBe("green");
  });

  test("is case and whitespace insensitive", () => {
    expect(colourForWord("  rUBBISH ")).toBe("red");
  });

  test("returns null for an unknown word so the caller can degrade", () => {
    expect(colourForWord("Hard Waste")).toBeNull();
  });
});

test.describe("collectionsFromCalendar", () => {
  test("groups events by day and sorts by date", () => {
    const collections = collectionsFromCalendar(councilEvents);
    expect(collections).toHaveLength(2);
    expect(collections[0].date.getDate()).toBe(6);
    expect(collections[1].date.getDate()).toBe(13);
  });

  test("orders bins red first so copy never reads 'Yellow + Red'", () => {
    // Feed them deliberately backwards.
    const collections = collectionsFromCalendar([
      { start: { date: "2026-08-06" }, summary: "Recycling" },
      { start: { date: "2026-08-06" }, summary: "Rubbish" }
    ]);
    expect(collections[0].bins.map((b) => b.colour)).toEqual(["red", "yellow"]);
    expect(collections[0].bins.map((b) => b.word)).toEqual(["Rubbish", "Recycling"]);
  });

  test("an unrecognised bin is kept as 'unknown', never dropped", () => {
    // A bin we cannot name is still a bin to put out — silence is the worst answer.
    const collections = collectionsFromCalendar([
      { start: { date: "2026-08-06" }, summary: "Hard Waste" }
    ]);
    expect(collections[0].bins).toEqual([{ word: "Hard Waste", colour: "unknown" }]);
  });

  test("ignores duplicates and malformed events without throwing", () => {
    const collections = collectionsFromCalendar([
      { start: { date: "2026-08-06" }, summary: "Rubbish" },
      { start: { date: "2026-08-06" }, summary: "Rubbish" },
      { start: { date: "2026-08-06" } },
      { summary: "Rubbish" },
      null
    ]);
    expect(collections).toHaveLength(1);
    expect(collections[0].bins).toHaveLength(1);
  });

  test("tolerates a non-array upstream", () => {
    expect(collectionsFromCalendar(null)).toEqual([]);
    expect(collectionsFromCalendar({ error: "boom" })).toEqual([]);
  });
});

test.describe("collectionsFromDateMath (the HA-down fallback)", () => {
  const THURSDAY = 4;

  test("matches the live council calendar it stands in for", () => {
    // Verified 2026-08-06 against all 26 published collections: the parity math
    // agreed on every one. These two pin that agreement.
    const collections = collectionsFromDateMath({
      collectionDay: THURSDAY,
      yellowRef: "2026-06-11",
      now: localDate(2026, 8, 4),
      count: 2
    });
    expect(collections[0].date.getDate()).toBe(6);
    expect(collections[0].bins.map((b) => b.colour)).toEqual(["red", "yellow"]);
    expect(collections[1].date.getDate()).toBe(13);
    expect(collections[1].bins.map((b) => b.colour)).toEqual(["red", "green"]);
  });

  test("carries council words too, so the tile reads the same either source", () => {
    const [first] = collectionsFromDateMath({
      collectionDay: THURSDAY,
      yellowRef: "2026-06-11",
      now: localDate(2026, 8, 4),
      count: 1
    });
    expect(first.bins.map((b) => b.word)).toEqual(["Rubbish", "Recycling"]);
  });

  test("today counts as the next collection, not next week", () => {
    const [first] = collectionsFromDateMath({
      collectionDay: THURSDAY,
      yellowRef: "2026-06-11",
      now: localDate(2026, 8, 6, 3),
      count: 1
    });
    expect(first.date.getDate()).toBe(6);
  });

  test("red only when no yellow reference is configured", () => {
    const [first] = collectionsFromDateMath({
      collectionDay: THURSDAY,
      yellowRef: null,
      now: localDate(2026, 8, 4),
      count: 1
    });
    expect(first.bins.map((b) => b.colour)).toEqual(["red"]);
  });

  test("no configured weekday yields nothing", () => {
    expect(collectionsFromDateMath({ collectionDay: null })).toEqual([]);
  });
});

test.describe("binWindow — the reminder has to arrive before the truck", () => {
  const collections = collectionsFromCalendar(councilEvents); // 6th and 13th Aug

  test("silent on the day before until midday", () => {
    expect(binWindow(collections, localDate(2026, 8, 5, EVE_FROM_HOUR - 1)).due).toBe(false);
  });

  test("fires the day before from midday", () => {
    const window = binWindow(collections, localDate(2026, 8, 5, EVE_FROM_HOUR));
    expect(window).toMatchObject({ due: true, eve: true, lastChance: false });
    expect(window.collection.date.getDate()).toBe(6);
  });

  test("still on late the night before", () => {
    expect(binWindow(collections, localDate(2026, 8, 5, 23)).eve).toBe(true);
  });

  test("becomes a last chance in the early hours of collection day", () => {
    const window = binWindow(collections, localDate(2026, 8, 6, LAST_CHANCE_UNTIL_HOUR - 1));
    expect(window).toMatchObject({ due: true, eve: false, lastChance: true });
    expect(window.collection.date.getDate()).toBe(6);
  });

  test("goes SILENT once the truck has been", () => {
    // The regression this whole change exists to fix: the old route reminded all
    // day, asking for something no longer possible.
    expect(binWindow(collections, localDate(2026, 8, 6, LAST_CHANCE_UNTIL_HOUR)).due).toBe(false);
    expect(binWindow(collections, localDate(2026, 8, 6, 9)).due).toBe(false);
    expect(binWindow(collections, localDate(2026, 8, 6, 18)).due).toBe(false);
  });

  test("silent on a day with no collection either side", () => {
    expect(binWindow(collections, localDate(2026, 8, 9, 20)).due).toBe(false);
  });

  test("an empty or missing schedule is silent, never a crash", () => {
    expect(binWindow([], localDate(2026, 8, 5, 20)).due).toBe(false);
    expect(binWindow(null, localDate(2026, 8, 5, 20)).due).toBe(false);
  });
});

test.describe("parseDayNumber", () => {
  test("accepts names and numbers, rejects nonsense", () => {
    expect(parseDayNumber("Thursday")).toBe(4);
    expect(parseDayNumber("thursday")).toBe(4);
    expect(parseDayNumber(0)).toBe(0);
    expect(parseDayNumber("6")).toBe(6);
    expect(parseDayNumber("")).toBeNull();
    expect(parseDayNumber(null)).toBeNull();
    expect(parseDayNumber("someday")).toBeNull();
    expect(parseDayNumber(9)).toBeNull();
  });
});
