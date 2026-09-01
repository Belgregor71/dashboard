import express from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* ═══════════════════════════════════════════════════════════════════════════
   DEPTH CENSUS — how often the wall is at each depth, and for how long.

   Asked on 2026-08-23 and unanswerable: core/depth.js keeps one integer and one
   string, both overwritten in place ("There is no router, no view registry and
   no history"), nothing ships it anywhere, and the server has no access log.
   So two weeks of the surface's actual behaviour left no trace at all, and any
   decision about which depth is worth designing for was being made blind.

   This is the smallest thing that fixes that, and it is deliberately NOT a log.

   ── Aggregates only, same as routines ───────────────────────────────────────

   ON-DEVICE ONLY — never talks to an upstream, exactly like /api/routines. The
   file is bounded by construction: at most MAX_DAYS days, each holding four
   entry counts, four dwell totals and at most MAX_REASONS named causes. It
   cannot grow into a record of what happened in the house at 6:04pm, because
   nothing here has a timestamp finer than the day.

   ── Why POST-deltas and not a PUT of the whole blob ─────────────────────────

   routines.js PUTs its entire aggregate because exactly one runtime owns it.
   This one has several writers over time: the kiosk reloads on every deploy,
   the page can be open on a laptop at the same time, and the suite drives it.
   A whole-blob PUT from a freshly-booted page whose in-memory tally starts at
   zero would erase the fortnight it was meant to be collecting. So the client
   sends only what it has counted SINCE ITS LAST FLUSH, and the addition happens
   here. A client that reloads, crashes or double-flushes can lose a few
   minutes; it can never zero the history.

   ── Causes are attributed per depth, and BOTH SHAPES ARRIVE ─────────────────

   A day now holds `byDepth` — four cause maps, one per depth — alongside the
   flat `reasons` total, which is kept because it is the whole of the history
   collected before attribution existed (2026-08-23 onward) and dropping it
   would make the first week incomparable with every week after it.

   ⚠ THE FLAT TOTAL IS DERIVED FROM byDepth, NEVER ADDED TO IT. A client that
   sent both would otherwise have every cause counted twice, in silence, and a
   doubled counter looks exactly like a busy house. So: `byDepth` present means
   `reasons` in the body is IGNORED, not merged. There is one number per cause
   on the wire and one place it lands.

   ⚠ The kiosk keeps running the bundle it loaded until something reloads it, so
   for a while after this ships the live page is still POSTing flat `reasons`
   with no attribution — that path is not dead code, it is the deploy window.
   The day that straddles it holds `sum(byDepth) < reasons`, which is the honest
   record of a day only partly attributed. Only `byDepth` being ABSENT means
   "attribution was not running"; four empty maps mean "nothing happened".
   ═══════════════════════════════════════════════════════════════════════════ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CENSUS_DIR = path.join(__dirname, "..", "..", "data", "census");
const CENSUS_FILE = path.join(CENSUS_DIR, "depth.json");

export const DEPTHS = 4;          // FIELD, GLANCE, SPREAD, SUBJECT
export const MAX_DAYS = 30;
export const MAX_REASONS = 64;

/* Per-delta ceilings. Not security — the cross-origin guard and the LAN-only
   rate limiter are that — but a bad client (or a debug handle typo) must not be
   able to write a number that makes every later reading meaningless. One day of
   milliseconds is the most dwell any single flush can honestly represent. */
const MAX_DWELL_DELTA = 86_400_000;
const MAX_ENTRY_DELTA = 100_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REASON_RE = /^[a-z0-9][a-z0-9._:-]{0,39}$/i;

const router = express.Router();

export function emptyDay() {
  return {
    entries: Array(DEPTHS).fill(0),
    dwellMs: Array(DEPTHS).fill(0),
    reasons: {},
    byDepth: Array.from({ length: DEPTHS }, () => ({}))
  };
}

/** A stored day from before attribution — or one a hand edit has bent out of
 *  shape — reads as four empty maps rather than throwing the flush away. */
function readStoredByDepth(value) {
  const ok = Array.isArray(value) && value.length === DEPTHS;
  return Array.from({ length: DEPTHS }, (_, d) => {
    const map = ok ? value[d] : null;
    return map && typeof map === "object" && !Array.isArray(map) ? { ...map } : {};
  });
}

/* Strict about type, not just about value. `Number("1")` is 1, so a coercing
   check accepts a client that sends its counts as strings and rejects the same
   client the moment one of them is "12e3" or "". Half-working is the worst of
   the three outcomes for an instrument: it means the file is real for weeks and
   then quietly is not. Only a JSON number is a count. */
function readCounts(value, cap) {
  if (!Array.isArray(value) || value.length !== DEPTHS) return null;
  const out = [];
  for (const raw of value) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > cap) return null;
    out.push(Math.round(raw));
  }
  return out;
}

/* Reasons are code literals ("recede", "voice-wake", "doorbell"), never user
   text — but they arrive over HTTP, so they are treated as untrusted anyway.
   Anything unnameable is dropped rather than rejecting the whole delta: losing
   one label is a much smaller loss than losing the flush it rode in on. */
function readReasons(value, seen = new Set()) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!REASON_RE.test(key)) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > MAX_ENTRY_DELTA) continue;
    // `seen` is shared across the four maps of a byDepth body, so the cap lands
    // on the union of names. Left to default it is per-map, which is what the
    // single flat map of a legacy delta wants.
    if (!seen.has(key) && seen.size >= MAX_REASONS) continue;
    seen.add(key);
    out[key] = Math.round(raw);
  }
  return out;
}

