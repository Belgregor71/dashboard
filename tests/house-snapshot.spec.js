import { test, expect } from "@playwright/test";
import {
  houseSnapshot,
  refreshHouseCache,
  houseCacheAge,
  __resetHouseCache
} from "../src/js/services/houseSnapshot.js";
import { collectSources } from "../src/js/services/candidateSources.js";

/* houseSnapshot's contract. Pure-node — no browser, no server, no DOM — because
   that is the entire point of the module: the attention engine's inputs were
   scraped out of forty getElementById calls in focusHero, which is why the whole
   decision layer was unreachable from V3. If this file ever needs a page, the
   module has regressed to the thing it replaced.

   Two properties matter more than the rest and most of the file is about them:

   1. SHAPE PARITY with focusHero.readState(). collectSources() must not be able
      to tell the two apart, or the engine silently loses candidates.
   2. ABSENT IS NOT EMPTY. This module touches every data path in the house, and
      this codebase has produced three "not loaded read as empty" bugs in a
      single day. A cold cache must produce NO candidates — never a confident
      empty one. */

/* Exactly the keys focusHero.readState() returns, transcribed from the module.
   A missing key here is a candidate the engine will never see again. */
const READ_STATE_KEYS = [
  "bomWarning", "robotProblems", "robotConsumables", "insight",
  "weatherCondition", "weatherTemp",
  "commuteActive", "commuteText",
  "nextEventActive", "nextEventText", "nextEventTitle", "nextEventSub",
  "nowPlayingActive", "nowPlayingText", "nowPlayingImage", "nowPlayingTitle", "nowPlayingSub",
  "plexActive", "plexText", "plexImage",
  "menuActive", "menuName",
  "cameraTriggerName", "cameraTriggerAt", "cameraTriggerLabel", "cameraTriggerImage"
];

const NOW = new Date("2026-08-08T18:30:00+10:00");

/* Stub the HTTP half. Each key is matched as a substring of the request url. */
function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => null };
    const body = routes[hit];
    if (body === null) return { ok: false, status: 500, json: async () => null };
    return { ok: true, status: 200, json: async () => body };
  };
}

const calendarWith = (events) => events;

/* Workers are reused across spec files, so a stubbed global left in place would
   follow this file into the next pure-node spec in the same process. Capture the
   real one and always put it back. */
const realFetch = globalThis.fetch;

test.beforeEach(() => {
  __resetHouseCache();
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => null });
});

test.afterEach(() => {
  globalThis.fetch = realFetch;
  __resetHouseCache();
});

/* ── The drop-in contract ─────────────────────────────────────────────────── */

test("returns exactly the key set focusHero.readState() produces", () => {
  const snap = houseSnapshot({ now: NOW });
  expect(Object.keys(snap).sort()).toEqual([...READ_STATE_KEYS].sort());
});

/* ── Absent is not empty ──────────────────────────────────────────────────── */

test("a cold cache yields nulls, never empty strings or zero-values", () => {
  const snap = houseSnapshot({ now: NOW });

  // The scalar text fields must be null. "" would be an assertion that we
  // looked and found nothing, which a cold cache has not earned.
  for (const key of ["weatherCondition", "weatherTemp", "commuteText", "nextEventText", "menuName", "plexText"]) {
    expect(snap[key], `${key} must be null when nothing is loaded`).toBeNull();
  }
  // The *Active booleans are the adapters' gates and must be false, not true-ish.
  for (const key of ["commuteActive", "nextEventActive", "nowPlayingActive", "plexActive", "menuActive"]) {
    expect(snap[key], `${key} must be false when nothing is loaded`).toBe(false);
  }
});

test("a cold cache produces ZERO candidates — the whole point", () => {
  expect(collectSources(houseSnapshot({ now: NOW }))).toEqual([]);
});

test("houseCacheAge is null until the cache is actually filled", async () => {
  expect(houseCacheAge()).toBeNull();
  stubFetch({ "/api/weather/now": { now: { condition: { label: "Clear" }, temp_c: 19 } } });
  await refreshHouseCache();
  expect(houseCacheAge()).toBeGreaterThanOrEqual(0);
});

/* ── Weather ──────────────────────────────────────────────────────────────── */

test("a severe condition becomes an interrupt candidate carrying the temperature", async () => {
  stubFetch({ "/api/weather/now": { now: { condition: { label: "Severe thunderstorm" }, temp_c: 28.6 } } });
  await refreshHouseCache();

  const snap = houseSnapshot({ now: NOW });
  expect(snap.weatherCondition).toBe("Severe thunderstorm");
  expect(snap.weatherTemp).toBe("29°");

  const weather = collectSources(snap).find((c) => c.source === "weather");
  expect(weather).toBeTruthy();
  expect(weather.interrupt).toBe(true);
  expect(weather.text).toBe("Severe thunderstorm · 29°");
});

