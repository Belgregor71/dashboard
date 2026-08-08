/* ═══════════════════════════════════════════════════════════════════════════
   V3 BOOT.

   Phase 1 scope: the substrate, the tokens, the type, and depths 0 and 1.
   The composer (depth 2), the subjects (depth 3) and the voice lanes land in
   later phases — the mounts for them exist in index.html and are empty.
   ═══════════════════════════════════════════════════════════════════════════ */

import { getPosition } from "../js/vendor/suncalc.js";
import { initSubstrate, toCauses } from "./substrate/index.js";
import { initDepth, setDepth, onDepth, DEPTH } from "./core/depth.js";
import { initPresenceLight } from "./core/presence-light.js";
import { initVoice } from "./core/voice.js";
import { initGround } from "./core/ground.js";
import { initScrim, applyScrim, resampleScrim } from "./core/scrim.js";
import { clearSubject, activeSubject, showSubject } from "./subjects/index.js";
import { clearVocabularyCard, vocabularyCardMounted } from "./core/vocabulary-card.js";
import { clearSpread, spreadMounted } from "./core/spread.js";
import { railPhrase } from "../js/services/vocabulary.js";
import { voiceSnapshot, refreshVoiceCache } from "../js/services/voiceSnapshot.js";
import { connectHA, isHAConnected } from "../js/services/homeAssistant/client.js";
import { registerEntityFeed } from "../js/services/homeAssistant/entityFeed.js";
import { getAllEntities } from "../js/services/homeAssistant/state.js";
import { emit as emitBus } from "../js/core/eventBus.js";
import { refreshHouseCache, houseCacheAge } from "../js/services/houseSnapshot.js";
import { initAttention, lastSelection, tickAttention, announcements } from "./core/attention.js";
import { initAlerts, lastAlert } from "./core/alerts.js";
import { initArrival, lastArrival } from "./core/arrival.js";
import { initBriefingWindow, lastBriefing } from "./core/briefing-window.js";
import { initDisplay, onPanelDark, displayState } from "./core/display.js";

/* Sun position only. City-level Brisbane, deliberately coarse: this repo is
   PUBLIC and its bundle is tracked, so no house-precise coordinate may appear
   in it. Solar altitude and azimuth differ by well under a thousandth of a
   degree across the whole metro area, so precision costs nothing here and
   would cost privacy. Weather comes from the server, which has the real ones. */
const CITY = { lat: -27.47, lon: 153.02 };

const el = {
  substrate: document.getElementById("substrate"),
  hour: document.getElementById("hour"),
  ground: document.getElementById("ground"),
  rail: document.getElementById("rail")
};

let railTick = 0;

let substrate = null;
let weather = null;
let wasNight = null;

