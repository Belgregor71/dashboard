/* ═══════════════════════════════════════════════════════════════════════════
   TIMERS — the one thing in this house with a clock it can ring.

   docs/research/FIELD-SCAN.md, round 1 (features.voiceTimers). Every commercial
   assistant does this and this wall could not: "set a timer" opened with a verb
   the mutation guard hands to Assist, and Assist's timers live on voice
   satellites, not on a conversation posted from a browser.

   ── Two registers, as health.js has ─────────────────────────────────────────
   A running timer is a STATE, so it is a pill: measured, uppercase, tabular,
   its own ground. A finished timer is NEWS somebody asked for, so it is said
   out loud — and, owner's call 2026-09-15, said again every 30 s up to three
   times, or until someone says "stop". Kitchen-timer insistence, bounded.

   ⚠ IT NEVER GOES THROUGH announce(). A timer is not a candidate for the glance
   and must not compete with the doorbell for one cell; it owns one node that
   nothing else writes, which is the health pill's guarantee.

   ── Corner ──────────────────────────────────────────────────────────────────
   Top-right (owner, 2026-09-15). That corner belongs to the transcript, so the
   pill steps out of the way while `.heard` is on the glass (compose.css) and
   stands down at depth 3 like the fault pill. `.heard` lingers seconds; a timer
   runs minutes.

   ── Memory discipline ───────────────────────────────────────────────────────
   One setTimeout per timer, cleared on fire or cancel. ONE 1 s interval for the
   countdown, created with the first live timer and cleared with the last — so a
   house with no timers runs no interval at all. Capped at MAX_TIMERS.

   ⚠ A RELOAD WOULD DROP EVERY TIMER, and deploys reload the kiosk. So the set is
   mirrored to localStorage as absolute end times and re-armed at boot. A timer
   that ended while the page was down rings once if it is recent, and is
   dropped silently if it is not — a "your timer's done" twenty minutes late is
   not a timer, it is a non sequitur.
   ═══════════════════════════════════════════════════════════════════════════ */

import { speak } from "../../js/core/tts.js";
import { setPhase, trackSpeech } from "./presence-light.js";
import { record } from "./feature-census.js";
import {
  MAX_TIMERS, MAX_MS, RING_EVERY_MS, RING_TIMES, LATE_RING_MS,
  durationPhrase, remainingPhrase, clockText
} from "./timer-words.js";

const STORE_KEY = "v3.timers";
const PILL_ID = "timers";
const LABEL_ID = "timers-label";
const TIME_ID = "timers-time";

let enabled = false;
let nextId = 1;
/** @type {Map<number, {id:number, kind:"timer"|"reminder", label:string|null, text:string|null, endsAt:number, handle:any}>} */
const live = new Map();
/** @type {Map<number, {id:number, kind:string, label:string|null, text:string|null, rung:number, handle:any}>} */
const ringing = new Map();
let tick = null;
// Read per call so a spec's page.clock governs it.
const now = () => Date.now();

/* ── Words ─────────────────────────────────────────────────────────────────── */

const nameOf = (t) => (t.kind === "reminder" ? "reminder" : t.label ? `${t.label} timer` : "timer");

function doneLine(t) {
  if (t.kind === "reminder") return `Reminder — ${t.text}.`;
  return t.label ? `The ${t.label} timer's done.` : "Timer's done.";
}

/* ── Persistence ─────────────────────────────────────────────────────────────
   Wrapped in try on both sides: a kiosk profile with storage blocked must still
   keep time for the life of the page, it just cannot survive a reload. */

function persist() {
  try {
    const rows = [...live.values()].map(({ kind, label, text, endsAt }) => ({ kind, label, text, endsAt }));
    if (rows.length) localStorage.setItem(STORE_KEY, JSON.stringify(rows));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* storage unavailable — timers still run, they just do not survive a reload */ }
}

function restore() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows)) return;
  const t0 = now();
  for (const row of rows.slice(0, MAX_TIMERS)) {
    const endsAt = Number(row?.endsAt);
    if (!Number.isFinite(endsAt)) continue;
    const kind = row.kind === "reminder" ? "reminder" : "timer";
    const label = typeof row.label === "string" ? row.label.slice(0, 40) : null;
    const text = typeof row.text === "string" ? row.text.slice(0, 120) : null;
    if (endsAt > t0) {
      arm({ kind, label, text, endsAt });
    } else if (t0 - endsAt <= LATE_RING_MS) {
      // Ended while the page was down, recently enough to still mean something.
      // Rung once rather than three times: it is already late.
      ring({ id: nextId++, kind, label, text }, RING_TIMES - 1);
    }
  }
  persist();
}

