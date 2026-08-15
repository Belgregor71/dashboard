/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

// Behavioural learning — Phase 8 (docs/vision/phase-8-learn.md). Pure
// accumulation + confidence math, same contract as houseModel.js /
// predictiveRules.js: no imports, no DOM, no IO, so the whole module
// unit-tests in plain node (tests/routines.spec.js). The runtime
// (routineRuntime.js) owns the IO — it feeds observed events in and flushes
// the aggregates out.
//
// Everything here is an AGGREGATE, never a log of individual events: a rolling
// exponentially-weighted mean+variance per time-of-day routine, and small
// shown/dwell counters per attention source. That keeps the on-disk blob
// bounded (the kiosk's defining failure mode is unbounded 24/7 growth) and
// keeps behavioural data cheap and impersonal.
//
// Learning stays ADVISORY: predict() returns null until a routine is confident,
// and attention nudges are clamped small — learning tilts, never overrides.

// ── Tunables ───────────────────────────────────────────────────
const ALPHA = 0.3;            // rolling weight — recent days dominate (adaptive)
const SAMPLE_CAP = 10;        // confidence counter ceiling (bounded, not a log)
const MIN_SAMPLES = 4;        // below this a routine is never confident
const STD_TIGHT_MIN = 20;     // std ≤ 20 min → the routine is tight (full var-conf)
const STD_LOOSE_MIN = 90;     // std ≥ 90 min → too scattered to trust (no var-conf)
export const CONF_THRESHOLD = 0.5; // predict() returns null below this

const MIN_SHOWN = 4;          // attention nudge needs this many appearances
const NUDGE_BASELINE = 0.4;   // dwell-ratio at which the nudge is ~zero
const NUDGE_K = 30;           // ratio→score gain
const NUDGE_DOWN = 15;        // max down-weight for an always-ignored source
const NUDGE_UP = 10;          // max up-weight for an always-dwelt source
const MAX_SOURCES = 32;       // hard cap on distinct attention keys (bounded)

const TIME_ROUTINES = ["wake", "departure", "return"];
const BUCKETS = ["weekday", "weekend"];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ── Shape ──────────────────────────────────────────────────────

function emptyDist() {
  return { n: 0, mean: 0, variance: 0 };
}

export function emptyRoutines() {
  const out = { attention: {} };
  for (const r of TIME_ROUTINES) {
    out[r] = { weekday: emptyDist(), weekend: emptyDist() };
  }
  return out;
}

// Tolerate a partial blob loaded from disk (a routine added in a later version,
// or a cold-start empty object) by filling in any missing structure.
export function normalize(loaded) {
  const base = emptyRoutines();
  if (!loaded || typeof loaded !== "object") return base;
  for (const r of TIME_ROUTINES) {
    for (const b of BUCKETS) {
      const d = loaded[r]?.[b];
      if (d && Number.isFinite(d.n)) base[r][b] = { n: d.n, mean: d.mean, variance: d.variance };
    }
  }
  if (loaded.attention && typeof loaded.attention === "object") {
    for (const [src, a] of Object.entries(loaded.attention)) {
      if (a && Number.isFinite(a.shown)) base.attention[src] = { shown: a.shown, dwell: a.dwell || 0 };
    }
  }
  return base;
}

// ── Folding (the pure accumulators) ────────────────────────────

// Exponentially-weighted running mean + variance (West, 1979). O(1) storage,
// naturally rolling so a shifting routine adapts. `n` is a bounded confidence
// counter, NOT the true sample count — it caps so the blob never grows.
function foldTime(dist, minutes) {
  if (!Number.isFinite(minutes)) return dist;
  if (dist.n === 0) {
    return { n: 1, mean: minutes, variance: 0 };
  }
  const delta = minutes - dist.mean;
  const mean = dist.mean + ALPHA * delta;
  const variance = (1 - ALPHA) * (dist.variance + ALPHA * delta * delta);
  return { n: Math.min(dist.n + 1, SAMPLE_CAP), mean, variance };
}

function foldAttention(attention, source, dwelt) {
  if (!source) return attention;
  const existing = attention[source];
  if (!existing && Object.keys(attention).length >= MAX_SOURCES) return attention; // bounded
  const a = existing || { shown: 0, dwell: 0 };
  attention[source] = { shown: a.shown + 1, dwell: a.dwell + (dwelt ? 1 : 0) };
  return attention;
}

/**
 * Fold one observed event into the aggregates. Mutates + returns `routines`
 * (the runtime owns the object). Unknown event types are ignored.
 *
 * @param {object} routines the aggregate blob
 * @param {object} event
 *   time routine: { type: "wake"|"departure"|"return", minutes, weekend }
 *   attention:    { type: "attention", source, dwelt }
 */
export function observe(routines, event) {
  if (!routines || !event) return routines;
  const { type } = event;
  if (type === "attention") {
    routines.attention = foldAttention(routines.attention || {}, event.source, event.dwelt === true);
    return routines;
  }
  if (TIME_ROUTINES.includes(type)) {
    const bucket = event.weekend ? "weekend" : "weekday";
    routines[type] = routines[type] || { weekday: emptyDist(), weekend: emptyDist() };
    routines[type][bucket] = foldTime(routines[type][bucket] || emptyDist(), event.minutes);
  }
  return routines;
}

// ── Confidence + prediction ────────────────────────────────────

/** 0–1 confidence in a single distribution: rises with samples, falls with spread. */
export function confidence(dist) {
  if (!dist || dist.n < MIN_SAMPLES) return 0;
  const sampleConf = Math.min(1, dist.n / SAMPLE_CAP);
  const std = Math.sqrt(Math.max(0, dist.variance));
  const varConf = clamp((STD_LOOSE_MIN - std) / (STD_LOOSE_MIN - STD_TIGHT_MIN), 0, 1);
  return sampleConf * varConf;
}

/** The learned value (minutes-of-day) or null when the routine isn't yet trusted. */
export function predict(dist, { threshold = CONF_THRESHOLD } = {}) {
  if (confidence(dist) < threshold) return null;
  return Math.round(dist.mean);
}

/** Predict a time routine for the given weekday/weekend bucket, or null. */
export function learnedTime(routines, routine, weekend, opts) {
  const dist = routines?.[routine]?.[weekend ? "weekend" : "weekday"];
  return predict(dist, opts || {});
}

// ── Attention preference → a bounded, clamped score nudge ──────

/** Per-source score nudge from the dwell/shown ratio. Small, clamped, advisory. */
export function attentionNudge(routines, source) {
  const a = routines?.attention?.[source];
  if (!a || a.shown < MIN_SHOWN) return 0;
  const ratio = a.dwell / a.shown; // 0 (always ignored) … 1 (always leaned into)
  const raw = (ratio - NUDGE_BASELINE) * NUDGE_K;
  return Math.round(clamp(raw, -NUDGE_DOWN, NUDGE_UP));
}

/** The full { source: nudge } map for every source with enough appearances. */
export function attentionWeights(routines) {
  const out = {};
  for (const source of Object.keys(routines?.attention || {})) {
    const nudge = attentionNudge(routines, source);
    if (nudge !== 0) out[source] = nudge;
  }
  return out;
}
