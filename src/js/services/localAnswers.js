/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   LOCAL ANSWERS — intent + snapshot -> what the house says.

   Pure, like the matcher. Everything it needs arrives in the snapshot, so the
   answer costs no network and no DOM read, and it unit-tests in plain node.

   TWO RULES, both enforced here rather than trusted:

   1. TWO SENTENCES, MAXIMUM. Spoken replies overflow working memory fast — the
      Rabbit R1's 9.2-second average reply is the canonical failure of this
      whole product category. Anything longer than two sentences belongs on the
      screen with the voice pointing at it.

   2. NEVER SPEAK A LIST OF MORE THAN THREE. Lists are a screen job. A voice
      reading six calendar events is not being helpful, it is being a queue.

   Every answer degrades honestly. "I don't know" is a valid answer and is
   always better than a confident wrong one, because the second kind teaches
   the family to stop trusting the first kind.
   ═══════════════════════════════════════════════════════════════════════════ */

import { MEAL_PREFIX } from "./mealEvent.js";

const TZ = "Australia/Brisbane";

const time = (d) =>
  d ? new Date(d).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }) : null;

/** Cap at two sentences. The cap is applied to the FINAL string so no answer
 *  can route around it by composing its parts separately. */
export function capSentences(text, max = 2) {
  if (typeof text !== "string") return "";
  const t = text.trim();
  if (!t) return "";

  // A full stop is only a SENTENCE END when whitespace or the end of the string
  // follows it. Splitting on every "." instead turns "Nightswimming by R.E.M."
  // into "Nightswimming by R.E." — which is what this house would have said out
  // loud, and which also breaks Dr., St., Mt. and every set of initials.
  const parts = [];
  const terminator = /[.!?]+(?=\s|$)/g;
  let start = 0;
  let m;
  while ((m = terminator.exec(t)) !== null) {
    const end = m.index + m[0].length;
    parts.push(t.slice(start, end));
    start = end;
    if (parts.length >= max) break;
  }
  if (parts.length === 0) return t;                    // no terminator at all
  if (parts.length < max && start < t.length) parts.push(t.slice(start));
  return parts.slice(0, max).join("").trim();
}

/** Join at most three items, spoken. More than three is a screen's job. */
function speakList(items, { max = 3 } = {}) {
  const list = items.filter(Boolean).slice(0, max);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const last = list[list.length - 1];
  return `${list.slice(0, -1).join(", ")} and ${last}`;
}

const round = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);

/** Add a full stop only if one is not already there. Titles and names routinely
 *  end in punctuation of their own ("R.E.M.", "Where Are You Now?"), and
 *  blindly appending gives "R.E.M.." — which the TTS reads as a stumble. */