/* ── Arming, ringing ─────────────────────────────────────────────────────── */

function arm({ kind, label, text, endsAt }) {
  const id = nextId++;
  const timer = { id, kind, label, text, endsAt, handle: null };
  timer.handle = setTimeout(() => fire(id), Math.max(0, endsAt - now()));
  live.set(id, timer);
  ensureTick();
  return timer;
}

function fire(id) {
  const t = live.get(id);
  if (!t) return;
  clearTimeout(t.handle);
  live.delete(id);
  persist();
  ring({ id: t.id, kind: t.kind, label: t.label, text: t.text }, 0);
}

function ring(t, alreadyRung) {
  const entry = { ...t, rung: alreadyRung, handle: null };
  ringing.set(entry.id, entry);
  sayDone(entry);
  ensureTick();
  paint();
}

function sayDone(entry) {
  entry.rung += 1;
  record("spoke", "timer", "said");
  setPhase("speaking");
  speak(doneLine(entry), { onAudio: (audio) => trackSpeech(audio) })
    .then(() => setPhase("idle"), () => setPhase("idle"));
  /* The next repeat, or — after the last — the moment the pill lets go. The
     same handle either way, so dismissal is one clearTimeout. */
  entry.handle = setTimeout(() => {
    if (!ringing.has(entry.id)) return;
    if (entry.rung < RING_TIMES) sayDone(entry);
    else settle(entry.id);
  }, RING_EVERY_MS);
}

function settle(id) {
  const entry = ringing.get(id);
  if (!entry) return;
  clearTimeout(entry.handle);
  ringing.delete(id);
  maybeStopTick();
  paint();
}

function ensureTick() {
  if (tick || (live.size === 0 && ringing.size === 0)) return;
  tick = setInterval(paint, 1000);
}

function maybeStopTick() {
  if (tick && live.size === 0 && ringing.size === 0) {
    clearInterval(tick);
    tick = null;
  }
}

/* ── The pill ────────────────────────────────────────────────────────────────
   Idempotent: this runs once a second while anything is live, so it writes a
   node only when the words on it changed. `hidden`, not opacity, so the
   contrast sweep cannot measure a pill that is not there. */

function soonest() {
  let best = null;
  for (const t of live.values()) if (!best || t.endsAt < best.endsAt) best = t;
  return best;
}

export function pillState() {
  const firstRinging = ringing.values().next().value;
  if (firstRinging) {
    return {
      ringing: true,
      label: firstRinging.kind === "reminder" ? "Reminder" : (firstRinging.label ?? "Timer"),
      time: "Done",
      more: live.size + ringing.size - 1
    };
  }
  const t = soonest();
  if (!t) return null;
  return {
    ringing: false,
    label: t.kind === "reminder" ? "Reminder" : (t.label ?? "Timer"),
    time: clockText(t.endsAt - now()),
    more: live.size - 1
  };
}

function paint(state = pillState()) {
  const node = typeof document !== "undefined" ? document.getElementById(PILL_ID) : null;
  if (!node) return null;
  if (!state) {
    if (!node.hidden) {
      node.hidden = true;
      delete node.dataset.ringing;
    }
    return null;
  }
  const label = document.getElementById(LABEL_ID);
  const time = document.getElementById(TIME_ID);
  const words = state.more > 0 ? `${state.label} +${state.more}` : state.label;
  if (label && label.textContent !== words) label.textContent = words;
  if (time && time.textContent !== state.time) time.textContent = state.time;
  const r = state.ringing ? "1" : "0";
  if (node.dataset.ringing !== r) node.dataset.ringing = r;
  if (node.hidden) node.hidden = false;
  return words;
}

/* ── The lane's API (voice.js) ───────────────────────────────────────────────
   Every function returns the SENTENCE to say, or null to fall through. */

