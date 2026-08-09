/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by V3 (/v3/) ONLY. It lives in `src/js/` for history, not because
   the incumbent uses it — so deleting it with "the old dashboard" breaks V3
   alone, and nothing on / goes wrong to warn you.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE SNAPSHOT — the DOM-free state feed for the attention engine.

   WHY THIS EXISTS. `services/attentionEngine.js` and `services/candidateSources.js`
   are already pure — zero DOM between them, unit-testable in plain node. But
   their INPUTS are not: `modules/focusHero.js` assembles the state object out of
   forty `getElementById(...).textContent` reads against the incumbent's rendered
   panels — `current-conditions`, `commute-greg`, `next-event-name`,
   `.media-panel__title`, and so on.

   That makes the house's entire decision layer unreachable from V3, which has
   34 DOM nodes and none of those ids. Every V3 feature that depends on a scored
   candidate — which is nearly all of them — is blocked behind this one fact.

   THE PATTERN THIS FOLLOWS. `voiceSnapshot.js` already solved exactly this for
   the fast lane: read the live HA entity cache (a map lookup, already kept
   current by the SSE stream) plus a small prefetched cache of the HTTP-backed
   endpoints, refreshed on a timer. Zero DOM, and both surfaces share it today.
   This module is that pattern widened to cover what focusHero scrapes.

   THE CONTRACT. `houseSnapshot()` returns exactly the shape `focusHero.readState()`
   returns, so `collectSources(houseSnapshot())` is a drop-in for
   `collectSources(readState())`. The incumbent is deliberately NOT changed here:
   it is what is on the wall, and a parallel surface is worth nothing if standing
   it up destabilises the working one.

   ⚠ ABSENT IS NOT EMPTY. This module touches every data path in the house, which
   makes it the most likely place in the codebase to breed the bug that has now
   been fixed three times in one day (todos, calendar, camera events). A cold
   cache and a genuinely quiet house are DIFFERENT, and only one of them is
   something we are entitled to make a statement about. Every reader below
   returns `null` when it does not know, never a cheerful zero-value. The
   candidate adapters are all falsy-guarded, so `null` correctly produces no
   candidate rather than a confident empty one.
   ═══════════════════════════════════════════════════════════════════════════ */

import { getAllEntities } from "./homeAssistant/state.js";
import { menuFrom } from "./mealEvent.js";
import { resolveMediaImage } from "./mediaImage.js";
import { isTvAudio } from "./mediaSource.js";
import { getBomWarnings } from "./weather/bom.js";
import { robotAttentionFrom, cameraSnapshotUrl } from "./candidateSources.js";
import { CONFIG } from "../core/config.js";
import {
  COMMUTE_ORIGIN,
  COMMUTE_GREG_DEST,
  COMMUTE_BRETT_DEST
} from "../config/config.js";

/* The HTTP-backed half. Refreshed on an init-once timer by the host surface,
   never fetched while a tick is waiting. A null field means "not loaded" and is
   never confused with "loaded and empty" — see the header. */
const cache = {
  weather: null,
  calendar: null,
  commute: null,
  plex: null,
  fetchedAt: 0
};

async function getJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null; // upstreams may be down on any machine; the queue degrades
  }
}

/* ── Commute ────────────────────────────────────────────────────────────────
   Two drive times, same shape the panel renders: "23 min". The incumbent gates
   the candidate on `isPanelActive("commute-panel")`, which has no DOM-free
   equivalent — so the gate here is the honest one it was standing in for:
   we have at least one real drive time. A failed leg contributes nothing rather
   than the panel's "Unavailable"/"Error" strings, which are display copy and
   have no business becoming a scored candidate's text.
─────────────────────────────────────────────────────────────────────────── */
async function fetchLeg(origin, destination) {
  if (!origin || !destination) return null;
  const data = await getJson(
    `/api/commute?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}`
  );
  if (typeof data?.seconds !== "number") return null;
  return `${Math.round(data.seconds / 60)} min`;
}

