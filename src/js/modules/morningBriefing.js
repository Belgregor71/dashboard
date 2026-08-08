import { wakeScreensaver, resetIdleTimer } from "./screensaver.js";
import { speak } from "../core/tts.js";
import { generateBriefing } from "./aiBriefing.js";
import { switchView } from "../core/viewManager.js";
import { dueBriefing, hasFiredToday, markFired } from "../services/briefingSchedule.js";

// WHEN a briefing is due now lives in services/briefingSchedule.js, shared with
// V3's briefing window. This module keeps what only the incumbent has: waking
// the screensaver, switching to the briefing view, and speaking it.
const STORAGE_KEY = "dashboard:briefing-fired";

// ── Trigger ────────────────────────────────────────────────────

async function prefetch(schedule) {
  try { await generateBriefing({ type: schedule.type }); }
  catch { /* fall back to a live fetch at fire time */ }
}

async function trigger(schedule) {
  wakeScreensaver();
  resetIdleTimer();
  switchView("briefing", { force: true }); // scheduled briefing event — past the Phase 7 gate

  try {
    const summary = await generateBriefing({ type: schedule.type });
    if (summary) await speak(summary, { rate: schedule.rate });
  } catch { /**/ }
}

// ── Tick (called every 30s, and once on init) ───────────────────
// Generating ahead of the scheduled time absorbs AI latency (cold Ollama loads
// have taken 60s+) so speech starts immediately when the schedule fires.
// generateBriefing caches per type and dedupes in-flight calls, so repeated
// ticks in the lead window are harmless and the trigger (and the briefing view)
// reuse the exact summary that was prefetched.

function tick() {
  const due = dueBriefing({ hasFired: (name) => hasFiredToday(STORAGE_KEY, name) });
  if (!due) return;

  if (due.phase === "prefetch") {
    prefetch(due.schedule);
    return;
  }

  markFired(STORAGE_KEY, due.schedule.name);
  trigger(due.schedule);
}

// ── Init ───────────────────────────────────────────────────────

export function initMorningBriefing() {
  tick();
  setInterval(tick, 30_000);
}