const endStop = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/* ── The answerers ──────────────────────────────────────────────────────────
   Each takes (snapshot, slots) and returns { speech, refs } or null. `refs`
   name cells currently on screen so the surface can light what is being talked
   about — the deixis link that makes the screen and the speaker one system.
─────────────────────────────────────────────────────────────────────────── */
const ANSWERERS = {
  "time.now": () => ({
    speech: `It's ${new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ })}.`,
    refs: ["hour"]
  }),

  "time.date": () => ({
    speech: `It's ${new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}.`,
    refs: ["hour"]
  }),

  "time.sunset": (s) => {
    const t = time(s.sun?.sunset);
    if (!t) return null;
    const mins = s.sun?.sunset ? Math.round((new Date(s.sun.sunset) - Date.now()) / 60000) : null;
    if (mins != null && mins > 0 && mins < 90) return { speech: `Sunset's at ${t}, about ${mins} minutes away.`, refs: ["sky"] };
    if (mins != null && mins <= 0) return { speech: `The sun set at ${t}.`, refs: ["sky"] };
    return { speech: `Sunset's at ${t}.`, refs: ["sky"] };
  },

  "time.sunrise": (s) => {
    const t = time(s.sun?.sunrise);
    return t ? { speech: `Sunrise is at ${t}.`, refs: ["sky"] } : null;
  },

  /* ── The weather family ──────────────────────────────────────────────────
     Every answerer below reads `slots.day` the same way the calendar ones do,
     and every one of them is UNCHANGED when the utterance named no day or named
     today — those sentences are byte-identical to what they said before the
     slot reached this family, which is the rollback.

     A future day is a different question with a different source: `s.weather`
     is a reading of RIGHT NOW and has nothing to say about Saturday, so the
     answer comes from `s.forecast` via forecastDay() or it does not come. */

  "weather.now": (s, slots) => {
    // "What's the weather on Tuesday" is not a question about now — this line
    // is the reported defect (F8), which answered it "It's 18 degrees and clear."
    if (future(slots)) return forecastSpeech(s, slots.day);
    const n = s.weather?.now;
    if (!n || n.temp_c == null) return null;
    const label = n.condition?.label ? n.condition.label.toLowerCase() : null;
    return { speech: `It's ${round(n.temp_c)} degrees${label ? ` and ${label}` : ""}.`, refs: ["weather"] };
  },

  "weather.today": (s, slots) => {
    if (future(slots)) return forecastSpeech(s, slots.day);
    const d = s.weather?.day;
    if (!d || d.high_c == null) return null;
    return { speech: `Today's top is ${round(d.high_c)}, low of ${round(d.low_c)}.`, refs: ["weather"] };
  },

  "weather.tomorrow": (s, slots) => forecastSpeech(s, slots?.day ?? DAY_TOMORROW),

  "weather.umbrella": (s, slots) => {
    if (future(slots)) {
      /* ⚠ THE NOWCAST MUST NOT REACH HERE. It is a radar extrapolation of the
         next ~90 minutes, so "rain in about 20 minutes" is a true sentence
         about now and a nonsense one about Thursday. Returning before the
         branch below is what keeps it out. */
      const p = forecastDay(s, slots.day)?.rain_chance_pct;
      if (p == null) return null;
      const when = dayPhrase(slots.day);
      if (p >= 50) return { speech: `Probably — ${p} percent chance ${when}.`, refs: ["weather"] };
      if (p >= 20) return { speech: `Maybe. ${p} percent ${when}.`, refs: ["weather"] };
      return { speech: `No, only ${p} percent ${when}.`, refs: ["weather"] };
    }
    // The nowcast is the good answer when it has one — "in 20 minutes" is
    // actionable in a way that "40% chance" never is.
    const nc = s.nowcast;
    if (nc && typeof nc.startsInMin === "number") {
      return { speech: `Yes — rain in about ${nc.startsInMin} minutes.`, refs: ["weather", "sky"] };
    }
    const p = s.weather?.now?.rain_chance_pct;
    if (p == null) return null;
    if (p >= 50) return { speech: `Probably — ${p} percent chance of rain.`, refs: ["weather"] };
    if (p >= 20) return { speech: `Maybe. ${p} percent chance.`, refs: ["weather"] };
    return { speech: `No, only ${p} percent chance of rain.`, refs: ["weather"] };
  },

  "weather.jacket": (s, slots) => {
    if (future(slots)) {
      /* Answered from the LOW, not from feels-like — the forecast carries no
         apparent temperature. A day can be cold at seven and mild by noon, so
         the verdict says which part of it it means and names the number, the
         way the calendar's reply names the date. */
      const f = forecastDay(s, slots.day);
      const low = round(f?.low_c);
      if (low == null) return null;
      const high = round(f.high_c);
      const when = dayPhrase(slots.day);
      if (high != null && high < 19) return { speech: `Yes — ${low} to ${high} ${when}.`, refs: ["weather"] };
      if (low < 14) return { speech: `Yes, first thing — down to ${low} ${when}.`, refs: ["weather"] };
      if (low < 19) return { speech: `Maybe early — down to ${low} ${when}.`, refs: ["weather"] };
      return { speech: `No need — ${low} to ${high} ${when}.`, refs: ["weather"] };
    }
    const t = s.weather?.now?.feels_like_c ?? s.weather?.now?.temp_c;
    if (t == null) return null;
    if (t < 14) return { speech: `Yes — it feels like ${round(t)}.`, refs: ["weather"] };
    if (t < 19) return { speech: `Maybe a light one, it feels like ${round(t)}.`, refs: ["weather"] };
    return { speech: `No need, it feels like ${round(t)}.`, refs: ["weather"] };
  },

  /* ⚠ UV AND WIND ARE NOT IN THE FORECAST FEED — see DAY_INTENTS in
     localIntents.js, which declines a future day before these are ever reached.
     The guard is repeated here because an answerer that would silently report
     the CURRENT uv for a question about Saturday is exactly the defect this
     whole change is about, and it should be impossible from either direction. */
  "weather.sunscreen": (s, slots) => {
    if (future(slots)) return null;
    const uv = s.weather?.now?.uv;
    if (uv == null) return null;
    if (uv >= 8) return { speech: `Definitely — UV is ${round(uv)}, that's very high.`, refs: ["weather"] };
    if (uv >= 3) return { speech: `Yes, UV is ${round(uv)}.`, refs: ["weather"] };
    return { speech: `Not really, UV is only ${round(uv)}.`, refs: ["weather"] };
  },

  "weather.wind": (s, slots) => {
    if (future(slots)) return null;
    const w = s.weather?.now?.wind_kph;
    if (w == null) return null;
    const calm = w < 12 ? "fairly calm" : w < 30 ? "breezy" : "quite windy";
    return { speech: `It's ${calm}, ${round(w)} k p h.`, refs: ["weather"] };
  },

  /* NOT LOADED IS NOT EMPTY. If the calendar upstream is down, s.calendar is
     undefined — and answering "nothing on today" would be a confident lie on
     the exact day someone is relying on it. Returning null falls the turn
     through to Assist, which is slower and correct. Only an array that really
     is empty earns "nothing on".

     The DAY these read is `slots.day`, resolved by localIntents' resolveDay and
     defaulting to today when the utterance named no day. With no day named the
     sentences below are byte-identical to what they said before. */
  "cal.today": (s, slots) => readout(s, slots, DAY_TODAY),

  "cal.tomorrow": (s, slots) => readout(s, slots, DAY_TOMORROW),

  "cal.next": (s) => {
    if (!Array.isArray(s.calendar)) return null;
    const next = s.calendar
      .filter((e) => new Date(e.start) > new Date())
      .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
    if (!next) return { speech: "Nothing coming up.", refs: ["calendar"] };
    return { speech: `Next is ${spokenTitle(next)}, at ${time(next.start)}.`, refs: ["calendar"] };
  },

  /* Free/busy is the one question a dinner plan must not answer — see isMeal. */
  "cal.free": (s, slots) => {
    if (!Array.isArray(s.calendar)) return null;
    const day = slots?.day ?? DAY_TODAY;
    const ev = inWindow(s.calendar, day).filter((e) => !isMeal(e));
    if (ev.length === 0) return { speech: `You're free — nothing ${day.when}.`, refs: ["calendar"] };
    return { speech: `You've got ${ev.length} thing${ev.length === 1 ? "" : "s"} ${day.when}.`, refs: ["calendar"] };
  },

  "house.who": (s, slots) => {
    const people = s.people ?? [];
    if (people.length === 0) return null;
    if (slots?.person) {
      const p = people.find((x) => x.name?.toLowerCase().startsWith(slots.person));
      if (!p) return { speech: `I don't know anyone called ${slots.person}.`, refs: [] };
      return { speech: `${p.name} is ${p.home ? "home" : "out"}.`, refs: ["people"] };
    }
    const home = people.filter((p) => p.home).map((p) => p.name);
    if (home.length === 0) return { speech: "Nobody's home.", refs: ["people"] };
    return { speech: `${speakList(home)} ${home.length === 1 ? "is" : "are"} home.`, refs: ["people"] };
  },

  "house.bins": (s) => {
    const b = s.bins;
    if (!b || !b.configured) return null;
    if (!b.due) return { speech: "No bins due tonight.", refs: ["bins"] };
    const names = { red: "general waste", yellow: "recycling", green: "garden" };
    return { speech: `${b.label}: ${speakList((b.bins ?? []).map((x) => names[x] ?? x))}.`, refs: ["bins"] };
  },

  "house.media": (s) => {
    if (!Array.isArray(s.media)) return null;   // no players known != nothing playing
    const m = s.media[0];
    if (!m) return { speech: "Nothing's playing.", refs: ["media"] };
    return { speech: endStop(`${m.title}${m.artist ? ` by ${m.artist}` : ""}`), refs: ["media"] };
  },

  "house.vacuum": (s) => {
    const v = s.vacuum;
    if (!v) return null;
    if (v.problem) return { speech: `The vacuum needs you — ${v.problem}.`, refs: ["vacuum"] };
    return { speech: "The vacuum's fine.", refs: ["vacuum"] };
  },

  "house.downloads": (s) => {
    const d = s.downloads;
    if (!d) return null;
    if (!d.active) return { speech: "Nothing downloading.", refs: ["downloads"] };
    return { speech: `${d.active} downloading${d.title ? `, including ${d.title}` : ""}.`, refs: ["downloads"] };
  },

  "self.sleep": (s) => {
    const sl = s.sleep;
    if (!sl || sl.score == null) return null;
    return { speech: `You scored ${sl.score} last night${sl.label ? ` — ${sl.label}` : ""}.`, refs: ["sleep"] };
  },

  "self.commute": (s) => {
    const c = s.commute;
    if (!c) return null;
    const first = c.greg ?? c.brett;
    if (!first) return null;
    return { speech: `About ${first.minutes} minutes${first.delayMin > 3 ? `, ${first.delayMin} of that is traffic` : ""}.`, refs: ["commute"] };
  },

  "self.fuel": (s) => {
    const site = s.fuel?.sites?.[0];
    if (!site) return null;
    return { speech: `${site.price} cents at ${site.name}.`, refs: ["fuel"] };
  },

  "list.shopping": (s) => {
    if (!Array.isArray(s.todos?.shopping)) return null;   // not loaded != empty
    const items = s.todos.shopping;
    if (items.length === 0) return { speech: "The shopping list is empty.", refs: ["shopping"] };
    const more = items.length > 3 ? ` And ${items.length - 3} more.` : "";
    return { speech: `${speakList(items)}.${more}`, refs: ["shopping"] };
  },

  "list.todo": (s) => {
    if (!Array.isArray(s.todos?.tasks)) return null;      // not loaded != empty
    const items = s.todos.tasks;
    if (items.length === 0) return { speech: "Nothing on your list.", refs: ["todo"] };
    return { speech: `${items.length} thing${items.length === 1 ? "" : "s"}: ${speakList(items)}.`, refs: ["todo"] };
  },

  /* ── The show-me surfaces ────────────────────────────────────────────────
     These ids open a depth-3 subject on V3. They still answer here, and that
     is not belt-and-braces: the incumbent has no subjects at all, so it reaches
     these ids and falls straight through to answer() — without these the
     matcher change would have turned a working spoken reply into a trip to
     Assist. On V3 the same line becomes the POINTER: the voice says the
     headline, the screen carries the rest. Which is the two-sentence cap's
     whole reason for existing, applied on purpose rather than by accident.
  ───────────────────────────────────────────────────────────────────────── */

  "show.list": (s, slots) => {
    const shopping = slots?.list !== "todo";
    const items = shopping ? s.todos?.shopping : s.todos?.tasks;
    if (!Array.isArray(items)) return null;                 // not loaded != empty
    const what = shopping ? "The shopping list" : "Your list";
    if (items.length === 0) return { speech: `${what} is empty.`, refs: [shopping ? "shopping" : "todo"] };
    const more = items.length > 3 ? ` And ${items.length - 3} more.` : "";
    return { speech: `${speakList(items)}.${more}`, refs: [shopping ? "shopping" : "todo"] };
  },

  "show.day": (s) => {
    if (!Array.isArray(s.calendar)) return null;
    const ev = todays(s.calendar);
    if (ev.length === 0) return { speech: "Nothing on today.", refs: ["calendar"] };
    return { speech: `${ev.length} thing${ev.length === 1 ? "" : "s"} on today.`, refs: ["calendar"] };
  },

  // Deliberately does NOT reach for the calendar when the menu is absent. A
  // cold cache and a night with no dinner planned are different, and only the
  // second earns a sentence about it.
  /* Two refs, not one. A ref is a `data-cell` address and unknown ones are
     dropped silently, so naming both the subject's own cell and the composer's
     source name lights the right rectangle whichever depth the surface is at —
     the composed cell carries the CANDIDATE SOURCE (composer.js: `ref:
     candidate.source`), and the subject carries a plain noun. */
  "show.recipe": (s) => {
    if (!Array.isArray(s.calendar)) return null;
    if (!s.menu) return { speech: "Nothing's planned for dinner.", refs: ["menu", "tonightsMenu"] };
    return { speech: endStop(`${s.menu} tonight`), refs: ["menu", "tonightsMenu"] };
  },

  "show.media": (s) => {
    if (!Array.isArray(s.media)) return null;               // no players known != nothing playing
    const m = s.media[0];
    if (!m) return { speech: "Nothing's playing.", refs: ["media", "nowPlaying", "plex"] };
    return {
      speech: endStop(`${m.title}${m.artist ? ` by ${m.artist}` : ""}`),
      refs: ["media", "nowPlaying", "plex"]
    };
  },

  /* show.year and show.briefing are absent on purpose, and differently so.
     The year IS the photographs — a sentence introducing them would be the
     house talking over its own answer. The briefing's text does not exist
     until it has been generated, so its subject speaks its own opening two
     sentences once it has them; there is nothing for a pure answerer to say.
     Both are surface-handled, which the lane spec already allows for. */

  "camera.last": (s) => {
    // Only speak about the cameras if we can actually see them. With HA down
    // "nothing's triggered recently" is a claim about the house that we are in
    // no position to make.
    if (!s.camera?.known) return null;
    const e = s.camera.lastEvent;
    if (!e) return { speech: "Nothing's triggered recently.", refs: ["cameras"] };
    const who = e.person ? `${e.person} ` : "";
    return { speech: `${who}at the ${e.name}, ${time(e.at)}.`, refs: ["cameras"] };
  },

  "meta.repeat": (s) => (s.lastReply ? { speech: s.lastReply, refs: [] } : { speech: "I haven't said anything yet.", refs: [] }),

  // The vocabulary card is a SCREEN answer, so the speech is deliberately a
  // pointer rather than a recital. Reading a menu aloud is the exact failure
  // this whole lane exists to avoid.
  "meta.vocabulary": () => ({ speech: "Here's some of what you can ask me.", refs: [], showVocabulary: true })
};

