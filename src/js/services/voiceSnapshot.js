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
import { getTodoEntityIds, openTodoSummaries, getShoppingEntityId } from "./homeAssistant/todoEntities.js";
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
   players exist and none of them is playing, which is a different sentence. */
function mediaFrom(entities) {
  const players = entities.filter((e) => e?.entity_id?.startsWith("media_player."));
  if (players.length === 0) return null;
  return players
    .filter((e) => e.state === "playing")
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
