/* ═══════════════════════════════════════════════════════════════════════════
   ARRIVAL — someone came home.

   Step 3.3 of docs/design/V3-MIGRATION.md. Not an interruption in the doorbell's
   sense — nobody needs to act on it — but it is the other thing that happens
   rather than merely being true, and a house that says nothing when you walk in
   is a house that is not paying attention.

   ── Why this does not touch the screen ──────────────────────────────────────

   The incumbent's `arrivalGreeting.js` is 313 lines because it owns a card: it
   builds DOM, holds it for 15 s, drains a progress bar, and reads the calendar
   to fill it. None of that ports. V3 already has a place for one true line at
   depth 1, and it already has a rule for who may write it, so this module
   announces a CANDIDATE and stops. Depth, phrasing, decay, quiet mode and the
   cooldowns are then somebody else's problem, which is the correct number of
   modules to have opinions about the glance cell.

   ── The guard the incumbent never got ───────────────────────────────────────

   `arrivalGreeting.js:289` has no minimum-away guard, and in July the house
   produced 27 false arrivals in five days: `iphonedetect` was flapping
   person entities away and back within seconds. The root cause was fixed in
   Home Assistant (`consider_home` 60 s → 900 s), which is the right place for
   it — but the dashboard believed all 27, and a surface that greets you every
   time your phone's wifi blinks teaches you to ignore it.

   So a spell shorter than MIN_AWAY_MS is not an arrival. This is belt and
   braces over an upstream fix rather than a substitute for one, and it is cheap:
   the module is already tracking the transition, so the only new state is when
   it happened.
   ═══════════════════════════════════════════════════════════════════════════ */

import { on } from "../../js/core/eventBus.js";
import { getAllEntities } from "../../js/services/homeAssistant/state.js";
import { speak } from "../../js/core/tts.js";
import { setPhase, trackSpeech } from "./presence-light.js";
import { announce } from "./attention.js";

/* Below this, they never really left — see the header. Ten minutes is the
   incumbent's own re-greet cooldown, reused rather than chosen so both surfaces
   agree about what counts as having been out. */
export const MIN_AWAY_MS = 10 * 60 * 1000;

/* Interrupt band (90–100 in candidateSources.js). An arrival reaches the glance
   whether or not the kitchen sensor has noticed anyone yet — which is the usual
   case, because walking in the front door precedes being seen in the kitchen. */
const ARRIVAL_SCORE = 92;

/* How long "Greg's home" stays true enough to show. The glance holds itself for
   90 s anyway; this is about the candidate not lingering in the queue behind it. */
const ARRIVAL_LIFE_MS = 3 * 60 * 1000;

const lastState = new Map();    // entityId → last seen state
const awaySince = new Map();    // entityId → when they left
let unsubscribe = null;
let last = null;

function firstName(entity) {
  const full = String(entity?.attributes?.friendly_name ?? "").trim();
  if (full) return full.split(" ")[0];
  // person.greg_dee → "Greg"
  const id = String(entity?.entity_id ?? "").replace(/^person\./, "");
  const word = id.split(/[_\s]/)[0];
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "Someone";
}

/** Who else is already in. Reads the cache directly — there is no event for
 *  "who is home", and asking at the moment of arrival is the only honest time. */
function othersHome(excludeId) {
  let entities = [];
  try { entities = Object.values(getAllEntities() ?? {}); } catch { return []; }
  return entities
    .filter((e) => e?.entity_id?.startsWith("person.") && e.entity_id !== excludeId && e.state === "home")
    .map(firstName);
}

/**
 * The line. Deliberately one sentence and deliberately plain — it is set in the
 * said voice at 132px on a wall, and personality.phrase() will run over it
 * afterwards for tone. No calendar, no agenda: that is what depth 2 is for, and
 * someone who has just walked through the door has not put the shopping down.
 */
function greeting(name, others) {
  if (others.length === 0) return `${name}'s home.`;
  if (others.length === 1) return `${name}'s home. ${others[0]}'s already in.`;
  return `${name}'s home, with ${others.slice(0, -1).join(", ")} and ${others.at(-1)} already in.`;
}

function onStateUpdated(entity) {
  const entityId = String(entity?.entity_id ?? "");
  if (!entityId.startsWith("person.")) return;

  const state = String(entity?.state ?? "");
  const previous = lastState.get(entityId);
  lastState.set(entityId, state);

  if (state !== "home") {
    // Note when they left, so the arrival can measure the absence.
    if (previous === "home") awaySince.set(entityId, Date.now());
    return;
  }

  /* The opening snapshot sends an update for every person in the house,
     including everyone already home — that is not an arrival, it is the page
     finding out what is true. Only a transition OBSERVED in this session counts,
     which is why an unseen previous state is a return rather than a greeting. */
  if (previous === undefined || previous === "home") return;

  const awayAt = awaySince.get(entityId);
  awaySince.delete(entityId);

  /* The guard. An unknown away time is treated as long enough — the alternative
     is staying silent on a genuine arrival the page happened not to have seen
     leave, and a missed greeting is a worse failure than a duplicate one. */
  if (awayAt != null && Date.now() - awayAt < MIN_AWAY_MS) {
    last = { name: firstName(entity), suppressed: "too-brief", awayMs: Date.now() - awayAt };
    return;
  }

  const name = firstName(entity);
  const text = greeting(name, othersHome(entityId));

  announce({
    // Keyed on the person, not the moment: a second arrival for the same person
    // replaces the first rather than queueing behind it.
    id: `arrival:${entityId}`,
    source: "arrival",
    // `kind` is what personality.phrase() reads for its length cap, and arrival
    // has its own (240) precisely so a warm line is not clipped mid-sentence.
    kind: "arrival",
    icon: "🏠",
    text,
    score: ARRIVAL_SCORE,
    interrupt: true,
    expiresAt: Date.now() + ARRIVAL_LIFE_MS,
    cooldownMs: 0
  });

  setPhase("speaking");
  speak(text, { onAudio: (audio) => trackSpeech(audio) })
    .then(() => setPhase("idle"), () => setPhase("idle"));

  last = { name, text, awayMs: awayAt ? Date.now() - awayAt : null, at: new Date().toISOString() };
}

/** The last arrival, or the last one suppressed and why. For __v3(). */
export function lastArrival() {
  return last;
}

export function initArrival() {
  if (unsubscribe) return unsubscribe;
  unsubscribe = on("ha:state-updated", onStateUpdated);

  /* Drive an arrival without going outside. Two calls are needed — away, then
     home — because a greeting requires a transition this session, and a debug
     hook that skipped that would be testing a path the house does not have. */
  window.__v3Arrival = (entityId = "person.greg", state = "home") =>
    (onStateUpdated({ entity_id: entityId, state, attributes: {} }), last);

  return unsubscribe;
}

/** Test seam — forgets every person so a spec starts cold. */
export function __resetArrival() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  lastState.clear();
  awaySince.clear();
  last = null;
}
