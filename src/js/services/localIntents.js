/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   LOCAL INTENTS — the fast lane.

   Pure. No DOM, no fetch, no imports. Text in, an intent out. It unit-tests in
   plain node, which is the whole reason it exists as its own module: the lane
   that has to answer in under 300ms is the one you least want to be debugging
   through a browser.

   WHY THIS MATTERS MORE THAN IT LOOKS. The cascaded voice pipeline here is
   whisper -> LLM -> Kokoro, which costs 2-4 seconds end to end. Natural human
   turn-taking sits at 200-500ms. No amount of visual treatment closes that gap;
   the only thing that closes it is NOT MAKING THE ROUND TRIP. Every utterance
   matched here is answered from data already in memory, and the difference
   between 250ms and 3s is the difference between a house that answers and a
   device you wait on.

   The ordering rule: MOST SPECIFIC FIRST. "what's on today" must beat "what's
   on", and "when's sunset" must beat "when". First match wins, so a general
   pattern placed above a specific one silently eats it — which is why the
   tests assert the specific ones resolve, not merely that something matched.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Cameras the house can be asked for by name. Slot values map to camera ids. */
export const CAMERA_ALIASES = {
  doorbell: ["door", "doorbell", "front door", "the door"],
  front_yard: ["front", "front yard", "yard"],
  driveway: ["driveway", "drive"],
  backyard: ["backyard", "back yard", "out the back", "back"],
  patio: ["patio"],
  side_gate: ["side gate", "gate", "side"],
  tilt_pan: ["tilt", "pan", "tilt pan"]
};

/* Each entry: { id, re, slots? }. `re` is tested against the normalised text.
   Kept as one ordered list rather than grouped maps so the precedence is
   readable top to bottom — precedence IS the design here. */
