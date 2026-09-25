/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   EVIDENCE — what a candidate is standing on. HOUSE-MIND S5a, 2026-09-25.

   Every candidate names the observation it was built from: `evidence: {key,
   at}`, where `key` says WHICH reading and `at` (epoch ms) says when the page
   last had it. The "8:41" briefing and the forecast invented 24/24 times were
   both a line with nothing under it; this makes "nothing under it" a property
   a ranker can see, instead of a prompt rule a model can ignore.

   Pure, no imports — candidateSources, the rules and the ranker all use it and
   all unit-test in plain node.

   ── The vocabulary ────────────────────────────────────────────────────────
   HOUSE-MIND §S5 says "an S2 store key or an HA entity". The inventory found
   candidates that stand on neither, so the list is wider, and each extra key
   says why it exists:

     S2 keys      weather forecast nowcast calendar commute bins plex
                  — read over HTTP (or the S2 stream) on a 5-minute cadence.
     fuel         the briefing context's fuel price; not an S2 key (S2 was
                  built without fuel and chores).
     resolutions  the server's unresolved/resolved store (/api/house/resolutions).
     immich       an on-this-day photo memory, fetched from Immich.
     memory       an owner-authored memory entry. The entry IS the evidence.
     clock        a fact the date alone establishes (Christmas Eve). Cannot go
                  stale: the date is re-read on every call.
     boot         this page's own start (the power-restored delight).
     presence     the house's person entities, as V3 presence reads them.
     ha:<entity>  one Home Assistant entity from the live stream.

   ── Stale ─────────────────────────────────────────────────────────────────
   `at` is when the PAGE last had the reading, never when the world changed.
   A BOM warning that has said the same thing for three hours is not stale; a
   weather reading the page has not refreshed for three cycles is.

   So only the polled keys have a max age: 20 minutes, which is four missed
   5-minute reads (S2's own "fresh" window is 11). A failed read keeps the last
   good value (houseSnapshot, the S2 store) — that is right for a readout, and
   this is the bound on how long a candidate may keep standing on it.

   HA keys have NO max age here. The entity cache is pushed live; an entity's
   own `last_updated` is a world-change time, and gating on it would drop every
   steady state (a warning, a playing speaker) that simply has not changed.

   ── Events ────────────────────────────────────────────────────────────────
   A READOUT is re-derived every cycle, so its `at` keeps moving and a stuck
   one ages out. An EVENT happened once — an arrival, a delight that fired, a
   resolution — and is held for a life of its own. `{key, at, event: true}`
   says "this happened at `at`": the key's max age does not apply, and instead
   the candidate MUST carry `expiresAt`, the same rule announce() already
   states. An event with no end is a claim about the present that becomes a
   lie, so it is dropped as "endless".
   ═══════════════════════════════════════════════════════════════════════════ */

const POLLED_MAX_AGE_MS = 20 * 60 * 1000;

/** key → max age in ms, or null for "never stale". */
export const EVIDENCE_KEYS = Object.freeze({
  weather: POLLED_MAX_AGE_MS,
  forecast: POLLED_MAX_AGE_MS,
  nowcast: POLLED_MAX_AGE_MS,
  calendar: POLLED_MAX_AGE_MS,
  commute: POLLED_MAX_AGE_MS,
  bins: POLLED_MAX_AGE_MS,
  plex: POLLED_MAX_AGE_MS,
  fuel: POLLED_MAX_AGE_MS,
  resolutions: POLLED_MAX_AGE_MS,
  immich: null,
  memory: null,
  clock: null,
  boot: null,
  presence: null
});

const HA_KEY = /^ha:[a-z_]+\.[a-z0-9_]+$/;

/** A known key: one of EVIDENCE_KEYS, or `ha:<domain>.<object_id>`. */
export function isEvidenceKey(key) {
  if (typeof key !== "string") return false;
  return Object.prototype.hasOwnProperty.call(EVIDENCE_KEYS, key) || HA_KEY.test(key);
}

/** Max age for a key; null = never stale (HA keys, and the unpolled ones). */
export function maxAgeOf(key) {
  return HA_KEY.test(key) ? null : EVIDENCE_KEYS[key] ?? null;
}

function toMs(at) {
  if (at instanceof Date) return at.getTime();
  if (typeof at === "number") return at;
  const parsed = Date.parse(String(at ?? ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Build one evidence record, or null when the reading is absent or undated.
 * An undated reading is not evidence: "we had it at some point" is exactly the
 * claim this exists to stop.
 */
export function evidenceOf(key, at, { event = false } = {}) {
  const ms = toMs(at);
  if (!isEvidenceKey(key) || !Number.isFinite(ms) || ms <= 0) return null;
  return event ? { key, at: ms, event: true } : { key, at: ms };
}

/**
 * Why a candidate would be dropped, or "ok".
 *   missing  no evidence object
 *   unknown  a key outside the vocabulary
 *   undated  no usable `at`
 *   endless  an event with no `expiresAt` on its candidate
 *   stale    a readout older than its key's max age
 */
export function evidenceVerdict(candidate, now = Date.now()) {
  const ev = candidate?.evidence;
  if (!ev || typeof ev !== "object") return "missing";
  if (!isEvidenceKey(ev.key)) return "unknown";
  const at = toMs(ev.at);
  if (!Number.isFinite(at) || at <= 0) return "undated";
  if (ev.event === true) return Number.isFinite(candidate.expiresAt) ? "ok" : "endless";
  const t = now instanceof Date ? now.getTime() : now;
  const max = maxAgeOf(ev.key);
  if (max != null && t - at > max) return "stale";
  return "ok";
}

/**
 * The S5a runtime gate. Splits a candidate list into what may be ranked and
 * what was dropped (with the reason), preserving order. Pure.
 */
export function gateByEvidence(candidates, now = Date.now()) {
  const kept = [];
  const dropped = [];
  for (const c of candidates) {
    if (!c) continue;
    const why = evidenceVerdict(c, now);
    if (why === "ok") kept.push(c);
    else dropped.push({ id: c.id ?? null, source: c.source ?? null, why });
  }
  return { kept, dropped };
}
