/* ═══════════════════════════════════════════════════════════════════════════
   DEPTH CENSUS — the client half. Counts, it does not narrate.

   depth.js is the one authority on where the surface is, and it is deliberately
   amnesiac: one integer, one reason string, both overwritten in place. That is
   the right shape for the module that DRIVES the wall and the wrong shape for
   answering "which depth does this house actually live at", which is a question
   about a fortnight, not about now.

   So the counting lives out here, subscribed to depth.js rather than welded
   into it. depth.js stays pure and node-testable, and the census can be flipped
   off at the flag without depth.js containing a single line about it.

   ── What it counts ──────────────────────────────────────────────────────────

   Per depth: how many times the surface ENTERED it, and how many milliseconds
   it spent there. Both are needed and neither substitutes for the other — a
   depth entered forty times for four seconds each and a depth entered once for
   three minutes are opposite design problems with the same total.

   Plus a tally by CAUSE, which is the half that says what to build: "recede"
   dominating means the wall is timing out rather than being read.

   ── Causes are attributed PER DEPTH, and the direction is not dwell's ───────

   The first week of data (Aug 24-29) could say the wall spends 9.2% of its life
   at the spread and 1.5% at the glance, and could say `attention:spread` fired
   220 times, but could NOT say those were the same events: the cause tally was
   one flat map for the whole day. `attention:spread` (220) matching depth 2's
   entries (219) was circumstantial, and reading it as attribution was a guess
   dressed as a measurement. So the tally is now four maps, one per depth.

   ⚠ A CAUSE IS CREDITED TO THE DEPTH BEING ENTERED. Dwell goes the other way —
   to the depth being LEFT — and the asymmetry is deliberate, not an oversight
   to be tidied up. "attention:spread" explains why the surface ARRIVED at the
   spread; it says nothing about the field it came from. Time, meanwhile, was
   spent where the surface WAS. Make both point the same way and one of them
   becomes a lie.

   ── Dwell is attributed at FLUSH time, not at transition time ───────────────

   A period that spans midnight is split at the next flush rather than exactly
   at the boundary, so up to one flush interval of dwell can land on the wrong
   side of a date. That is at most five minutes out of a night the wall spends
   entirely at depth 0, and buying exactness would mean this file owning a
   midnight timer — a second clock, running forever, to sharpen a number nobody
   reads to the minute.

   ⚠ ENTRIES AND DWELL PERIODS ARE KEPT IN STEP ON PURPOSE. Boot counts as an
   entry into whatever depth the surface starts at, so every dwell period has
   exactly one entry to divide by and `dwellMs[d] / entries[d]` is an honest
   mean. The cost is that depth 0's entry count includes one per page load; the
   `boot` reason is there to subtract it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { DEPTH, getDepth, onDepth } from "./depth.js";

const DEPTHS = 4;
const DEFAULT_FLUSH_MS = 5 * 60_000;

/* Mirrors MAX_REASONS in server/routes/census.js. Both ends cap, because the
   server's cap protects the file and this one protects the flush: a client that
   invented labels forever would send a growing body every five minutes and have
   most of it dropped on arrival.

   ⚠ ONE cap on the UNION of names, not one per depth. A cause seen at three
   depths is one name, not three, so the ceiling still means what it always
   meant — at most 64 named causes — and splitting the tally four ways did not
   quietly quadruple the ceiling along with it. */
const MAX_REASONS = 64;
const OVERFLOW_REASON = "other";

/** Four cause maps, one per depth. Null-prototype so a cause that happens to be
 *  called "constructor" is counted rather than colliding with the prototype. */
function emptyByDepth() {
  return Array.from({ length: DEPTHS }, () => Object.create(null));
}

/** The old flat total, derived rather than stored — so it can never disagree
 *  with the attribution it is a sum of. Only the debug handle needs it. */
function flatten(maps) {
  const out = {};
  for (const map of maps) {
    for (const [key, n] of Object.entries(map)) out[key] = (out[key] ?? 0) + n;
  }
  return out;
}

/** Local date, not UTC. `toISOString()` would roll this house's day over at
 *  10am Brisbane time and put a whole morning onto the previous date. */
export function localDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The accumulator. Pure: no DOM, no clock of its own, no fetch — every time it
 * needs to know "now" it is told. That is what lets a spec drive a fortnight of
 * wall behaviour through it in a millisecond.
 */
