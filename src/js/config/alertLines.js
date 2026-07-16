// Shared source of truth for doorbell / side-gate alert phrasing.
//
// doorbellAlert.js (frontend) picks a line to speak on a real trigger; the
// server's TTS warmer (server/services/ttsWarmer.js) pre-synthesizes the
// name-free lines into the Kokoro cache on boot, so real rings play instantly
// instead of waiting ~10-17s on live synthesis. Keep ALERT_TTS_RATE in sync
// with the rate doorbellAlert.js speaks at, or the pre-warmed cache keys won't
// match (server cache key = sha256(text::rate)) and the warm-up is wasted.

export const ALERT_TTS_RATE = 0.92;

// Front door, nobody identified — name-free, so pre-warmable.
export const VISITOR_UNKNOWN_LINES = [
  "Someone's at the front door. Hope you've got friends.",
  "Doorbell's going. Statistically, it's a parcel, not a person you like.",
  "Knock knock at the front door. Probably not a joke.",
  "Someone's at the door. Bold of them to just show up unannounced.",
  "There's someone at the front door. Could be a neighbour. Could be a scam.",
  "Doorbell. Must be DoorDash, nobody else visits unannounced.",
  "Someone's knocking at the front door. Try not to look too surprised you have visitors.",
  "Someone's at the door. No, it's not your imagination.",
  "Doorbell's ringing. Fifty-fifty it's someone lovely or someone selling something.",
  "There's a knock at the front door. Miracles do happen, apparently."
];

// Front door, person identified by name — depends on who, so never cacheable.
export const VISITOR_KNOWN_LINES = [
  name => `It's ${name} at the door. Try to act surprised.`,
  name => `${name}'s here. Hope you're decent.`,
  name => `${name}'s at the door. You don't have to pretend you're not home.`,
  name => `It's ${name}. Could be worse, could've been a Jehovah's Witness.`,
  name => `${name}'s at the front door. Look alive.`
];

// Side gate, nobody identified — name-free, so pre-warmable.
export const INTRUDER_UNKNOWN_LINES = [
  "Someone's at the side gate. Hope it's a tradie, not a burglar with poor planning.",
  "Unidentified person at the side gate. Could be trouble, could just be the meter reader.",
  "Someone's sneaking round the side gate. Bold or lost, hard to say.",
  "Movement at the side gate. Definitely not your average Tuesday visitor.",
  "Someone's at the side gate. Who's breaking in this time?"
];

// Side gate, person identified by name — depends on who, so never cacheable.
export const INTRUDER_KNOWN_LINES = [
  name => `${name}'s coming round the side gate. Bold move.`,
  name => `It's ${name}, sneaking in the back way as usual.`,
  name => `${name}'s at the side gate. Front door not good enough?`,
  name => `Spotted: ${name}, taking the scenic route via the side gate.`,
  name => `${name}'s at the side gate again. Definitely not suspicious.`
];

// Every name-free line — exactly what the server pre-warms into the TTS cache.
export const PREWARM_LINES = [...VISITOR_UNKNOWN_LINES, ...INTRUDER_UNKNOWN_LINES];
