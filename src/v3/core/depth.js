/* ═══════════════════════════════════════════════════════════════════════════
   DEPTH — the only navigation in V3.

   There is no router, no view registry and no history. There is one number,
   0..3, and two verbs: something pushes you deeper, silence lets you recede.

   The rule that makes it work: RECESSION IS ALWAYS AUTOMATIC AND ALWAYS
   DOWNHILL. Nothing can get stuck deep, because nothing has to be dismissed —
   which matters enormously on a surface where "dismiss" would have to be
   spoken, and where the person who walked away is not coming back to tidy up.

   ── Downhill, but not necessarily one step ──────────────────────────────────

   Recession used to step down exactly one level, and that was wrong in a way
   nothing had reached yet. Depth 2 is empty unless something composed it and
   depth 1 is empty unless something wrote its cell, so a subject timing out
   dropped the wall onto a blank rectangle and held it there for the next
   depth's full hold — 45 seconds of black, then 90 more.

   Nothing had hit it because every route to depth 3 so far was a spoken one,
   with a person standing there to say something else. Phase 3 is precisely the
   set of things that drive the surface deep WITH NOBODY WATCHING, so it had to
   be fixed before the doorbell could be trusted with the screen. The floor is
   the answer: depth 0 always has the hour and the photograph, so recession
   falls to the deepest depth that actually has something in it, and worst case
   that is the field.
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

/* Does this depth have anything in it? Injected at init rather than read here,
   because the answer is a DOM question ("does the lattice have children", "does
   the glance cell have text") and this module has no business knowing the shape
   of the surface. Defaults to "yes", which reproduces the old one-step
   behaviour exactly for any caller that does not supply one. */
let inhabited = () => true;

function clearHold() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

/** The deepest depth below this one that has something to show. FIELD is the
 *  floor and is always inhabited — the hour and the photograph are always there,
 *  which is the whole reason depth 0 can be the resting state. */
function recedeTarget(from) {
  let target = from - 1;
  while (target > DEPTH.FIELD && !inhabited(target)) target -= 1;
  return target;
}

/**
 * Set the depth. `reason` is required and is kept for the debug hook — a depth
 * change without a nameable cause is a bug, and being forced to write one down
 * is how that stays true.
 *
 * `holdMs` overrides how long this particular cause survives. Only worth using
 * when the cause itself carries a different weight from the depth it lands on —
 * a doorbell is a subject, but it is not the same as having asked to see the
 * driveway, and the difference belongs to the event rather than to the depth.
 */
export function setDepth(next, reason, { holdMs = null } = {}) {
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
      // Asked at the moment it fires, never at the moment it was armed: what is
      // on the screen a minute later is not what was on it when the timer
      // started, and the whole point is to land somewhere that has content NOW.
      setDepth(recedeTarget(current), "recede");
    }, holdMs ?? HOLD_MS[current]);
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

export function initDepth({ inhabited: probe = null } = {}) {
  if (probe) inhabited = probe;
  document.documentElement.dataset.depth = String(current);

  // Debug/verification hooks, matching the house convention (__attention,
  // __presence, __voiceSession) so the kiosk CDP probes can drive this without
  // a microphone or a person in the room.
  window.__depth = () => ({
    depth: current,
    reason: lastReason,
    held: holdTimer !== null,
    // Where the current hold would land if it fired right now. The recession is
    // the half of this module that runs unwatched, so it is the half worth being
    // able to read over CDP without waiting out a timer to find out.
    recedesTo: current > DEPTH.FIELD ? recedeTarget(current) : null
  });
  window.__setDepth = (n, why = "debug", opts) => setDepth(n, why, opts);
}