export function makeLedger(startDepth = DEPTH.FIELD, now = 0) {
  let depth = startDepth;
  let mark = now;
  let entries = Array(DEPTHS).fill(0);
  let dwellMs = Array(DEPTHS).fill(0);
  let byDepth = emptyByDepth();
  /* The union of names seen since the last drain. Kept alongside rather than
     recomputed, because the cap has to be checked on every transition and the
     four maps would have to be walked to answer it. */
  let names = new Set();

  /* `target` is the depth being ENTERED — see the header on why this is the
     opposite direction to dwell. Overflow is attributed too: a cause dropped
     into "other" still says which depth it drove the surface to. */
  function countReason(target, reason) {
    let key = typeof reason === "string" && reason ? reason : "unknown";
    if (!names.has(key) && names.size >= MAX_REASONS) key = OVERFLOW_REASON;
    names.add(key);
    byDepth[target][key] = (byDepth[target][key] ?? 0) + 1;
  }

  // Boot is an entry, so that entries and dwell periods stay one-to-one.
  entries[depth] += 1;
  countReason(depth, "boot");

  /** Fold everything up to `now` into the current depth without moving. */
  function settle(at) {
    const elapsed = at - mark;
    // A clock that went backwards (NTP stepping the box, which this one does)
    // must not subtract time already counted. Drop the interval instead.
    if (elapsed > 0) dwellMs[depth] += elapsed;
    mark = at;
  }

  return {
    /* A real depth change. Only ever called for one: depth.js does not notify
       listeners when `sustain()` re-arms the hold at the depth already showing,
       so a sustain reads here as more dwell rather than as a new entry — which
       is exactly right. Nothing appeared; the room just kept giving a reason. */
    enter(next, reason, at) {
      settle(at);
      depth = next;
      entries[next] += 1;
      countReason(next, reason);
    },

    /* Everything counted since the last drain, shaped as the route's delta
       body, plus a reset. Zeroing here is what makes a failed POST recoverable:
       the caller then holds the only copy and can hand it back. */
    drain(at, date = new Date()) {
      settle(at);
      /* The maps are handed over, not copied: the ledger drops its reference in
         the next line, so there is exactly one owner either way. */
      const delta = { day: localDay(date), entries, dwellMs, byDepth };
      entries = Array(DEPTHS).fill(0);
      dwellMs = Array(DEPTHS).fill(0);
      byDepth = emptyByDepth();
      names = new Set();
      return delta;
    },

    /* Put a drained delta back after a failed flush. The day it was stamped
       with is discarded; the next drain stamps its own. */
    restore(delta) {
      for (let d = 0; d < DEPTHS; d += 1) {
        entries[d] += delta.entries[d];
        dwellMs[d] += delta.dwellMs[d];
        for (const [key, n] of Object.entries(delta.byDepth[d])) {
          if (!names.has(key) && names.size >= MAX_REASONS) continue;
          names.add(key);
          byDepth[d][key] = (byDepth[d][key] ?? 0) + n;
        }
      }
    },

    /* Read-only peek for the debug handle. Never the live arrays. */
    peek(at = mark) {
      const view = dwellMs.slice();
      const elapsed = at - mark;
      if (elapsed > 0) view[depth] += elapsed;
      const attributed = byDepth.map((map) => ({ ...map }));
      /* `reasons` is kept in the peek — derived, not stored — so the debug
         handle still answers the flat question a human asks first. */
      return { depth, entries: entries.slice(), dwellMs: view, byDepth: attributed, reasons: flatten(attributed) };
    }
  };
}

/* ── The wiring ─────────────────────────────────────────────────────────────
   One subscription and one init-once interval, which is the shape the memory
   rules allow without teardown. There is no per-event path here: nothing is
   created per depth change, so nothing has to be destroyed per depth change.
─────────────────────────────────────────────────────────────────────────── */

let ledger = null;
let timer = null;
let unsubscribe = null;
let lastFlush = null;

async function flush({ keepalive = false } = {}) {
  if (!ledger) return null;
  const delta = ledger.drain(Date.now());
  try {
    const res = await fetch("/api/census/depth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(delta),
      keepalive
    });
    lastFlush = { at: new Date().toISOString(), ok: res.ok, status: res.status };
    // A 4xx means this delta will never be accepted, so it is dropped rather
    // than retried forever. Only a 5xx or a transport failure is worth holding.
    if (!res.ok && res.status >= 500) ledger.restore(delta);
  } catch (err) {
    ledger.restore(delta);
    lastFlush = { at: new Date().toISOString(), ok: false, error: String(err?.message ?? err) };
  }
  return lastFlush;
}

/**
 * Start counting. Safe to call twice — the second call is ignored rather than
 * doubling the interval, because a second subscription would count every
 * transition twice and the resulting file would look like a busy house.
 */
export function initCensus({ flushMs = DEFAULT_FLUSH_MS } = {}) {
  if (ledger) return;
  ledger = makeLedger(getDepth(), Date.now());

  unsubscribe = onDepth((next, _prev, reason) => ledger.enter(next, reason, Date.now()));

  timer = setInterval(() => { flush(); }, flushMs);

  /* The kiosk reloads on every deploy and a laptop tab gets closed the ordinary
     way. Without this, up to one interval of counting dies with the page — so a
     deploy day would systematically under-count. */
  window.addEventListener("pagehide", () => { flush({ keepalive: true }); });

  window.__v3Census = () => ({
    ...ledger.peek(Date.now()),
    day: localDay(new Date()),
    flushMs,
    lastFlush
  });
  /* Verification handle: the census is a slow instrument by design, and waiting
     five minutes to find out whether it is wired up at all is not a test. */
  window.__v3CensusFlush = () => flush();
}

/** For the specs, which run several pages in one node process. */
export function __resetCensus() {
  if (timer) clearInterval(timer);
  if (unsubscribe) unsubscribe();
  timer = null;
  unsubscribe = null;
  ledger = null;
  lastFlush = null;
}
