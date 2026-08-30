import { test, expect } from "@playwright/test";
import http from "http";
import { __memoTestOnly } from "../server/routes/immich.js";
import { searchRandomResult, memoriesFeedResult, searchTakenResult } from "../server/services/immichClient.js";

/**
 * The day the wall went blank (2026-08-30).
 *
 * `/api/immich/on-this-day` answered a healthy `200 {"assets":[]}` for an hour
 * while Immich itself held eighteen photographs for that date. Nothing was
 * logged, every up-check passed, and the photo ground was empty the whole time.
 *
 * The cause was one line of caching policy: the memo kept whatever the client
 * returned, and the client returned [] for BOTH "Immich has nothing" and "the
 * fetch failed". A single cold-start failure after a service restart was
 * therefore stored with a success's TTL — ten minutes for the random feed, a
 * full HOUR for on-this-day.
 *
 * ⚠ Every test here is written against a specific wrong answer, because both
 * the defect AND the obvious fix are invisible in a one-shot request:
 *   - the defect needs a SECOND call to see the first call's failure served;
 *   - "just don't cache empties" passes every failure test and is still wrong,
 *     since on-this-day fans out one query per year and a genuinely empty date
 *     would re-run fifteen of them forever. That fix is caught by name below.
 */

const { memoised, clear } = __memoTestOnly;

const HOUR = 60 * 60 * 1000;

/** A fetcher that reads its outcomes from a script, and counts its calls. */
function scripted(...outcomes) {
  const fn = async () => {
    fn.calls += 1;
    return outcomes[Math.min(fn.calls - 1, outcomes.length - 1)];
  };
  fn.calls = 0;
  return fn;
}

const failed = { ok: false, assets: [] };
const answered = (...assets) => ({ ok: true, assets });

test.describe("memoised — a failure is not an answer", () => {
  test.beforeEach(() => clear());

  test("⚠ a failure is NOT served to the next caller inside the TTL", async () => {
    /* THE REGRESSION. The old memo stored the failure's [] with on-this-day's
       full hour, so this second call — the one the ground makes a minute later
       — used to come back empty and stay empty until 10:39. */
    const fetcher = scripted(failed, answered("a", "b"));

    const first = await memoised("k", HOUR, fetcher);
    const second = await memoised("k", HOUR, fetcher);

    expect(first).toEqual([]);
    expect(second).toEqual(["a", "b"]);
    expect(fetcher.calls).toBe(2); // the failure did not satisfy the second call
  });

  test("⚠ a GENUINE empty IS cached — 'never cache empties' is not the fix", async () => {
    /* Aimed squarely at the tempting one-liner. `if (assets.length) memSet(...)`
       passes every failure test above and fails this one: on-this-day fans out
       one metadata query PER YEAR, so a date the library truly has no photo for
       would re-run fifteen queries on every request, forever. */
    const fetcher = scripted(answered(), answered("late-arrival"));

    const first = await memoised("k", HOUR, fetcher);
    const second = await memoised("k", HOUR, fetcher);

    expect(first).toEqual([]);
    expect(second).toEqual([]);          // served from the memo, not re-fetched
    expect(fetcher.calls).toBe(1);
  });

  test("an answer is cached, and the fetcher is not asked twice", async () => {
    const fetcher = scripted(answered("a"));
    await memoised("k", HOUR, fetcher);
    const second = await memoised("k", HOUR, fetcher);

    expect(second).toEqual(["a"]);
    expect(fetcher.calls).toBe(1);
  });

  test("a stale entry is re-fetched", async () => {
    const fetcher = scripted(answered("old"), answered("new"));
    await memoised("k", HOUR, fetcher);
    const second = await memoised("k", 0, fetcher);   // TTL already elapsed

    expect(second).toEqual(["new"]);
    expect(fetcher.calls).toBe(2);
  });

  test("repeated failures never poison the key", async () => {
    // Three cold-start failures in a row, then Immich wakes up. Nothing about
    // the failures may make the eventual success unreachable.
    const fetcher = scripted(failed, failed, failed, answered("a"));
    for (let i = 0; i < 3; i += 1) expect(await memoised("k", HOUR, fetcher)).toEqual([]);

    expect(await memoised("k", HOUR, fetcher)).toEqual(["a"]);
  });

  test("keys do not bleed into one another", async () => {
    // The count-dependent symptom that made this look like a value bug: only
    // `rnd:2` was poisoned, so counts 3..20 looked healthy and count=2 did not.
    const bad = scripted(failed);
    const good = scripted(answered("x"));

    await memoised("rnd:2", HOUR, bad);
    expect(await memoised("rnd:3", HOUR, good)).toEqual(["x"]);
    expect(await memoised("rnd:2", HOUR, scripted(answered("y")))).toEqual(["y"]);
  });
});