const INTENTS = [
  // ── Meta ────────────────────────────────────────────────────────────────
  // First, deliberately: "what can I say" must never be swallowed by a
  // content pattern, because it is the escape hatch when nothing else worked.
  { id: "meta.vocabulary", re: /\b(what can (i|you) (say|do)|what do you (know|do)|help me|your commands)\b/ },
  { id: "meta.repeat", re: /\b(say (that )?again|repeat( that)?|what did you say|come again)\b/ },

  // ── Actions ─────────────────────────────────────────────────────────────
  { id: "action.goodnight", re: /\b(good\s*night|night\s*night|sleep\s*mode|going to bed|bed\s*time)\b/ },

  // ── Time ────────────────────────────────────────────────────────────────
  { id: "time.sunset", re: /\b(sun\s*set|sundown|when.*(sun|it).*(set|go down)|how long.*(daylight|light left)|dark)\b/ },
  { id: "time.sunrise", re: /\b(sun\s*rise|when.*sun.*(rise|come up)|first light)\b/ },
  { id: "time.date", re: /\b(what.*(date|day is)|what day|today.s date)\b/ },
  { id: "time.now", re: /\b(what.*time|time is it|got the time)\b/ },

  // ── Weather ─────────────────────────────────────────────────────────────
  // Actionable questions come before the general readout: someone asking
  // "do I need a jacket" wants a yes, not a barometric report.
  { id: "weather.umbrella", re: /\b(umbrella|rain\s*coat|need.*(rain|wet)|is it.*(rain|wet)|going to rain|rain.*(today|soon|later))\b/ },
  { id: "weather.jacket", re: /\b(jacket|jumper|coat|cold out|warm out|need.*(warm|layer))\b/ },
  { id: "weather.sunscreen", re: /\b(sunscreen|sun\s*block|uv|burn)\b/ },
  { id: "weather.wind", re: /\b(wind(y|s)?|breeze|gust)\b/ },
  { id: "weather.tomorrow", re: /\b(weather|forecast|hot|cold|rain|temp).*(tomorrow)|tomorrow.*(weather|forecast|like)\b/ },
  { id: "weather.today", re: /\b((high|top|max|low|min).*(today)|how (hot|cold|warm).*(today|get)|today.s (high|top|max))\b/ },
  { id: "weather.now", re: /\b(weather|temperature|how.s (it )?outside|outside like|how (hot|cold|warm) is it|what.s it like)\b/ },

  // ── Lists ───────────────────────────────────────────────────────────────
  // ABOVE the calendar, deliberately. "what's on the shopping list" and
  // "what's on today" both begin "what's on", and the calendar's pattern is the
  // greedier of the two — with the order reversed it silently ate every
  // shopping-list question, which is exactly what the precedence tests caught.
  { id: "list.shopping", re: /\b(shopping list|groceries|grocery list|what.*(buy|shop))\b/ },
  { id: "list.todo", re: /\b(to.?do|task(s)?|jobs|my list|what.*(need|have) to do)\b/ },

  // ── The house ───────────────────────────────────────────────────────────
  { id: "house.media", re: /\b(what.s (playing|on the (tv|telly)|on telly)|now playing|what are we watching|what.s this song)\b/ },
  { id: "house.who", re: /\b(who.s (home|here|in)|is anyone (home|here|in)|anybody (home|here)|is (\w+) home)\b/ },
  { id: "house.bins", re: /\b(bin(s)?|recycling|rubbish|trash|garbage|wheelie)\b/ },
  { id: "house.vacuum", re: /\b(vacuum|roborock|robot|hoover)\b/ },
  { id: "house.downloads", re: /\b(download(s|ing)?|torrent|queue|sonarr|radarr)\b/ },

  // ── Personal ────────────────────────────────────────────────────────────
  // Widened after the fast lane missed "how'd I sleep" and the turn fell all
  // the way through to Claude, which has no CPAP data and said so. The house
  // holds the answer (sensor.cpap_total_myair_score); the only thing between
  // the question and it was this line. Bare "sleep" is still NOT enough — that
  // would swallow "sleep mode" and "I'm going to sleep", which action.goodnight
  // above already owns.
  { id: "self.sleep", re: /\b(how.?(d|did|was).{0,12}(i|my|you).{0,6}sleep|did (i|you) sleep|my sleep|sleep score|slept|night.?s sleep|sleep last night|sleep quality|cpap|myair|ahi)\b/ },
  { id: "self.commute", re: /\b(commute|traffic|how long.*(work|drive)|drive to work|get to work)\b/ },
  { id: "self.fuel", re: /\b(fuel|petrol|gas price|servo|fill up|cheapest.*(fuel|petrol))\b/ },

  // ── Cameras / security ──────────────────────────────────────────────────
  { id: "camera.last", re: /\b(who was at|anyone at|any (motion|movement)|anything happen|who came)\b/ },

  // ── Calendar ────────────────────────────────────────────────────────────
  // LAST of the content intents, because "what's on" is the greediest pattern
  // in the whole table and anything it can swallow must be given its chance
  // first.
  { id: "cal.tomorrow", re: /\b(tomorrow).*(on|happening|calendar|diary|schedule)|what.*(on|doing).*tomorrow\b/ },
  { id: "cal.next", re: /\b(next (event|thing|up)|what.s next|coming up|after this)\b/ },
  { id: "cal.free", re: /\b(am i free|are we free|anything on|much on|busy (today|tomorrow))\b/ },
  { id: "cal.today", re: /\b(what.s on( today)?|on today|today.*(happening|agenda|calendar|diary|schedule)|happening today|what.*going on)\b/ },

  // ── Show me (V3 depth 3 subjects) ───────────────────────────────────────
  // These carry a slot, so they are matched by a resolver below rather than a
  // bare regex — a camera name has to come out of the utterance, not just a
  // yes/no that one was mentioned.
  { id: "show.sky", re: /\b(show|pull up|bring up).*(sky|radar|rain map)|\b(the )?radar\b/ },
  { id: "show.tonight", re: /\b(show|what about).*(tonight)|what.s (on )?tonight\b/ },
  { id: "show.year", re: /\b(show|see).*(the year|this year|our year)\b/ },
  { id: "show.day", re: /\b(show).*(the day|my day|today.s shape)\b/ },

  // Two subjects that have a natural question form with no "show" in it. Both
  // sit at the very bottom because they are the last resort, and both were
  // previously unmatched — "what's for dinner" fell through to Assist, and the
  // briefing is caught one layer earlier on the incumbent by voiceCommands'
  // BRIEFING_RE, which runs before this table is ever consulted.
  { id: "show.recipe", re: /\b(what.s for dinner|what are we (having|cooking|eating)|dinner tonight|the recipe)\b/ },
  { id: "show.briefing", re: /\b(brief me|the briefing|catch me up|what did i miss)\b/ }
];

