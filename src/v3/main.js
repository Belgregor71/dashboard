/* ═══════════════════════════════════════════════════════════════════════════
   V3 BOOT.

   Phase 1 scope: the substrate, the tokens, the type, and depths 0 and 1.
   The composer (depth 2), the subjects (depth 3) and the voice lanes land in
   later phases — the mounts for them exist in index.html and are empty.
   ═══════════════════════════════════════════════════════════════════════════ */

import lottie from "lottie-web/build/player/lottie_light.js";
import { getPosition } from "../js/vendor/suncalc.js";
import { stage, guard, bootReport } from "./core/boot.js";
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
import { getAllEntities, updateEntity } from "../js/services/homeAssistant/state.js";
import { emit as emitBus } from "../js/core/eventBus.js";
import { refreshHouseCache, houseCacheAge } from "../js/services/houseSnapshot.js";
import { initAttention, lastSelection, tickAttention, announcements } from "./core/attention.js";
import { initAlerts, lastAlert } from "./core/alerts.js";
import { initArrival, lastArrival } from "./core/arrival.js";
import { initBriefingWindow, lastBriefing } from "./core/briefing-window.js";
import { initHealth, lastHealth } from "./core/health.js";
import { initDisplay, onPanelDark, displayState } from "./core/display.js";
import { initNowPlaying, nowPlayingState } from "./core/now-playing.js";
import { initDinner, lastDinner } from "./core/dinner.js";
import { initMemoryRuntime } from "../js/core/memoryRuntime.js";
import { initRoutineRuntime } from "../js/core/routineRuntime.js";

/* ⚠ `/js/config.js` is a separate <script> in index.html, so window.CONFIG is
   populated before this module runs — but read it LATE anyway (per call, not at
   module load). The incumbent's isEnabled() default is `false`, and matching it
   matters: an unreadable config must mean "off", never "on by accident". */
const flag = (name) => Boolean(globalThis.window?.CONFIG?.features?.[name]);

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