async function fetchCommute() {
  const [greg, brett] = await Promise.all([
    fetchLeg(COMMUTE_ORIGIN, COMMUTE_GREG_DEST),
    fetchLeg(COMMUTE_ORIGIN, COMMUTE_BRETT_DEST)
  ]);
  const parts = [greg, brett].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Refresh the HTTP-backed half. Call on an init-once interval. */
export async function refreshHouseCache() {
  const [weather, calendar, commute, plex] = await Promise.all([
    getJson("/api/weather/now"),
    getJson("/api/calendar/all"),
    fetchCommute(),
    getJson("/api/plex/sessions")
  ]);

  // Only overwrite on success: a momentary upstream failure should leave the
  // last known good value standing rather than blanking the queue. Same reason
  // the substrate keeps its last causes — a stale reading beats a lie.
  if (weather) cache.weather = weather;
  if (calendar) cache.calendar = Array.isArray(calendar) ? calendar : calendar.events ?? [];
  if (commute) cache.commute = commute;
  if (plex) cache.plex = Array.isArray(plex.sessions) ? plex.sessions : null;
  cache.fetchedAt = Date.now();
}

/* ── Weather ───────────────────────────────────────────────────────────────
   focusHero reads the rendered condition label and temperature. Both come off
   /api/weather/now, which is already the panel's own source — so this is the
   same number one hop earlier, not an approximation.

   "Unavailable" is the weather service's display string for a dead upstream.
   It must not become a candidate: `weatherSevereCandidate` pattern-matches the
   label, and a literal "Unavailable" on the wall is worse than silence.
─────────────────────────────────────────────────────────────────────────── */
function weatherFrom(now) {
  const label = now?.now?.condition?.label ?? null;
  const temp = now?.now?.temp_c;
  return {
    condition: label && label !== "Unavailable" ? label : null,
    temp: Number.isFinite(temp) ? `${Math.round(temp)}°` : null
  };
}

/* ── Next event ────────────────────────────────────────────────────────────
   ⚠ DELIBERATE DUPLICATION of `modules/nextEventPanel.js`. That module reads
   `window.__CAL_EVENTS__` and writes straight into its own DOM, so there is no
   pure function to import. Rather than refactor a module that is currently on
   the wall, the selection window and copy format are reproduced here.

   FOLLOW-UP owed: once V3 takes over, lift this into one shared pure helper and
   have nextEventPanel render from it. Until then, any change to the window
   constants or the "Starts in N min" copy must be made in BOTH places.
─────────────────────────────────────────────────────────────────────────── */
const WINDOW_BEFORE_MS = 30 * 60 * 1000;
const WINDOW_AFTER_MS = 15 * 60 * 1000;

const isAllDay = (ev) => ev?.allDay === true || ev?.isAllDay === true || ev?.dateOnly === true;

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nextEventFrom(events, now) {
  // A cold cache is not an empty calendar. Null here means the next-event
  // candidate is simply not offered, which is correct; [] would mean "we looked
  // and there is nothing on", which we are not in a position to say.
  if (!Array.isArray(events)) return null;

  const candidates = events
    .filter((ev) => !isAllDay(ev))
    .map((ev) => {
      const start = toDate(ev?.start);
      if (!start) return null;
      if (now < new Date(start.getTime() - WINDOW_BEFORE_MS)) return null;
      if (now > new Date(start.getTime() + WINDOW_AFTER_MS)) return null;
      return { ev, start, started: now >= start };
    })
    .filter(Boolean);

  if (!candidates.length) return null;

  // Something already under way outranks something merely approaching.
  candidates.sort((a, b) => (a.started !== b.started ? (a.started ? -1 : 1) : a.start - b.start));
  const { ev, start } = candidates[0];

  const icon = ev?.category?.icon || "📅";
  const title = ev?.displayTitle || ev?.title || "(Untitled)";
  const delta = Math.round((start.getTime() - now.getTime()) / 60000);
  const relative =
    delta > 0 ? `Starts in ${delta} min` : delta === 0 ? "Starting now" : `Started ${Math.abs(delta)} min ago`;
  const meta = `${relative} • ${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  return {
    // The rendered name carries the category emoji; the rich card owns its own
    // icon slot, so `title` is the stripped form — matching focusHero exactly.
    text: `${icon} ${title} · ${meta}`,
    title,
    sub: meta
  };
}

/* ── Tonight's menu ────────────────────────────────────────────────────────
   Dinner is a calendar event prefixed "Meal: ", which is how tonightsMenu.js
   finds it too. Same source, no tile to read.

   The parse now lives in services/mealEvent.js so that voiceSnapshot (and
   through it V3's recipe subject) reads the SAME answer rather than a fifth
   copy of the regex.
─────────────────────────────────────────────────────────────────────────── */

/* ── Now playing ───────────────────────────────────────────────────────────
   focusHero reads the two rendered media panels. The panels themselves render
   from `CONFIG.homeAssistant.mediaPlayers`, so the entity cache is the same
   source one hop earlier. Configured players are preferred over a blanket scan
   so the choice of WHICH player speaks stays a config decision.

   ── TV audio is not "now playing" ──────────────────────────────────────────

   Owner's call, 2026-08-09: when the Sonos is carrying TV audio, the house is
   not to display it as what's playing. Two reasons it is the right answer
   rather than only the asked-for one. There is nothing to show — MEASURED on
   the live house, `media_player.living_room` in this mode reports no
   `media_title`, no artist and no `entity_picture`, so the honest render is a
   speaker's name and a blank rectangle. And when the thing on the TV is
   actually worth naming, `plexFrom` below already names it properly, with a
   title and a poster.

   ⚠ `continue`, NOT `return null`. The scan is ordered by config and the Lounge
   group comes first, so bailing out here would blank the answer while Spotify
   was playing in the piano room. TV audio makes that ONE PLAYER silent to this
   reader; it does not make the house silent.

   ⚠ The predicate lives in services/mediaSource.js and is IMPORTED, not copied.
   The incumbent's own media panels apply the same rule from the same module —
   and the incumbent is what the kiosk serves at `/`, so a rule that lived only
   here would hide TV audio on a surface nobody is looking at while leaving it on
   the one they are. That is the mediaImage.js bug in a new shape.
─────────────────────────────────────────────────────────────────────────── */
function nowPlayingFrom(byId) {
  const groups = CONFIG?.homeAssistant?.mediaPlayers;
  if (!Array.isArray(groups)) return null;

  for (const group of groups) {
    for (const id of group?.entityIds ?? []) {
      const entity = byId[id];
      if (!entity || entity.state !== "playing") continue;
      if (isTvAudio(entity)) continue;
      const title = entity.attributes?.media_title;
      if (!title) continue;
      const source = entity.attributes?.media_series_title || entity.attributes?.media_artist || group?.label || null;
      return {
        text: [source, title].filter(Boolean).join(" — "),
        /* Resolved, not raw. focusHero reads this value out of a rendered
           <img src>, which mediaPanels had already put through the proxy — so
           returning the bare HA path here would have quietly broken the parity
           this whole module exists to guarantee. See services/mediaImage.js. */
        image: resolveMediaImage(entity.attributes?.entity_picture) || null,
        title,
        sub: source
      };
    }
  }
  return null;
}

/* ── Plex ──────────────────────────────────────────────────────────────────
   The first active stream. `configMissing` is a real answer meaning "this house
   has no Plex configured", which is not the same as "no one is watching" — but
   both correctly yield no candidate, so they collapse here.
─────────────────────────────────────────────────────────────────────────── */
function plexFrom(sessions) {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  const session = sessions[0];
  if (!session?.title) return null;

  /* ⚠ SEEN ON THE GLASS, 2026-08-09. `session.title` alone is the EPISODE, and
     for the show that was actually playing that episode is called "2022-01-27"
     — so the wall named what was on as a bare date. `grandparentTitle` ("And
     Just Like That...") was sitting in the same payload, unused.

     The show is what a person says when asked what they're watching, so the
     show is what this returns. The episode is deliberately dropped rather than
     appended: this string is a single line on a wall read from three or four
     metres — it is the incumbent's hero card, V3's ambient band (capped at 26ch
     before it ellipsises) and V3's depth-3 caption — and "And Just Like That...
     — Season 1 · 2022-01-27" is a string that fits none of them and helps
     nobody. A movie has no grandparentTitle, so it keeps its own title. */
  const text = session.grandparentTitle || session.title;

  return {
    text,
    image: session.thumb ? `/api/plex/image?path=${encodeURIComponent(session.thumb)}` : null
  };
}

/* ── Camera trigger ────────────────────────────────────────────────────────
   The incumbent asks `cameraTiles.getLastCameraTrigger()` — module state owned
   by a rendering module. The DOM-free equivalent already exists and is better:
   every HA binary_sensor carries `last_changed`, so the last event is DERIVED
   from the entity cache with nothing to subscribe to and no listener to leak.

   Reproduced here rather than imported from voiceSnapshot because that module's
   `pickLastCameraEvent` returns a voice-shaped answer (`{known, lastEvent}`);
   what the candidate needs is a card-shaped one. Same derivation, different
   consumer.
─────────────────────────────────────────────────────────────────────────── */
const MOTION_RE = /^binary_sensor\.(.+?)_(motion|person)_detected$/;
const TRIGGER_WINDOW_MS = 6 * 60 * 60 * 1000;

function cameraTriggerFrom(list, now) {
  const events = [];
  for (const e of list) {
    const m = MOTION_RE.exec(e?.entity_id ?? "");
    if (!m || !e.last_changed) continue;
    const at = new Date(e.last_changed);
    if (!Number.isFinite(at.getTime())) continue;
    if (now.getTime() - at.getTime() > TRIGGER_WINDOW_MS) continue;
    events.push({ slug: m[1], at, live: e.state === "on" });
  }
  if (!events.length) return null;

  events.sort((a, b) => (b.live - a.live) || (b.at - a.at));
  const top = events[0];
  const name = top.slug.replace(/_/g, " ");
  const time = top.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return {
    name,
    at: top.at.toISOString(),
    label: `Last triggered ${time}`,
    image: cameraSnapshotUrl({ cameraId: top.slug, at: top.at.toISOString() })
  };
}

/**
 * Build the state object the attention engine's adapters expect.
 *
 * Synchronous and cheap by design: this runs on the composer's tick, so it must
 * never await. Everything is either a map lookup against the live entity cache
 * or a read of the prefetched HTTP cache.
 *
 * @param {object}   [opts]
 * @param {Date}     [opts.now]      injectable clock, for tests
 * @param {object}   [opts.insight]  current insight, injected rather than imported
 *                                   so this module stays free of the briefing
 *                                   graph and testable without stubbing it
 * @param {Array}    [opts.entities] override the live entity cache. The cache is
 *                                   module-level state in homeAssistant/state.js
 *                                   with no reset seam, so a spec that seeded it
 *                                   would leak entities into every later spec in
 *                                   the file. Injecting keeps each case isolated.
 */
export function houseSnapshot({ now = new Date(), insight = null, entities: injected = null } = {}) {
  let entities = [];
  try {
    entities = injected ?? getAllEntities() ?? [];
  } catch {
    entities = [];
  }
  const list = Array.isArray(entities) ? entities : Object.values(entities);
  const byId = Object.fromEntries(list.filter((e) => e?.entity_id).map((e) => [e.entity_id, e]));

  // An empty entity map means Home Assistant is not connected, NOT that the
  // house is quiet. Skip the HA-derived readers entirely rather than let each
  // one independently conclude "nothing here".
  const haLive = list.length > 0;

  const bom = haLive ? getBomWarnings(list) : null;
  const robot = haLive ? robotAttentionFrom(list) : null;
  const weather = weatherFrom(cache.weather);
  const nextEvent = nextEventFrom(cache.calendar, now);
  const nowPlaying = haLive ? nowPlayingFrom(byId) : null;
  const plex = plexFrom(cache.plex);
  const menuName = menuFrom(cache.calendar, now);
  const cameraTrigger = haLive ? cameraTriggerFrom(list, now) : null;

  return {
    bomWarning: bom?.summary ?? null,
    robotProblems: robot?.problems ?? null,
    robotConsumables: robot?.consumables ?? null,
    insight,

    weatherCondition: weather.condition,
    weatherTemp: weather.temp,

    commuteActive: Boolean(cache.commute),
    commuteText: cache.commute,

    nextEventActive: Boolean(nextEvent),
    nextEventText: nextEvent?.text ?? null,
    nextEventTitle: nextEvent?.title ?? null,
    nextEventSub: nextEvent?.sub ?? null,

    nowPlayingActive: Boolean(nowPlaying),
    nowPlayingText: nowPlaying?.text ?? null,
    nowPlayingImage: nowPlaying?.image ?? null,
    nowPlayingTitle: nowPlaying?.title ?? null,
    nowPlayingSub: nowPlaying?.sub ?? null,

    plexActive: Boolean(plex),
    plexText: plex?.text ?? null,
    plexImage: plex?.image ?? null,

    menuActive: Boolean(menuName),
    menuName,

    cameraTriggerName: cameraTrigger?.name ?? null,
    cameraTriggerAt: cameraTrigger?.at ?? null,
    cameraTriggerLabel: cameraTrigger?.label ?? null,
    cameraTriggerImage: cameraTrigger?.image ?? null
  };
}

/** Age of the HTTP-backed half in ms, or null if it has never been filled. */
export function houseCacheAge() {
  return cache.fetchedAt ? Date.now() - cache.fetchedAt : null;
}

/** Test seam: drop the prefetched cache so a spec starts cold. */
export function __resetHouseCache() {
  cache.weather = null;
  cache.calendar = null;
  cache.commute = null;
  cache.plex = null;
  cache.fetchedAt = 0;
}
