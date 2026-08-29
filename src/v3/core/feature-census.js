/* ═══════════════════════════════════════════════════════════════════════════
   FEATURE CENSUS — the client half. Which named features are still ALIVE.

   docs/AUGUST-IMPROVEMENTS.md §1. The sibling of core/census.js and deliberately
   the same machine: a pure ledger that is told what time it is, subscribed from
   OUTSIDE the things it measures, flushing DELTAS so a reload cannot zero the
   fortnight, bounded on-device, one flag, one init-once interval.

   ── The question nothing in this repo could answer ──────────────────────────

   Tests prove a path CAN execute. healthService proves a FEED is fresh (eight
   of them). Neither proves a candidate ever won, a subject ever rendered, or an
   intent ever matched ON THE GLASS. Eight features have shipped, gone dead and
   stayed dead for weeks — `bomWarning` empty since the cutover so the wall could
   not say a storm was coming, `robotCandidate` never read, `__intent` undefined,
   `media.js` undrivable — and a green suite was compatible with every one.

   ── ⚠⚠ RULE: EVERY KEY MUST TRACE TO A STRING LITERAL ───────────────────────

   `candidateSources.js` exports SOURCES as an array of NAMED function
   references, so `fn.name` looks like free, code-derived identity. It is not.
   Measured, not assumed:

       $ grep -c "bomCandidate" dist/assets/v3-*.js
       0

   Minification renames every one of them. A census keyed on `fn.name` would be
   perfect in dev, perfect in every spec, and GARBAGE ON THE WALL — which is
   precisely the failure mode this instrument exists to catch, reproduced inside
   the instrument. String literals survive; function names do not. Every key
   here comes from a literal, and feature-census.spec.js pins that against the
   built bundle so it cannot come back.

   ── ⚠ You cannot detect the absence of something you never knew existed ─────

   If `bom` never fires there is no `attn:bom` row, which is indistinguishable
   from "there is no such thing as bom". A pure counter can NEVER report bom
   dead. That is why `initFeatureCensus` takes a ROSTER — the set of keys that
   could fire — and ships it to the server, which holds it outside the 30-day
   window. main.js assembles it from code-derived key spaces (the subject
   REGISTRY's own keys, INTENTS' own ids, LOCATIONS' own prefixes) so the only
   hand-written part is candidateSources' SOURCE_NAMES, which a spec cross-checks
   against the `source:` literals in that file.

   ── Why the roster is assembled by main.js and not here ─────────────────────

   Three V3 modules import THIS one to call record(). If it imported them back
   for their rosters that is a cycle, and a cycle in a module that four other
   modules depend on at boot is not a thing to discover on the kiosk. So this
   file is a LEAF: it imports nothing, and the roster arrives as an argument.
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_FLUSH_MS = 5 * 60_000;

/* Mirrors MAX_KEYS in server/routes/censusFeatures.js. Both ends cap, for the
   same reason the depth census caps reasons at both ends: the server's cap
   protects the file, this one protects the flush. Observed key count on the
   live surface is ~124 (11 attention sources x 3 outcomes, 12 subjects x 3,
   ~45 intents, 2 alert locations x 2), so 256 is roughly double the truth. */
const MAX_KEYS = 256;

/* Namespaces, outcomes and names are all code literals, but they are joined
   into something that becomes an object key and then travels over HTTP, so they
   are validated rather than trusted. Dots because intent ids carry them
   ("show.forecast"); colons because they are the separator itself. */
const KEY_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;

/** Local date, not UTC — `toISOString()` would roll this house's day over at
 *  10am Brisbane time. Same rule and the same reason as census.js. */
export function localDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * `<ns>:<name>:<outcome>`, or null if any part is unnameable.
 *
 * One shape for all four observers on purpose. A flat map of uniform keys
 * merges exactly like the depth census's `reasons` — no per-namespace schema on
 * either end, and adding a fifth observer later needs no route change.
 */
export function featureKey(ns, name, outcome) {
  const key = `${ns}:${name}:${outcome}`;
  return KEY_RE.test(key) ? key : null;
}

/**
 * The accumulator. Pure: no DOM, no clock of its own, no fetch. That is what
 * lets a spec drive a fortnight of wall behaviour through it in a millisecond.
 */