/* Three outcomes, and they are not the same: absent (a client from before
   attribution — merge its flat total and record no attribution), malformed
   (reject the delta, the way a malformed entries array is rejected), or four
   maps of counts. Folding the first two together is how a real client bug
   becomes a permanent silent gap in the file. */
export const MALFORMED = Symbol("malformed byDepth");

export function readByDepth(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== DEPTHS) return MALFORMED;
  const seen = new Set();
  const out = [];
  for (const map of value) {
    const one = readReasons(map, seen);
    if (one === null) return MALFORMED;
    out.push(one);
  }
  return out;
}

/** Fold one delta into the stored census. Pure — exported for the unit spec, so
 *  the merge rules can be tested without a server, a file or a clock. */
export function mergeDelta(census, delta) {
  const days = { ...(census?.days ?? {}) };
  const day = { ...emptyDay(), ...(days[delta.day] ?? {}) };

  const entries = day.entries.slice();
  const dwellMs = day.dwellMs.slice();
  for (let d = 0; d < DEPTHS; d += 1) {
    entries[d] += delta.entries[d];
    dwellMs[d] += delta.dwellMs[d];
  }

  const reasons = { ...day.reasons };
  const byDepth = readStoredByDepth(day.byDepth);

  // A day already at the cap keeps the causes it has rather than trading one
  // established count for a newcomer — otherwise a burst of novel labels would
  // evict the very history this file exists to hold. Checked against the flat
  // total, which is the union of every name the day has at any depth.
  const admit = (key) => reasons[key] !== undefined || Object.keys(reasons).length < MAX_REASONS;

  if (delta.byDepth) {
    for (let d = 0; d < DEPTHS; d += 1) {
      for (const [key, n] of Object.entries(delta.byDepth[d])) {
        if (!admit(key)) continue;
        byDepth[d][key] = (byDepth[d][key] ?? 0) + n;
        reasons[key] = (reasons[key] ?? 0) + n;   // derived, never independently sent
      }
    }
  } else {
    // The deploy window: a page still running the pre-attribution bundle. Its
    // causes are real and are kept; only where they happened is unknown.
    for (const [key, n] of Object.entries(delta.reasons ?? {})) {
      if (!admit(key)) continue;
      reasons[key] = (reasons[key] ?? 0) + n;
    }
  }

  days[delta.day] = { entries, dwellMs, reasons, byDepth };

  // Prune by key, which sorts chronologically because the keys are ISO dates.
  // Oldest goes first, so a box that has been running for months holds a
  // rolling window rather than a growing file.
  const keys = Object.keys(days).sort();
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete days[stale];

  return { days, updated: new Date().toISOString() };
}

async function loadCensus() {
  try {
    return JSON.parse(await readFile(CENSUS_FILE, "utf8"));
  } catch {
    return { days: {} }; // cold start — no file yet, same as /api/routines
  }
}

/* Exported for services/houseLately.js, which uses this census as the DENOMINATOR
   for the other one: dwellMs says how long the wall was actually awake on a given
   day, and without it a day the kiosk was down is indistinguishable from a day
   nothing happened. See that file's header. */
export const readDepthCensus = loadCensus;

/* Read-modify-write, serialised. The kiosk flushes every five minutes and would
   never collide with itself, but the suite fires these back to back in parallel
   workers, and two interleaved reads would silently drop one flush — the exact
   class of bug a counter must not have. */
let writeQueue = Promise.resolve();

router.get("/api/census/depth", async (_req, res) => {
  const census = await loadCensus();
  res.json({ census });
});

router.post("/api/census/depth", async (req, res) => {
  const body = req.body ?? {};
  const day = body.day;
  if (typeof day !== "string" || !DAY_RE.test(day)) {
    return res.status(400).json({ error: "expected { day: 'YYYY-MM-DD' }" });
  }

  const entries = readCounts(body.entries, MAX_ENTRY_DELTA);
  const dwellMs = readCounts(body.dwellMs, MAX_DWELL_DELTA);
  if (!entries || !dwellMs) {
    return res.status(400).json({ error: `expected entries and dwellMs as ${DEPTHS} non-negative numbers` });
  }

  const byDepth = readByDepth(body.byDepth);
  if (byDepth === MALFORMED) {
    return res.status(400).json({ error: `expected byDepth as ${DEPTHS} objects of reason counts` });
  }

  /* ⚠ Not read when byDepth is present: the merge derives the flat total from
     the attribution, and adding both would double every cause in silence. The
     ENFORCEMENT is mergeDelta's branch, which is where the spec aims; this line
     is belt-and-braces, so do not read its removal as the defect being fixed. */
  const reasons = byDepth ? {} : readReasons(body.reasons);
  if (!reasons) return res.status(400).json({ error: "expected reasons as an object" });

  const task = writeQueue.then(async () => {
    const census = await loadCensus();
    const next = mergeDelta(census, { day, entries, dwellMs, reasons, byDepth });
    await mkdir(CENSUS_DIR, { recursive: true });
    await writeFile(CENSUS_FILE, JSON.stringify(next), "utf8");
    return next;
  });
  // The queue must survive a failed write, or one ENOSPC ends every later flush.
  writeQueue = task.then(() => {}, () => {});

  try {
    const next = await task;
    res.json({ ok: true, day: next.days[day] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
