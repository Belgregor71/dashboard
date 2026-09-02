import express from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* ═══════════════════════════════════════════════════════════════════════════
   FEATURE CENSUS — which named features are still alive on the wall.

   docs/AUGUST-IMPROVEMENTS.md §1, and the sibling of routes/census.js. That one
   answers "which DEPTH does this house live at"; this one answers the question
   that has now been asked eight times the expensive way: **what has been
   silently dead for a month?**

   `bomWarning` was empty from the V3 cutover onward — the wall could not say a
   storm was coming — and nobody found out until an unrelated flag audit tripped
   over it. `robotCandidate` was never read. `__intent` was undefined on the
   glass so two postures could never fire. 24 of 26 HA dispatch scripts had
   never fired. A green suite was compatible with all of it, and so was the
   eight-feed watchdog, because a test proves a path CAN run and a watchdog
   proves a FEED is fresh. Neither proves anything about the wall.

   ── The shape, and why it is not the depth census's shape ───────────────────

   Aggregates only, on-device only, POST-of-deltas, bounded by construction —
   all the same. Four additions, each earned:

   1. `seen` — a sticky per-key { first, last, total } held OUTSIDE the 30-day
      window. The 30 days are for "how often lately"; `seen` is for "when did
      this last work AT ALL", and that is the question a regression answers to.
      A key that fell out of the day window would otherwise become invisible at
      exactly the moment it became interesting.

   2. `roster` — the set of keys that COULD fire, declared by the client.
      ⚠ WITHOUT THIS THE REPORT CAN NEVER SAY "DEAD". A counter observes what
      happens; it cannot observe what stopped happening before it was installed.
      `attn:bom` firing zero times and `attn:bom` not existing produce byte-
      identical files. The roster is the only thing that tells them apart.

   3. `report` — computed on GET rather than left to the reader. The whole point
      of the item is that ONE curl from anywhere on the LAN answers the
      question; handing back raw counts and a suggestion to diff them by hand is
      how this ends up as unread telemetry, which is what it is replacing.

   4. `since` — the day counting began, sticky and held outside the day window.
      ⚠ WITHOUT THIS THE REPORT CANNOT SAY "DEAD" HONESTLY EITHER. The roster
      separates "never fired" from "no such thing"; `since` separates "dead for
      a month" from "we have been watching for nine minutes". It was missing on
      day one and the wall duly reported 71 dead of 73 — see DEFAULT_DEAD_DAYS.

   ── ⚠ Keys are code literals, and that is load-bearing ──────────────────────

   Every key traces to a string literal (`source:"bom"`, a REGISTRY key, an
   INTENTS id, a LOCATIONS prefix) because function names do not survive
   minification — `grep -c bomCandidate dist/assets/v3-*.js` is 0. See the
   header of src/v3/core/feature-census.js. They still arrive over HTTP, so they
   are validated here anyway.
   ═══════════════════════════════════════════════════════════════════════════ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CENSUS_DIR = path.join(__dirname, "..", "..", "data", "census");
const CENSUS_FILE = path.join(CENSUS_DIR, "features.json");

export const MAX_DAYS = 30;
export const MAX_KEYS = 256;      // observed on the live surface: ~124
export const MAX_ROSTER = 128;    // observed: ~73

/* ── Retired roster keys ────────────────────────────────────────────────────
   ⚠ THE ROSTER IS A UNION WITH NO OTHER WAY OUT, AND THAT IS THE PROBLEM THIS
   SOLVES. Union is right — several clients declare over time and a page booted
   with a flag off must not be able to shrink the roster and take every "dead"
   verdict with it — but it means a feature that is DELETED keeps its key in the
   stored file forever, and reports as dead for the rest of the file's life.
   Dead is precisely the verdict this instrument exists to give, so one
   permanent false positive is not cosmetic: it is the instrument teaching its
   reader to discount the finding it was built for.

   `attn:health` is the first entry. core/health.js announced a degraded feed as
   a score-72 candidate until 2026-09-01; it now draws a pill instead, so
   nothing will ever observe that key again on any surface.

   ⚠ FILTERED ON MERGE, NOT ON READ, so it leaves the stored file the first time
   a live census is written rather than being masked on every request forever.
   Add a key here ONLY when the code that could record it is gone — a key
   removed while its feature still exists is this instrument going quiet about
   exactly the thing it is for. */
export const RETIRED_ROSTER = new Set(["attn:health"]);
export const DEFAULT_SILENT_DAYS = 14;

