import { test, expect } from "@playwright/test";
import {
  parseLog,
  renderNote,
  renderTranscript,
  houseDay,
  memoryEnabled,
  MAX_ENTRY_CHARS,
  MAX_ENTRIES_PER_DAY,
  RAW_RETENTION_DAYS
} from "../server/services/conversationLog.js";
import {
  parseHistory,
  recordDay,
  compact,
  foldReading,
  materialOf,
  __seedFrom,
  __resetHistory,
  MAX_DAYS,
  MAX_CONDITIONS
} from "../server/services/weatherHistory.js";
import { readFile, writeFile, rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/* ═══════════════════════════════════════════════════════════════════════════
   CONVERSATION MEMORY — the pure half.

   Everything asserted here runs without touching the disk or the API. The
   parts that do (consolidateOnce, the sweep, the review routes) are proved
   live, because a fixture that cannot produce the defect cannot catch it.

   The properties that matter are all about NOT keeping things: the retention
   promise, the frontmatter that must not exist, and the flag defaulting off.
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe("memoryEnabled — off unless asked, exactly", () => {
  const KEY = "VOICE_MEMORY_ENABLED";
  let saved;
  test.beforeEach(() => { saved = process.env[KEY]; });
  test.afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  test("unset is off", () => {
    delete process.env[KEY];
    expect(memoryEnabled()).toBe(false);
  });

  // A microphone that writes things down does not get to be switched on by a
  // typo. "true" and "0" are both things a hand-edited .env acquires.
  test("only the exact string \"1\" arms it", () => {
    for (const value of ["0", "true", "yes", "", "on"]) {
      process.env[KEY] = value;
      expect(memoryEnabled()).toBe(false);
    }
    process.env[KEY] = "1";
    expect(memoryEnabled()).toBe(true);
  });
});

test.describe("houseDay — Brisbane, not the server's idea of a day", () => {
  test("sorts lexically, which the 'is this today's file' check relies on", () => {
    expect(houseDay(new Date("2026-08-15T02:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(houseDay(new Date("2026-08-14T00:00:00Z")) < houseDay(new Date("2026-08-15T00:00:00Z"))).toBe(true);
  });

  // 15:00Z is already 01:00 the next day here. A UTC day boundary would file
  // the evening's conversation under the wrong date and — worse — consolidate
  // it as "finished" while it was still being had.
  test("a UTC evening is already tomorrow in Brisbane", () => {
    expect(houseDay(new Date("2026-08-14T15:00:00Z"))).toBe("2026-08-15");
    expect(houseDay(new Date("2026-08-14T13:59:00Z"))).toBe("2026-08-14");
  });
});

test.describe("parseLog — a corrupt line costs that line, never the day", () => {
  test("reads well-formed entries", () => {
    const raw = [
      JSON.stringify({ at: "2026-08-15T01:00:00Z", said: "when's the rubbish", replied: "Tonight." }),
      JSON.stringify({ at: "2026-08-15T01:01:00Z", said: "thanks", replied: "" })
    ].join("\n");
    expect(parseLog(raw)).toHaveLength(2);
    expect(parseLog(raw)[0].said).toBe("when's the rubbish");
  });

  // A hard kill mid-append leaves half a line. Losing the whole day's memory
  // to it would be a poor trade.
  test("a half-written trailing line is skipped, the rest survives", () => {
    const raw = `${JSON.stringify({ said: "good one" })}\n{"said":"trunca`;
    expect(parseLog(raw)).toHaveLength(1);
  });

  test("entries with no utterance are dropped", () => {
    const raw = [
      JSON.stringify({ said: "   ", replied: "hello" }),
      JSON.stringify({ replied: "orphan" }),
      JSON.stringify({ said: "real" })
    ].join("\n");
    expect(parseLog(raw)).toHaveLength(1);
  });

  test("never throws on rubbish", () => {
    for (const bad of [null, undefined, "", "not json", 42, "{}\n[]\n"]) {
      expect(() => parseLog(bad)).not.toThrow();
    }
  });
});

test.describe("renderNote — a memory that must not caption a photograph", () => {
  const note = { title: "Melbourne trip in October", tags: ["travel", "#Melbourne"], body: "Greg and Brett are going to Melbourne in October." };

  /* ⚠⚠ THE ONE THAT WOULD BE FOUND ON THE WALL RATHER THAN IN A TEST.
     `date`, `until` and `label` are not metadata in this vault — they open a
     photo-caption span (docs/design/VAULT.md, "The date grain"). A memory note
     dated today with a label would start captioning today's photographs with
     whatever the kitchen happened to be talking about. */
  test("carries no date, until or label — those caption photographs", () => {
    const md = renderNote(note, "2026-08-15");
    const frontmatter = md.split("---")[1];
    expect(frontmatter).not.toMatch(/^\s*date:/m);
    expect(frontmatter).not.toMatch(/^\s*until:/m);
    expect(frontmatter).not.toMatch(/^\s*label:/m);
  });

  test("the day is recorded as prose in the body, where it is inert", () => {
    expect(renderNote(note, "2026-08-15")).toContain("2026-08-15");
    expect(renderNote(note, "2026-08-15")).toMatch(/Remembered by the house/);
  });

  // Provenance: a person reading their own vault has to be able to tell what
  // they wrote from what the house wrote about them.
  test("is marked as machine-written and tagged for retrieval", () => {
    const md = renderNote(note, "2026-08-15");
    expect(md).toContain("kind: memory");
    expect(md).toMatch(/tags: \[memory, /);
  });

  test("tags are normalised the way the vault parser expects", () => {
    // Obsidian writes inline tags as "#travel"; the index strips the hash and
    // lowercases, so a note written with one would never match the spoken word.
    expect(renderNote(note, "2026-08-15")).toContain("melbourne");
    expect(renderNote(note, "2026-08-15")).not.toContain("#Melbourne");
  });

  test("indexable — private is false, or the note is invisible to retrieval", () => {
    expect(renderNote(note, "2026-08-15")).toContain("private: false");
  });

  test("a title with a newline cannot break the frontmatter block", () => {
    const md = renderNote({ ...note, title: "line one\nline two" }, "2026-08-15");
    expect(md.split("\n")[1]).toBe("title: line one line two");
    expect(md.split("---").length).toBeGreaterThanOrEqual(3);
  });

  test("tags are bounded", () => {
    const md = renderNote({ ...note, tags: Array.from({ length: 30 }, (_, i) => `t${i}`) }, "2026-08-15");
    expect(md.match(/tags: \[(.+)\]/)[1].split(", ")).toHaveLength(7); // "memory" + 6
  });
});

