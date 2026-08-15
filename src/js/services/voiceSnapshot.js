/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   VOICE SNAPSHOT — the data the fast lane answers from.

   The whole point of the local lane is that answering costs NO NETWORK. So the
   snapshot is assembled from two zero-latency sources:

     1. The live HA entity cache (services/homeAssistant/state.js). Already in
        memory, already kept current by the SSE stream — reading it is a map
        lookup, not a request.
     2. A small prefetched cache of the HTTP-backed endpoints, refreshed on a
        timer rather than on demand.

   Nothing here fetches while someone is waiting for an answer. If the cache is
   cold the answerers see undefined and return null, and the turn falls through
   to Assist — which is the correct outcome, because a fast "I don't know" and a
   slow correct answer are both better than a three-second pause that ends in a
   fast "I don't know" anyway.
   ═══════════════════════════════════════════════════════════════════════════ */

import { getAllEntities } from "./homeAssistant/state.js";
import { looksLikeMutation } from "./localIntents.js";
import { getTodoEntityIds, openTodoSummaries, getShoppingEntityId } from "./homeAssistant/todoEntities.js";
import { menuFrom } from "./mealEvent.js";
import { isTvAudio } from "./mediaSource.js";
import { getTimes } from "../vendor/suncalc.js";

/* Refreshed on a timer; never fetched at answer time. */
const cache = {
  weather: null,
  forecast: null,
  nowcast: null,
  calendar: null,
  bins: null,
  commute: null,
  fuel: null,
  fetchedAt: 0
};

let lastReply = null;

/** Remember what was last said, so "say that again" is answerable locally. */
export function rememberReply(text) {
  if (typeof text === "string" && text.trim()) lastReply = text.trim();
}

async function getJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;                       // upstreams may be down; the lane degrades
  }
}

/** Refresh the HTTP-backed half. Called on an init-once interval. */
export async function refreshVoiceCache() {
  const [weather, forecast, nowcast, calendar, bins] = await Promise.all([
    getJson("/api/weather/now"),
    getJson("/api/weather/forecast"),
    getJson("/api/weather/nowcast"),
    getJson("/api/calendar/all"),
    getJson("/api/bins")
  ]);
  if (weather) cache.weather = weather;
  if (forecast) cache.forecast = forecast;
  if (nowcast) cache.nowcast = nowcast.nowcast ?? null;
  if (calendar) cache.calendar = Array.isArray(calendar) ? calendar : calendar.events ?? [];
  if (bins) cache.bins = bins;
  cache.fetchedAt = Date.now();
}

/* ── HA-derived, read live from the in-memory entity map ───────────────────── */

