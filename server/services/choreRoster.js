import {
  LAST_CHANCE_UNTIL_HOUR,
  binWindow,
  binsConfigured,
  loadCollections,
  parseLocalDate,
  startOfLocalDay
} from "./binSchedule.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE CHORE ROSTER — who does what, and on which night.

   Two chores, two DIFFERENT rules, and that is the whole reason this is a
   module rather than a sentence somewhere:

     · THE DOGS alternate by NIGHT. Brett on the night of 2026-08-27, Greg the
       next, and so on forever. Nothing in the house observes a feed, so the
       roster is date math and only date math — it says whose turn it IS, never
       whether it happened.

     · THE BINS alternate by COLOUR, not by night. The council alternates the
       second bin (see binSchedule.js: always Rubbish plus Recycling OR Garden,
       weekly), so "red and green" and "red and yellow" arrive fortnightly each
       and the roster hangs off which one turned up. Brett takes red + green,
       Greg takes red + yellow.

   ⚠ THE TWO RULES ARE NOT THE SAME PARITY AND MUST NOT BE COLLAPSED. A dog
   night flips every day; a bin colour flips every seven. They coincide only by
   accident, and the accident lasts a fortnight at a time — long enough for an
   "obvious" simplification to look right in every test written in one sitting.

   ⚠ NO SECOND SCHEDULE. Every date here comes from binSchedule's collections
   and its window rule; nothing in this file re-derives a collection day. The
   one clock it does read is LAST_CHANCE_UNTIL_HOUR, and it reads it from there
   rather than restating 7 — two modules disagreeing about when the truck has
   been is the exact drift this borrow prevents.
   ═══════════════════════════════════════════════════════════════════════════ */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The dog roster. `anchor` is the night `onAnchor` feeds; every night after
 *  alternates. Owner's instruction, 2026-08-27. */
export const DOG_ROSTER = Object.freeze({
  anchor: "2026-08-27",
  onAnchor: "Brett",
  alternate: "Greg"
});

/** The bin roster, keyed by the SECOND bin's colour. Red is on every
 *  collection and so decides nothing. Owner's instruction, 2026-08-27. */
export const BIN_ROSTER = Object.freeze({ green: "Brett", yellow: "Greg" });