/** @returns {string|null} */
export function handleTimerIntent(intent) {
  if (!enabled || !intent?.id) return null;
  const slots = intent.slots ?? {};

  if (intent.id === "timer.set" || intent.id === "reminder.set") {
    const kind = intent.id === "reminder.set" ? "reminder" : "timer";
    if (slots.ms == null) return "Say how long — like, set a timer for ten minutes.";
    if (slots.ms > MAX_MS) return "I can only keep time for up to twelve hours.";
    if (slots.ms < 1000) return null;
    if (live.size >= MAX_TIMERS) return `That's ${MAX_TIMERS} running already — cancel one first.`;
    const t = arm({
      kind,
      label: kind === "timer" ? (slots.label ?? null) : null,
      text: kind === "reminder" ? String(slots.text ?? "").slice(0, 120) : null,
      endsAt: now() + slots.ms
    });
    persist();
    paint();
    if (kind === "reminder") return `OK — in ${durationPhrase(slots.ms)}.`;
    return t.label
      ? `${t.label[0].toUpperCase()}${t.label.slice(1)}, ${durationPhrase(slots.ms)}.`
      : `${durationPhrase(slots.ms)}, starting now.`.replace(/^./, (c) => c.toUpperCase());
  }

  if (intent.id === "timer.cancel") {
    // Ringing first: "stop" means THIS noise, whatever else is running.
    if (ringing.size > 0 && (slots.bare || !slots.label || slots.all)) {
      for (const id of [...ringing.keys()]) settle(id);
      return slots.bare ? "" : "OK.";
    }
    if (slots.bare) return null;

    const matches = [...live.values()].filter((t) =>
      slots.all ? (slots.kind === "reminder" ? t.kind === "reminder" : true)
        : slots.label ? t.label === slots.label
        : t.kind === slots.kind
    );
    if (matches.length === 0) {
      if (!slots.named) return null;
      return slots.label ? `There's no ${slots.label} timer.` : `There's no ${slots.kind} running.`;
    }
    /* One unnamed timer among several: cancelling the wrong one is worse than
       asking. Name them instead. */
    if (!slots.all && !slots.label && matches.length > 1) {
      return `Which one — the ${matches.map((t) => nameOf(t)).join(" or the ")}?`;
    }
    for (const t of matches) {
      clearTimeout(t.handle);
      live.delete(t.id);
    }
    persist();
    maybeStopTick();
    paint();
    if (matches.length > 1) return `Cancelled ${matches.length}.`;
    const only = matches[0];
    return `${nameOf(only)[0].toUpperCase()}${nameOf(only).slice(1)} cancelled.`;
  }

  if (intent.id === "timer.query") {
    const all = [...live.values()].sort((a, b) => a.endsAt - b.endsAt);
    const pool = slots.label ? all.filter((t) => t.label === slots.label) : all;
    if (pool.length === 0) {
      // "how much time is left" with nothing running is probably not about us.
      return slots.label ? `There's no ${slots.label} timer.` : null;
    }
    const lines = pool.slice(0, 2).map((t) =>
      `${remainingPhrase(t.endsAt - now())} on the ${nameOf(t)}`);
    const said = lines.join(", and ");
    return `${said[0].toUpperCase()}${said.slice(1)}.`;
  }

  return null;
}

export function timersSnapshot() {
  return {
    enabled,
    live: [...live.values()].map(({ id, kind, label, text, endsAt }) => ({ id, kind, label, text, remainingMs: endsAt - now() })),
    ringing: [...ringing.values()].map(({ id, kind, label, rung }) => ({ id, kind, label, rung })),
    ticking: tick !== null
  };
}

/** Everything off, nothing left armed. Tests and flag-off teardown. */
export function resetTimers() {
  for (const t of live.values()) clearTimeout(t.handle);
  for (const r of ringing.values()) clearTimeout(r.handle);
  live.clear();
  ringing.clear();
  if (tick) clearInterval(tick);
  tick = null;
  persist();
  paint(null);
}

export function initTimers({ enabled: on = false } = {}) {
  enabled = Boolean(on);

  /* Registered before anything async, and whether or not the flag is on: the
     contrast sweep has to be able to put this pill on the glass to measure it,
     and a spec has to be able to read the teardown. `paint` takes a state so a
     sweep can paint a pill without arming a real timer. */
  window.__v3Timers = {
    snapshot: timersSnapshot,
    paint: (state) => paint(state ?? null),
    reset: resetTimers
  };

  if (!enabled) return;
  restore();
  paint();
}