function friendlyName(entity) {
  const attr = entity?.attributes?.friendly_name;
  if (typeof attr === "string" && attr.trim()) return attr.trim().split(" ")[0];
  // person.greg_dee -> Greg
  const slug = entity?.entity_id?.split(".")[1] ?? "";
  const first = slug.split("_")[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : null;
}

function peopleFrom(entities) {
  return entities
    .filter((e) => e?.entity_id?.startsWith("person."))
    .map((e) => ({ name: friendlyName(e), home: e.state === "home" }))
    .filter((p) => p.name);
}

/* null when the house has no media players AT ALL — which is what a
   disconnected Home Assistant looks like from here. An empty array means the
   players exist and none of them is playing, which is a different sentence.

   ⚠⚠ TV AUDIO IS NOT MEDIA, AND THIS READER WAS THE ONE THAT NEVER LEARNT IT.
   `mediaSource.js` names the three readers that must share the rule — the
   incumbent's panels, `houseSnapshot`, and this one — and says in its own
   header that a rule living in only some of them is "a house that says one
   thing on the wall and another out loud." That is exactly what was measured on
   2026-08-15: `media_player.living_room` sat `playing` with `source: "TV"`, the
   screen correctly showed nothing playing, and the voice answered **"TV."**

   ⚠ Note the header's 2026-08-09 measurement has since MOVED — that player now
   carries `media_title: "TV"` where it used to carry none. The `source` test is
   what saved this, which is why that header says the source test is the whole
   test. Do not switch to a title check. */
function mediaFrom(entities) {
  const players = entities.filter((e) => e?.entity_id?.startsWith("media_player."));
  if (players.length === 0) return null;
  return players
    .filter((e) => e.state === "playing" && !isTvAudio(e))
    .map((e) => ({
      title: e.attributes?.media_title ?? null,
      artist: e.attributes?.media_artist ?? e.attributes?.media_series_title ?? null
    }))
    .filter((m) => m.title);
}

function numeric(entity) {
  const n = Number(entity?.state);
  return Number.isFinite(n) ? n : null;
}

function sleepFrom(byId) {
  const score = numeric(byId["sensor.cpap_total_myair_score"]);
  if (score == null) return null;
  const label = score >= 85 ? "solid" : score >= 70 ? "decent" : "a rough one";
  return { score, label, ahi: numeric(byId["sensor.cpap_ahi_events_per_hour"]) };
}

function vacuumFrom(entities) {
  const problem = entities.find(
    (e) =>
      e?.attributes?.device_class === "problem" &&
      /roborock|vacuum/.test(e.entity_id ?? "") &&
      e.state === "on"
  );
  if (!problem) return { problem: null };
  return { problem: (problem.attributes?.friendly_name ?? "something").toLowerCase() };
}

function downloadsFrom(byId) {
  const active = numeric(byId["sensor.qbittorrent_active_torrents"]) ?? numeric(byId["sensor.qbittorrent_downloading"]);
  if (active == null) return null;
  return { active };
}

/* NOT LOADED IS NOT EMPTY — the same distinction the calendar answerers make,
   and it bites harder here. openTodoSummaries() returns [] for an entity that
   is absent, which is indistinguishable from an entity whose list is genuinely
   empty. With Home Assistant disconnected that made the house say "the shopping
   list is empty" with total confidence, on the one morning someone was relying
   on it.

   So presence in the entity cache is the test: no entity, no answer. null falls
   the turn through to Assist instead. */
function todosFrom(byId) {
  try {
    const shoppingId = getShoppingEntityId();
    const shopping = byId[shoppingId] ? openTodoSummaries(shoppingId) : null;

    // getTodoEntityIds() falls back to a hard-coded default list when nothing
    // has been discovered yet, so those ids must be checked against the cache
    // too rather than trusted to exist.
    const present = getTodoEntityIds().filter((id) => byId[id]);
    const tasks = present.length ? present.flatMap((id) => openTodoSummaries(id)) : null;

    return { shopping, tasks };
  } catch {
    return { shopping: null, tasks: null };
  }
}

/* The last camera event is DERIVED, not remembered. Every HA binary_sensor
   carries last_changed, so "who was at the door" can be answered from the cache
   without this module subscribing to anything — which means no listener to leak
   and no state to go stale on a reconnect.

   One honest caveat: for a sensor that has returned to "off", last_changed is
   when it CLEARED, not when it fired. Eufy clears within a minute or two, so
   the reported time is close but not exact. Sensors still "on" are preferred
   precisely so the live case is exact. */
const MOTION_RE = /^binary_sensor\.(.+?)_(motion|person)_detected$/;
const EVENT_WINDOW_MS = 6 * 60 * 60 * 1000;

export function pickLastCameraEvent(list, byId = null) {
  const index = byId ?? Object.fromEntries((list ?? []).filter((e) => e?.entity_id).map((e) => [e.entity_id, e]));

  // `known` separates "the cameras exist and none has fired recently" from
  // "there are no cameras here, because HA is not connected". Without it, a
  // dead HA answers "nothing's triggered recently" — which is a statement
  // about the house that we are in no position to make.
  const known = (list ?? []).some((e) => MOTION_RE.test(e?.entity_id ?? ""));
  if (!known) return { known: false, lastEvent: null };

  const events = [];
  for (const e of list ?? []) {
    const m = MOTION_RE.exec(e?.entity_id ?? "");
    if (!m || !e.last_changed) continue;
    const at = new Date(e.last_changed);
    if (!Number.isFinite(at.getTime())) continue;
    if (Date.now() - at.getTime() > EVENT_WINDOW_MS) continue;
    events.push({ slug: m[1], at, live: e.state === "on" });
  }
  if (events.length === 0) return { known: true, lastEvent: null };

  // Anything currently detecting wins; otherwise the most recent change.
  events.sort((a, b) => (b.live - a.live) || (b.at - a.at));
  const top = events[0];

  // The camera's own person sensor, when it has a real name on it.
  const person = (() => {
    const s = index[`sensor.${top.slug}_person_name`]?.state;
    return typeof s === "string" && s && !["unknown", "unavailable", "none", ""].includes(s.toLowerCase())
      ? s
      : null;
  })();

  return { known: true, lastEvent: { name: top.slug.replace(/_/g, " "), at: top.at.toISOString(), person } };
}

/**
 * Build the snapshot. Synchronous and cheap by design — this runs inside the
 * answer path, so it must never await anything.
 */
export function voiceSnapshot({ lat, lon } = {}) {
  let entities = [];
  try {
    entities = getAllEntities() ?? [];
  } catch {
    entities = [];
  }
  const list = Array.isArray(entities) ? entities : Object.values(entities);
  const byId = Object.fromEntries(list.filter((e) => e?.entity_id).map((e) => [e.entity_id, e]));

  // Sun times come from the vendored suncalc — no network, no cache, exact.
  let sun = null;
  if (typeof lat === "number" && typeof lon === "number") {
    try {
      const t = getTimes(new Date(), lat, lon);
      sun = { sunrise: t.sunrise, sunset: t.sunset };
    } catch { /* leave null */ }
  }

  return {
    sun,
    weather: cache.weather,
    forecast: cache.forecast,
    nowcast: cache.nowcast,
    calendar: cache.calendar,
    /* Tonight's dish, from the same parse houseSnapshot uses. Derived rather
       than cached because it is a pure function of the calendar we already
       hold, and because it must roll over at midnight without a refetch. */
    menu: menuFrom(cache.calendar, new Date()),
    bins: cache.bins,
    commute: cache.commute,
    fuel: cache.fuel,
    people: peopleFrom(list),
    media: mediaFrom(list),
    sleep: sleepFrom(byId),
    vacuum: vacuumFrom(list),
    downloads: downloadsFrom(byId),
    todos: todosFrom(byId),
    camera: pickLastCameraEvent(list, byId),
    lastReply
  };
}

export function voiceCacheAge() {
  return cache.fetchedAt ? Date.now() - cache.fetchedAt : null;
}

/* ── Is HA Assist worth a round trip? ───────────────────────────────────────
   Every utterance the fast lane declined used to be posted to Assist and
   waited on, purely to be told "not mine". For a conversational question —
   which is most of what reaches lane 2 — that is a full round trip spent
   learning nothing, and it is paid before the house voice is even asked.

   The test is deliberately CONSERVATIVE, because a false negative here is
   worse than the latency it saves: skipping Assist for something it could
   have handled turns a working device command into a model's opinion about a
   device command. So Assist is skipped only when BOTH are true:

     - the utterance is not a mutation (localIntents' MUTATION_RE, which is
       already the authority on "this is a command"), and
     - it names nothing Home Assistant knows about.

   The second half is what keeps HassGetState questions — "is the kitchen
   light on" — routed correctly. They change nothing, so the first test alone
   would hand them to a model that cannot see a light switch.

   Names are matched on word boundaries. A substring test makes "is anyone
   here" match an entity called "Here Comes The Sun" and quietly re-introduces
   the round trip it was meant to remove.
─────────────────────────────────────────────────────────────────────────── */
function entityWords() {
  let entities = [];
  try {
    entities = getAllEntities() ?? [];
  } catch {
    return null;                      // cannot tell — the caller must not skip
  }
  const list = Array.isArray(entities) ? entities : Object.values(entities);
  if (!list.length) return null;      // HA silent; same conclusion

  const words = new Set();
  for (const e of list) {
    const name = e?.attributes?.friendly_name;
    if (typeof name !== "string") continue;
    for (const word of name.toLowerCase().split(/[^a-z0-9]+/)) {
      // Single letters and two-letter words ("TV" aside) match far too much
      // to be evidence that a sentence is about a device.
      if (word.length >= 3) words.add(word);
    }
  }
  return words;
}

export function couldBeAssist(text) {
  if (looksLikeMutation(text)) return true;

  const words = entityWords();
  // No roster means Home Assistant is not talking, and we cannot rule Assist
  // out on the evidence. Fail toward the round trip: slow and correct beats
  // fast and wrong, which is the same call voiceSnapshot makes everywhere.
  if (!words) return true;

  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => word.length >= 3 && words.has(word));
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DIGEST — the same snapshot, shaped for the house voice.

   The fast lane above answers a question the regex caught. Everything else
   went to a model that knew the date and nothing else: it could not say what
   the weather was doing, who was home, or what was on tonight, because none of
   that was ever in its prompt. It was a voice for this house with no knowledge
   of this house.

   ⚠⚠ ABSENT IS NOT EMPTY, AND FLATTENING IT IS THE WHOLE DANGER HERE.

   Every reader above is careful about this — mediaFrom() returns null for "no
   players exist" and [] for "players exist, none playing"; todosFrom() returns
   null for an entity missing from the cache; pickLastCameraEvent() reports
   `known: false` separately from `lastEvent: null`. That care exists because
   with Home Assistant disconnected the house once said "the shopping list is
   empty" with total confidence, on the morning somebody was relying on it.

   A digest that renders both states as a missing key hands the model exactly
   that failure, dressed as fluent prose. So the shape is two-part:

     known — what the house can see, already worded
     blind — what it CANNOT see right now, named

   `blind` is not defensive plumbing; it is the character (CHARACTER.md, "it
   admits the edge of what it knows"). It is what lets the house answer "I
   can't see the shopping list from here" instead of inventing one.

   Pure and synchronous by design: this runs inside the answer path and must
   never await. It is also the only place the house's private data is shaped
   for an upstream request — see VOICE_HOUSE_CONTEXT in .env.example.
   ═══════════════════════════════════════════════════════════════════════════ */

const TZ = "Australia/Brisbane";
const clock = (d) => {
  const t = d ? new Date(d) : null;
  return t && Number.isFinite(t.getTime())
    ? t.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ })
    : null;
};
const num = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);

