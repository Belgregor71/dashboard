/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   BRIEFING SCHEDULE — when a briefing is due, and nothing else.

   Extracted from modules/morningBriefing.js for the same reason
   services/alertRouter.js was extracted from modules/doorbellAlert.js in
   Phase 3: two surfaces now need the same decision, and the incumbent's copy
   is entangled with the screensaver and the view manager, neither of which
   exists in V3.

   The incumbent's behaviour is deliberately unchanged. This file is the
   original tick() logic moved verbatim and made pure; morningBriefing.js keeps
   the waking, the view switch and the speech.

   ── The one thing that is NOT shared: which briefings have fired ────────────

   `firedKey` is a parameter rather than a constant. Both surfaces are served
   from the same origin, so they share a localStorage namespace whenever they
   share a Chromium profile — and a single key would mean the incumbent firing
   its 5:35 briefing silently marks V3's as already done (or the reverse). They
   are different screens showing it to the same person, but a lab surface must
   not be able to eat the wall's briefing, so each carries its own record.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Weekday mornings are early because the household is; weekends are not. The
   evening briefing is the day's other end and runs every day. */
export const BRIEFING_SCHEDULES = Object.freeze([
  { name: "morning-weekday", days: [1, 2, 3, 4, 5], hour: 5,  minute: 35, type: "morning", rate: 0.90 },
  { name: "morning-weekend", days: [0, 6],          hour: 7,  minute: 30, type: "morning", rate: 0.90 },
  { name: "evening",         days: [0, 1, 2, 3, 4, 5, 6], hour: 18, minute: 0, type: "evening", rate: 0.92 }
]);

/* Fire a missed briefing any time within this window AFTER its target. A busy
   main thread can stall a 30 s interval past an exact-minute match, and a page
   that was reloaded through 5:35 would otherwise skip the day entirely. */
export const CATCHUP_MS = 30 * 60 * 1000;

/* Start generating before the target so AI latency is absorbed rather than
   heard as silence. A cold Ollama load has taken 60 s+. */
export const PREFETCH_LEAD_MS = 3 * 60 * 1000;

/**
 * What, if anything, the schedule wants right now.
 *
 * @param {object}   [opts]
 * @param {Date}     [opts.now]         injectable clock
 * @param {Function} [opts.hasFired]    (name) => boolean — already done today
 * @returns {{schedule: object, phase: "prefetch"|"fire"}|null}
 *          `prefetch` means "warm the summary, do not show anything"; `fire`
 *          means "this is the moment".
 *
 * A `fire` anywhere in the table beats a `prefetch`, which is what the original
 * loop did by walking past prefetch matches and returning on the first fire.
 * With the current schedules the two can never be live at the same instant —
 * the gaps are 115 and 630 minutes against a 3-minute lead — but encoding the
 * precedence means a fourth schedule cannot quietly starve a real briefing.
 */
export function dueBriefing({ now = new Date(), hasFired = () => false } = {}) {
  const day = now.getDay();
  const nowMs =
    now.getHours() * 3_600_000 + now.getMinutes() * 60_000 + now.getSeconds() * 1000;

  let prefetch = null;

  for (const schedule of BRIEFING_SCHEDULES) {
    if (!schedule.days.includes(day)) continue;
    if (hasFired(schedule.name)) continue;

    const deltaMs = nowMs - (schedule.hour * 3_600_000 + schedule.minute * 60_000);

    if (deltaMs >= 0 && deltaMs <= CATCHUP_MS) return { schedule, phase: "fire" };
    if (deltaMs >= -PREFETCH_LEAD_MS && deltaMs < 0 && !prefetch) {
      prefetch = { schedule, phase: "prefetch" };
    }
  }
  return prefetch;
}

/* ── The fired-today record ─────────────────────────────────────────────────
   Keyed by day string rather than by timestamp: "has this fired today" is the
   real question, and a date string answers it across a reload, a timezone
   change and a clock adjustment without arithmetic.
─────────────────────────────────────────────────────────────────────────── */

function readFired(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}"); }
  catch { return {}; }
}

export function hasFiredToday(key, name, now = new Date()) {
  return readFired(key)[name] === now.toDateString();
}

export function markFired(key, name, now = new Date()) {
  try {
    const data = readFired(key);
    data[name] = now.toDateString();
    localStorage.setItem(key, JSON.stringify(data));
  } catch { /* a full or blocked store must never stop the briefing itself */ }
}