/* ⚠⚠ THE AGE GUARD — and this instrument shipped for one day without it.
   Minutes after the flag flip the live wall reported `dead: 71` of a 73-key
   roster, because "dead" was computed as "in the roster and never observed"
   with no record of WHEN counting began. It could not tell "dead for a month"
   from "we have been watching for nine minutes" — this file's own headline
   failure, committed inside this file.

   The cost is worse than a wrong number. A reader who curls this on day one
   sees an indictment of the whole surface, and the only two outcomes are panic
   or learning to ignore the report — and "learning to ignore it" is exactly the
   unread-telemetry end the computed report exists to prevent.

   Seven days because many keys are event-shaped and honestly take days:
   `alert:doorbell` needs a caller, `attn:commute` a weekday 07:40, every
   `intent:*` needs someone to speak. A fair verdict needs a window measured in
   days. */
export const DEFAULT_DEAD_DAYS = 7;

/* One flush cannot honestly represent more than this. Not security — the
   cross-origin guard and the /api rate limiter in middleware/security.js are
   that — but a bad client (or a debug-handle typo) must not be able to write a
   number that makes every later reading meaningless. */
const MAX_COUNT_DELTA = 1_000_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/* Must agree with KEY_RE in src/v3/core/feature-census.js. Dots because intent
   ids carry them ("show.forecast"); colons because they are the separator. */
const KEY_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;

const router = express.Router();

/** `attn:bom:offered` → `attn:bom`. The roster is declared at base level, so
 *  "dead" is a question about a base, not about one of its outcomes. */
export function baseOf(key) {
  const parts = key.split(":");
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : key;
}

/* Strict about TYPE, not just about value. `Number("1")` is 1, so a coercing
   check accepts a client that sends its counts as strings and then rejects the
   same client the moment one of them is "12e3" or "". Half-working is the worst
   of the three outcomes for an instrument: the file is real for weeks and then
   quietly is not. Only a JSON number is a count.
   ⚠ An unnameable key is DROPPED, not fatal — losing one label is a much
   smaller loss than losing the flush it rode in on. */
export function readCounts(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!KEY_RE.test(key)) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > MAX_COUNT_DELTA) continue;
    out[key] = Math.round(raw);
    if (Object.keys(out).length >= MAX_KEYS) break;
  }
  return out;
}

export function readRoster(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const key of value) {
    if (typeof key !== "string" || !KEY_RE.test(key)) continue;
    out.push(key);
    if (out.length >= MAX_ROSTER) break;
  }
  return out;
}

export function emptyCensus() {
  return { days: {}, seen: {}, roster: [], since: null };
}

/** The earliest of a set of day strings, ignoring anything that is not one.
 *  Nothing here parses a date: ISO day strings sort lexicographically, which is
 *  the same reason `days` is pruned by sorted key. */
export function earliestDay(candidates) {
  let out = null;
  for (const day of candidates) {
    if (typeof day !== "string" || !DAY_RE.test(day)) continue;
    if (out === null || day < out) out = day;
  }
  return out;
}

/** Whole days from `from` to `to`, floored at 0 so a client clock running
 *  ahead of the server cannot manufacture a negative observation window. */
export function daysBetween(from, to) {
  const at = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.max(0, Math.round((at(to) - at(from)) / 86_400_000));
}

/** The day counting began. The stored field when there is one, DERIVED from the
 *  oldest thing in the file when there is not — a census written before `since`
 *  existed must not read as having started today, which would withhold every
 *  verdict for another week on a file that has already counted for a fortnight.
 *
 *  ⚠ A STORED `since` WINS OUTRIGHT — it is not merged with the derivation.
 *  Taking the earlier of the two would hand a page with a wrong clock exactly
 *  what pinning the stored field denies it: one flush dated last January, and
 *  the age guard re-opens on the read side while the file still says today. */
export function censusSince(census) {
  if (typeof census?.since === "string" && DAY_RE.test(census.since)) return census.since;
  return earliestDay([
    ...Object.keys(census?.days ?? {}),
    ...Object.values(census?.seen ?? {}).map((entry) => entry?.first)
  ]);
}

/**
 * Fold one delta into the stored census. Pure — exported for the unit spec, so
 * the merge rules can be tested without a server, a file or a clock.
 *
 * @param {object} delta  { day, counts, roster? }
 * @param {string} at     ISO timestamp; injected so a spec can age the file
 */
