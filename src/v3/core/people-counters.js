/* ═══════════════════════════════════════════════════════════════════════════
   THE PEOPLE'S COUNTERS — HOUSE-MIND S6b (docs/design/HOUSE-MIND.md §S6).

   The wall's log (presentation-log.js) holds rows about the MACHINE. Anything
   about the PEOPLE is here, and it is counts only — per source, per day, in the
   feature census's own ledger, beside `attn:<source>:shown`:

     ppl:<source>:present    a presentation of this source opened with someone
                             in the room
     ppl:<source>:cut        this speaker was cut off by a barge-in
     ppl:<source>:followed   a question on the same topic was asked while it was
                             up, or within FOLLOW_MS of it leaving

   No times, no row ids, nothing joined to a row: phase-8's
   "aggregates-not-logs" (HOUSE-MIND §S6, the 09-25 amendment). The only
   timestamps are the in-memory `recent` map below — one number per source,
   never sent anywhere, gone on reload.

   ── "Same topic" is a declared table, and it is narrower than it sounds ─────
   A question only has a machine-readable topic when the LOCAL intent matcher
   caught it (localIntents.js). A sentence that falls through to /converse has
   no label at all, so it is never counted — `followed` is a floor, not a
   total. TOPIC_SOURCES maps an intent id to the sources that speak to the same
   subject; an intent absent from it follows nothing.

   `followed` is recorded, not judged (S6 point 1): a rain question after a
   rain card may mean the card failed or that it worked. A person reading the
   digest decides; nothing here feeds ranking or wording.

   ── Cost ────────────────────────────────────────────────────────────────────
   Rides `v3PresentationLog` (armed by initPresentationLog) and the feature
   census's own flag: record() is a no-op until that ledger exists. `recent` is
   bounded by the number of sources. No timer, no listener, no request.
   ═══════════════════════════════════════════════════════════════════════════ */

import { record } from "./feature-census.js";
import { isPresent } from "./presence.js";

/* How long after a presentation leaves the glass a question still counts as
   following it. Ten minutes: long enough to cross the kitchen and ask, short
   enough that an unrelated question later in the evening is not attributed. */
export const FOLLOW_MS = 10 * 60 * 1000;

/* intent id → the sources on the same subject. Every key is an id the local
   matcher can yield and every value a `source` literal a presentation row can
   carry; people-counters.spec.js checks both against the source files. */
export const TOPIC_SOURCES = Object.freeze({
  "weather.umbrella": ["bom", "weather"],
  "weather.jacket": ["bom", "weather"],
  "weather.sunscreen": ["bom", "weather"],
  "weather.wind": ["bom", "weather"],
  "weather.tomorrow": ["bom", "weather"],
  "weather.today": ["bom", "weather"],
  "weather.now": ["bom", "weather"],
  "show.sky": ["bom", "weather"],
  "show.forecast": ["bom", "weather"],
  "cal.tomorrow": ["nextEvent"],
  "cal.next": ["nextEvent"],
  "cal.free": ["nextEvent"],
  "cal.today": ["nextEvent"],
  "show.day": ["nextEvent"],
  "show.ahead": ["nextEvent"],
  "self.commute": ["commute", "departure"],
  "house.media": ["nowPlaying", "plex"],
  "show.media": ["nowPlaying", "plex"],
  "camera.last": ["cameraTrigger", "doorbell"],
  "show.camera": ["cameraTrigger", "doorbell"],
  "show.recipe": ["tonightsMenu", "dinner"],
  "show.briefing": ["briefing"],
  "house.vacuum": ["robot"],
  "show.year": ["memory"]
});

let armed = false;
/* source → { open: how many rows of it are up, closedAt, counted } */
const recent = new Map();

function entry(source) {
  let e = recent.get(source);
  if (!e) {
    e = { open: 0, closedAt: 0, counted: false };
    recent.set(source, e);
  }
  return e;
}

/** presentation-log.js: a row for `source` has just opened on `surface`. */
export function noteShown(surface, source) {
  if (!armed || !source) return;
  // A voice row is the house talking, not something on the glass to be near.
  if (surface !== "voice" && isPresent()) record("ppl", source, "present");
  const e = entry(source);
  // A fresh presentation may be followed afresh; a second surface of one
  // already up (glance → spread) is the same showing.
  if (e.open === 0) e.counted = false;
  e.open += 1;
}

/** presentation-log.js: a row for `source` has just closed. */
export function noteClosed(source) {
  if (!armed || !source) return;
  const e = recent.get(source);
  if (!e) return;
  e.open = Math.max(0, e.open - 1);
  if (e.open === 0) e.closedAt = Date.now();
}

/** voice.js: the local matcher caught `intentId`. One count per showing. */
export function noteQuestion(intentId) {
  if (!armed) return;
  const sources = TOPIC_SOURCES[intentId];
  if (!sources) return;
  const now = Date.now();
  for (const source of sources) {
    const e = recent.get(source);
    if (!e || e.counted) continue;
    if (e.open === 0 && now - e.closedAt > FOLLOW_MS) continue;
    e.counted = true;
    record("ppl", source, "followed");
  }
}

/** voice.js: a barge-in landed while `author` held the air (null = nobody). */
export function noteCutOff(author) {
  if (!armed || !author) return;
  record("ppl", author, "cut");
}

/** Read-only, for __v3(). No times leave the page: ages only. */
export function peopleCountersState() {
  const now = Date.now();
  return {
    armed,
    recent: [...recent.entries()].map(([source, e]) => ({
      source,
      open: e.open,
      counted: e.counted,
      closedAgoMs: e.open === 0 && e.closedAt ? now - e.closedAt : null
    }))
  };
}

export function initPeopleCounters() {
  armed = true;
}
