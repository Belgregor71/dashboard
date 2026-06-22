import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { generateBriefing } from "./aiBriefing.js";
import { switchView } from "../core/viewManager.js";

const SCHEDULES = [
  { name: "morning-weekday", days: [1, 2, 3, 4, 5], hour: 5,  minute: 35, type: "morning", rate: 0.90 },
  { name: "morning-weekend", days: [0, 6],           hour: 7,  minute: 30, type: "morning", rate: 0.90 },
  { name: "evening",         days: [0, 1, 2, 3, 4, 5, 6], hour: 18, minute: 0,  type: "evening", rate: 0.92 },
];

const STORAGE_KEY   = "dashboard:briefing-fired";
const CATCHUP_MS    = 30 * 60 * 1000; // fire a missed briefing if within 30 min

// Ollama has been observed taking 60s+ to respond (likely a cold model
// load), which left the briefing view sitting in dead air. Generating
// ahead of the scheduled time absorbs that latency so speech starts
// immediately when the schedule actually fires.
const PREFETCH_LEAD_MS = 3 * 60 * 1000;
const prefetched       = new Map(); // schedule.name -> summary
const prefetchInFlight  = new Set(); // schedule.name

// ── Persistent storage ─────────────────────────────────────────

function getFired() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

function hasFiredToday(name) {
  return getFired()[name] === new Date().toDateString();
}

function markFired(name) {
  try {
    const data = getFired();
    data[name] = new Date().toDateString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

// ── Trigger ────────────────────────────────────────────────────

async function prefetch(schedule) {
  if (prefetched.has(schedule.name) || prefetchInFlight.has(schedule.name)) return;
  prefetchInFlight.add(schedule.name);
  try {
    const summary = await generateBriefing({ type: schedule.type });
    if (summary) prefetched.set(schedule.name, summary);
  } catch { /* fall back to a live fetch at fire time */ }
  finally { prefetchInFlight.delete(schedule.name); }
}

async function trigger(schedule) {
  wakeScreensaver();
  resetIdleTimer();
  switchView("briefing");

  try {
    const summary = prefetched.get(schedule.name) ?? await generateBriefing({ type: schedule.type });
    prefetched.delete(schedule.name);
    if (summary) await speak(summary, { rate: schedule.rate });
  } catch { /**/ }
}

// ── Tick (called every 30s, and once on init) ───────────────────
// Fires a schedule any time within CATCHUP_MS *after* its target time,
// rather than requiring an exact hour:minute match. A busy main thread
// (screensaver, camera tiles, ticker, etc.) can stall the 30s interval
// long enough to skip a single exact-minute window, so this also
// covers a briefing missed while the page was unloaded/reloaded.

function tick() {
  const now      = new Date();
  const day      = now.getDay();
  const nowMs    = now.getHours() * 3_600_000 + now.getMinutes() * 60_000 + now.getSeconds() * 1000;

  for (const schedule of SCHEDULES) {
    if (!schedule.days.includes(day)) continue;
    if (hasFiredToday(schedule.name)) continue;

    const schedMs  = schedule.hour * 3_600_000 + schedule.minute * 60_000;
    const deltaMs  = nowMs - schedMs;

    if (deltaMs >= -PREFETCH_LEAD_MS && deltaMs < 0) {
      prefetch(schedule);
      continue;
    }

    if (deltaMs >= 0 && deltaMs <= CATCHUP_MS) {
      markFired(schedule.name);
      trigger(schedule);
      return; // fire one at a time
    }
  }
}

// ── Init ───────────────────────────────────────────────────────

export function initMorningBriefing() {
  tick();
  setInterval(tick, 30_000);
}