export function mergeFeatureDelta(census, delta, at = new Date().toISOString()) {
  const days = { ...(census?.days ?? {}) };
  const day = { ...(days[delta.day] ?? {}) };

  for (const [key, n] of Object.entries(delta.counts)) {
    // A day already at the cap keeps the keys it has rather than trading an
    // established count for a newcomer — otherwise a burst of novel names would
    // evict the very history this file exists to hold.
    if (day[key] === undefined && Object.keys(day).length >= MAX_KEYS) continue;
    day[key] = (day[key] ?? 0) + n;
  }
  days[delta.day] = day;

  // Prune by key, which sorts chronologically because the keys are ISO dates.
  const keys = Object.keys(days).sort();
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete days[stale];

  /* ⚠ `seen` is NOT pruned with the days. A key whose last firing has aged out
     of the 30-day window is exactly the key someone needs to ask about, and
     losing its `last` date at that moment would make the instrument blind
     precisely where it is supposed to speak. Bounded by MAX_KEYS instead. */
  const seen = { ...(census?.seen ?? {}) };
  for (const [key, n] of Object.entries(delta.counts)) {
    if (n <= 0) continue;
    const prior = seen[key];
    if (!prior) {
      if (Object.keys(seen).length >= MAX_KEYS) continue;
      seen[key] = { first: delta.day, last: delta.day, total: n };
    } else {
      // `last` only moves forward. A late flush from a page whose clock is
      // behind must not rewind the last-seen date of a live feature.
      seen[key] = {
        first: prior.first < delta.day ? prior.first : delta.day,
        last: prior.last > delta.day ? prior.last : delta.day,
        total: prior.total + n
      };
    }
  }

  // Union, never replace: several clients declare over time (the kiosk, a
  // laptop tab, the suite) and a page booted with a flag off would otherwise
  // shrink the roster to nothing and take every "dead" verdict with it.
  const roster = [...new Set([...(census?.roster ?? []), ...(delta.roster ?? [])])]
    .filter((key) => !RETIRED_ROSTER.has(key))
    .sort()
    .slice(0, MAX_ROSTER);

  /* `since` — written ONCE and never moved again. It is held outside the day
     window for the same reason `seen` is: `Object.keys(days)` is a lossy proxy
     for "when did we start" — it ages out at 30 days, and a day on which
     nothing fired writes no key at all.

     ⚠ Unlike `seen.first`, this does NOT move backward when a client claims an
     older day. `first` moving back costs one wrong date on one key; `since`
     moving back re-opens the age guard, and a page with a wrong clock would
     hand back the very verdict this guard exists to withhold. A file written
     before the field existed backfills from its own oldest content instead, so
     a census that has honestly been counting a fortnight is not made to start
     over. */
  const since = censusSince(census) ?? delta.day;

  return { days, seen, roster, since, updated: at };
}

/** `2026-08-29` minus n days, as the same local-ish ISO day string. Day strings
 *  are compared as strings throughout — they sort correctly and never involve a
 *  timezone, which is the whole reason localDay() exists on the client. */
export function dayBefore(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
}

/**
 * The verdict. Pure — exported for the unit spec.
 *
 * Three findings, and they are different diagnoses that look identical from the
 * floor of the kitchen:
 *
 *   dead              in the roster, NEVER observed. Either it has been broken
 *                     since before the census, or it cannot fire at all — the
 *                     `bomWarning` / `robotCandidate` class. ⚠ WITHHELD until
 *                     the census has run for `deadDays` days; until then those
 *                     same keys appear under `notYetSeen`, which claims only
 *                     what has actually been observed.
 *   silent            it worked once and has not been seen lately. A REGRESSION,
 *                     and the one the sticky `seen` map exists for.
 *   offeredNeverShown an attention source produced a candidate every tick and
 *                     never once reached the glass. Alive, and pointless.
 */
