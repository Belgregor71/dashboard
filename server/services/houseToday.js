/* ═══ TODAY, ANSWERED — HOUSE-MIND S7 (docs/design/HOUSE-MIND.md §S7) ═════════
   House Lately works by the DAY. Nothing held today's timed facts about the
   WORLD: "the sky turned to rain about 17:30", "the rain chance went past 50%
   about 07:10". This is that, and nothing more.

   ── What is in it, and what never is ────────────────────────────────────────
     condition      the observed condition changed (from → to)
     rain-chance    today's rain chance crossed 50% (up or down)
   Both come from the S2 store's `weather` read (/api/weather/now), which the
   store already makes every five minutes — so a time here is "when the house
   noticed", accurate to about five minutes, and is phrased that way.

   ⛔ NEVER: who was home, who left or arrived, presence, anything a voice turn
   said. phase-8's "aggregates-not-logs" forbids a timed log about the
   residents; this is a timed log about the sky. An entry is rebuilt from two
   whitelisted shapes below, so no other field can ride in.

   ⚠ The nowcast is NOT a source. It only ever describes rain in the FUTURE
   (weatherService.normalizeNowcast skips the current block), so "it started
   raining" read off it would be a forecast reported as an event.

   ── Answered, never announced ───────────────────────────────────────────────
   The only reader is /api/voice/converse. Nothing here raises a candidate, a
   glance line or a spoken remark (houseLately.js states the same rule).

   ── Bounds ──────────────────────────────────────────────────────────────────
   Today only: the fold resets at the house day's rollover. At most MAX_ENTRIES,
   newest kept. In memory only — a restart (every deploy) starts the day again,
   which is why `since` is carried and stated: the house can say what it saw
   after that time and must say nothing about before it.

   ⚠ A TAP, NOT A SUBSCRIPTION. houseStore polls only while somebody is
   subscribed; subscribing here would keep it polling forever. tap() listens to
   reads that were happening anyway and never starts one.

   Flag: HOUSE_TODAY=1, read per call (server.js's imports evaluate before its
   dotenv.config()). Off: nothing is folded and nothing reaches the prompt.
   ═══════════════════════════════════════════════════════════════════════════ */

import { tap } from "./houseStore.js";
import { houseDay } from "./weatherHistory.js";

export const MAX_ENTRIES = 48;
export const RAIN_CHANCE_BAR = 50;

export function emptyToday() {
  return { day: null, since: null, condition: null, rainOver: null, entries: [] };
}

/**
 * Fold one store read into the day. Pure — returns the next state.
 * @param {object} state  emptyToday()'s shape
 * @param {string} key    the store key the read was for
 * @param {{value: any, at: number}} entry
 */
export function foldObservation(state, key, entry) {
  if (key !== "weather" || !entry || !Number.isFinite(entry.at)) return state;
  const now = entry.value?.now ?? entry.value;
  const label = typeof now?.condition?.label === "string" ? now.condition.label.trim() : "";
  // The route's fallback payload ("Unavailable", code null) is not a sky.
  const condition = label && now?.condition?.code != null ? label : null;
  const pct = typeof now?.rain_chance_pct === "number" && Number.isFinite(now.rain_chance_pct) ? now.rain_chance_pct : null;
  if (condition === null && pct === null) return state;

  const day = houseDay(new Date(entry.at));
  /* A new day keeps what the sky WAS (so the first change of the day has a
     "from") and forgets what happened. */
  const next = state.day === day
    ? { ...state, entries: state.entries.slice() }
    : { ...state, day, since: entry.at, entries: [] };

  if (condition !== null) {
    if (next.condition !== null && next.condition !== condition) {
      next.entries.push({ at: entry.at, kind: "condition", from: next.condition, to: condition });
    }
    next.condition = condition;
  }

  if (pct !== null) {
    const over = pct >= RAIN_CHANCE_BAR;
    if (next.rainOver !== null && next.rainOver !== over) {
      next.entries.push({ at: entry.at, kind: "rain-chance", direction: over ? "up" : "down", pct: Math.round(pct) });
    }
    next.rainOver = over;
  }

  if (next.entries.length > MAX_ENTRIES) next.entries = next.entries.slice(next.entries.length - MAX_ENTRIES);
  return next;
}

let state = emptyToday();

function enabled() {
  return process.env.HOUSE_TODAY === "1";
}

tap((key, entry) => {
  if (!enabled()) return;
  state = foldObservation(state, key, entry);
});

/**
 * What the house noticed about the world today, for /converse. Null when the
 * flag is off or nothing has been observed today.
 * @returns {{day: string, since: number, entries: object[]} | null}
 */
export function todayClaims(now = new Date()) {
  if (!enabled()) return null;
  if (state.day === null || state.day !== houseDay(now)) return null;
  return { day: state.day, since: state.since, entries: state.entries.map((e) => ({ ...e })) };
}

/** Test seam. */
export function __resetHouseToday() {
  state = emptyToday();
}