test('"Unavailable" is display copy for a dead upstream and must never reach the queue', async () => {
  stubFetch({ "/api/weather/now": { now: { condition: { label: "Unavailable" } } } });
  await refreshHouseCache();

  const snap = houseSnapshot({ now: NOW });
  expect(snap.weatherCondition).toBeNull();
  expect(collectSources(snap).find((c) => c.source === "weather")).toBeUndefined();
});

test("a calm condition is not severe and raises no candidate", async () => {
  stubFetch({ "/api/weather/now": { now: { condition: { label: "Clear" }, temp_c: 19 } } });
  await refreshHouseCache();
  expect(collectSources(houseSnapshot({ now: NOW })).find((c) => c.source === "weather")).toBeUndefined();
});

/* ── Next event ───────────────────────────────────────────────────────────── */

const eventAt = (offsetMin, title = "Dentist") => ({
  title,
  start: new Date(NOW.getTime() + offsetMin * 60000).toISOString()
});

test("an event inside the window becomes a candidate with split title/sub slots", async () => {
  stubFetch({ "/api/calendar/all": calendarWith([eventAt(20)]) });
  await refreshHouseCache();

  const snap = houseSnapshot({ now: NOW });
  expect(snap.nextEventActive).toBe(true);
  expect(snap.nextEventTitle).toBe("Dentist");
  expect(snap.nextEventSub).toContain("Starts in 20 min");
  // The rendered name carries the emoji; the card's icon slot owns the glyph,
  // so `title` must be the stripped form.
  expect(snap.nextEventTitle).not.toContain("📅");
  expect(snap.nextEventText).toContain("📅");

  expect(collectSources(snap).find((c) => c.source === "nextEvent")).toBeTruthy();
});

test("an event beyond the 30-minute lead-in is not yet offered", async () => {
  stubFetch({ "/api/calendar/all": calendarWith([eventAt(90)]) });
  await refreshHouseCache();
  expect(houseSnapshot({ now: NOW }).nextEventActive).toBe(false);
});

test("an event past the 15-minute tail has gone", async () => {
  stubFetch({ "/api/calendar/all": calendarWith([eventAt(-40)]) });
  await refreshHouseCache();
  expect(houseSnapshot({ now: NOW }).nextEventActive).toBe(false);
});

test("something already under way outranks something merely approaching", async () => {
  stubFetch({ "/api/calendar/all": calendarWith([eventAt(20, "Later"), eventAt(-5, "Running")]) });
  await refreshHouseCache();

  const snap = houseSnapshot({ now: NOW });
  expect(snap.nextEventTitle).toBe("Running");
  expect(snap.nextEventSub).toContain("Started 5 min ago");
});

test("an all-day event is never the next event", async () => {
  stubFetch({ "/api/calendar/all": calendarWith([{ ...eventAt(10, "Public holiday"), allDay: true }]) });
  await refreshHouseCache();
  expect(houseSnapshot({ now: NOW }).nextEventActive).toBe(false);
});

/* ── Tonight's menu ───────────────────────────────────────────────────────── */

test("tonight's Meal: event becomes the menu, with the prefix stripped", async () => {
  stubFetch({ "/api/calendar/all": calendarWith([{ title: "Meal: Butter chicken", start: NOW.toISOString() }]) });
  await refreshHouseCache();

  const snap = houseSnapshot({ now: NOW });
  expect(snap.menuName).toBe("Butter chicken");
  expect(collectSources(snap).find((c) => c.source === "tonightsMenu")).toBeTruthy();
});

test("tomorrow's meal is not tonight's dinner", async () => {
  const tomorrow = new Date(NOW.getTime() + 24 * 3600e3).toISOString();
  stubFetch({ "/api/calendar/all": calendarWith([{ title: "Meal: Lasagne", start: tomorrow }]) });
  await refreshHouseCache();
  expect(houseSnapshot({ now: NOW }).menuName).toBeNull();
});

/* ── Commute ──────────────────────────────────────────────────────────────── */

test("both legs join with the separator the panel uses", async () => {
  stubFetch({ "/api/commute": { seconds: 1380 } });
  await refreshHouseCache();

  const snap = houseSnapshot({ now: NOW });
  expect(snap.commuteText).toBe("23 min · 23 min");
  expect(snap.commuteActive).toBe(true);
  expect(collectSources(snap).find((c) => c.source === "commute")).toBeTruthy();
});

