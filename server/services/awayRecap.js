/* ═══════════════════════════════════════════════════════════════════════════
   AWAY RECAP — "While you were out", from the camera captions (field-scan #3,
   Phase 2). Owner's choice 2026-11-20: option 2, a tally plus ONE quoted line.

   The tally is built from WHICH camera and WHETHER the caption mentions a
   person or a vehicle, never from the caption's particulars: the model invents
   a person in ~5% of its claims (prompt A/B 2026-11-20), so a wrong caption can
   move a count by one but cannot tell a story. The one particular that is shown
   is quoted and attributed to the camera, so it reads as the camera's words.

   Rules (owner, 2026-11-20):
   - only the window the house was empty, minus the last HOMECOMING_MS, which
     is almost certainly the person now walking in;
   - "Nothing." rows, and rows naming neither a person nor a vehicle, are skipped;
   - no names: the captioner does not know who anyone is;
   - nothing happened → "All quiet while you were out." — but ONLY when the lane
     was running for the whole window. A lane that was off saw nothing, which is
     not the same as nothing happening.
   ═══════════════════════════════════════════════════════════════════════════ */

export const HOMECOMING_MS = 5 * 60 * 1000;
export const QUOTE_MAX = 90;
export const MAX_CLAUSES = 3;

/* Cameras without a place are left out rather than given an invented one. */
export const PLACES = {
  doorbell: { at: "at the front door", label: "Front door" },
  driveway: { at: "in the driveway", label: "Driveway" },
  front_yard: { at: "in the front yard", label: "Front yard" },
  patio: { at: "on the patio", label: "Patio" },
  backyard: { at: "in the backyard", label: "Backyard" }
};

/* The Phase 0 scorer's own patterns (tools/caption-probe/score.mjs), so the
   recap counts exactly what was measured. */
const NEG = /\b(no|not|without|nobody|none)\b[^.]*\b(person|people|vehicle|car)/i;
const SAYS = {
  person: /\b(person|people|man|men|woman|women|child|children|kid|kids|someone|individual|figure|pedestrian)\b/i,
  vehicle: /\b(vehicle|vehicles|car|cars|truck|ute|van|suv|pickup|bus|motorcycle)\b/i
};

export function mentions(caption, kind) {
  const text = String(caption ?? "");
  if (/^\s*nothing\b/i.test(text)) return false;
  return SAYS[kind].test(text) && !NEG.test(text);
}

const times = (n) => (n === 1 ? "" : n === 2 ? " twice" : ` ${n} times`);

function clockOf(at) {
  return new Date(at)
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function quoteOf(caption) {
  let s = String(caption).trim().replace(/^["“”']+|["“”']+$/g, "").trim();
  if (s.length > QUOTE_MAX) s = s.slice(0, QUOTE_MAX).replace(/\s+\S*$/, "") + "…";
  return s;
}

/**
 * @param {object[]} rows  caption rows { at, camera, burst, caption }
 * @param {{ since: number, until: number, laneSince: number|null }} window
 *        laneSince: when the caption lane started this process, null if off.
 * @returns {{ text: string, sub: string|null, events: number, last: number|null }|null}
 *          null = nothing honest to say.
 */
export function recap(rows, { since, until, laneSince }) {
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since) return null;
  const end = until - HOMECOMING_MS;

  const bursts = new Map();   // camera:burst → { camera, person, vehicle, at }
  const people = [];          // rows that may be quoted
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !PLACES[r.camera] || !(r.at >= since && r.at < end)) continue;
    const person = mentions(r.caption, "person");
    const vehicle = mentions(r.caption, "vehicle");
    if (!person && !vehicle) continue;
    const key = `${r.camera}:${r.burst ?? r.at}`;
    const b = bursts.get(key) ?? { camera: r.camera, person: false, vehicle: false, at: r.at };
    b.person ||= person;
    b.vehicle ||= vehicle;
    b.at = Math.max(b.at, r.at);
    bursts.set(key, b);
    if (person) people.push(r);
  }

  if (bursts.size === 0) {
    const watched = Number.isFinite(laneSince) && laneSince <= since;
    return watched ? { text: "All quiet while you were out.", sub: null, events: 0, last: null } : null;
  }

  const count = (kind) => {
    const by = new Map();
    for (const b of bursts.values()) if (b[kind]) by.set(b.camera, (by.get(b.camera) ?? 0) + 1);
    return by;
  };
  const persons = count("person");
  const vehicles = count("vehicle");

  // Front door first, then the other places a person was, then vehicles.
  const clauses = [];
  const order = Object.keys(PLACES);
  for (const cam of order) if (persons.has(cam)) clauses.push(`someone ${PLACES[cam].at}${times(persons.get(cam))}`);
  for (const cam of order) if (vehicles.has(cam)) clauses.push(`a car ${PLACES[cam].at}${times(vehicles.get(cam))}`);
  const shown = clauses.slice(0, MAX_CLAUSES);
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;

  // The quote: the front door's latest, else the latest anywhere.
  const pick = [...people].sort((a, b) => (a.camera === "doorbell") - (b.camera === "doorbell") || a.at - b.at).at(-1);
  const sub = pick ? `${PLACES[pick.camera].label}, ${clockOf(pick.at)} — “${quoteOf(pick.caption)}”` : null;

  return {
    text: `While you were out: ${list}.`,
    sub,
    events: bursts.size,
    last: Math.max(...[...bursts.values()].map((b) => b.at))
  };
}
