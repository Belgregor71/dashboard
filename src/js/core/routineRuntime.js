/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

import { on } from "./eventBus.js";
import { get as getContext } from "./contextStore.js";
import {
  emptyRoutines,
  normalize,
  observe,
  learnedTime,
  attentionWeights as weightsFrom
} from "../services/routineStore.js";

// The behavioural-learning runtime — Phase 8 (docs/vision/phase-8-learn.md).
// A passive observer on the heartbeat that already beats: it subscribes to the
// signals presence.js / arrivalGreeting / the attention engine already emit,
// folds them into the pure routineStore aggregates, and flushes a bounded blob
// to disk. It adds NO new signal and NO new UI — it is deliberately off the
// render path. It only informs (House Model + attention ranking), and only
// above a confidence threshold; below it, Phase 6/7 behaviour is unchanged.
//
// Leak discipline (CLAUDE.md 24/7 kiosk): every listener + the flush timer is
// registered once at init behind the flag. Aggregates-not-logs keeps the store
// bounded — the phase-critical guardrail.

const FLUSH_MS = 10 * 60 * 1000; // persist the aggregates on a long, init-once timer

let enabled = false;
let routines = emptyRoutines();
let wakeRecordedDay = null;      // dedupe the morning wake to one per calendar day
const personState = new Map();   // entityId → last state (skip the boot snapshot)
let presentation = null;         // { source, dwelt } — the hero currently on glass

function isWeekend(now) {
  const d = now.getDay();
  return d === 0 || d === 6;
}

function minutesOfDay(now) {
  return now.getHours() * 60 + now.getMinutes();
}

function record(event) {
  observe(routines, event);
}

// Finalize the current on-screen candidate: it was shown, and dwelt iff the
// room reached DWELL while it was up. Called when the hero is replaced/cleared.
function finalizePresentation() {
  if (presentation) {
    record({ type: "attention", source: presentation.source, dwelt: presentation.dwelt });
    presentation = null;
  }
}

// ── IO (the only side effects; both fail-soft) ─────────────────

async function loadAggregates() {
  try {
    const res = await fetch("/api/routines", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return;
    const data = await res.json();
    routines = normalize(data?.routines);
  } catch {
    /* cold start — keep the empty aggregates */
  }
}

async function flush() {
  try {
    await fetch("/api/routines", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routines }),
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    /* on-device best-effort; retry next interval */
  }
}

// ── Observation (subscriptions on signals already emitted) ─────

function onPresence({ mode }) {
  const now = new Date();
  // Wake: the first GLANCE of the morning (after the night window). One per day.
  if (mode === "glance") {
    const day = now.toDateString();
    const hour = now.getHours();
    if (wakeRecordedDay !== day && hour >= 4 && hour <= 11) {
      wakeRecordedDay = day;
      record({ type: "wake", minutes: minutesOfDay(now), weekend: isWeekend(now) });
    }
  }
  // Attention: reaching DWELL means the current hero was leaned into.
  if (mode === "dwell" && presentation) {
    presentation.dwelt = true;
  }
  // Leaving the awake window (back to AMBIENT) closes the current presentation.
  if (mode === "ambient") {
    finalizePresentation();
  }
}

// The attention engine is the source of truth for what's on the glass; it emits
// attention:hero when the hero changes. Each hero is one "presentation" whose
// outcome (dwelt vs merely shown) we finalize when the next one replaces it.
function onHero({ hero }) {
  finalizePresentation();
  presentation = hero?.source ? { source: hero.source, dwelt: false } : null;
}

/* Takes the entity itself, because this now arrives on the BUS rather than as a
   `CustomEvent` on `document` — see the subscription in init for why. */
function onHaState(entity) {
  const id = String(entity?.entity_id ?? "");
  if (!id.startsWith("person.")) return;
  const state = String(entity?.state ?? "");
  const prev = personState.get(id);
  personState.set(id, state);
  if (prev === undefined) return; // the boot snapshot is not a transition

  const now = new Date();
  if (prev === "home" && state !== "home") {
    record({ type: "departure", minutes: minutesOfDay(now), weekend: isWeekend(now) });
  } else if (prev !== "home" && state === "home") {
    record({ type: "return", minutes: minutesOfDay(now), weekend: isWeekend(now) });
  }
}

// ── Advisory reads (safe before/without init → null/empty) ─────

/** Learned departure time for today's bucket (minutes-of-day), or null. */
export function learnedDeparture(now = new Date()) {
  if (!enabled) return null;
  return learnedTime(routines, "departure", isWeekend(now));
}

/**
 * The learned times the house is confident enough to state, for today's
 * bucket — `{ wake, departure, return }` in minutes-of-day, each null until
 * `predict()` clears CONF_THRESHOLD.
 *
 * ⚠⚠ THIS IS PULL-ONLY DATA AND MUST STAY THAT WAY. `docs/vision/phase-8-learn.md:81`
 * makes it an absolute rule that learning is NEVER announced — "a half-learned
 * routine that announces itself would be worse than silence" — and
 * `personality.js:39-48` enforces it by stripping "I noticed…" from every
 * candidate. This exists so the house can ANSWER "what time do we usually
 * leave?", which is a question someone chose to ask. It must never become an
 * attention candidate, a glance line, or anything the house volunteers.
 *
 * No threshold is applied here: learnedTime() already returns null below
 * CONF_THRESHOLD, and re-implementing that bar would give the house two
 * different opinions about what it is sure of.
 */
export function learnedTimes(now = new Date()) {
  if (!enabled) return { wake: null, departure: null, return: null };
  const weekend = isWeekend(now);
  return {
    wake:      learnedTime(routines, "wake", weekend),
    departure: learnedTime(routines, "departure", weekend),
    return:    learnedTime(routines, "return", weekend)
  };
}

/** The clamped per-source attention nudges the ranking may tilt by (empty when off). */
export function attentionWeights() {
  if (!enabled) return {};
  return weightsFrom(routines);
}

export function initRoutineRuntime(options = {}) {
  enabled = options.enabled === true;

  // Read-only debug hook in both states so CDP can confirm the flag.
  window.__routines = () => ({
    enabled,
    routines,
    departureWeekday: learnedTime(routines, "departure", false),
    departureWeekend: learnedTime(routines, "departure", true),
    weights: attentionWeights()
  });

  if (!enabled) return; // flag off → exact Phase 6/7 behaviour, no observation, no writes

  loadAggregates();

  on("presence:changed", onPresence);
  on("attention:hero", onHero);

  /* ⚠ THE BUS, NOT `document`. `entityFeed.js` is deliberately DOM-free so V3
     can share it; the `document` re-broadcast of `ha:state-updated` lives in
     `services/homeAssistant/events.js` (`registerHAEvents`), which the
     INCUMBENT calls and V3 does not. So this listener — the departure and
     return half of Phase 8 — heard nothing at all on the surface that ships.

     The bus carries the same payloads from the same feed, one synchronous tick
     EARLIER than the DOM copy, so the incumbent is unaffected beyond ordering.
     A shared-runtime module must subscribe where the signal actually enters the
     house; anything on `document` is incumbent-only by construction. */
  on("ha:state-updated", onHaState);

  setInterval(flush, FLUSH_MS);

  // Inject synthetic history over CDP so a learned routine can be verified
  // without waiting days (convention: __seed*). Pass an array of observe events.
  window.__seedRoutines = (history = []) => {
    for (const ev of history) observe(routines, ev);
    return window.__routines();
  };
}
