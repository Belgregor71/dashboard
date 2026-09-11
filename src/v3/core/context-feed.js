/* ═══════════════════════════════════════════════════════════════════════════
   THE CONTEXT FEED — contextStore's V3 writer.

   `js/core/contextStore.js` carries the V3-SHARED-RUNTIME banner and HAD NO
   WRITER ON THIS SURFACE. Its four writers are all incumbent modules V3 either
   replaced or has no equivalent of:

     presence / lastMotionAt  ← js/core/presence.js   (replaced by v3/core/presence.js)
     isNight                  ← modules/screensaver.js (V3 has no screensaver)
     condition / weather      ← services/weather/renderer.js (V3 has no DOM weather)

   So on the live wall it was a frozen literal — `presence:"glance"` with nobody
   home, `lastMotionAt:0`, `isNight:false` AT MIDNIGHT, `condition:null` in a
   storm — and every shared-runtime reader of it has been reasoning about a house
   that does not exist. Found by the app.js→V3 orphan sweep, 2026-08-16.

   ⚠ THIS HAD TO LAND BEFORE intentEngine COULD BE ARMED, and that is the whole
   reason it is a separate file rather than three lines in main.js. `deriveIntent`
   reads exactly presence + lastMotionAt + isNight, so an intent runtime armed
   over the frozen literal would not have been neutral — it would have asserted a
   confidently WRONG posture (permanently "someone is here", never night), which
   is strictly worse than the dead lever it replaced.

   ── One writer, whole writes ────────────────────────────────────────────────
   Every push writes all four slices from their current sources rather than each
   trigger patching its own. Partial writes are how a store like this ends up
   half-stale in a way nothing can see: `set()` only notifies on a real change,
   so a slice nobody remembered to re-push simply stops moving and looks fine.
   ═══════════════════════════════════════════════════════════════════════════ */

import { get as getContext, set as setContext } from "../../js/core/contextStore.js";
import { on } from "../../js/core/eventBus.js";
import { getBaseCategory, intensityForWeatherCode, isThunderCode } from "../../js/weatherPrompts.js";
import { presenceMode, lastMotionAtMs } from "./presence.js";

/* Last known base category. Held here rather than re-derived because the
   weather fetch is a 10-minute poll and the store must answer between them. */
let condition = null;
let conditionCode = null;
/* The Living Window's input — `{category, intensity, thunder, windKph, tempC}`,
   the shape the incumbent's weather renderer writes and atmoFx/planner.js
   reads. Null until a reading with a code arrives. Its IDENTITY only changes
   when a field does: the store's set() notifies on `!==`, so a fresh object per
   minute's push would wake every subscriber sixty times an hour for nothing. */
let weather = null;
let unsubscribe = null;

/* Strict, never Number(): Number(null) is 0, and a missing temperature read as
   0°C is a frost the house would draw (the atmoTextures bug, 2026-07-19). */
const finiteOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Write the whole context slice from the house as it stands right now. */
export function pushContext() {
  setContext({
    presence: presenceMode(),
    lastMotionAt: lastMotionAtMs(),
    /* V3's night is the sun's, stamped on the root by main.js — READ, never
       recomputed, for the same reason presence.js reads it for its linger: two
       modules doing their own suncalc is two answers to what time of day it is,
       and the disagreement is invisible until something acts on the wrong one. */
    isNight: document.documentElement.dataset.night === "1",
    condition,
    conditionCode,
    weather
  });
  return getContext();
}

/**
 * Feed the weather in. Takes the WMO code — `condition.code` — and NOT
 * `condition.icon`: the icon field carries the server's finer category string
 * ("showers", "snow", "storms"), while contextStore's readers speak the five
 * collapsed words getBaseCategory emits. Passing the icon through would put
 * "showers" in a slice whose readers only test for "rain".
 *
 * A null code keeps the last known category. An upstream that is down is not a
 * report of clear skies, and getBaseCategory(null) would say "clear".
 */
export function feedWeatherCode(code) {
  if (code != null) {
    condition = getBaseCategory(code);
    conditionCode = Number(code);
  }
  return pushContext();
}

/**
 * Feed the whole reading in — the `now` block of `/api/weather/now`.
 *
 * Everything categorical comes from the WMO CODE, through the same three
 * helpers the incumbent renderer uses, and not from the server's
 * `condition.icon` / `.intensity` / `.thunder`: one code, one vocabulary, so
 * `condition` and `weather.category` can never disagree with each other.
 *
 * Nothing on V3 reads the slice yet (2026-09-12) — it is the input the Living
 * Window's effects will plan from, landed first so they arrive to a real one.
 * A reading with no code keeps the last slice, for feedWeatherCode's reason.
 */
export function feedWeather(now) {
  const code = now?.condition?.code ?? null;
  if (code != null) {
    const next = {
      category: getBaseCategory(code),
      intensity: intensityForWeatherCode(code),
      thunder: isThunderCode(code),
      windKph: finiteOrNull(now.wind_kph),
      tempC: finiteOrNull(now.temp_c)
    };
    if (!weather || Object.keys(next).some((k) => next[k] !== weather[k])) weather = next;
  }
  return feedWeatherCode(code);
}

/**
 * Subscribe to the live signal and take a first reading.
 *
 * `presence:changed` on the BUS, which is where v3/core/presence.js announces —
 * the same lesson `routineRuntime` cost us on 2026-08-17: a shared-runtime
 * module must subscribe where the signal enters the house, and anything on
 * `document` is incumbent-only by construction.
 *
 * Init-once, no per-event teardown: one subscription for the life of the page.
 */
export function initContextFeed() {
  if (unsubscribe) return unsubscribe;
  unsubscribe = on("presence:changed", pushContext);

  /* The handle the orphan sweep did not have. `__intent` and `__personality`
     answered "undefined" and the store underneath them could not be read at
     all, so "the posture is wrong" and "the inputs are frozen" looked the same
     from outside. Read-only. */
  window.__v3Context = () => ({ ...getContext() });

  pushContext();
  return unsubscribe;
}

/** Test seam — drops the subscription and the held weather so a spec starts cold. */
export function __resetContextFeed() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  condition = null;
  conditionCode = null;
  weather = null;
}
