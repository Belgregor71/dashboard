/* ═══════════════════════════════════════════════════════════════════════════
   DEPTH — the only navigation in V3.

   There is no router, no view registry and no history. There is one number,
   0..3, and two verbs: something pushes you deeper, silence lets you recede.

   The rule that makes it work: RECESSION IS ALWAYS AUTOMATIC AND ALWAYS
   DOWNHILL. Nothing can get stuck deep, because nothing has to be dismissed —
   which matters enormously on a surface where "dismiss" would have to be
   spoken, and where the person who walked away is not coming back to tidy up.
   ═══════════════════════════════════════════════════════════════════════════ */

export const DEPTH = { FIELD: 0, GLANCE: 1, SPREAD: 2, SUBJECT: 3 };

/* How long each depth survives without a fresh cause. These are not styling
   choices — they are how long the room stays interesting after the reason for
   it has gone. SPREAD is generous because a person cooking is present but not
   looking, and snapping them back to one line mid-task is the wrong read. */
const HOLD_MS = {
  [DEPTH.GLANCE]: 90_000,
  [DEPTH.SPREAD]: 45_000,
  [DEPTH.SUBJECT]: 30_000
};

let current = DEPTH.FIELD;
let holdTimer = null;
let lastReason = "boot";
const listeners = new Set();

function clearHold() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

/**
 * Set the depth. `reason` is required and is kept for the debug hook — a depth
 * change without a nameable cause is a bug, and being forced to write one down
 * is how that stays true.
 */
export function setDepth(next, reason) {
  const target = Math.max(DEPTH.FIELD, Math.min(DEPTH.SUBJECT, next | 0));
  clearHold();

  if (target !== current) {
    const prev = current;
    current = target;
    lastReason = reason;
    document.documentElement.dataset.depth = String(current);
    for (const fn of listeners) {
      // Isolated: one bad subscriber must not stop the surface changing depth.
      // Re-thrown on a fresh task so a genuine page error still surfaces to the
      // kiosk smoke test rather than being swallowed here.
      try { fn(current, prev, reason); }
      catch (err) { setTimeout(() => { throw err; }); }
    }
  } else {
    lastReason = reason;
  }

  // Arm the recession. FIELD is the floor and holds itself.
  if (current > DEPTH.FIELD) {
    holdTimer = setTimeout(() => {
      holdTimer = null;
      setDepth(current - 1, "recede");
    }, HOLD_MS[current]);
  }
}

/** Re-arm the current depth's hold without changing depth — a fresh cause for
 *  the state we are already in (motion continuing, a follow-up question). */
export function sustain(reason = "sustain") {
  if (current > DEPTH.FIELD) setDepth(current, reason);
}

/** Push deeper, never shallower. Causes that mean "there is more to see" use
 *  this so that a low-priority cause can never pull the surface up out of a
 *  subject the room is actually looking at. */
export function deepen(target, reason) {
  if (target > current) setDepth(target, reason);
  else sustain(reason);
}

export function getDepth() { return current; }

/** WHY the surface is at this depth. Worth having as a real export rather than
 *  only on the debug global: it is the one authority on who owns the screen, and
 *  a subscriber that tries to keep its own copy will be wrong — `sustain()`
 *  changes the reason WITHOUT changing the depth, so no listener fires. */
export function getReason() { return lastReason; }

export function onDepth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initDepth() {
  document.documentElement.dataset.depth = String(current);

  // Debug/verification hooks, matching the house convention (__attention,
  // __presence, __voiceSession) so the kiosk CDP probes can drive this without
  // a microphone or a person in the room.
  window.__depth = () => ({ depth: current, reason: lastReason, held: holdTimer !== null });
  window.__setDepth = (n, why = "debug") => setDepth(n, why);
}