function addDays(date, days) {
  const next = startOfLocalDay(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Local date → "YYYY-MM-DD". ⚠ NOT toISOString(), which is UTC and lands on
 *  the previous day for every Brisbane evening. */
function isoLocalDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Whose night it is to feed the dogs on the given DATE.
 *
 * The unit is the calendar day, not "the last time it got dark": at 1am the
 * roster has already turned over. That is the readable rule for a chore done in
 * the evening — the wall says one name all day and changes it at midnight — and
 * anything cleverer would need to know when the feed actually happened, which
 * nothing here does.
 */
export function dogFeederOn(when = new Date(), roster = DOG_ROSTER) {
  const anchor = parseLocalDate(roster.anchor);
  if (!anchor) return null;
  const days = Math.round((startOfLocalDay(when) - anchor) / MS_PER_DAY);
  /* ⚠ `days % 2` IS NEGATIVE BEFORE THE ANCHOR, and -1 !== 1, so a plain
     remainder inverts the whole roster for every past date — silently, and
     only on the half of the calendar nobody writes a test for. */
  return ((days % 2) + 2) % 2 === 0 ? roster.onAnchor : roster.alternate;
}

/**
 * Whose turn the bins are, from the colours going out.
 *
 * Returns null rather than a guess when the colours name nobody (red alone —
 * which is what binSchedule's fallback produces with no BIN_YELLOW_REFERENCE)
 * or name two people (impossible on this council's schedule, so if it ever
 * happens the honest answer is that the roster does not cover it).
 */
export function binPersonFor(colours, roster = BIN_ROSTER) {
  const present = new Set(
    (Array.isArray(colours) ? colours : []).map((c) => String(c ?? "").toLowerCase())
  );
  const named = [...new Set(
    Object.entries(roster)
      .filter(([colour]) => present.has(colour))
      .map(([, person]) => person)
  )];
  return named.length === 1 ? named[0] : null;
}

/**
 * The next collection that is still ahead of the household.
 *
 * Today counts until LAST_CHANCE_UNTIL_HOUR and not after — past that the truck
 * has been, and calling this morning's collection "next" would put a bin night
 * in the future that is already in the past. Same boundary binWindow uses to
 * stop reminding, borrowed rather than restated.
 */
export function nextCollection(collections, now = new Date()) {
  const today = startOfLocalDay(now);
  const floor = now.getHours() < LAST_CHANCE_UNTIL_HOUR ? today : addDays(today, 1);
  return (Array.isArray(collections) ? collections : [])
    .find((entry) => entry.date >= floor) ?? null;
}

/** A collection → the shape the surfaces read, with its owner attached. */
export function describeCollection(collection, now = new Date(), roster = BIN_ROSTER) {
  if (!collection) return null;
  const colours = collection.bins.map((bin) => bin.colour);
  /* ⚠ THE BINS GO OUT THE NIGHT BEFORE THE TRUCK. Every sentence anyone says
     about a bin night — "out tonight", "Wednesday night", the reminder window's
     whole existence — is about THIS date, not the collection date. Naming it
     here is the only way a caller can say "tonight" without doing the minus-one
     itself and getting it wrong on the one day a month it matters. */
  const eve = addDays(collection.date, -1);
  return {
    date: isoLocalDate(collection.date),
    // Named here rather than client-side on purpose: "2026-08-27" through the
    // string constructor is UTC midnight and names the wrong weekday west of
    // Greenwich — the trap binSchedule.js opens by warning about.
    weekday: collection.date.toLocaleDateString("en-AU", { weekday: "long" }),
    inDays: Math.round((collection.date - startOfLocalDay(now)) / MS_PER_DAY),
    eve: {
      date: isoLocalDate(eve),
      weekday: eve.toLocaleDateString("en-AU", { weekday: "long" }),
      inDays: Math.round((eve - startOfLocalDay(now)) / MS_PER_DAY)
    },
    colours,
    words: collection.bins.map((bin) => bin.word),
    person: binPersonFor(colours, roster)
  };
}

/**
 * The whole roster as of `now`. Never throws — the dogs are answerable from the
 * clock alone, so a dead council calendar costs the bin half and nothing else.
 */
/* The roster stated in words, generated from the constants above rather than
   written out beside them. It exists because the conversational lane's model
   is asked things the fast lane refuses — "who's on next Saturday?" — and a
   model given only tonight's name has to guess, while a model given the RULE
   can count. Anything that restated these sentences by hand would be a fourth
   copy of the roster and the first one able to disagree with it. */
export function rosterRules(dogRoster = DOG_ROSTER, binRoster = BIN_ROSTER) {
  return [
    `the dogs alternate nightly, ${dogRoster.onAnchor} then ${dogRoster.alternate}`,
    `bin nights go by colour — red+green are ${binRoster.green}'s, red+yellow are ${binRoster.yellow}'s`
  ];
}

export async function loadChores({ now = new Date() } = {}) {
  const dogs = {
    tonight: dogFeederOn(now),
    tomorrow: dogFeederOn(addDays(now, 1))
  };

  if (!binsConfigured()) {
    return { configured: true, dogs, bins: { configured: false }, rules: rosterRules() };
  }

  const { collections, source } = await loadCollections({ now });
  const window = binWindow(collections, now);

  return {
    configured: true,
    dogs,
    rules: rosterRules(),
    bins: {
      configured: true,
      // The reminder window — whether the bins want doing RIGHT NOW.
      due: window.due,
      eve: window.eve,
      lastChance: window.lastChance,
      // The roster question — whose turn it is next, window or no window.
      next: describeCollection(nextCollection(collections, now), now),
      source
    }
  };
}
