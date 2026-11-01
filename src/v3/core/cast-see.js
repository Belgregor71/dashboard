/* The wiring for cast-moments.js, which holds the rules and stays pure so node
   specs can reach them. This half touches the page. */

import { isGamingQuiet } from "../../js/services/quietMode.js";
import { castOn, speakCast } from "./cast.js";
import { mayPipeUp, momentEvent } from "./cast-moments.js";
import { isPresent } from "./presence.js";

/* shortcut: held in memory, so a page reload can repeat a day's moments. The page
   runs for weeks; move it to localStorage if a reload is ever heard to repeat one. */
let day = null;
let heard = new Set();

/** Called with whatever is on the wall, on every attention tick. */
export function castSee(candidates, now = new Date()) {
  if (!castOn()) return;
  const today = now.toDateString();
  if (today !== day) { day = today; heard = new Set(); }

  for (const candidate of candidates) {
    const event = momentEvent(candidate);
    if (!mayPipeUp(event, { now, present: isPresent(), gaming: isGamingQuiet(), tally: heard })) continue;
    heard.add(event);
    speakMoment(event);
    return;   // one at a time: the next tick can take the next
  }
}

/* Imported here, not at the top: attention.js loads this file, node-side specs
   load attention.js, and presence-light.js reads `document` as it loads. */
async function speakMoment(event) {
  const { setPhase, trackSpeech } = await import("./presence-light.js");
  setPhase("speaking");
  speakCast(event, { author: "moment", onAudio: (audio) => trackSpeech(audio) })
    .then(() => setPhase("idle"), () => setPhase("idle"));
}