function todays(events) {
  return onDay(events, 0);
}

/* The day an intent falls back to when the utterance named none. Same shape
   resolveDay produces, so there is one code path rather than two. */
const DAY_TODAY = Object.freeze({ offset: 0, part: null, label: "today", when: "on today" });
const DAY_TOMORROW = Object.freeze({ offset: 1, part: null, label: "tomorrow", when: "on tomorrow" });

/* ── The weather family's day handling ──────────────────────────────────────
   Only a day AFTER today changes any weather answer. Today and "no day named"
   both keep the live reading and the sentence that was there before, which is
   what makes this change invisible until someone asks about Saturday. */
const future = (slots) => (slots?.day?.offset ?? 0) > 0;

/* How the weather says a future day. NOT the calendar's `when`, and the
   difference is audible: "nothing on tomorrow" is idiomatic and "72 percent
   chance on tomorrow" is not. `dayLabel` rather than `label` because the
   forecast is daily — see resolveDay's note on why "Tuesday afternoon" must
   not be echoed back by a source that only knows Tuesday. */
const dayPhrase = (day) => (day.offset === 1 ? "tomorrow" : `on ${day.dayLabel ?? day.label}`);

/* ⚠⚠ THE FORECAST'S HORIZON IS READ, NEVER ASSUMED — this is F8's whole
   finding, and it is a DIFFERENT bound from the calendar's. The calendar was
   limited by getRecurrenceWindow(); the weather is limited by however many days
   the last /api/weather/forecast refresh actually returned. Measured on the
   live G11 2026-08-15: SEVEN days, days[0] = today, each keyed by a bare
   YYYY-MM-DD date.

   Seven is not a promise. The Open-Meteo path and the BOM-via-HA fallback build
   that array differently, and weatherFallbackForecast() returns `{ days: [] }`
   when there are no coordinates at all. So the day is looked up BY DATE and a
   miss returns null: the turn falls through to a lane that can reason about
   Saturday, which costs a beat. Guessing costs the lane.

   By date rather than by index for the same reason — `days[1]` is only tomorrow
   while `days[0]` is today, which is an assumption about an upstream, not a
   fact about the data.

   ⚠ Host-local, like onDay() above, and for the same reason: two clocks would
   put the day's LABEL and the day's NUMBERS on different dates at the margins.
   The kiosk's clock is the location's clock, which is what makes them agree. */
