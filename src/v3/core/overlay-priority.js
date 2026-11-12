/* ═══════════════════════════════════════════════════════════════════════════
   OVERLAY PRIORITY — who gives way to whom on the glass, in one place.

   Highest first:
     alert      the door, the gate (core/alerts.js)
     voice      a live turn: the transcript, the house's light
     subject    depth 3, whoever asked for it
     moment     the parcel card, the diorama
     character  the dogs
     (the resting wall)

   A layer arriving takes the glass from everything below it. Found by the
   2026-11-12 visual audit: each overlay knew its own corner and not each other,
   so the dogs stayed up over the door's camera and covered its caption.

   What is enforced where:
     · alert   → character   HERE, always (shipped unflagged as a defect fix).
     · alert   → a finished turn's lingering transcript   HERE, features.v3OverlayPriority.
     · subject → character   HERE, features.v3OverlayPriority.
     · subject → moment      css/parcels.css hides the card at depth 3; the
                             diorama tears itself down on the same depth change.
   Not built: queueing two moments. They own different corners and have never
   been seen to collide.
   ═══════════════════════════════════════════════════════════════════════════ */

import { dogOccasion } from "./dog-occasion.js";
import { stopDogShow } from "./dog-show.js";
import { clearHeard } from "./voice.js";

export const ORDER = ["alert", "voice", "subject", "moment", "character"];

const flag = (name) => Boolean(globalThis.window?.CONFIG?.features?.[name]);

/** `layer` has arrived: everything it outranks leaves the glass. */
export function yieldTo(layer) {
  const on = flag("v3OverlayPriority");
  if (layer === "alert" || (on && layer === "subject")) {
    stopDogShow();
    dogOccasion.hide();
  }
  if (on && layer === "alert") clearHeard();
}
