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

// Voice: docs/design/VOICE.md — big, gossipy, delighted-to-have-a-visitor.
// SECURITY IS INFORMATION FIRST: every line still says WHAT and WHERE plainly.
// Graduated intensity — the front door and any NAMED person get the full sass;
// an UNKNOWN person at the SIDE gate stays clear and only lightly warm (never a
// punchline), because that's the one that might one day be a real problem.

// Front door, nobody identified — name-free, so pre-warmable.
export const VISITOR_UNKNOWN_LINES = [
  "Ooh — someone's at the front door!",
  "Doorbell! Someone's here and we did not plan for this.",
  "Someone's at the front door. Look important.",
  "There's someone on the front porch — could be anyone.",
  "Someone's at the front door, and I'm dying to know who.",
  "Front door! Best behaviour, everyone.",
  // Added 2026-10-03 — owner: "keep hearing the same ones". The front door
  // fires ~10 times a day (134 detections in 14 d), so a pool of 6 came round
  // more than once daily.
  "Someone's at the front door — and I do love a mystery guest.",
  "We've got a visitor at the front door.",
  "Front door — someone's just arrived.",
  "Someone's on the front porch. How exciting.",
  "Knock knock — someone's at the front door.",
  "Someone's at the front door. Hair check, everyone.",
  "A visitor at the front door — different, unusual, I like it.",
  "Someone's come to the front door. I'll allow it.",
  "Front door, hun — somebody's here.",
  "There's someone at the front door. Act natural.",
  "Company at the front door! Nobody told me."
];

// Front door, person identified by name — depends on who, so never cacheable.
export const VISITOR_KNOWN_LINES = [
  name => `${name}'s here! Look who decided to grace us.`,
  name => `Ooh, it's ${name}. Get the good biscuits out.`,
  name => `It's ${name} at the front door — the door's never looked better.`,
  name => `${name}'s home! Someone tell the good cushions.`,
  name => `Look who it is — ${name}, gorgeous as ever.`,
  name => `It's ${name}, at the front door.`,
  name => `${name}'s at the front door — finally, some glamour.`,
  name => `${name}'s at the front door. I'd know that face anywhere.`,
  name => `Oh, it's ${name} at the front door. Noice.`,
  name => `${name}'s arrived at the front door — roll out the welcome.`
];

// Side gate, nobody identified — name-free, so pre-warmable. Deliberately the
// calmest pool: clear and lightly warm, but no bit. (See the graduated-intensity
// note above — an unknown figure at the side of the house isn't a punchline.)
export const INTRUDER_UNKNOWN_LINES = [
  "Someone's at the side gate — go and have a squiz.",
  "There's movement at the side gate. Worth a look.",
  "Someone's coming through the side gate, not the front.",
  "Someone's at the side gate — not who we expected.",
  "Someone's near the side gate. Have a look.",
  "Someone's at the side of the house.",
  "Someone's at the side gate just now.",
  "There's a person at the side gate.",
  "Side gate — someone's there. Worth checking.",
  "Someone's come in by the side gate. Take a look."
];

// Side gate, person identified by name — depends on who, so never cacheable.
// A known face round the side is no mystery, so this pool gets the full tease.
export const INTRUDER_KNOWN_LINES = [
  name => `It's ${name}, round the side as usual — never the front.`,
  name => `${name}'s coming round the side gate — course they are.`,
  name => `${name}'s at the side gate. Creature of habit, that one.`,
  name => `${name}'s taking the side way in, per usual.`,
  name => `${name}'s at the side, not the front — bold choice.`,
  name => `${name}'s doing the side-gate special, right on cue.`,
  name => `${name}'s at the side gate — the front door weeps.`,
  name => `It's ${name} at the side gate. Front doors are for other people.`,
  name => `${name}'s slipping in the side gate. Seen it, hun.`,
  name => `Side gate — it's ${name}, taking the scenic route.`
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