function forecastDay(s, day) {
  const days = s.forecast?.days;
  if (!Array.isArray(days) || days.length === 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + (day?.offset ?? 0));
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return days.find((x) => x?.date === key) ?? null;
}

/** The general readout for a day the live reading cannot speak for. */
function forecastSpeech(s, day) {
  const f = forecastDay(s, day);
  if (!f || f.high_c == null) return null;
  const label = f.condition?.label ? f.condition.label.toLowerCase() : null;
  return {
    speech: `${sentenceCase(day.dayLabel ?? day.label)}: ${round(f.high_c)} and ${round(f.low_c)}${label ? `, ${label}` : ""}.`,
    refs: ["weather"]
  };
}

/* A dinner plan is not a commitment. The household types tonight's meal into
   the calendar as "Meal: <dish>" — 73 of the live feed's 383 events — so
   counting it answered "am I free Tuesday arvo?" with "you've got 1 thing on",
   which is true of the data and false of the question. Excluded from free/busy,
   kept in "what's on": the dish is worth naming when someone asks what the day
   holds, just not when they ask whether they are free. Owner's call 2026-08-15.

   MEAL_PREFIX is imported rather than re-written — mealEvent.js exists exactly
   because four modules had each grown their own copy of this regex. */
const isMeal = (e) => MEAL_PREFIX.test(String(e?.title ?? ""));