/* ── The hour ───────────────────────────────────────────────────────────────
   Depth 0's only text. Ticks on the minute rather than the second: a seconds
   display on an always-on wall is a 1Hz repaint forever, and nobody in a
   kitchen has ever needed it.
─────────────────────────────────────────────────────────────────────────── */
function paintHour() {
  const d = new Date();
  const h = d.getHours() % 12 || 12;
  el.hour.textContent = `${h}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ── Night ──────────────────────────────────────────────────────────────────
   Driven by sun altitude, never by clock time. A cloudy 5pm in June and a
   clear 5pm in December are different rooms, and the screen should agree with
   whichever one you are standing in.
─────────────────────────────────────────────────────────────────────────── */
function sun() {
  const p = getPosition(new Date(), CITY.lat, CITY.lon);
  return { altitudeDeg: (p.altitude * 180) / Math.PI, azimuthRad: p.azimuth };
}

function syncSun() {
  const s = sun();
  const root = document.documentElement;

  // Night begins as the sun goes down, and the transition is a ramp rather
  // than a switch so nothing snaps in the corner of your eye.
  const night = s.altitudeDeg < -2;
  if (night) root.dataset.night = "1";
  else delete root.dataset.night;

  // Night changes the ink, and the scrim was solved against the day ink — so
  // the answer it reached is no longer the answer. Re-measure the photograph
  // already on the glass rather than carrying a stale opacity across dusk.
  // Twice a day, on a state change the room can see: a cause, not a timer.
  if (wasNight !== null && night !== wasNight) resampleScrim();
  wasNight = night;

  // Sun-agreed light: shadows on the surface point where the real sun is.
  root.style.setProperty("--sun-az", `${s.azimuthRad}rad`);
  root.style.setProperty("--sun-alt", s.altitudeDeg.toFixed(2));
  root.style.setProperty("--sun-warmth", Math.max(0, Math.min(1, (s.altitudeDeg + 6) / 18)).toFixed(3));

  return s;
}

function pushCauses() {
  const s = syncSun();
  if (!substrate) return;
  substrate.update(toCauses({
    sunAltitudeDeg: s.altitudeDeg,
    sunAzimuthRad: s.azimuthRad,
    windKph: weather?.now?.wind_kph ?? 0,
    // wind_bearing and cloud_pct DO NOT EXIST on /api/weather/now yet — the
    // route returns wind_kph but not direction, and no cloud cover at all.
    // Both are already in the Open-Meteo response the server throws away, so
    // this is an additive server change (with its contract test) rather than a
    // new upstream. Until it lands these fall back, and the fallback is stated
    // rather than hidden: a fixed bearing would make the drift LOOK caused
    // while being decorative, which is the one thing the substrate must not do.
    windBearingDeg: weather?.now?.wind_bearing ?? null,
    cloudPct: weather?.now?.cloud_pct ?? null,
    // condition.icon, not condition.code: the WMO tuple is
    // [label, category, intensity, thunder] and weatherService destructures
    // position 1 into a field it calls `icon`, but the value is the CATEGORY
    // string ("clear", "cloudy", "rain"...). `code` is the raw numeric code.
    category: weather?.now?.condition?.icon ?? null,
    intensity: weather?.now?.condition?.intensity ?? null
  }));
}

async function loadWeather() {
  try {
    const res = await fetch("/api/weather/now");
    if (!res.ok) return;
    weather = await res.json();
    pushCauses();
  } catch {
    // Upstreams are allowed to be down. The substrate keeps its last causes;
    // an atmosphere that freezes is far better than one that lies.
  }
}

/* The vocabulary rail. Everything offered is filtered through the lane against
   live data first, so it can only ever suggest something that would actually
   work right now — a suggestion that then falls through teaches the room that
   the rail is decorative. */
function paintRail() {
  if (!el.rail) return;
  const phrase = railPhrase(voiceSnapshot({ lat: CITY.lat, lon: CITY.lon }), { tick: railTick });
  if (!phrase) {
    el.rail.hidden = true;
    return;
  }
  el.rail.textContent = phrase;
  el.rail.hidden = false;
}

/* Leaving a depth must dismantle whatever it mounted. This is the one per-event
   path in V3, and a subject left mounted keeps its MJPEG connection open
   forever. Depth 2 has two possible tenants — the composed spread and the
   vocabulary card — and leaving clears whichever one was there. */
function onDepthChange(next, prev) {
  if (prev === DEPTH.SUBJECT && next !== DEPTH.SUBJECT) clearSubject();
  if (prev === DEPTH.SPREAD && next !== DEPTH.SPREAD) {
    clearSpread();
    clearVocabularyCard();
  }
}

/* ── Occupancy ──────────────────────────────────────────────────────────────
   Which depths currently have something in them, so recession can fall past the
   ones that do not. Asked of the DOM rather than tracked, for the same reason
   the composer's render signature is: three modules can mount and unmount these
   two nodes, and a tally kept in a variable is wrong the moment one of them
   acts without telling the others.

   Depth 0 and depth 3 are absent from the switch on purpose. The field always
   has the hour and the photograph — it is the floor precisely because it can
   never be empty — and nothing ever recedes INTO a subject.
─────────────────────────────────────────────────────────────────────────── */
function depthInhabited(depth) {
  if (depth === DEPTH.SPREAD) {
    return (document.getElementById("spread-lattice")?.childElementCount ?? 0) > 0;
  }
  if (depth === DEPTH.GLANCE) {
    return (document.getElementById("glance-said")?.textContent ?? "").trim().length > 0;
  }
  return true;
}

function boot() {
  initDepth({ inhabited: depthInhabited });
  initPresenceLight();
  initVoice({ enabled: true, lat: CITY.lat, lon: CITY.lon });
  onDepth(onDepthChange);

  /* ── The house's feed ─────────────────────────────────────────────────────
     Both halves of the state the decision layer reads. The entity cache is
     filled by the SSE stream (live, push); the HTTP-backed half — weather,
     calendar, commute, Plex — is prefetched on a timer because those are
     request/response and must never be awaited on a tick.

     The feed comes BEFORE connectHA() or the first snapshot arrives with
     nobody subscribed, and that snapshot is the only bulk fill there is: after
     it, only entities that actually change are sent. Miss it and the cache
     stays near-empty until something in the house moves.

     Nothing consumes this yet — the attention engine is wired in 1.3. It is
     first because until it exists, houseSnapshot() reads an empty cache and
     honestly answers null to every question, which looks like a broken engine
     and is a missing feed. It also fixes the voice rail, which has been asking
     the same empty cache since V3 booted. */
  registerEntityFeed();
  connectHA();
  refreshHouseCache();

  /* The house's opinion, and its permission to act on it. See core/attention.js:
     an interrupt reaches the glance whether or not anyone is there, the High
     band reaches it when someone is, and nothing below that earns the screen.
     initAttention() brings presence up with it. */
  initAttention();

  /* Phase 3 — the two things that happen rather than being true. Both subscribe
     to the same entity feed and neither writes the surface directly: the door
     forces depth 3 with a camera because it has to be seen, and an arrival
     announces a candidate and lets the queue decide, because it does not.

     Registered AFTER initAttention() so `announce()` has an engine to reach. */
  initAlerts();
  initArrival();

  /* Phase 4's one unasked-for subject. The window is a PERMISSION, not a
     trigger — a clock is not an external cause, so the briefing opens only
     while someone is actually in the room to receive it. It subscribes to
     presence, so it must come up after initAttention() has brought presence
     with it. */
  initBriefingWindow();

  substrate = initSubstrate(el.substrate);

  /* ── Step 5.1 · the panel ─────────────────────────────────────────────────
     The crontab powers the backlight down at 21:00 and DPMS says nothing to the
     page about it, so without this the substrate animates at 15fps until 05:00
     on any windy night, for a dark screen in an empty room.

     Registered after the substrate exists because the pause is the only thing
     it does here, and before nothing in particular — display.js holds no state
     the rest of the boot depends on. Flag-off means it never runs, which is why
     the wiring is a single subscription rather than a condition in the loop. */
  if (initDisplay()) {
    onPanelDark((isDark) => substrate?.setPaused(isDark));
  }

  // The photograph and its scrim are one thing in two files: the ground knows
  // nothing about legibility and the scrim knows nothing about where photos
  // come from, and this line is the whole of the coupling between them.
  initScrim();
  initGround(el.ground, { onPhoto: (img, meta) => applyScrim(img, meta) });

  paintHour();
  pushCauses();
  loadWeather();
  refreshVoiceCache().then(paintRail, paintRail);

  // Init-once intervals only. Per-event timers are where this house has leaked
  // before; these are registered exactly once at startup and never re-created.
  setInterval(paintHour, 20_000);   // cheap, and keeps the minute honest
  setInterval(pushCauses, 60_000);  // sun moves; the field follows it
  setInterval(loadWeather, 600_000);
  setInterval(() => { refreshVoiceCache(); }, 300_000);
  setInterval(() => { refreshHouseCache(); }, 300_000);
  setInterval(() => { railTick += 1; paintRail(); }, 90_000);

  setDepth(DEPTH.FIELD, "boot");

  window.__v3 = () => ({
    depth: window.__depth?.(),
    substrate: window.__substrate?.(),
    // `light` and not `presence`: both of these used to be called presence, so
    // the second key silently ate the first and the presence LIGHT's state was
    // unreachable from this handle. They are different things — one is whether
    // anyone is in the room, the other is what the screen's own glow is doing.
    light: window.__presenceLight?.(),
    voice: window.__v3Voice?.(),
    subject: activeSubject(),
    spread: spreadMounted(),
    vocabCard: vocabularyCardMounted(),
    ground: window.__ground?.(),
    scrim: window.__scrim?.(),
    rail: el.rail?.hidden === false ? el.rail.textContent : null,
    weather: weather?.now?.condition?.label ?? null,
    // The feed, in the two numbers that tell you whether it is alive. An entity
    // count of 0 with connected:true means the snapshot has not landed yet; 0
    // with connected:false means the stream is down and every reader is right
    // to be answering null.
    ha: {
      connected: isHAConnected(),
      entities: Object.keys(getAllEntities()).length,
      houseCacheAgeMs: houseCacheAge()
    },
    attention: lastSelection(),
    announced: announcements(),
    alert: lastAlert(),
    arrival: lastArrival(),
    briefing: lastBriefing(),
    display: displayState(),
    presence: window.__v3Presence?.()
  });

  // Force a tick rather than waiting out the 30s cycle — the companion to
  // __forceCandidate, and the only way to drive the queue over CDP on the wall
  // without sitting through a full interval per probe.
  //
  // The optional clock is not decoration: `expiresAt` decay is the entire
  // lifetime of an announced event (Phase 3), and without a way to ask "what
  // does the queue look like in ten minutes" the only way to see a candidate
  // expire is to wait ten minutes. This handle silently ignored its argument
  // until a spec noticed, which is the same class of no-op as a font axis the
  // API rejects.
  window.__v3Tick = (now) => tickAttention(now == null ? new Date() : new Date(now));

  // Push one entity onto the bus exactly as the SSE would deliver it. The way
  // to drive motion, or any other cause, without walking into the kitchen —
  // and the companion to __forceCandidate for the half of the rule that is
  // about presence rather than about score.
  window.__emitHaState = (entity) => { emitBus("ha:state-updated", entity); return entity?.entity_id ?? null; };

  /* Both halves of the prefetched cache, awaited. The boot tick reads a COLD
     HTTP cache — refreshHouseCache() has not resolved yet — so the first read
     of anything calendar-shaped is empty and looks broken when it is merely
     early. This is the handle that says "now", rather than sleeping and hoping.
     Six of Phase 4's subjects read that cache. */
  window.__v3Refresh = async () => {
    await Promise.all([refreshVoiceCache(), refreshHouseCache()]);
    return { houseCacheAgeMs: houseCacheAge() };
  };

  /* Mount any subject directly, optionally against an INJECTED snapshot.

     Two things this buys that the voice path cannot. It shows a subject on the
     kiosk without saying anything out loud at 11pm; and it makes a subject's
     rendering testable against a state the house does not currently have —
     a five-item shopping list, an empty day — without stubbing the entity cache
     and leaking that stub into every later assertion.

     It deliberately does NOT change depth. What mounted and what the surface
     decided to do about it are separate questions, and Phase 3 was the phase
     that proved conflating them hides real bugs. */
  window.__v3Subject = (id, slots = {}, snapshot = undefined) =>
    showSubject(
      { id, slots },
      snapshot === undefined ? voiceSnapshot({ lat: CITY.lat, lon: CITY.lon }) : snapshot
    );

  console.info("V3 ready —", substrate?.backend ?? "no substrate");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
