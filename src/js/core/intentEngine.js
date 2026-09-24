/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

import { get as getContext, set as setContext } from "./contextStore.js";
import { on } from "./eventBus.js";
import { getAllEntities } from "../services/homeAssistant/state.js";
import { deriveIntent, settleCategory, NEUTRAL_INTENT } from "../services/houseModel.js";
import { learnedDeparture } from "./routineRuntime.js";
import { storeFresh } from "../services/houseStream.js";

// The intent runtime — Phase 6 (docs/vision/phase-6-intent.md). It gathers the
// live inputs (context store + calendar + person.* state), calls the pure House
// Model, applies a settle/hysteresis guard so the posture can't flap, and writes
// the result to the store + body dataset + the bus. It reasons only — it renders
// nothing new; the attention gate reads the posture, later phases dress to it.
//
// Leak discipline (CLAUDE.md 24/7 kiosk): every listener/interval is registered
// once at init behind the flag. There is no per-event UI surface.

const RECOMPUTE_MS = 60 * 1000;       // re-derive the posture once a minute
const CAL_REFRESH_MS = 5 * 60 * 1000; // re-read today's events every 5 min
const SETTLE_MS = 90 * 1000;          // a categorical change must hold this long

let enabled = false;
let committed = { ...NEUTRAL_INTENT };
let pending = null;      // settle state: { cat, since } | null
let override = null;     // __forceIntent patch — held across ticks until cleared
let events = [];         // today's upcoming events, [{ start: Date }]
let lastInputs = null;   // for the __intent debug hook

function countPeopleHome() {
  return Object.values(getAllEntities()).filter(
    (e) => e?.entity_id?.startsWith("person.") && e.state === "home"
  ).length;
}

/* ── HOUSE-MIND S2: the observation store (features.v3HouseStoreIntent) ──────
   With the flag on, the store's calendar pushes land here as they arrive, and
   the 5-min refresh skips its own fetch while the store is fresh (the fallback
   rule is services/houseStream.js's). A fetch that resolves after the store
   delivered is dropped. Flag read per push and per refresh, never at load:
   ES imports hoist above /js/config.js. Flag off: every refresh fetches, and a
   push is ignored, exactly as before. */
const STORE_FLAG = "v3HouseStoreIntent";
let calendarFrom = null; // "store" | "fetch" — where the held events came from

function storeOn() {
  return Boolean(globalThis.window?.CONFIG?.features?.[STORE_FLAG]);
}

// Today's still-upcoming events, so timeBudget can name the next thing that
// matters. Mirrors arrivalGreeting's read. One writer for both paths.
function setEventsFrom(data, from) {
  if (!data) return;
  const now = new Date();
  const dayStr = now.toDateString();
  events = (data.events ?? data ?? [])
    .map((ev) => ({ start: new Date(ev.start ?? ev.startDate ?? ev.date) }))
    .filter((ev) => !Number.isNaN(ev.start.getTime()) && ev.start.toDateString() === dayStr && ev.start > now);
  calendarFrom = from;
}

function onObservation({ key, value } = {}) {
  if (key !== "calendar" || !storeOn()) return;
  setEventsFrom(value, "store");
}

// Keeps the last-known list on failure.
async function refreshEvents() {
  const viaStore = storeOn();
  if (viaStore && storeFresh("calendar")) return;
  try {
    const res = await fetch("/api/calendar/all", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return;
    const data = await res.json();
    if (viaStore && storeFresh("calendar")) return;
    setEventsFrom(data, "fetch");
  } catch {
    /* keep the last-known events */
  }
}

function categoricalsOf(i) {
  return { activity: i.activity, tempo: i.tempo, company: i.company };
}

function apply(next, reason) {
  const prev = committed;
  const catChanged =
    next.activity !== prev.activity || next.tempo !== prev.tempo || next.company !== prev.company;
  // dayCharacter/season are not settled (they turn over at clean boundaries, not
  // noisy motion) but still mark the posture stale so the store stays fresh.
  const changed =
    catChanged ||
    next.timeBudget !== prev.timeBudget ||
    next.dayCharacter !== prev.dayCharacter ||
    next.season !== prev.season;
  if (!changed) return;

  committed = next;
  setContext({ intent: next });
  document.body.dataset.intent = next.activity;
  document.body.dataset.tempo = next.tempo;
  /* `intent:changed` used to be emitted here and had no subscriber on either
     surface; removed 2026-09-22 (docs/design/HOUSE-MIND.md, S0). The posture's
     channel is contextStore — every reader already takes it from there. */
}

function recompute() {
  if (!enabled) return;
  const now = new Date();
  const ctx = getContext();
  const peopleHome = countPeopleHome();

  const derived = deriveIntent({
    presence: ctx.presence,
    lastMotionAt: ctx.lastMotionAt,
    isNight: ctx.isNight,
    condition: ctx.condition,
    events,
    peopleHome,
    // Phase 8 — a confident learned departure sharpens the budget when the
    // calendar is silent (null when routineLearning is off → unchanged).
    learnedDeparture: learnedDeparture(now),
    now
  });
  lastInputs = { presence: ctx.presence, isNight: ctx.isNight, peopleHome, events: events.length };

  // Settle the categorical dims (anti-flap); timeBudget flows through immediately.
  const settled = settleCategory(
    { committed: categoricalsOf(committed), pending },
    categoricalsOf(derived),
    now.getTime(),
    SETTLE_MS
  );
  pending = settled.pending;

  let next = {
    ...settled.committed,
    timeBudget: derived.timeBudget,
    dayCharacter: derived.dayCharacter,
    season: derived.season
  };
  // A forced posture wins and holds across ticks until cleared with null.
  if (override) next = { ...next, ...override };

  apply(next, override ? "debug" : settled.changed ? "settled" : "tick");
}

export function initIntent(options = {}) {
  enabled = options.enabled === true;

  // Read-only debug hook exists in both states so CDP can confirm the flag.
  window.__intent = () => ({ enabled, intent: committed, inputs: lastInputs, override, calendarFrom, events: events.length });

  if (!enabled) return; // flag off → exact Phase 5 behaviour

  document.body.dataset.intent = committed.activity;
  document.body.dataset.tempo = committed.tempo;
  setContext({ intent: committed });

  // Attached before the first fetch and before V3 opens the stream, so the
  // held snapshot never arrives unheard. Checks its flag per push.
  on("house:observation", onObservation);
  refreshEvents();
  setInterval(refreshEvents, CAL_REFRESH_MS);
  // Run the 5-min calendar refresh now, for CDP and specs: the boot read always
  // precedes the stream, so only a refresh can show the store-fresh skip.
  window.__intentRefreshCalendar = () => refreshEvents();

  recompute();
  setInterval(recompute, RECOMPUTE_MS);
  // Presence flips are the main live signal — re-derive immediately (registered
  // once; presence:changed is emitted by presence.js, never by us, so no loop).
  on("presence:changed", recompute);

  // Force a posture over CDP to drive the gate for verification (convention:
  // __presence / __atmosphere). Pass null to clear the override.
  window.__forceIntent = (patch) => {
    override = patch == null ? null : { ...(override || {}), ...patch };
    recompute();
    return { override, intent: committed };
  };
}