test.describe("renderTranscript — what the distiller is shown", () => {
  test("attributes both sides, so the house's own guesses are identifiable", () => {
    const out = renderTranscript([{ said: "is it going to rain", replied: "Not today." }]);
    expect(out).toContain("Person: is it going to rain");
    expect(out).toContain("House: Not today.");
  });

  // The house's replies can be wrong. The prompt tells the model not to treat
  // them as fact, which is only possible if they are labelled as its own.
  test("a turn the house did not answer is still shown", () => {
    expect(renderTranscript([{ said: "hmm", replied: "" }])).toBe("Person: hmm");
  });
});

test.describe("the retention promise", () => {
  // Not arbitrary numbers — each one is a ceiling on how much of a kitchen
  // ends up on an SD card in a public-repo checkout.
  test("raw text is bounded on every axis: length, count and age", () => {
    expect(MAX_ENTRY_CHARS).toBeLessThanOrEqual(2000);
    expect(MAX_ENTRIES_PER_DAY).toBeLessThanOrEqual(1000);
    expect(RAW_RETENTION_DAYS).toBeLessThanOrEqual(7);
    expect(RAW_RETENTION_DAYS).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   WEATHER HISTORY — one line a day, so the house eventually has a past.

   Audited 2026-08-16: the dashboard retained no weather reading of any age, so
   every "coldest morning in weeks" the house could say would have been
   invented. services/lately.js is the reader (AUGUST-IMPROVEMENTS.md §4).

   ⚠⚠ EVERY TEST THAT TOUCHES DISK REDIRECTS THE STORE FIRST. recordDay() now
   reads the file on its first call of a day (to seed the accumulator) and
   compacts it — so a spec left pointing at the default would rewrite the
   developer's real record, and two parallel workers would collide on it.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("weatherHistory — the record the house keeps of its own sky", () => {
  const day = (d, high, low) => JSON.stringify({ day: d, high, low, condition: "Clear" });

  /** A normalizeWeatherNow-shaped reading: an observed temperature now, and
   *  the day's FORECAST extremes, which are deliberately different numbers. */
  const reading = (tempC, { high = 99, low = -99, condition = "Clear" } = {}) =>
    ({ now: { temp_c: tempC, condition: { label: condition } }, day: { high_c: high, low_c: low } });

  const AT = new Date("2026-08-20T03:00:00Z");     // 13:00 Brisbane
  const DAY = "2026-08-20";

  let dir = null;
  let file = null;

  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wh-"));
    file = join(dir, "weather-history.jsonl");
    __resetHistory({ file });
  });

  test.afterEach(async () => {
    __resetHistory({ file: null });
    await rm(dir, { recursive: true, force: true });
  });

  const rows = async () => parseHistory(await readFile(file, "utf8"));

  test("parses days, newest first", () => {
    const out = parseHistory([day("2026-08-14", 22, 9), day("2026-08-15", 24, 11)].join("\n"));
    expect(out.map((e) => e.day)).toEqual(["2026-08-15", "2026-08-14"]);
  });

  // A restart can append a second row for the same day; the later one is the
  // more complete reading of it.
  test("a duplicated day collapses to the last line written", () => {
    const out = parseHistory([day("2026-08-15", 20, 9), day("2026-08-15", 24, 11)].join("\n"));
    expect(out).toHaveLength(1);
    expect(out[0].high).toBe(24);
  });

  test("a half-written trailing line costs that line, not the history", () => {
    const out = parseHistory(`${day("2026-08-15", 24, 11)}\n{"day":"2026-08-16","hi`);
    expect(out).toHaveLength(1);
  });

  test("never throws on rubbish", () => {
    for (const bad of [null, undefined, "", "not json", 42]) {
      expect(() => parseHistory(bad)).not.toThrow();
      expect(parseHistory(bad)).toEqual([]);
    }
  });

  test("bounded to roughly three years", () => {
    const lines = Array.from({ length: MAX_DAYS + 200 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      return day(d, 20, 10);
    });
    expect(parseHistory(lines.join("\n")).length).toBeLessThanOrEqual(MAX_DAYS);
  });

  // A day with neither a high nor a low is not worth a row: every later
  // "coldest since" query would filter it out anyway, and a sparse file of
  // real days beats a dense one of half-days.
  test("a reading with no high, no low and no observation is not recorded", async () => {
    expect(await recordDay({ now: { condition: { label: "Clear" } }, day: {} }, AT)).toBe(false);
    expect(await recordDay(null, AT)).toBe(false);
  });

  /* ── The fold: pure, and the half that makes the record true ────────────── */

  test("observed extremes RATCHET — the max only rises, the min only falls", () => {
    let s = foldReading(null, reading(18), DAY);
    s = foldReading(s, reading(25), DAY);
    s = foldReading(s, reading(11), DAY);
    s = foldReading(s, reading(20), DAY);
    expect(s.obsHigh).toBe(25);
    expect(s.obsLow).toBe(11);
    expect(s.n).toBe(4);
  });

  /* THE WRONG ANSWER: storing the observation over the forecast, or vice
     versa. They are different claims and both are kept — lately.js reads only
     the observed pair, and renaming these would reinterpret every row written
     before 2026-08-31. */
  test("the forecast is kept alongside the observation, not instead of it", () => {
    const s = foldReading(null, reading(19, { high: 24, low: 9 }), DAY);
    expect(s.obsHigh).toBe(19);
    expect(s.high).toBe(24);
    expect(s.low).toBe(9);
  });

  test("a reading with no observed temperature still records the forecast", () => {
    const s = foldReading(null, { now: { condition: { label: "Clear" } }, day: { high_c: 24, low_c: 9 } }, DAY);
    expect(s.obsHigh).toBeNull();
    expect(s.n).toBe(0);
    expect(s.high).toBe(24);
  });

  /* 2026-08-20 was recorded as "Partly cloudy" when it had also been Clear,
     Mostly clear and Cloudy. One sample is not a description of a day. */
  test("conditions accumulate for the day, deduped and capped", () => {
    let s = foldReading(null, reading(18, { condition: "Clear" }), DAY);
    s = foldReading(s, reading(19, { condition: "Cloudy" }), DAY);
    s = foldReading(s, reading(20, { condition: "Clear" }), DAY);
    expect(s.conditions).toEqual(["Clear", "Cloudy"]);
    expect(s.condition).toBe("Clear");

    for (let i = 0; i < 30; i++) s = foldReading(s, reading(18, { condition: `C${i}` }), DAY);
    expect(s.conditions.length).toBeLessThanOrEqual(MAX_CONDITIONS);
  });

  test("a new day starts a fresh accumulator rather than carrying yesterday's", () => {
    const y = foldReading(null, reading(30), "2026-08-19");
    const t = foldReading(y, reading(15), DAY);
    expect(t.day).toBe(DAY);
    expect(t.obsHigh).toBe(15);
  });

  /* THE WRONG ANSWER: letting the sample count decide. `n` moves on every
     refresh, so a material check that included it would append a line per
     request and the file would grow with the traffic instead of the weather. */
  test("the sample count is NOT material — only the weather is", () => {
    const a = foldReading(null, reading(18), DAY);
    const b = foldReading(a, reading(18), DAY);
    expect(b.n).toBe(a.n + 1);
    expect(materialOf(b)).toBe(materialOf(a));
  });

  /* ── The disk lane ─────────────────────────────────────────────────────── */

  test("appends only when the weather actually moves", async () => {
    expect(await recordDay(reading(18), AT)).toBe(true);
    expect(await recordDay(reading(18), AT)).toBe(false);   // nothing new
    expect(await recordDay(reading(25), AT)).toBe(true);    // a new high
    expect(await recordDay(reading(24), AT)).toBe(false);   // inside the range
    expect(await recordDay(reading(9), AT)).toBe(true);     // a new low

    const out = await rows();
    expect(out).toHaveLength(1);
    expect(out[0].obsHigh).toBe(25);
    expect(out[0].obsLow).toBe(9);
  });

  /* ⚠⚠⚠ THE TRAP THIS FILE EXISTS TO SURVIVE, and the reason the seeding code
     is there at all.

     The kiosk restarts ~7.6 times a day (every deploy). A process that starts
     its accumulator from empty re-folds only the REST of the day and appends a
     NARROWER range — and parseHistory's last-wins rule then prefers that
     narrower line over the wide one already on disk.

     The failure does not look like a failure. It looks like a genuinely milder
     day, it is written by working code, and every later superlative is
     computed against it. Delete the seed read in recordDay() and this is the
     test that goes red. */
  test("a RESTART mid-day does not narrow the day's range", async () => {
    await recordDay(reading(25), AT);
    await recordDay(reading(9), AT);
    expect((await rows())[0]).toMatchObject({ obsHigh: 25, obsLow: 9 });

    __resetHistory({ file });                 // the process restarts; the file remains
    await recordDay(reading(18), AT);         // a mild afternoon reading

    const out = await rows();
    expect(out).toHaveLength(1);
    expect(out[0].obsHigh).toBe(25);
    expect(out[0].obsLow).toBe(9);
  });

  test("a restart still WIDENS the range when the day earns it", async () => {
    await recordDay(reading(20), AT);
    __resetHistory({ file });
    await recordDay(reading(31), AT);
    expect((await rows())[0].obsHigh).toBe(31);
  });

  /* A row written before the observed fields existed must not have them
     invented — the 16 days already on the kiosk are exactly this shape. */
  test("seeding an old-format row starts the observations at null", () => {
    const seeded = __seedFrom({ day: DAY, high: 21, low: 12, condition: "Clear" }, DAY);
    expect(seeded.obsHigh).toBeNull();
    expect(seeded.obsLow).toBeNull();
    expect(seeded.high).toBe(21);
  });

  test("seeding refuses a row from a different day", () => {
    expect(__seedFrom({ day: "2026-08-19", obsHigh: 30 }, DAY)).toBeNull();
    expect(__seedFrom(null, DAY)).toBeNull();
  });

  /* ── compact(): the prune this file never had ───────────────────────────── */

  test("compact collapses a day to its winning line and loses nothing", async () => {
    await writeFile(file, [
      day("2026-08-18", 20, 10),
      day("2026-08-19", 21, 11),
      day("2026-08-19", 22, 12),
      day("2026-08-19", 23, 13)
    ].join("\n") + "\n", "utf8");

    const before = await rows();
    const removed = await compact();
    const after = await rows();

    expect(removed).toBe(2);
    expect(after).toEqual(before);                       // reading is unchanged
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  test("compact is a no-op on an already-compact file", async () => {
    await writeFile(file, day("2026-08-18", 20, 10) + "\n", "utf8");
    expect(await compact()).toBe(0);
  });

  test("compact on a missing file is 0, not a throw", async () => {
    expect(await compact()).toBe(0);
  });

  test("compact enforces MAX_DAYS, which reading alone never did", async () => {
    const lines = Array.from({ length: MAX_DAYS + 50 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      return day(d, 20, 10);
    });
    await writeFile(file, lines.join("\n") + "\n", "utf8");
    await compact();
    const kept = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    expect(kept.length).toBe(MAX_DAYS);
  });
});