/* ── Boot ───────────────────────────────────────────────────────────────────
   Every step runs inside stage(). Cutover §4: this used to be a flat sequence,
   so a throw at line nine cost the substrate, the timers, the depth machinery
   and every debug handle below it — and while V3 was secondary that degraded a
   page nobody was looking at. Once `/` serves V3 there is nothing behind it.
   See core/boot.js for the rules; the short version is that stages continue,
   the FIRST failure is the cause, and the failure reaches the room through
   health.js rather than only the console.
─────────────────────────────────────────────────────────────────────────── */
function boot() {
  /* ⚠ The handles come FIRST, before anything that could break. They are the
     only way to ask a wall that came up wrong what happened to it, and at the
     bottom of the sequence — where they used to live — they are registered
     precisely when nothing has gone wrong. Nothing here touches a subsystem;
     every reader below returns module state that is null before its init runs.

     Safe for the specs that wait on `typeof window.__v3 === "function"` as
     their readiness signal: boot() is synchronous, so no polled predicate can
     observe the page between this line and the end of the function. */
  stage("handles", registerHandles);

  /* ── The lottie player ────────────────────────────────────────────────────
     `window.lottie` was set in exactly one place in this repo — js/core/app.js,
     line 3 — which V3 does not import. So helpers/lottie.js has been present in
     V3's dependency graph and inert on this surface since the cutover: it
     returns immediately when the global is missing. The week strip is the first
     thing here that wants an animated icon, and this is the whole of what it
     needed.

     A global rather than an import into the subject because helpers/lottie.js
     reads `window.lottie` itself, and 236 icon JSONs and two surfaces are not
     worth a second convention.

     ⚠ Costs ~50 kB gzipped on a surface that had none, and the payment is at
     BOOT, not per-animation. Nothing here creates a player: with v3ForecastWeek
     off, `loadAnimation` is never called on this wall and the runtime cost is a
     parsed script and one property. The strip's teardown destroys every instance
     it made — see subjects/forecast.js. */
  stage("lottie", () => { window.lottie = lottie; });

  stage("depth", () => initDepth({ inhabited: depthInhabited }));
  stage("presence-light", () => initPresenceLight());
  stage("voice", () => initVoice({ enabled: true, lat: CITY.lat, lon: CITY.lon }));
  stage("depth-teardown", () => onDepth(onDepthChange));

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
     the same empty cache since V3 booted.

     One stage, not three: the feed, the socket and the first prefetch are one
     fact about the house being reachable, and three names for it would be
     three symptoms of one cause. */
  stage("ha-feed", () => {
    registerEntityFeed();
    connectHA();
    refreshHouseCache();
  });

  /* The field's second fact. Before the first snapshot lands, for the same
     reason the feed itself is: it subscribes to `ha:state-updated`, and the
     opening bulk fill is the one event that says what is ALREADY playing.
     After it, only entities that change are sent — so a subscriber that arrives
     late learns nothing until the next track. Flag-off returns false having
     registered nothing. */
  stage("now-playing", () => initNowPlaying());

  /* ── Stage 3 · the house's own writing ────────────────────────────────────
     73 authored memories, every one photo-anchored through Memory Studio, and
     `window.__memoryState` was **undefined** on the live wall. Not broken —
     never armed: `initMemoryRuntime()` had exactly one caller, `js/core/app.js`,
     which V3 does not import. `collectMemory()` therefore returned [] forever
     while `attentionEngine.js:19` imported it, so the candidate path existed,
     passed the closure test, and could not fire.

     BEFORE initAttention(), which is the only ordering constraint: the engine
     concats collectMemory() into its queue on the first pass, and initAttention
     ticks immediately. Armed late, the first tick would silently run without it.

     ⚠ A TENDER MEMORY HAS NOWHERE TO LAND HERE, and it is worth knowing which
     silence that is. pickMemory chooses at most one memory per day; if the day's
     best fit is `sensitivity: "tender"`, collectMemory correctly refuses to put
     grief in a passing text line and hands it to collectAmbientMemory instead —
     whose only consumer is modules/screensaver.js, which V3 has no equivalent
     of. So on a tender day V3 shows no memory at all rather than a clumsy one.
     That is the right failure, not the right feature; the ambient tender frame
     is a design pass this file does not get to make. */
  stage("memory", () => initMemoryRuntime({ enabled: flag("memoryEngine") }));

  /* ── Phase 8, and the SAME DEFECT the memory stage above records ───────────
     `initRoutineRuntime()` also had exactly one caller — `js/core/app.js`,
     which V3 does not import — so since the cutover the house has learned
     nothing. `routineLearning` reads true, `data/routines/aggregates.json` is
     frozen at whatever the incumbent last wrote, and every read of a learned
     time has quietly returned null on the surface that actually ships.

     Found 2026-08-16 while wiring learned times into the voice: the feature
     depended on a module that was never armed, which is the second time this
     file has caught that shape. Arming it restores intended behaviour rather
     than adding any.

     ⚠ Two things switch on together here, by design. The obvious one is the
     wake/departure/return distributions. The quieter one is
     `attentionWeights()` — a per-source ranking nudge, clamped to −15…+10,
     which tilts sort ORDER only and never the displayed score. It needs four
     appearances of a source before it moves at all, so nothing changes on the
     wall today; it drifts in over a week.

     AFTER initMemoryRuntime and BEFORE initAttention, for the same reason the
     memory stage is: the engine reads the weights on its first tick, and armed
     late it would run that tick without them. */
  stage("routines", () => initRoutineRuntime({ enabled: flag("routineLearning") }));

  /* The house's opinion, and its permission to act on it. See core/attention.js:
     an interrupt reaches the glance whether or not anyone is there, the High
     band reaches it when someone is, and nothing below that earns the screen.
     initAttention() brings presence up with it. */
  stage("attention", () => initAttention());

  /* Phase 3 — the two things that happen rather than being true. Both subscribe
     to the same entity feed and neither writes the surface directly: the door
     forces depth 3 with a camera because it has to be seen, and an arrival
     announces a candidate and lets the queue decide, because it does not.

     Registered AFTER initAttention() so `announce()` has an engine to reach.
     Separate stages: the door and an arrival are genuinely two subsystems, and
     the door is the one that must not be lost to the other's bad day. */
  stage("alerts", () => initAlerts());
  stage("arrival", () => initArrival());

  /* The second unasked-for subject, and the one that also fills the recipe book.
     See core/dinner.js: the incumbent's dinner panel had exactly one caller in
     js/core/app.js, so the cutover took it off the wall AND stopped anything
     writing data/recipe-cache — one cause, both halves of the complaint.

     ⚠ THIS IS THE THIRD TIME AN init* HAS BEEN FOUND MISSING FROM V3's BOOT
     (memoryRuntime and routineRuntime were the first two, both above). The
     pattern is always the same: a module wired only into js/core/app.js, which
     V3 does not import, so the feature is not broken — it is never armed. When
     adding anything to this file, the question worth asking is which OTHER
     app.js line has no counterpart here.

     After initAttention() like alerts and arrival, though for a weaker reason:
     dinner announces nothing to the queue. It is here because it deepens, and
     deepening is only meaningful once presence is up. */
  stage("dinner", () => initDinner({ enabled: flag("v3DinnerPanel") }));

  /* Phase 4's one unasked-for subject. The window is a PERMISSION, not a
     trigger — a clock is not an external cause, so the briefing opens only
     while someone is actually in the room to receive it. It subscribes to
     presence, so it must come up after initAttention() has brought presence
     with it. */
  stage("briefing-window", () => initBriefingWindow());

  /* Phase 6 — the box saying it is broken. The watchdog and the self-heal are
     server-side and already running; what V3 lacked was any way to tell the
     ROOM, which matters most for the one feed that is display-only by design
     (the internet — a push about it would travel over it). Announces a
     candidate like arrival does, so the queue decides whether anyone sees it.

     After initAttention() for the same reason arrival is: `announce()` needs an
     engine to reach.

     ⚠ This is also the stage that carries every OTHER stage's failure to the
     room — health.js polls bootFault() alongside the server's feeds. So a boot
     where this one is the casualty is the boot with no voice to say so, which
     is why the console line in stage() is not redundant with it. */
  stage("health", () => initHealth());

  /* `?__backend=canvas2d` forces the fallback — see substrate/index.js. The
     backend is chosen by capability and every machine in this house has WebGL2,
     so this is the only way the 2D field is ever looked at, here or on the
     wall. Any other value is ignored rather than validated: the seam can only
     ever ask for the weaker backend, so a typo is a normal boot. */
  stage("substrate", () => {
    const forceBackend = new URLSearchParams(location.search).get("__backend");
    substrate = initSubstrate(el.substrate, { forceBackend });
  });

  /* ── Step 5.1 · the panel ─────────────────────────────────────────────────
     The crontab powers the backlight down at 21:00 and DPMS says nothing to the
     page about it, so without this the substrate animates at 15fps until 05:00
     on any windy night, for a dark screen in an empty room.

     Registered after the substrate exists because the pause is the only thing
     it does here, and before nothing in particular — display.js holds no state
     the rest of the boot depends on. Flag-off means it never runs, which is why
     the wiring is a single subscription rather than a condition in the loop. */
  stage("display", () => {
    if (initDisplay()) {
      onPanelDark((isDark) => substrate?.setPaused(isDark));
    }
  });

  // The photograph and its scrim are one thing in two files: the ground knows
  // nothing about legibility and the scrim knows nothing about where photos
  // come from, and this line is the whole of the coupling between them.
  //
  // One stage for the same reason: the scrim without the ground has nothing to
  // measure, and the ground without the scrim is unreadable text over a photo.
  // Half of this pair working is not a partial success.
  stage("ground", () => {
    initScrim();
    initGround(el.ground, { onPhoto: (img, meta) => applyScrim(img, meta) });
  });

  stage("hour", () => paintHour());
  stage("causes", () => pushCauses());
  stage("weather", () => loadWeather());
  // Two handlers rather than .finally(): a rejection handled on a fresh chain
  // re-throws, and an uncaught page error on the kiosk is the bug class the
  // suite exists to catch. The rail is best-effort either way.
  stage("rail", () => refreshVoiceCache().then(guard("rail", paintRail), guard("rail", paintRail)));

  /* Init-once intervals only. Per-event timers are where this house has leaked
     before; these are registered exactly once at startup and never re-created.

     ⚠ Each callback is guarded. setInterval keeps firing after its callback
     throws, so a broken pushCauses is not a stopped clock — it is an uncaught
     error every sixty seconds for as long as the page is up, which on this
     wall is weeks. guard() logs the first and counts the rest. */
  stage("timers", () => {
    setInterval(guard("hour", paintHour), 20_000);   // cheap, keeps the minute honest
    setInterval(guard("causes", pushCauses), 60_000); // sun moves; the field follows it
    setInterval(guard("weather", loadWeather), 600_000);
    setInterval(guard("voice-cache", () => { refreshVoiceCache(); }), 300_000);
    setInterval(guard("house-cache", () => { refreshHouseCache(); }), 300_000);
    setInterval(guard("rail", () => { railTick += 1; paintRail(); }), 90_000);
  });

  // Last, and outside everything that could have failed: whatever else did or
  // did not come up, the field is the floor and the wall shows it.
  stage("field", () => setDepth(DEPTH.FIELD, "boot"));

  console.info("V3 ready —", substrate?.backend ?? "no substrate");
}