/* "Meal: " is authoring scaffolding, not part of the dish's name, and saying it
   out loud ("Today: Meal: Steak with Peppercorn Sauce") is the calendar's
   plumbing leaking into the room. Same strip dayModel.js already does before
   anything reaches the spine. */
const spokenTitle = (e) => String(e?.title ?? "").replace(MEAL_PREFIX, "").trim();

const sentenceCase = (s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/* Events on the day asked about, narrowed to the part of it that was asked for.

   ⚠ AN ALL-DAY EVENT BELONGS TO EVERY WINDOW. It carries a start time and that
   time means nothing — the live feed has "Bob's Birthday" at 10:00 with
   allDay:true — so bucketing it by its hour would drop it out of every question
   about an afternoon, which is the same wrong-window bug one level down. */
function inWindow(events, day) {
  const ev = onDay(events, day?.offset ?? 0);
  const part = day?.part;
  if (!part) return ev;
  return ev.filter((e) => {
    if (e?.allDay) return true;
    const h = new Date(e.start).getHours();
    return h >= part.from && h < part.to;
  });
}

/** "What's on <day>" — shared by cal.today and cal.tomorrow, which differ only
 *  in the day they assume when the utterance names none. */
function readout(s, slots, fallback) {
  if (!Array.isArray(s.calendar)) return null;
  const day = slots?.day ?? fallback;
  const ev = inWindow(s.calendar, day);
  if (ev.length === 0) return { speech: `Nothing ${day.when}.`, refs: ["calendar"] };
  const names = speakList(ev.map(spokenTitle));
  const more = ev.length > 3 ? ` And ${ev.length - 3} more on the screen.` : "";
  return { speech: `${sentenceCase(day.label)}: ${names}.${more}`, refs: ["calendar"] };
}

function onDay(events, offset) {
  const target = new Date();
  target.setDate(target.getDate() + offset);
  const key = target.toDateString();
  return (events ?? [])
    .filter((e) => e?.start && new Date(e.start).toDateString() === key)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

/**
 * Resolve an intent against a snapshot.
 * @returns {{speech: string, refs: string[], showVocabulary?: boolean}|null}
 *          null means the lane matched but has no data — the caller should fall
 *          through rather than say something empty.
 */
export function answer(intent, snapshot = {}) {
  if (!intent?.id) return null;
  const fn = ANSWERERS[intent.id];
  if (!fn) return null;
  let result;
  try {
    result = fn(snapshot, intent.slots ?? {});
  } catch {
    return null;                       // a broken answerer falls through, never throws at the room
  }
  if (!result?.speech) return null;
  return { ...result, speech: capSentences(result.speech) };
}

/** Intent ids this module can actually answer — the tests assert every matcher
 *  id either has an answerer here or is deliberately handled elsewhere. */
export const ANSWERABLE = Object.freeze(Object.keys(ANSWERERS));
