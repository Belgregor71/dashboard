/* ═══════════════════════════════════════════════════════════════════════════
   THE BRIEFING WINDOW — step 3.4, deferred out of Phase 3 and landed here.

   The morning briefing opens itself. That is the whole feature, and the
   interesting part is the one line of restraint around it.

   ── ⚠ A CLOCK IS NOT AN EXTERNAL CAUSE ──────────────────────────────────────

   The calm law survived the V3 rewrite in exactly one clause: *never move for a
   reason the room cannot see.* §5.1 spells out the corollary the incumbent
   never had to think about — TIME PASSING IS NOT A CAUSE. A wall that lights
   itself at 5:35am in an empty kitchen and reads the news to nobody is not a
   briefing, it is the screen talking to itself, and it is precisely the
   behaviour V3 exists to not have.

   So the window is a PERMISSION, not a trigger. The cause is a person being in
   the room during it. Two consequences worth stating:

   - The check runs on the presence signal as well as on a tick, so walking in
     at 6:10 opens it immediately rather than up to thirty seconds later.
   - `CATCHUP_MS` (30 min) does real work here that it never did on the
     incumbent, where the briefing fired into an empty room and was over. Here
     it is the window in which someone can still walk in and get it.

   ── The other two traps, both already paid for elsewhere ────────────────────

   FORCED, NOT DEEPENED. `deepen(SUBJECT)` from depth 3 falls through to
   `sustain()`, which re-arms the hold and leaves the OLD subject mounted — the
   doorbell announced over the wrong camera, in Phase 3's version of this. The
   briefing calls `setDepth` directly, and only once the text is in hand.

   NOTHING FLIPS DEPTH INTO AN EMPTY LAYER. `showBriefing()` returns null when
   the model gave us nothing, and null means the depth is never touched.
   ═══════════════════════════════════════════════════════════════════════════ */

import { dueBriefing, hasFiredToday, markFired } from "../../js/services/briefingSchedule.js";
import { showSubject } from "../subjects/index.js";
import { DEPTH, setDepth } from "./depth.js";
import { isPresent, onPresence } from "./presence.js";
import { setPhase, trackSpeech } from "./presence-light.js";
import { speak } from "../../js/core/tts.js";
import { record } from "./feature-census.js";

/* Its own record, deliberately. Both surfaces are served from the same origin,
   so a shared key would let the incumbent's 5:35 briefing mark V3's as done —
   a lab surface silently eating the wall's briefing, or the reverse. See
   services/briefingSchedule.js. */
const FIRED_KEY = "dashboard:briefing-fired-v3";

/* Longer than a subject's 30s and longer than the door's 60s. A briefing is
   read, not glanced at, and the recession is still automatic — this only says
   how patient it is.

   ⚠ WAS FOUR MINUTES UNTIL 2026-08-19, on the reasoning that it should be
   twice the time it takes to hear the spoken half and read the rest. Owner's
   verdict from the wall: it outstayed its welcome badly. Twice-the-reading-time
   was the wrong model — nobody stands in front of a briefing for four minutes,
   so the second half of that window was simply the kitchen unable to get its
   photograph back. Ninety seconds is about the spoken half plus a beat to
   finish reading, which is the whole job. */
export const BRIEFING_HOLD_MS = 90_000;

let timer = null;
let unsubscribe = null;
let opening = false;
let last = null;

/**
 * Open the briefing if this is its moment and someone is here to see it.
 * Exported for the debug hook: waiting until 5:35am to find out whether it
 * works is not a verification anyone will run.
 */
export async function checkBriefingWindow({ now = new Date(), force = false } = {}) {
  /* Re-entrancy guard, and it is load-bearing rather than defensive: the
     generation is awaited for up to twelve seconds, during which both a 30s
     tick and a presence event can arrive. Without this the house would open
     the briefing twice and speak it over itself. */
  if (opening) return null;

  if (!force) {
    const due = dueBriefing({ now, hasFired: (name) => hasFiredToday(FIRED_KEY, name, now) });
    if (!due) return null;

    /* Prefetch is the incumbent's job and the incumbent is not necessarily
       running. Doing it here as well would double the model calls for a saving
       V3 does not need: the window is 30 minutes wide and the person arriving
       in it is what starts the clock, so the wait is theirs, once. */
    if (due.phase !== "fire") return null;

    // ⚠ THE WHOLE POINT. An empty room gets no briefing, and the window simply
    // stays open until someone walks in or it expires.
    if (!isPresent()) return null;

    markFired(FIRED_KEY, due.schedule.name, now);
    last = { name: due.schedule.name, type: due.schedule.type, at: now.toISOString(), shown: false };
  } else {
    last = { name: "forced", type: undefined, at: now.toISOString(), shown: false };
  }

  opening = true;
  try {
    const shown = await showSubject(
      { id: "show.briefing", slots: {} },
      null
    );
    if (!shown) return last;

    last.shown = true;
    setDepth(DEPTH.SUBJECT, "briefing:window", { holdMs: BRIEFING_HOLD_MS });

    /* Spoken AFTER the screen has it, because the two-sentence opening is a
       pointer at something that must already be there to point at. */
    if (shown.speech) {
      setPhase("speaking");
      record("spoke", "briefing", "said");
      speak(shown.speech, { onAudio: (audio) => trackSpeech(audio) })
        .then(() => setPhase("idle"), () => setPhase("idle"));
    }
    return last;
  } finally {
    opening = false;
  }
}

/** The last window that fired, or null. For __v3(). */
export function lastBriefing() {
  return last;
}

export function initBriefingWindow() {
  if (timer) return;

  /* Two clocks, because the cause is a person and the schedule is only its
     permission. The tick covers "already standing there when the window
     opened"; the presence subscription covers "walked in at 6:10", which is the
     more common one in a kitchen. */
  timer = setInterval(() => { checkBriefingWindow().catch(() => {}); }, 30_000);
  unsubscribe = onPresence(() => { checkBriefingWindow().catch(() => {}); });
  checkBriefingWindow().catch(() => {});

  /* Drive it without waiting for 5:35am. `{force:true}` skips the schedule and
     the presence gate but NOT the empty-text guard — an unreachable model still
     produces no subject and no depth change, which is the behaviour worth being
     able to check by hand.

     It also takes `{now}`, which is the only way to exercise the gate that
     matters: a real fire window with nobody in the room must produce nothing,
     and waiting until 5:35am to find that out is not a verification anyone
     will run. */
  window.__v3Briefing = (opts) => checkBriefingWindow(opts ?? { force: true });
}