/* ── The other half: the client must be able to TELL the two apart ──────────
   The memo above is only as good as the `ok` it is handed. These drive the real
   client against a real HTTP server on loopback — no module mocking, because
   the thing under test is exactly how it reads a live upstream's answers.
─────────────────────────────────────────────────────────────────────────── */

test.describe("the client separates a failure from an empty library", () => {
  let server;
  let handler;
  let saved;

  test.beforeAll(async () => {
    server = http.createServer((req, res) => handler(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    saved = { url: process.env.IMMICH_URL, key: process.env.IMMICH_API_KEY };
    process.env.IMMICH_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.IMMICH_API_KEY = "spec-key";
  });

  test.afterAll(async () => {
    /* ⚠ Restored, not left set. `config()` reads process.env on every call, so
       a leaked IMMICH_URL would point every later spec in this worker at a dead
       port and turn "Immich is absent" into "Immich is broken". */
    if (saved.url === undefined) delete process.env.IMMICH_URL;
    else process.env.IMMICH_URL = saved.url;
    if (saved.key === undefined) delete process.env.IMMICH_API_KEY;
    else process.env.IMMICH_API_KEY = saved.key;
    await new Promise((resolve) => server.close(resolve));
  });

  const json = (res, body, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  test("an empty library is ok:true — it is an answer", async () => {
    handler = (_req, res) => json(res, []);
    const r = await searchRandomResult(2);

    expect(r.ok).toBe(true);
    expect(r.assets).toEqual([]);
  });

  test("a 500 is ok:false, not an empty library", async () => {
    // The assertion that fails if `!res.ok` keeps returning a bare []: both
    // shapes have `assets: []`, and only the flag tells them apart.
    handler = (_req, res) => json(res, { error: "boom" }, 500);
    const r = await searchRandomResult(2);

    expect(r.ok).toBe(false);
    expect(r.assets).toEqual([]);
  });

  test("a dropped connection is ok:false", async () => {
    handler = (_req, res) => res.destroy();
    const r = await searchRandomResult(2);

    expect(r.ok).toBe(false);
  });

  test("browse reports its failure too", async () => {
    handler = (_req, res) => json(res, { error: "boom" }, 503);
    const r = await searchTakenResult("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z");

    expect(r.ok).toBe(false);
  });

  test("⚠ ONE year failing makes the whole on-this-day feed uncacheable", async () => {
    /* on-this-day is one query per past year, and a partial result is the
       dangerous one: fifteen years asked, fourteen answered, one timed out
       gives a plausible-looking day that would be pinned for an hour. "Some of
       your photographs" is much harder to notice than none of them.

       The defect this is aimed at is `ok: perYear.some(r => r.ok)` — which is
       true here, because most years did answer. */
    let n = 0;
    handler = (_req, res) => {
      n += 1;
      if (n === 3) return json(res, { error: "boom" }, 500);
      json(res, { assets: { items: [] } });
    };
    const r = await memoriesFeedResult(new Date(2026, 7, 30));

    expect(n).toBeGreaterThan(3);   // it really did ask for many years
    expect(r.ok).toBe(false);
  });

  test("every year answering is ok:true even when nothing was found", async () => {
    // The control for the test above: an honestly empty day must still cache,
    // or the fifteen-query fan-out runs on every request forever.
    handler = (_req, res) => json(res, { assets: { items: [] } });
    const r = await memoriesFeedResult(new Date(2026, 7, 30));

    expect(r.ok).toBe(true);
    expect(r.assets).toEqual([]);
  });
});