export function makeFeatureLedger() {
  let counts = Object.create(null);

  return {
    /* An unnameable key is dropped rather than throwing: this is called from
       inside the attention tick and the voice turn, and an instrument must
       never be able to take down the thing it is measuring. */
    record(ns, name, outcome) {
      const key = featureKey(ns, name, outcome);
      if (!key) return null;
      /* A key already present keeps counting even at the cap — the ceiling
         stops NEW keys, so a burst of novel names cannot stop the established
         ones being counted. */
      if (counts[key] === undefined && Object.keys(counts).length >= MAX_KEYS) return null;
      counts[key] = (counts[key] ?? 0) + 1;
      return key;
    },

    /* Everything counted since the last drain, shaped as the route's delta
       body, plus a reset. Zeroing here is what makes a failed POST recoverable:
       the caller then holds the only copy and can hand it back. */
    drain(date = new Date()) {
      const delta = { day: localDay(date), counts };
      counts = Object.create(null);
      return delta;
    },

    /* Put a drained delta back after a failed flush. The day it was stamped
       with is discarded; the next drain stamps its own. */
    restore(delta) {
      for (const [key, n] of Object.entries(delta?.counts ?? {})) {
        if (counts[key] === undefined && Object.keys(counts).length >= MAX_KEYS) continue;
        counts[key] = (counts[key] ?? 0) + n;
      }
    },

    /* Read-only peek for the debug handle. Never the live object. */
    peek() {
      return { ...counts };
    }
  };
}

/* ── The wiring ─────────────────────────────────────────────────────────────
   One init-once interval and no subscription of its own — the four observers
   push into `record()` from where they already are. Nothing is created per
   event, so nothing has to be destroyed per event.
─────────────────────────────────────────────────────────────────────────── */

let ledger = null;
let timer = null;
let lastFlush = null;
let roster = null;
let rosterPending = false;

/**
 * Count one observation. **A no-op until `initFeatureCensus` has run**, which is
 * what lets the four call sites be unconditional: the flag lives in main.js, and
 * a flag-off build reaches four function calls that return immediately rather
 * than four `if (flag(...))` reads scattered across the surface.
 *
 * ⚠ This is why the flag-off build is BEHAVIOURALLY identical rather than
 * byte-identical. Stated plainly in the flag comment in config.js.
 */
export function record(ns, name, outcome) {
  if (!ledger) return null;
  return ledger.record(ns, name, outcome);
}

async function flush({ keepalive = false } = {}) {
  if (!ledger) return null;
  const delta = ledger.drain(new Date());
  /* The roster rides along until one is accepted, rather than going out as its
     own request at boot. Two reasons: a boot-time POST is one more thing that
     can fail alone and leave the server holding counts it cannot name, and a
     kiosk that reloads on every deploy would send it dozens of times a week for
     no benefit. Re-sent on failure because a roster lost at boot is not
     recoverable — nothing else ever declares one. */
  const body = rosterPending && roster ? { ...delta, roster } : delta;
  try {
    const res = await fetch("/api/census/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive
    });
    lastFlush = { at: new Date().toISOString(), ok: res.ok, status: res.status };
    if (res.ok) rosterPending = false;
    // A 4xx will never be accepted, so it is dropped rather than retried
    // forever. Only a 5xx or a transport failure is worth holding.
    else if (res.status >= 500) ledger.restore(delta);
  } catch (err) {
    ledger.restore(delta);
    lastFlush = { at: new Date().toISOString(), ok: false, error: String(err?.message ?? err) };
  }
  return lastFlush;
}

/**
 * Start counting.
 *
 * @param {object}   opts
 * @param {string[]} opts.roster   base keys (`attn:bom`, `subject:show.year`)
 *                                 that COULD fire. Without this the report can
 *                                 never say "dead" — see the header.
 * @param {number}   opts.flushMs
 *
 * Safe to call twice: the second call is ignored rather than doubling the
 * interval, because two intervals would double every count and the resulting
 * file would look like a busy house.
 */
export function initFeatureCensus({ roster: declared = [], flushMs = DEFAULT_FLUSH_MS } = {}) {
  if (ledger) return;
  ledger = makeFeatureLedger();
  roster = [...new Set(declared)].filter((k) => typeof k === "string" && k);
  rosterPending = roster.length > 0;

  timer = setInterval(() => { flush(); }, flushMs);

  /* The kiosk reloads on every deploy and a laptop tab gets closed the ordinary
     way. Without this, up to one interval of counting dies with the page — so a
     deploy day would systematically under-count the very features the deploy
     touched. */
  window.addEventListener("pagehide", () => { flush({ keepalive: true }); });

  window.__v3Features = () => ({
    counts: ledger.peek(),
    day: localDay(new Date()),
    roster,
    rosterPending,
    flushMs,
    lastFlush
  });
  /* Verification handle. The census is a slow instrument by design and waiting
     five minutes to find out whether it is wired up at all is not a test. */
  window.__v3FeaturesFlush = () => flush();
}

/** For the specs, which run several pages in one node process. */
export function __resetFeatureCensus() {
  if (timer) clearInterval(timer);
  timer = null;
  ledger = null;
  lastFlush = null;
  roster = null;
  rosterPending = false;
}
