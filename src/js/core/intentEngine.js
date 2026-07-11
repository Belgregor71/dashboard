import { get as getContext, set as setContext } from "./contextStore.js";
import { on, emit } from "./eventBus.js";
import { getAllEntities } from "../services/homeAssistant/state.js";
import { deriveIntent, settleCategory, NEUTRAL_INTENT } from "../services/houseModel.js";

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

// Today's still-upcoming events, so timeBudget can name the next thing that
// matters. Mirrors arrivalGreeting's read; keeps the last-known list on failure.
async function refreshEvents() {
  try {
    const res = await fetch("/api/calendar/all", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return;
    const data = await res.json();
    const now = new Date();
    const dayStr = now.toDateString();
    events = (data.events ?? data ?? [])
      .map((ev) => ({ start: new Date(ev.start ?? ev.startDate ?? ev.date) }))
      .filter((ev) => !Number.isNaN(ev.start.getTime()) && ev.start.toDateString() === dayStr && ev.start > now);
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
  const changed = catChanged || next.timeBudget !== prev.timeBudget;
  if (!changed) return;

  committed = next;
  setContext({ intent: next });
  document.body.dataset.intent = next.activity;
  document.body.dataset.tempo = next.tempo;
  if (catChanged) emit("intent:changed", { intent: next, prev, reason });
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

  let next = { ...settled.committed, timeBudget: derived.timeBudget };
  // A forced posture wins and holds across ticks until cleared with null.
  if (override) next = { ...next, ...override };

  apply(next, override ? "debug" : settled.changed ? "settled" : "tick");
}

export function initIntent(options = {}) {
  enabled = options.enabled === true;

  // Read-only debug hook exists in both states so CDP can confirm the flag.
  window.__intent = () => ({ enabled, intent: committed, inputs: lastInputs, override });

  if (!enabled) return; // flag off → exact Phase 5 behaviour

  document.body.dataset.intent = committed.activity;
  document.body.dataset.tempo = committed.tempo;
  setContext({ intent: committed });

  refreshEvents();
  setInterval(refreshEvents, CAL_REFRESH_MS);

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