/* ── The show-me surfaces ───────────────────────────────────────────────────
   Resolved BEFORE the table above, and only when the utterance actually
   carries a show verb. That ordering is the whole design.

   Every noun below already belongs to a spoken intent higher up the table —
   "shopping list" to list.shopping, "what's playing" to house.media — so
   putting these in the table itself would have meant either shadowing those
   (and breaking the incumbent, which has no depth 3 to show them on) or being
   shadowed BY them (and never firing at all). Requiring the verb separates the
   two cleanly: "what's on the shopping list" is still a question to be
   answered, "show me the shopping list" is a request for the screen.

   ⚠ NO BARE TIME WORDS HERE. An earlier draft matched `today` and `what's on`,
   which quietly took "show me what's on today" off cal.today — a phrase people
   really say, answered correctly today. The nouns are all surface nouns.

   ⚠ Each id must also carry an ANSWERER in localAnswers.js. The incumbent has
   no subjects: it reaches these ids and falls straight through to answer(), so
   an id with no answerer would turn a working spoken reply into a trip to
   Assist. The answerers are what make this change invisible on the wall.
─────────────────────────────────────────────────────────────────────────── */
const SHOW_VERB = /\b(show|pull up|bring up|let me see|look at|check)\b/;

const SURFACES = [
  { id: "show.list",     re: /\b(shopping list|grocer(y|ies)|the shopping)\b/, slots: { list: "shopping" } },
  { id: "show.list",     re: /\b(to.?do list|task list|my list|the list)\b/,   slots: { list: "todo" } },
  { id: "show.recipe",   re: /\b(the recipe|dinner|the menu|what we.re (cooking|having))\b/ },
  { id: "show.briefing", re: /\b(the brief(ing)?|the rundown)\b/ },
  { id: "show.media",    re: /\b(what.s playing|now playing|the album|album art|what we.re watching)\b/ },
  { id: "show.year",     re: /\b(the year|this year|our year|memories|(the )?photos)\b/ },
  { id: "show.day",      re: /\b(the day|my day|the calendar|the diary|my schedule|the agenda)\b/ },
  /* Phase 6. ⚠ Last on purpose, and note that the noun here was ALREADY spoken
     for — not by this table, which has no status intent, but by voiceCommands'
     NAV_KEYWORD_MAP, which matches a bare "status"/"system" and switches the
     incumbent to its status view. That map runs AFTER matchIntent, so adding
     this row without a matching branch in voiceCommands would have quietly
     taken the incumbent's status view away and replaced it with a sentence.
     `show.camera` and `show.sky` are handled there for exactly this reason. */
  { id: "show.status",   re: /\b(the status|system status|the system|diagnostics)\b/ }
];

function matchSurface(text) {
  for (const { id, re, slots } of SURFACES) {
    if (re.test(text)) return { id, slots: { ...(slots ?? {}) } };
  }
  return null;
}

/** Normalise a raw transcript for matching. Lowercase, strip punctuation that
 *  whisper sprinkles in, collapse whitespace, and drop a leading wake-word
 *  echo — the STT sometimes includes it and it derails anchored patterns. */