export function buildReport(
  census,
  { today, silentDays = DEFAULT_SILENT_DAYS, deadDays = DEFAULT_DEAD_DAYS } = {}
) {
  const seen = census?.seen ?? {};
  const roster = census?.roster ?? [];
  const cutoff = dayBefore(today, silentDays);

  const observedBases = new Set(Object.keys(seen).map(baseOf));

  /* ⚠ TWO LISTS, AND THEY ARE NOT THE SAME CLAIM. `notYetSeen` is the
     OBSERVATION and is always honest — these roster keys have produced nothing
     since counting began. `dead` is that observation promoted to a VERDICT,
     and it stays empty until the window is long enough to have earned one. On
     the seventh day they are identical; before it, the difference is the whole
     fix. */
  const notYetSeen = roster.filter((base) => !observedBases.has(base)).sort();

  const since = censusSince(census);
  const observedDays = since === null ? 0 : daysBetween(since, today);
  const deadReady = observedDays >= deadDays;

  /* Reported per BASE rather than per key: "attn:bom has not been seen since
     the 4th" is the sentence someone acts on, and three lines saying it about
     offered/hero/shown is the same fact three times. */
  const lastByBase = new Map();
  const totalByBase = new Map();
  for (const [key, entry] of Object.entries(seen)) {
    const base = baseOf(key);
    const prior = lastByBase.get(base);
    if (prior === undefined || entry.last > prior) lastByBase.set(base, entry.last);
    totalByBase.set(base, (totalByBase.get(base) ?? 0) + entry.total);
  }

  const silent = [...lastByBase.entries()]
    .filter(([, last]) => last < cutoff)
    .map(([key, last]) => ({ key, last, total: totalByBase.get(key) ?? 0 }))
    .sort((a, b) => (a.last === b.last ? a.key.localeCompare(b.key) : a.last.localeCompare(b.last)));

  const offeredNeverShown = [...observedBases]
    .filter((base) => base.startsWith("attn:"))
    .filter((base) => (seen[`${base}:offered`]?.total ?? 0) > 0)
    .filter((base) => (seen[`${base}:shown`]?.total ?? 0) === 0)
    .map((base) => ({
      key: base,
      offered: seen[`${base}:offered`].total,
      hero: seen[`${base}:hero`]?.total ?? 0
    }))
    .sort((a, b) => b.offered - a.offered);

  return {
    today,
    since,
    observedDays,
    deadDays,
    deadReady,
    silentDays,
    rosterSize: roster.length,
    observedKeys: Object.keys(seen).length,
    alive: [...lastByBase.entries()].filter(([, last]) => last >= cutoff).length,
    dead: deadReady ? notYetSeen : [],
    notYetSeen,
    silent,
    offeredNeverShown
  };
}

async function loadCensus() {
  try {
    const parsed = JSON.parse(await readFile(CENSUS_FILE, "utf8"));
    return { ...emptyCensus(), ...parsed };
  } catch {
    return emptyCensus(); // cold start — no file yet, same as /api/routines
  }
}

/* The same read, for a reader that is not this route. services/houseLately.js
   asks this file a HOUSE question rather than the engineering one buildReport
   asks, and it should not learn the path or the cold-start shape a second time —
   two definitions of "empty census" is how one of them quietly stops matching. */
export const readFeatureCensus = loadCensus;

/* Read-modify-write, serialised. The kiosk flushes every five minutes and would
   never collide with itself, but the suite fires these back to back in parallel
   workers, and two interleaved reads would silently drop one flush — the exact
   class of bug a counter must not have. */
let writeQueue = Promise.resolve();

function todayLocal(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A day count off the query string, clamped rather than trusted: a NaN or a
 *  negative from a URL must not quietly redefine what the report means. 0 is
 *  allowed on purpose — it is the escape hatch for a reader who knows the
 *  census is old and wants the verdict now. */
function clampDays(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_DAYS ? Math.round(n) : fallback;
}

router.get("/api/census/features", async (req, res) => {
  const census = await loadCensus();
  const silentDays = clampDays(req.query.silentDays, DEFAULT_SILENT_DAYS);
  const deadDays = clampDays(req.query.deadDays, DEFAULT_DEAD_DAYS);
  res.json({ census, report: buildReport(census, { today: todayLocal(), silentDays, deadDays }) });
});

router.post("/api/census/features", async (req, res) => {
  const body = req.body ?? {};
  const day = body.day;
  if (typeof day !== "string" || !DAY_RE.test(day)) {
    return res.status(400).json({ error: "expected { day: 'YYYY-MM-DD' }" });
  }

  const counts = readCounts(body.counts);
  if (!counts) return res.status(400).json({ error: "expected counts as an object of numbers" });

  const roster = readRoster(body.roster);
  if (body.roster != null && !roster) return res.status(400).json({ error: "expected roster as an array of strings" });

  const task = writeQueue.then(async () => {
    const census = await loadCensus();
    const next = mergeFeatureDelta(census, { day, counts, roster: roster ?? [] });
    await mkdir(CENSUS_DIR, { recursive: true });
    await writeFile(CENSUS_FILE, JSON.stringify(next), "utf8");
    return next;
  });
  // The queue must survive a failed write, or one ENOSPC ends every later flush.
  writeQueue = task.then(() => {}, () => {});

  try {
    const next = await task;
    res.json({ ok: true, day: next.days[day], rosterSize: next.roster.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
