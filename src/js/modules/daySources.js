import { eventMark, triggerMark, binMark } from "../services/dayModel.js";
import { getCalendarEvents } from "./calendar.js";
import { getLastCameraTrigger } from "./cameraTiles.js";
import { on } from "../core/eventBus.js";

// What the day is made of — the live-state half of "The Day, Rendered" v2.
//
// `dayModel.js` is pure (no imports, no DOM, no storage): it decides. This file
// reads. It was lifted verbatim out of `modules/temporalSpine.js` when the
// Ambient Archive (docs/design/AMBIENT-ARCHIVE.md §6) needed the SAME day —
// across is today, back is the years — rendered on a different geometry. Two
// renderers, one day: if the spine and the archive ever disagreed about what
// happened today, the instrument would be lying about which reading is true.
//
// Every read is defensive. A dead Sonos or a lagging HA means marks simply do
// not appear: data absence renders as silence, and the wall never draws an
// error state.

let binState = null;
let wired = false;

/**
 * Subscribe to the one source that pushes rather than polls. Init-once and
 * idempotent, so both renderers may call it (CLAUDE.md kiosk discipline —
 * init-once subscriptions need no per-event teardown).
 */
export function initDaySources() {
  if (wired) return;
  wired = true;
  on("bins:updated", (data) => {
    binState = data?.due ? data : null;
  });
}

function readEventMarks(now) {
  try {
    return (getCalendarEvents() || []).map((ev) => eventMark(ev, { now })).filter(Boolean);
  } catch {
    return [];
  }
}

function readTriggerMark() {
  try {
    const t = getLastCameraTrigger();
    if (!t?.cameraName || !t?.timestamp) return null;
    const time = new Date(t.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return triggerMark({ name: t.cameraName, at: t.timestamp, label: time });
  } catch {
    return null;
  }
}

function readBinMark(now) {
  try {
    return binMark(binState || {}, { now });
  } catch {
    return null;
  }
}

/** Every domain that has geometry today, as one flat list of marks. */
export function readDayMarks(now = new Date()) {
  return [readTriggerMark(), readBinMark(now), ...readEventMarks(now)].filter(Boolean);
}

/** Teardown parity for `stopTemporalSpine()` — the tests' seam. */
export function resetDaySources() {
  binState = null;
}
