/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by V3 (the wall). The incumbent that shared it was retired 2026-10-03.
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

// Shared source of truth for doorbell / side-gate alert phrasing.
//
// doorbellAlert.js (frontend) picks a line to speak on a real trigger; the
// server's TTS warmer (server/services/ttsWarmer.js) pre-synthesizes the
// name-free lines into the Kokoro cache on boot, so real rings play instantly
// instead of waiting ~10-17s on live synthesis. Keep ALERT_TTS_RATE in sync
// with the rate doorbellAlert.js speaks at, or the pre-warmed cache keys won't
// match (server cache key = sha256(text::rate)) and the warm-up is wasted.

export const ALERT_TTS_RATE = 0.92;

// Voice: docs/design/CHARACTER.md — REWRITTEN against it 2026-10-03 (the owner:
// "we are slipping back into the Kath & Kim personality which I thought we
// veto'd. Keep the humour but stay away from direct quotes"). The house is
// dry: the fact first, then at most one beat, and the comedy is SCALE — it is
// serious about small things — never a catchphrase, a costume or a quote.
//
// What that rules out here, each of which the old pools did:
//   · borrowed flavour — "hun", "noice", "gorgeous", "the good biscuits"
//   · an invented particular — "we did not plan for this", "right on cue",
//     "round the side as usual" (a pattern the house was never handed, and
//     CHARACTER.md: it never announces a pattern)
//   · an event the trigger does not prove — "Doorbell!", "Knock knock": most
//     alerts are person_detected, not a ring
//   · "home" for a named face, who may be a guest
//
// SECURITY IS INFORMATION FIRST (hard limit 3): every line says WHAT and WHERE
// in plain words. The front door and any NAMED person get the full character;
// an UNKNOWN person at the SIDE gate stays clear and only lightly warm — never
// a punchline — because that is the one that might one day be real.
//
// Pool sizes: the front door fires ~10 times a day (134 detections in 14 days
// of HA history), so its unknown pool is 20; the rest are 10. alertRouter.js
// draws each pool as a shuffled bag — every line once before any line twice.

// Front door, nobody identified — name-free, so pre-warmable.
export const VISITOR_UNKNOWN_LINES = [
  "Someone's at the front door.",
  "Someone's at the front door. I can't see who.",
  "There's a person at the front door — not one I recognise.",
  "Someone's at the front door, and I have no idea who.",
  "A visitor at the front door. I do enjoy a development.",
  "Someone's at the front door. That's the headline.",
  "Front door — a person, standing there. Over to you.",
  "Someone's at the front door. I'll keep watching — you do the walking.",
  "There's someone at the front door. Face unfamiliar.",
  "Someone's at the front door. I didn't catch a name.",
  "A person at the front door — unannounced, as far as I know.",
  "Someone's arrived at the front door.",
  "Front door — someone's waiting.",
  "Someone's at the front door. Noted — you may wish to act.",
  "Someone's at the front door. I'd answer it, but I'm a wall.",
  "There's a visitor at the front door.",
  "Someone's at the front door. Not a face I've been introduced to.",
  "Front door — someone's just walked up.",
  "Someone's at the front door. I consider this significant.",
  "A person at the front door. Big moment for the door."
];

// Front door, person identified by name. Pre-warmed per name the cameras can
// recognise (server/services/alertNames.js) — never from a list in this file.
export const VISITOR_KNOWN_LINES = [
  name => `${name}'s at the front door.`,
  name => `It's ${name} at the front door. That one I know.`,
  name => `${name}'s at the front door — a face I can vouch for.`,
  name => `Front door — it's ${name}. Recognised on sight, which I enjoy.`,
  name => `${name}'s at the front door. No introduction needed.`,
  name => `It's ${name} at the front door. I'd know that face anywhere.`,
  name => `${name}'s arrived at the front door. I'm counting that as news.`,
  name => `That's ${name} at the front door, or a very good likeness.`,
  name => `${name}'s at the front door. Somebody let them in.`,
  name => `Front door — ${name}'s here.`
];

// Side gate, nobody identified — name-free, so pre-warmable. Deliberately the
// calmest pool: clear and lightly warm, but no bit. (See the graduated-intensity
// note above — an unknown figure at the side of the house isn't a punchline.)
export const INTRUDER_UNKNOWN_LINES = [
  "Someone's at the side gate.",
  "There's a person at the side gate.",
  "Someone's at the side gate — worth a look.",
  "There's movement at the side gate. Worth a look.",
  "Someone's coming through the side gate, not the front.",
  "Someone's near the side gate. Have a look.",
  "Someone's at the side of the house.",
  "Side gate — someone's there. Worth checking.",
  "Someone's come in by the side gate. Take a look.",
  "There's someone at the side gate. I don't recognise them."
];

// Side gate, person identified by name. A known face round the side is no
// mystery, so this pool gets the character — aimed at the shortcut (a situation,
// fair game under hard limit 1), never at the person, and never claiming they
// "always" do it.
export const INTRUDER_KNOWN_LINES = [
  name => `${name}'s at the side gate.`,
  name => `It's ${name} at the side gate — the front door is right there.`,
  name => `${name}'s coming in by the side gate. The front door will cope.`,
  name => `${name}'s at the side gate. A bold choice of entrance.`,
  name => `Side gate — it's ${name}, taking the scenic route.`,
  name => `It's ${name} at the side gate. Front doors are for other people.`,
  name => `${name}'s at the side gate. The front door has been snubbed.`,
  name => `${name}'s come round the side. I saw that.`,
  name => `That's ${name} at the side gate. Nothing to worry about.`,
  name => `${name}'s using the side gate. Noted, without comment.`
];

// Every name-free line — exactly what the server pre-warms into the TTS cache.
export const PREWARM_LINES = [...VISITOR_UNKNOWN_LINES, ...INTRUDER_UNKNOWN_LINES];

// Every NAMED line for the given names — what the server pre-warms once it has
// learned who the cameras can recognise (server/services/alertNames.js). A
// named line that misses the cache is spoken ~10 s late: measured 2026-10-03,
// "Greg's home!" was chosen at +0.6 s and its WAV landed at +10 s (6 s primary
// timeout + fallback synthesis). The names never live in this file — it is
// tracked and public; they are read from Home Assistant at run time.
export function namedPrewarmLines(names) {
  const lines = [];
  for (const name of names ?? []) {
    for (const template of [...VISITOR_KNOWN_LINES, ...INTRUDER_KNOWN_LINES]) {
      lines.push(template(name));
    }
  }
  return lines;
}
