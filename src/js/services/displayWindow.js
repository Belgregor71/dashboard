/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by V3 (/v3/) ONLY. It lives in `src/js/` for history, not because
   the incumbent uses it — so deleting it with "the old dashboard" breaks V3
   alone, and nothing on / goes wrong to warn you.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   THE OFF-WINDOW — when the panel is powered down, as one answer.

   Extracted from server/routes/display.js so both sides of the wire agree about
   what "night" means for the PANEL. That is a different night from every other
   night in this house: main.js takes its night from solar altitude, presence.js
   takes its linger from the same, and neither of them has anything to do with
   the crontab that actually cuts the backlight at 21:00.

   The precedent is alertRouter / mediaImage / briefingSchedule — two surfaces,
   one answer. Here the two surfaces are the server (which runs `xset` and owns
   DISPLAY_OFF_START/END) and V3 (which must know whether the thing it is
   drawing to is switched on). A second copy of the midnight-wrap arithmetic in
   the browser would be a copy that drifts the first time the env changes.

   Pure and DOM-free on purpose: the server imports it too, so nothing in here
   may touch `window`, and it must not import express.
   ═══════════════════════════════════════════════════════════════════════════ */

/** "21:00" → 1260. Null for anything that is not a real time of day. */
export function toMinutes(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Is `now` inside the panel's off-window?
 *
 * The window wraps midnight, so the naive `start <= now < end` is wrong for
 * every real setting of it — 21:00→05:00 would match nothing at all.
 *
 * Fails SAFE in both directions, which matters because two different callers
 * act on it: an unparseable or degenerate window answers `false`, so the server
 * never powers the panel down at an arbitrary hour and V3 never pauses the
 * atmosphere on a panel that is plainly lit.
 */
export function isWithinOffWindow(now, start, end) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (s === e) return false;              // degenerate: never off
  if (s < e) return minutes >= s && minutes < e;
  return minutes >= s || minutes < e;     // wraps midnight (21:00 → 05:00)
}