test("a commute upstream that fails contributes nothing rather than 'Unavailable'", async () => {
  stubFetch({ "/api/commute": null });
  await refreshHouseCache();

  const snap = houseSnapshot({ now: NOW });
  expect(snap.commuteText).toBeNull();
  expect(snap.commuteActive).toBe(false);
  expect(collectSources(snap).find((c) => c.source === "commute")).toBeUndefined();
});

/* ── Plex ─────────────────────────────────────────────────────────────────── */

test("an active Plex stream carries a proxied poster url", async () => {
  stubFetch({ "/api/plex/sessions": { sessions: [{ title: "Arrival", thumb: "/library/metadata/1/thumb" }] } });
  await refreshHouseCache();

  const snap = houseSnapshot({ now: NOW });
  expect(snap.plexText).toBe("Arrival");
  expect(snap.plexImage).toBe("/api/plex/image?path=%2Flibrary%2Fmetadata%2F1%2Fthumb");
  expect(collectSources(snap).find((c) => c.source === "plex")).toBeTruthy();
});

test("an episode is named by its SHOW, not by its episode title", async () => {
  /* ⚠ SEEN ON THE GLASS, 2026-08-09, with the real payload below: the wall
     named what was playing "2022-01-27", because `title` on an episode is the
     episode and this show's episodes are dated rather than titled. The show
     name was in the same response the whole time. */
  stubFetch({
    "/api/plex/sessions": {
      sessions: [{
        title: "2022-01-27",
        grandparentTitle: "And Just Like That...",
        parentTitle: "Season 1",
        type: "episode",
        thumb: "/library/metadata/31022/thumb/1785381091"
      }]
    }
  });
  await refreshHouseCache();

  expect(houseSnapshot({ now: NOW }).plexText).toBe("And Just Like That...");
});

test("a film has no show above it and keeps its own title", async () => {
  stubFetch({ "/api/plex/sessions": { sessions: [{ title: "Arrival", type: "movie", thumb: "/t" }] } });
  await refreshHouseCache();
  expect(houseSnapshot({ now: NOW }).plexText).toBe("Arrival");
});

test("no sessions is not a candidate", async () => {
  stubFetch({ "/api/plex/sessions": { sessions: [] } });
  await refreshHouseCache();
  expect(houseSnapshot({ now: NOW }).plexActive).toBe(false);
});

/* ── Home Assistant derived ───────────────────────────────────────────────── */

test("a disconnected Home Assistant yields no HA-derived candidates at all", () => {
  // No entities have been seeded — the same thing a dead HA looks like from
  // here. The house is not quiet; we simply cannot see it. Saying "nothing has
  // triggered" would be a statement about the house we are not entitled to make.
  const snap = houseSnapshot({ now: NOW });
  expect(snap.cameraTriggerName).toBeNull();
  expect(snap.nowPlayingActive).toBe(false);
  expect(snap.bomWarning).toBeNull();
  expect(snap.robotProblems).toBeNull();
});

const sensor = (entity_id, state, agoMin) => ({
  entity_id,
  state,
  last_changed: new Date(NOW.getTime() - agoMin * 60000).toISOString(),
  attributes: {}
});

test("the last camera trigger is derived from last_changed, with no subscription", () => {
  const entities = [sensor("binary_sensor.driveway_motion_detected", "off", 4)];

  const snap = houseSnapshot({ now: NOW, entities });
  expect(snap.cameraTriggerName).toBe("driveway");
  expect(snap.cameraTriggerAt).toBe(entities[0].last_changed);
  expect(snap.cameraTriggerLabel).toMatch(/^Last triggered /);
  expect(collectSources(snap).find((c) => c.source === "cameraTrigger")).toBeTruthy();
});

test("a sensor still detecting outranks a more recent one that has cleared", () => {
  const entities = [
    sensor("binary_sensor.driveway_motion_detected", "off", 1),
    sensor("binary_sensor.front_door_person_detected", "on", 5)
  ];
  expect(houseSnapshot({ now: NOW, entities }).cameraTriggerName).toBe("front door");
});

test("a trigger older than the six-hour window is not news", () => {
  const entities = [sensor("binary_sensor.side_gate_motion_detected", "off", 7 * 60)];
  expect(houseSnapshot({ now: NOW, entities }).cameraTriggerName).toBeNull();
});