export function normalise(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[?!.,;:"]/g, " ")
    .replace(/\b(hey )?(mycroft|jarvis)\b/g, " ")
    // ── Contraction canonicalisation ──────────────────────────────────────
    // Whisper transcribes the same spoken phrase three ways depending on how
    // it was said and how much context it had: "who's home", "who is home",
    // and "whos home" all reach us for identical audio. Patterns written for
    // one form silently miss the other two, and it is invisible in tests unless
    // the tests deliberately use every form — which is how "who is home"
    // shipped as a dead phrase while "who's home" passed.
    //
    // So everything converges on the apostrophe form before matching.
    .replace(/\b(what|who|when|where|how|that|it|there|he|she) is\b/g, "$1's")
    .replace(/\b(what|who|when|where|how|that|it|there|let)s\b/g, "$1's")
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bi am\b/g, "i'm")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Which day is the question about? ───────────────────────────────────────
   ⚠ Until 2026-08-15 the answer was always TODAY. `cal.free` matched the bare
   phrase "am i free" and carried no day slot at all, so "am I free next Tuesday
   afternoon?" was answered "You've got 1 thing on today." The microphone and
   the STT were perfect — the agent logged the sentence verbatim — and every
   word after "free" was simply discarded.

   That failure is worse than not answering, which is the part that shapes this
   whole block. A reply that is confident, fast and about a different day
   teaches the room to stop trusting the lane, and the lane's only asset is
   being trusted at 250ms. So this is the repo's own "absent is not empty" rule
   applied to time: resolve the day when it can be resolved EXACTLY, and
   DECLINE when it cannot. A decline costs one 2-4s trip to a lane that can
   reason about Tuesday; a wrong day costs the whole lane.

   ⚠⚠ THE RANGE IS BOUNDED BY THE FEED, NOT BY THE PARSER — this is the reason
   the resolver stops where it does, and it is not obvious from here.
   `/api/calendar/all` expands recurring events only inside
   `getRecurrenceWindow()`, the first of this month minus 7 days to the last of
   this month plus 7 (server/routes/calendar.js:20), while one-off events arrive
   unfiltered. Past that window the feed is SILENTLY INCOMPLETE: a standing
   weekly commitment is simply not in it, so "you're free" would be exactly the
   confident lie this block exists to prevent. Measured on the live feed
   2026-08-15: 383 events, only 8 future days carrying one, and nothing at all
   between 27 Aug and 19 Nov.

   A weekday name can never resolve more than 7 days out, and the window always
   reaches at least 7 days ahead (its floor is the last day of the month, plus
   7) — so every day this resolver CAN name is inside the complete part of the
   feed, by construction. Everything that would reach past it — a month, a date,
   "next week", "the weekend" — is refused rather than parsed.
─────────────────────────────────────────────────────────────────────────── */

/** A day was named that the lane must not answer for. Deliberately distinct
 *  from `null`, which means no day was named at all and the intent's own
 *  default (today) still stands — that difference is the whole feature. */
export const DAY_BEYOND = Symbol("day-beyond-the-feed");

/* Full names only. Whisper writes spoken weekdays out in full, so the short
   forms buy nothing and cost collisions — a bare `sun` sits inside every
   question about sunset, and `sat` inside half the sentences in English. */
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/* Parts of a day as [from, to) in local hours. `arvo` is here because the house
   is in Brisbane and that is the word people actually say to it. */
const PARTS = [
  { re: /\bmorning\b/, word: "morning", from: 0, to: 12 },
  { re: /\b(afternoon|arvo)\b/, word: "afternoon", from: 12, to: 17 },
  { re: /\b(evening|tonight|night)\b/, word: "evening", from: 17, to: 24 }
];

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";

/* Everything that names a day the feed cannot be trusted about. Refusing here
   is always the safe direction: a false refusal costs one slow answer, a false
   parse costs a wrong one. That is why bare `may` is in the month list despite
   also being an English verb — nobody asks a kiosk "when may I". */
const BEYOND_RE = new RegExp(
  [
    `\\b(${MONTHS})\\b`,
    "\\b\\d{1,2}(st|nd|rd|th)\\b",
    "\\b(next|last|this) (week|fortnight|month|year)\\b",
    "\\bweekend\\b",
    "\\bin \\d+ (day|days|week|weeks|month|months)\\b",
    "\\byesterday\\b",
    `\\blast (night|${WEEKDAYS.join("|")})\\b`
  ].join("|")
);

const ordinal = (n) => {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/* How the day gets SAID. Today and tomorrow are named the way people name them;
   a weekday also carries its date, which is what makes the "next Tuesday"
   reading below safe to take.

   TWO forms, because English needs both. `label` heads a sentence ("Tuesday,
   the 18th: Physio"); `when` is the same day as a prepositional phrase and
   carries its own "on", because the preposition is not uniform — "nothing on
   today" and "nothing on tonight" are right, and "nothing on this morning" is
   not. Getting that wrong is small and audible, which on a spoken surface is
   the kind of wrong that gets noticed every time. */
function nameDay(offset, part, now) {
  const w = part?.word ?? null;
  if (offset === 0) {
    if (!w) return { label: "today", when: "on today" };
    if (w === "evening") return { label: "tonight", when: "on tonight" };
    return { label: `this ${w}`, when: `this ${w}` };
  }
  if (offset === 1) {
    if (!w) return { label: "tomorrow", when: "on tomorrow" };
    const night = w === "evening" ? "night" : w;
    return { label: `tomorrow ${night}`, when: `tomorrow ${night}` };
  }
  /* Host-local, deliberately: `onDay()` in localAnswers.js buckets events with
     toDateString(), which is also host-local. Two clocks here would put the
     label and the events it counts on different days at the margins. */
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  const name = WEEKDAYS[d.getDay()];
  const label = `${name.charAt(0).toUpperCase()}${name.slice(1)}${w ? ` ${w}` : ""}, the ${ordinal(d.getDate())}`;
  return { label, when: `on ${label}` };
}

/**
 * Resolve the day an utterance is asking about.
 * @returns {{offset:number, part:object|null, label:string, when:string}|null|symbol}
 *          an object when a day resolves exactly, `null` when no day was named
 *          (the intent's own default stands), `DAY_BEYOND` when a day was named
 *          that the feed cannot be trusted about.
 */
export function resolveDay(raw, now = new Date()) {
  const text = normalise(raw);
  if (!text) return null;
  if (BEYOND_RE.test(text)) return DAY_BEYOND;

  const part = PARTS.find((p) => p.re.test(text)) ?? null;

  let offset = null;
  if (/\btomorrow\b/.test(text)) offset = 1;
  else if (/\btoday\b/.test(text)) offset = 0;
  else {
    const idx = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(text));
    if (idx >= 0) {
      /* "Next Tuesday" is genuinely ambiguous in English and speakers disagree
         about it. Rather than pick a reading and hide it, the lane takes the
         NEAREST future occurrence and NAMES THE DATE in the reply, so a
         mismatched reading is audible and self-correcting instead of silent.
         The one place "next" changes the answer is when it is said ON that
         weekday, where it cannot mean today. (Owner's call, 2026-08-15.) */
      const delta = (idx - now.getDay() + 7) % 7;
      offset = delta === 0 && new RegExp(`\\bnext ${WEEKDAYS[idx]}\\b`).test(text) ? 7 : delta;
    }
  }

  // A bare part of day with no day attached means the one we are in.
  if (offset === null && !part) return null;
  const resolved = offset ?? 0;
  return { offset: resolved, part, ...nameDay(resolved, part, now) };
}

/* Which days each calendar intent is able to honour. An intent asked about a
   day it cannot answer for DECLINES, and the turn falls through to a lane that
   can — rather than answering confidently about a different day. */
const CAL_DAYS = {
  "cal.today": () => true,
  "cal.free": () => true,
  "cal.tomorrow": (d) => d.offset === 1,
  "cal.next": () => false,            // "what's next" has no day to take
  "show.day": (d) => d.offset === 0   // the subject draws today, and only today
};

/* Applied to BOTH match paths — the show-verb resolver returns before the
   table is ever reached, so a guard in only one of them would leave the other
   answering about the wrong day. */
function gateDay(result, text) {
  if (!result || !(result.id in CAL_DAYS)) return result;
  const day = resolveDay(text);
  if (day === DAY_BEYOND) return null;
  if (!day) return result;
  if (!CAL_DAYS[result.id](day)) return null;
  // show.day can only be today, so it needs no slot to say so.
  if (result.id !== "show.day") result.slots = { ...(result.slots ?? {}), day };
  return result;
}

/** Pull a camera id out of an utterance, or null. Longest alias first so
 *  "side gate" is not shadowed by "side" or "gate". */
export function matchCamera(text) {
  const t = normalise(text);
  const pairs = [];
  for (const [id, aliases] of Object.entries(CAMERA_ALIASES)) {
    for (const a of aliases) pairs.push([id, a]);
  }
  pairs.sort((x, y) => y[1].length - x[1].length);
  for (const [id, alias] of pairs) {
    if (new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`).test(t)) return id;
  }
  return null;
}

/**
 * Match an utterance to a local intent.
 * @returns {{id: string, slots: object}|null} null means "not ours" — the
 *          caller falls through to HA Assist and then to the model.
 */
/* A leading imperative verb means the utterance is a COMMAND, not a question,
   and commands belong to HA Assist — it owns the devices and the todo lists,
   and it can actually change something. "add oat milk to the shopping list"
   shares almost every word with "what's on the shopping list" and means the
   opposite; without this guard the fast lane cheerfully reads the list back
   instead of adding to it.

   Anchored to the START on purpose. An unanchored \bset\b would swallow "what
   time does the sun set", which is the kind of collision that only shows up
   once someone actually asks. */
const MUTATION_RE =
  /^(please\s+)?(can|could|would)?\s*(you\s+)?(add|put|remove|delete|clear|set|turn|switch|play|pause|stop|open|close|lock|unlock|dim|brighten|remind|create|schedule|start|make|send|call)\b/;

/* ── The photograph veto ────────────────────────────────────────────────────
   "Not this one" is the only quality signal the photo library has; everything
   automatic was measured and rejected (see services/photoVeto.js). Matching it
   here rather than in INTENTS because of the mutation guard below.

   ⚠⚠ THESE MUST BE TESTED BEFORE `MUTATION_RE`, and the exception is principled
   rather than convenient. That guard sends commands to HA Assist because Assist
   owns the things a command can change — but Assist cannot hide a photograph on
   this wall, and neither can the model behind it. "delete this photo" and
   "remove that one" open with banned verbs, so without this they fall through
   to a lane that can only *sound* like it complied. The local lane is the only
   lane that can act, so it is the only lane allowed to match.

   Kept narrow deliberately: every alternative names a photograph, or is one of
   the two bare demonstratives ("not this one"/"not that one") that only ever
   mean this while a photograph is on the wall. The handler falls through when
   the ground has nothing showing, so a stray match costs a beat, not a memory. */
const PHOTO_VETO_RE =
  /\b(not (this|that) (one|photo|picture|image)|(hide|delete|remove) (this|that|it)( ?(one|photo|picture|image))?|never show (this|that|it)( one| photo| picture| image)?( again)?|get rid of (this|that|it)( one| photo| picture| image)?|don.t (show|like) (this|that)( one| photo| picture| image)?)\b/;

/* The way back. Speech misfires, and a veto with no undo turns one mishearing
   into a photograph nobody can find again. */
const PHOTO_RESTORE_RE =
  /\b(bring (that|it|the photo|the picture) back|put (that|it) back|undo( that)?|i did ?n.t mean (that|it)|bring back (that|the last) (one|photo|picture))\b/;

export function matchIntent(raw) {
  const text = normalise(raw);
  if (!text) return null;
  if (PHOTO_RESTORE_RE.test(text)) return { id: "photo.restore" };
  if (PHOTO_VETO_RE.test(text)) return { id: "photo.veto" };
  if (MUTATION_RE.test(text)) return null;

  // "show me the driveway" and friends resolve first when a camera is named,
  // because a camera name is a much stronger signal than any keyword below.
  // Then the other surfaces, for the same reason: with a show verb present the
  // person is asking for the screen, not for a sentence.
  if (SHOW_VERB.test(text)) {
    const cam = matchCamera(text);
    if (cam) return { id: "show.camera", slots: { camera: cam } };
    const surface = matchSurface(text);
    if (surface) return gateDay(surface, text);
  }
  // A bare "who was at the door" also names a camera worth surfacing.
  const bareCam = /\b(who was at|anyone at|any (motion|movement))\b/.test(text) ? matchCamera(text) : null;

  for (const { id, re } of INTENTS) {
    if (re.test(text)) {
      const slots = {};
      if (id === "camera.last" && bareCam) slots.camera = bareCam;
      if (id === "house.who") {
        const m = text.match(/\bis (\w+) home\b/);
        if (m && !["anyone", "anybody", "everyone"].includes(m[1])) slots.person = m[1];
      }
      return gateDay({ id, slots }, text);
    }
  }
  return null;
}

/** Every intent id the lane can produce — used by the vocabulary card and by
 *  the tests, so a new intent cannot be added without both noticing. */
export const INTENT_IDS = Object.freeze([
  ...new Set([
    ...INTENTS.map((i) => i.id),
    ...SURFACES.map((s) => s.id),
    "show.camera"
  ])
]);
