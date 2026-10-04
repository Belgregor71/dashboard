import { test, expect } from "@playwright/test";
import { buildDigest, DIGEST_MAX_DAYS } from "../server/routes/presentations.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S6c — the weekly digest (docs/design/HOUSE-MIND.md §S6).

   "It worked when the digest reconciles with the rows and the counters": every
   number below is derived by hand from the fixture, and the totals are checked
   against the fixture's own row count, so a digest that dropped or doubled a
   row cannot agree with it.
   ═══════════════════════════════════════════════════════════════════════════ */

const at = (day, hh, mm = 0) => new Date(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`).getTime();
const row = (surface, source, start, seconds, extra = {}) =>
  ({ surface, id: `${source}:x`, source, evidenceKey: null, decision: null, shown: true, start, end: start + seconds * 1000, ...extra });

const TODAY = "2026-07-06";
const ROWS = [
  row("glance", "plex", at("2026-07-06", 9), 60),
  row("spread", "plex", at("2026-07-05", 20), 600),
  row("glance", "bom", at("2026-07-03", 7), 90),
  row("voice", "doorbell", at("2026-07-04", 15), 4, { id: null, decision: { action: "took", over: null } }),
  row("stage", "doorbell", at("2026-07-04", 15), 60),
  row("stage", "dinner", at("2026-07-02", 18), 0, { shown: false, decision: { action: "refused", over: "doorbell" } }),
  // Outside a 7-day window ending 07-06 (07-06 back to 06-30): the day before it.
  row("glance", "plex", at("2026-06-29", 9), 999)
];
const CENSUS = {
  days: {
    "2026-07-06": { "ppl:plex:present": 1, "attn:plex:shown": 40 },
    "2026-07-03": { "ppl:bom:present": 1, "ppl:bom:followed": 1 },
    "2026-07-04": { "ppl:doorbell:cut": 2 },
    "2026-06-29": { "ppl:plex:present": 50, "ppl:bom:followed": 50 }
  }
};

const bySource = (digest) => Object.fromEntries(digest.sources.map((s) => [s.source, s]));

test.describe("buildDigest", () => {
  test("reconciles with the rows and the counters, inside the window only", () => {
    const digest = buildDigest(ROWS, CENSUS, { today: TODAY, days: 7 });
    expect(digest).toMatchObject({ days: 7, from: "2026-06-30", to: "2026-07-06", rows: 6 });

    const s = bySource(digest);
    expect(s.plex).toEqual({ source: "plex", shown: 2, seconds: 660, spoken: 0, spokenSeconds: 0, notShown: 0, present: 1, cut: 0, followed: 0 });
    expect(s.bom).toEqual({ source: "bom", shown: 1, seconds: 90, spoken: 0, spokenSeconds: 0, notShown: 0, present: 1, cut: 0, followed: 1 });
    expect(s.doorbell).toEqual({ source: "doorbell", shown: 1, seconds: 60, spoken: 1, spokenSeconds: 4, notShown: 0, present: 0, cut: 2, followed: 0 });
    expect(s.dinner).toEqual({ source: "dinner", shown: 0, seconds: 0, spoken: 0, spokenSeconds: 0, notShown: 1, present: 0, cut: 0, followed: 0 });

    // Every counted row lands in exactly one bucket.
    const total = digest.sources.reduce((n, x) => n + x.shown + x.spoken + x.notShown, 0);
    expect(total).toBe(digest.rows);
    // Longest on the glass first.
    expect(digest.sources.map((x) => x.source)).toEqual(["plex", "bom", "doorbell", "dinner"]);
  });

  test("the lines say what the numbers say", () => {
    const { lines } = buildDigest(ROWS, CENSUS, { today: TODAY, days: 7 });
    expect(lines).toEqual([
      "plex: shown 2×, 11m on the glass; someone present 1×",
      "bom: shown 1×, 2m on the glass; someone present 1×; followed by a question 1×",
      "doorbell: shown 1×, 1m on the glass; spoken 1×; cut off 2×",
      "dinner: refused or dropped 1×"
    ]);
  });

  test("a wider window takes in the older day; a one-day window only today", () => {
    const wide = bySource(buildDigest(ROWS, CENSUS, { today: TODAY, days: 8 }));
    expect(wide.plex).toMatchObject({ shown: 3, seconds: 1659, present: 51 });
    expect(wide.bom.followed).toBe(51);

    const one = buildDigest(ROWS, CENSUS, { today: TODAY, days: 1 });
    expect(one.rows).toBe(1);
    expect(one.sources).toEqual([
      { source: "plex", shown: 1, seconds: 60, spoken: 0, spokenSeconds: 0, notShown: 0, present: 1, cut: 0, followed: 0 }
    ]);
  });

  test("only the people's counters are read from the census, and no field names a person", () => {
    const digest = buildDigest(ROWS, CENSUS, { today: TODAY, days: 7 });
    // attn:plex:shown (40) is the census's own count and must not leak into `shown`.
    expect(bySource(digest).plex.shown).toBe(2);
    for (const s of digest.sources) {
      expect(Object.keys(s).sort()).toEqual(["cut", "followed", "notShown", "present", "seconds", "shown", "source", "spoken", "spokenSeconds"]);
    }
  });

  test("no rows and no census is an empty digest, not a throw", () => {
    expect(buildDigest([], {}, { today: TODAY })).toMatchObject({ days: 7, rows: 0, sources: [], lines: [] });
  });
});

test.describe("GET /api/presentations/digest", () => {
  test("answers with the digest shape, and clamps the window", async ({ request }) => {
    const res = await request.get("/api/presentations/digest");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.days).toBe(7);
    expect(body.from < body.to).toBe(true);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.lines).toHaveLength(body.sources.length);

    const huge = await (await request.get("/api/presentations/digest?days=9999")).json();
    expect(huge.days).toBe(DIGEST_MAX_DAYS);
    const junk = await (await request.get("/api/presentations/digest?days=banana")).json();
    expect(junk.days).toBe(7);
  });
});