/* ── The handles ────────────────────────────────────────────────────────────
   Lifted out of boot() so they can be registered before it. Every reader below
   is a state accessor that answers null until its subsystem has come up, so
   calling this first is safe — and it means a half-booted wall can still be
   interrogated over CDP, which is exactly when you need to.
─────────────────────────────────────────────────────────────────────────── */
function registerHandles() {
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
    dinner: lastDinner(),
    briefing: lastBriefing(),
    health: lastHealth(),
    display: displayState(),
    nowPlaying: nowPlayingState(),
    presence: window.__v3Presence?.(),
    // Cutover §4. `failed: []` is the assertion worth making on a healthy
    // wall — a stage that started throwing in production is otherwise silent
    // by construction, because isolation is the thing hiding it.
    boot: bootReport()
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

  /* Push one entity onto the bus exactly as the SSE would deliver it. The way
     to drive motion, or any other cause, without walking into the kitchen —
     and the companion to __forceCandidate for the half of the rule that is
     about presence rather than about score.

     ⚠⚠ IT DID NOT WRITE THE CACHE UNTIL 2026-08-15, and "exactly as the SSE
     would deliver it" was therefore false in the one way that matters.
     `entityFeed.js`'s own header calls the order load-bearing — each entity is
     written to the cache immediately BEFORE its event fires, because the
     readers all read the cache from inside that event. This hook emitted only.
     So every listener saw the change and every READER — houseSnapshot,
     voiceSnapshot, the attention queue — still saw the house as it was before
     it, with nothing thrown and no symptom. That is why `subjects/media.js` sat
     at 0% coverage: a playing media_player could be announced to the page but
     never actually arrive in the house, so the subject was undrivable and
     declined every time it was asked (HOST-BASELINES, 2026-08-15 06:44).

     Same disarmed-instrument shape as the seams M1 repaired, and the same
     lesson: a probe that cannot produce the state cannot test for it. */
  window.__emitHaState = (entity) => {
    updateEntity(entity);                 // no-ops on a malformed entity, as the feed does
    emitBus("ha:state-updated", entity);
    return entity?.entity_id ?? null;
  };

  /* The same favour for the room's other presence source. A spec cannot reach
     `eventBus` by path — the build bundles it into a hashed asset, so a dynamic
     `import("/js/core/eventBus.js")` 404s against dist and fails for a reason
     that has nothing to do with the feature. This is the seam presence.js
     actually subscribes to; presence-light's SSE listener is only what feeds it
     in production. */
  window.__emitSoundPresence = (frame) => {
    const payload = { at: Date.now(), db: -32, floorDb: -48, excursionDb: 16, ...frame };
    emitBus("sound:presence", payload);
    return payload;
  };

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

  /* What the boot actually did, stage by stage. Separate from __v3() on
     purpose: __v3() reads twenty subsystems and any one of them could be the
     thing that is broken, so the question "what broke?" must not be asked
     through a handle that a broken subsystem can take down with it. */
  window.__v3Boot = () => bootReport();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