test("a configured media player that is playing becomes now-playing", () => {
  const entities = [{
    entity_id: "media_player.lounge_room",
    state: "playing",
    attributes: { media_title: "Nightswimming", media_artist: "R.E.M.", entity_picture: "/art.jpg" }
  }];

  const snap = houseSnapshot({ now: NOW, entities });
  expect(snap.nowPlayingActive).toBe(true);
  expect(snap.nowPlayingTitle).toBe("Nightswimming");
  expect(snap.nowPlayingText).toBe("R.E.M. — Nightswimming");

  /* ⚠ RESOLVED, not raw — and this assertion USED TO PIN THE BUG.
     `entity_picture` is a path relative to Home Assistant, which the browser is
     not talking to; it only loads through the server's image proxy.
     `focusHero.readNowPlaying()` reads `.media-panel__image`'s src out of the
     rendered panel, and `mediaPanels` had already put it through
     `resolveMediaImage()` before setting it — so the value focusHero returns,
     and therefore the value this module's whole contract promises to match, is
     the PROXIED one. Returning "/art.jpg" here made the media candidate carry
     an image that would never load, silently, on V3 only. */
  expect(snap.nowPlayingImage).toBe("/api/image_proxy/art.jpg");
});

test("a paused player is not playing", () => {
  const entities = [{
    entity_id: "media_player.lounge_room",
    state: "paused",
    attributes: { media_title: "Nightswimming" }
  }];
  expect(houseSnapshot({ now: NOW, entities }).nowPlayingActive).toBe(false);
});

/* ── TV audio ──────────────────────────────────────────────────────────────
   Owner's call, 2026-08-09: a Sonos carrying TV audio is not "what's playing".
   MEASURED on the live house first — `media_player.living_room` in that mode
   reports `source: "TV"` (one entry in a `source_list` whose every other member
   is a music service) and carries no title, artist or artwork at all.
─────────────────────────────────────────────────────────────────────────── */

test("a Sonos carrying TV audio is not what's playing", () => {
  const entities = [{
    entity_id: "media_player.living_room",
    state: "playing",
    // The generous case on purpose: even WITH a title, TV audio is not it.
    // The no-title case would fall out for free and would prove less.
    attributes: { source: "TV", media_title: "Channel 9", entity_picture: "/tv.jpg" }
  }];
  expect(houseSnapshot({ now: NOW, entities }).nowPlayingActive).toBe(false);
});

test("TV audio silences ONE PLAYER, not the house", () => {
  /* ⚠ The regression this exists for. The scan is ordered by config and the
     Lounge group is scanned FIRST, so a `return null` on the TV would blank the
     answer while music played in the piano room — and it would only ever be
     seen by someone with the TV on and Spotify going at the same time. */
  const entities = [
    {
      entity_id: "media_player.living_room",
      state: "playing",
      attributes: { source: "TV", media_title: "Channel 9" }
    },
    {
      entity_id: "media_player.piano_room",
      state: "playing",
      attributes: { source: "Spotify Connect", media_title: "Live to Tell", media_artist: "Madonna" }
    }
  ];

  const snap = houseSnapshot({ now: NOW, entities });
  expect(snap.nowPlayingActive).toBe(true);
  expect(snap.nowPlayingTitle).toBe("Live to Tell");
});

test("only TV is dropped — every other source is a music service", () => {
  for (const source of ["Spotify Connect", "TV Radio", "", undefined]) {
    const entities = [{
      entity_id: "media_player.living_room",
      state: "playing",
      attributes: { source, media_title: "Nightswimming" }
    }];
    expect(houseSnapshot({ now: NOW, entities }).nowPlayingActive, `source ${JSON.stringify(source)}`).toBe(true);
  }
});

test("an unconfigured player that is playing is deliberately ignored", () => {
  // Which player speaks for the house stays a config decision, not a scan.
  const entities = [{
    entity_id: "media_player.someone_elses_phone",
    state: "playing",
    attributes: { media_title: "Whatever" }
  }];
  expect(houseSnapshot({ now: NOW, entities }).nowPlayingActive).toBe(false);
});

/* ── Injection seams ──────────────────────────────────────────────────────── */

test("insight is injected rather than imported, keeping the briefing graph out", () => {
  const insight = { id: "x", text: "The bins go out tonight", score: 60 };
  expect(houseSnapshot({ now: NOW, insight }).insight).toBe(insight);
  expect(houseSnapshot({ now: NOW }).insight).toBeNull();
});

test("a failed refresh leaves the last known good value standing", async () => {
  stubFetch({ "/api/weather/now": { now: { condition: { label: "Severe storm" }, temp_c: 24 } } });
  await refreshHouseCache();
  expect(houseSnapshot({ now: NOW }).weatherCondition).toBe("Severe storm");

  // Every upstream now fails. A momentary outage must not blank the queue —
  // a stale reading beats a lie, the same rule the substrate follows.
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => null });
  await refreshHouseCache();
  expect(houseSnapshot({ now: NOW }).weatherCondition).toBe("Severe storm");
});
