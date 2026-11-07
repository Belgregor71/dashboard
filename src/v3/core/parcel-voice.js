/* ═══════════════════════════════════════════════════════════════════════════
   PARCEL VOICE — Kath and Kim remark on a parcel moment, from prerendered
   clips (data/cast/, events `parcel:delivering` and `parcel:delivered`).
   Behind features.v3ParcelVoice, and only when the cast itself is on.

   Count-free on purpose: a clip cannot know how many parcels there are, so the
   number stays on the card and the lines never say one.

   No plain-voice fallback. Before this the parcel was silent, so a missing
   clip, the cast off, quiet hours or a game running all leave it silent.
   ═══════════════════════════════════════════════════════════════════════════ */

import { on } from "../../js/core/eventBus.js";
import { castOn, speakCast } from "./cast.js";
import { isQuiet } from "./dog-schedule.js";
import { isGamingQuiet } from "../../js/services/quietMode.js";
import { record } from "./feature-census.js";

const flag = (name) => Boolean(globalThis.window?.CONFIG?.features?.[name]);

/** The cast event for this moment, or null when the house should stay quiet. */
export function parcelVoiceEvent(moment, { now = new Date(), cast = castOn(now), gaming = isGamingQuiet() } = {}) {
  if (!flag("v3ParcelVoice") || !cast || gaming || isQuiet(now)) return null;
  if (!["delivering", "delivered"].includes(moment?.kind)) return null;
  return `parcel:${moment.kind}`;
}

let unsubscribe = null;

export function initParcelVoice() {
  if (unsubscribe) return unsubscribe;
  unsubscribe = on("parcel:moment", (moment) => {
    const event = parcelVoiceEvent(moment);
    if (!event) return;
    // "moment": the arbiter's lowest rank, so anything else speaking wins.
    speakCast(event, { author: "moment" }).then(
      (spoke) => record("spoke", "parcel", spoke ? "said" : "no-clip"),
      () => {}
    );
  });
  return unsubscribe;
}
