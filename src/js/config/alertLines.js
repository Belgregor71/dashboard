// Shared source of truth for doorbell / side-gate alert phrasing.
//
// doorbellAlert.js (frontend) picks a line to speak on a real trigger; the
// server's TTS warmer (server/services/ttsWarmer.js) pre-synthesizes the
// name-free lines into the Kokoro cache on boot, so real rings play instantly
// instead of waiting ~10-17s on live synthesis. Keep ALERT_TTS_RATE in sync
// with the rate doorbellAlert.js speaks at, or the pre-warmed cache keys won't
// match (server cache key = sha256(text::rate)) and the warm-up is wasted.

export const ALERT_TTS_RATE = 0.92;

// Voice: docs/design/VOICE.md — plain, dry wit rationed (one eyebrow per
// pool), side gate matter-of-fact, family-tease licence on known names only.

// Front door, nobody identified — name-free, so pre-warmable.
export const VISITOR_UNKNOWN_LINES = [
  "Someone's at the front door.",
  "There's someone at the front door.",
  "Doorbell — someone's at the front door.",
  "Someone's at the front door. Probably a parcel.",
  "Someone's on the front porch.",
  "Someone's out the front."
];

// Front door, person identified by name — depends on who, so never cacheable.
export const VISITOR_KNOWN_LINES = [
  name => `It's ${name} at the front door.`,
  name => `${name}'s at the door.`,
  name => `${name}'s here.`,
  name => `${name}'s at the door. Act natural.`,
  name => `${name}'s home.`,
  name => `It's ${name}.`,
  name => `Look who it is — ${name}.`
];

// Side gate, nobody identified — name-free, so pre-warmable.
export const INTRUDER_UNKNOWN_LINES = [
  "Someone's at the side gate.",
  "There's movement at the side gate.",
  "Someone's coming through the side gate.",
  "Someone's at the side gate — worth a look.",
  "Someone's near the side gate.",
  "Someone's at the side of the house."
];

// Side gate, person identified by name — depends on who, so never cacheable.
export const INTRUDER_KNOWN_LINES = [
  name => `${name}'s coming round the side gate.`,
  name => `It's ${name}, round the side as usual.`,
  name => `${name}'s at the side gate.`,
  name => `${name}'s taking the side way in.`,
  name => `${name}'s at the side, not the front.`,
  name => `${name}'s round the side.`,
  name => `${name}'s taking their usual side-gate shortcut.`
];

// Every name-free line — exactly what the server pre-warms into the TTS cache.
export const PREWARM_LINES = [...VISITOR_UNKNOWN_LINES, ...INTRUDER_UNKNOWN_LINES];