/** Today's events, in the house's own window. Kept to three — past that it is
 *  a screen's job, and the digest rides every single turn. */
function eventsToday(calendar) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return calendar
    .filter((e) => {
      const at = new Date(e?.start);
      return Number.isFinite(at.getTime()) && at >= start && at < end;
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 3)
    .map((e) => `${String(e.title ?? "").trim()}${clock(e.start) ? ` at ${clock(e.start)}` : ""}`)
    .filter((s) => s.trim());
}

/**
 * Shape a voiceSnapshot() into { known, blind } for the house voice.
 *
 * `known` is a keyed object of short worded strings — deliberately NOT an
 * array. Handing an array to a reader that expects keys is precisely what left
 * bomWarning permanently empty and cost the wall its storm warning; the shape
 * is asserted in tests/voice.spec.js so it cannot drift back.
 *
 * @param {object} snap  the output of voiceSnapshot()
 * @returns {{ known: Record<string,string>, blind: string[] }}
 */
export function houseDigest(snap) {
  const known = {};
  const blind = [];
  const s = snap ?? {};

  // ── Weather. The house's favourite subject (CHARACTER.md), so it gets the
  //    most detail — but only the fields that actually resolved.
  const now = s.weather?.now;
  if (now && now.temp_c != null) {
    const bits = [`${num(now.temp_c)}°`];
    if (now.condition?.label) bits.push(String(now.condition.label).toLowerCase());
    if (now.feels_like_c != null && num(now.feels_like_c) !== num(now.temp_c)) {
      bits.push(`feels ${num(now.feels_like_c)}°`);
    }
    if (s.weather?.day?.high_c != null) bits.push(`today ${num(s.weather.day.low_c)}–${num(s.weather.day.high_c)}°`);
    if (now.uv != null) bits.push(`UV ${num(now.uv)}`);
    if (now.wind_kph != null) bits.push(`wind ${num(now.wind_kph)} km/h`);
    if (now.rain_chance_pct != null) bits.push(`rain ${num(now.rain_chance_pct)}%`);
    known.weather = bits.join(", ");
  } else {
    blind.push("the weather");
  }

  // The nowcast is a ~90 minute radar extrapolation. Present only when it has
  // something to say — its absence is not blindness, it is "no rain coming".
  if (typeof s.nowcast?.startsInMin === "number") {
    known.rainIncoming = `rain starting in about ${s.nowcast.startsInMin} minutes`;
  }

  if (s.sun?.sunrise || s.sun?.sunset) {
    known.sun = [
      clock(s.sun.sunrise) && `sunrise ${clock(s.sun.sunrise)}`,
      clock(s.sun.sunset) && `sunset ${clock(s.sun.sunset)}`
    ].filter(Boolean).join(", ");
  }

  // ── Calendar. Array-or-nothing, exactly as the answerers treat it: an
  //    undefined calendar must never become "nothing on today".
  if (Array.isArray(s.calendar)) {
    const today = eventsToday(s.calendar);
    known.today = today.length ? today.join("; ") : "nothing on the calendar today";
  } else {
    blind.push("the calendar");
  }

  // menu is derived from the calendar, so it is only meaningful alongside one.
  if (Array.isArray(s.calendar)) known.dinner = s.menu ? String(s.menu) : "nothing planned for dinner";

  // ── Bins. `configured: false` means this house never set them up — that is
  //    a settled fact, not a blind spot, so it earns neither key.
  if (s.bins?.configured) {
    known.bins = s.bins.due ? `${s.bins.label}: ${(s.bins.bins ?? []).join(", ")}` : "no bins due tonight";
  }

  // ── People. An empty roster means Home Assistant is not talking; it does
  //    NOT mean the house is empty, and saying so would be the worst version
  //    of this whole feature.
  if (Array.isArray(s.people) && s.people.length) {
    const home = s.people.filter((p) => p.home).map((p) => p.name);
    const out = s.people.filter((p) => !p.home).map((p) => p.name);
    known.people = [
      home.length ? `${home.join(" and ")} home` : "nobody home",
      out.length ? `${out.join(" and ")} out` : null
    ].filter(Boolean).join(", ");
  } else {
    blind.push("who is home");
  }

  // ── Media. null = no players known at all (HA down). [] = nothing playing.
  if (Array.isArray(s.media)) {
    const m = s.media[0];
    known.playing = m ? `${m.title}${m.artist ? ` by ${m.artist}` : ""}` : "nothing playing";
  } else {
    blind.push("what's playing");
  }

  if (s.sleep?.score != null) known.sleep = `last night's sleep score ${s.sleep.score}, ${s.sleep.label}`;
  if (s.vacuum?.problem) known.vacuum = `the vacuum has a problem: ${s.vacuum.problem}`;
  if (s.downloads?.active != null && s.downloads.active > 0) known.downloads = `${s.downloads.active} downloading`;

  // ── Lists. Same null-vs-empty rule, and the one this rule was written for.
  if (Array.isArray(s.todos?.shopping)) {
    known.shopping = s.todos.shopping.length
      ? `${s.todos.shopping.length} on the shopping list: ${s.todos.shopping.slice(0, 5).join(", ")}`
      : "the shopping list is empty";
  } else {
    blind.push("the shopping list");
  }
  if (Array.isArray(s.todos?.tasks)) {
    known.tasks = s.todos.tasks.length
      ? `${s.todos.tasks.length} to do: ${s.todos.tasks.slice(0, 5).join(", ")}`
      : "nothing on the to-do list";
  }

  // ── Cameras. `known: false` is "there are no cameras here", which from this
  //    vantage point is indistinguishable from a disconnected Home Assistant.
  if (s.camera?.known) {
    const e = s.camera.lastEvent;
    known.cameras = e
      ? `last movement: ${e.name}${e.person ? ` (${e.person})` : ""} at ${clock(e.at)}`
      : "nothing on the cameras in the last few hours";
  } else {
    blind.push("the cameras");
  }

  return { known, blind };
}
