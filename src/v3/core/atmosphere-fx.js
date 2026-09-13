/* ═══════════════════════════════════════════════════════════════════════════
   THE LIVING WINDOW ON V3 — the host.

   docs/design/HANDOVER-LIVING-WINDOW-V3.md. Seven incumbent weather effects had
   not been on the wall since the V3 cutover. The arc's first question was WHERE
   they live — because at depth 0 the archive's opaque mat covers both the
   photograph and the substrate. Three directions were built and shown on the
   real panel (docs/design/LIVING-WINDOW-VARIANTS.md); **the owner chose A, the
   overlay**, on 2026-09-12, and B (grade) and C (mat-as-window) were deleted.

     v3AtmoOverlay  A · a thin layer above the card and the mat, below all text

   This module turns the house's weather slice (context-feed.js) and the sun
   into three numbers on the root —
     --atmo-rain    0..1  how hard it is raining (0 unless rain/storm)
     --atmo-warmth  0..1  the sky's warmth, peaking at the horizon (skyWarmthFor)
     --atmo-amp     0.3..1 the night amplitude, the SAME curve as the sun-dimmed
                          hour (DESIGN_SYSTEM §5.2: reuse the curve, no second
                          night gate) — it scales swing and opacity, never time
   — plus `data-atmo-raining` (so rain only MOVES while it rains: §5.1's cause
   test) and a one-shot `data-atmo-strike`. The renderer is CSS keyed on
   `:root[data-atmo="overlay"]`; see css/atmosphere.css.

   ── Step 3: the effects, each behind its own flag (2026-09-13) ──────────────
   Every one of these is read ONLY while v3AtmoOverlay is on — they are effects
   the overlay carries, not surfaces of their own. Each writes its own root
   attribute, so its CSS matches nothing while it is off.

     v3AtmoAccent        the accent hue follows the weather by day (tokens only)
     v3AtmoLightning     strikes arrive on their own while thunder is live
     v3AtmoTextures      fog / heat / cold vignettes, a fog drift, a heat pulse
     v3AtmoNightSky      a clear night's stars on the mat, and a rare twinkle
     v3AtmoRainEpisodes  rain moves in bursts, the pane held still between

   The pacing is the incumbent's, imported rather than retyped: every gap band,
   budget and threshold comes from js/services/atmoFx/planner.js. What is NOT
   the incumbent's is the motion model — no rAF anywhere (§5.4: "motion
   implemented in JS per frame is the wrong implementation"). JS only decides
   WHEN; each episode is a CSS one-shot or a keyframe switched by an attribute,
   and a TIMER — never animationend, which does not fire under display:none —
   takes it down.

   Flag-off: no attribute, no node, no handle, no subscription, no timer — the
   build that shipped before.
   ═══════════════════════════════════════════════════════════════════════════ */

import { get as getContext, subscribe } from "../../js/core/contextStore.js";
import { skyWarmthFor } from "../../js/services/atmosphere.js";
import {
  BUDGETS,
  FOG_GAP_MS,
  HEAT_PULSE_GAP_MS,
  LIGHTNING_GAP_MS,
  RAIN_GAP_MS,
  STRIKE_DECAY_MS,
  TWINKLE_GAP_MS,
  texturesFor
} from "../../js/services/atmoFx/planner.js";
import { clockDim } from "./sun-clock.js";
import { overlay } from "../atmo/overlay.js";

const flag = (name) => Boolean(globalThis.window?.CONFIG?.features?.[name]);

/** The incumbent's strike: 1.6 s one-shot (atmoFx/planner.js STRIKE_DECAY_MS). */
export const STRIKE_MS = STRIKE_DECAY_MS;
/** Rain intensity → level. The incumbent's three tiers, and moderate when unsaid. */
export const RAIN_LEVEL = { light: 0.35, moderate: 0.65, heavy: 1 };

/** How long a rain burst MOVES. The incumbent's active parts (planner.js
    planRain): a heavy episode is fade 1.5 + streaks 3 + slide 3.5 = the ambient
    budget; a light or moderate moment is fade 2 + slide 4. */
export const RAIN_MOVE_MS = { heavy: BUDGETS.ambient.maxActiveMs, moment: 6000 };
/** A twinkle breathes once (planner.js planTwinkle), under its budget. */
export const TWINKLE_MS = 2500;
/** A fog bank's crossing: 7 s up to the budget (planner.js planFog). */
export const FOG_MS = [7000, BUDGETS.fog.maxActiveMs];
/** A heat pulse is one slow breath, the whole sequence budget. */
export const HEAT_MS = BUDGETS.heatPulse.maxSequenceMs;

/** The accent's settled DAY hues: tokens.css's warm 65, and the incumbent's
    rain-cool rgb(196,230,255) as an OKLCH hue. Night is tokens.css's 40, owned
    by CSS alone. */
export const ACCENT_HUE = { none: 65, cool: 240 };
/** The incumbent's 60 s settle, walked in discrete steps (see settleAccent). */
export const ACCENT_SETTLE_MS = 60000;
export const ACCENT_STEPS = 12;

/** @returns {number} 0..1 — 0 unless the slice says it is raining or storming. */
export function rainLevel(weather) {
  if (!weather || (weather.category !== "rain" && weather.category !== "storm")) return 0;
  return RAIN_LEVEL[weather.intensity] ?? RAIN_LEVEL.moderate;
}

/** The accent's weather. Only rain and storm move it — the incumbent's
    livingAccent turned every other sky white, and V3's day hue is already the
    warm one, so "cool" is the only move there is to make. */
export function accentFor(weather) {
  return weather && (weather.category === "rain" || weather.category === "storm") ? "cool" : null;
}

/** The static textures as bare words: "fog" | "heat" | "cold". */
export function texturesOf(weather) {
  return texturesFor(weather).map((c) => c.replace(/^fx-/, ""));
}

const intensityOf = (w) => (w?.intensity === "light" || w?.intensity === "heavy" ? w.intensity : "moderate");

/**
 * Which episode lanes the sky has earned, and the key each is armed on. A lane
 * whose key changes is re-armed; one whose key goes falsy is cancelled.
 * Pure — every cause test in one place, unit-tested without a page.
 */
export function lanesFor({ weather, night = false, flags = {} } = {}) {
  const raining = rainLevel(weather) > 0;
  const tex = flags.textures ? texturesOf(weather) : [];
  return {
    lightning: Boolean(flags.lightning && weather?.thunder === true),
    rain: flags.rainEpisodes && raining ? intensityOf(weather) : null,
    twinkle: Boolean(flags.nightSky && night && weather?.category === "clear"),
    fog: tex.includes("fog"),
    heat: tex.includes("heat")
  };
}

const band = (rng, [min, max]) => min + rng() * (max - min);

/** The wait before a lane's next episode, from the incumbent's bands. Rain uses
    the AMBIENT bands: V3's depth 0 is the ambient wall, and the incumbent's
    awake bands (10-25 s) read as continuous rain — the thing bursts replace. */
export function gapFor(lane, key, rng = Math.random) {
  switch (lane) {
    case "lightning": return band(rng, LIGHTNING_GAP_MS);
    case "rain": return band(rng, RAIN_GAP_MS.ambient[key] ?? RAIN_GAP_MS.ambient.moderate);
    case "twinkle": return band(rng, TWINKLE_GAP_MS);
    case "fog": return band(rng, FOG_GAP_MS);
    case "heat": return band(rng, HEAT_PULSE_GAP_MS);
    default: return Infinity;
  }
}

/** One lightning sequence: a strike, then 0-2 weaker aftershocks inside the
    decay window — planner.js planLightning's shape, never a repeated flash. */
export function planStrike(rng = Math.random) {
  const count = Math.floor(rng() * (BUDGETS.lightning.maxAftershocks + 1));
  const aftershocks = [];
  for (let i = 0; i < count; i++) {
    aftershocks.push({ offsetMs: Math.round(band(rng, [300, 1800])), peak: band(rng, [0.25, 0.5]) });
  }
  aftershocks.sort((a, b) => a.offsetMs - b.offsetMs);
  const last = aftershocks.length ? aftershocks[aftershocks.length - 1].offsetMs : 0;
  return {
    peak: band(rng, [0.8, 1]),
    aftershocks,
    durationMs: Math.min(last + STRIKE_DECAY_MS, BUDGETS.lightning.maxSequenceMs)
  };
}

const LANES = ["lightning", "rain", "twinkle", "fog", "heat"];

let renderer = null;
let unsubscribe = null;
let strikeTimer = null;
let lastWeather = undefined;
let sunAlt = NaN;
let forced = null;
let effects = {};
let rng = Math.random;
/** name -> { key, timer, dueAt, active, endTimer, subTimers[] } */
const lanes = new Map();

function pick() {
  // A literal read — tests/flag-surface.spec.js derives which flags V3 reads
  // from exactly this form.
  if (flag("v3AtmoOverlay")) return overlay;
  return null;
}

function readEffects() {
  return {
    accent: flag("v3AtmoAccent"),
    lightning: flag("v3AtmoLightning"),
    textures: flag("v3AtmoTextures"),
    nightSky: flag("v3AtmoNightSky"),
    rainEpisodes: flag("v3AtmoRainEpisodes")
  };
}

/** The slice as the effects see it: the house's, with any probe override. */
function weatherNow() {
  const w = getContext().weather;
  return forced?.weather ? { ...(w || {}), ...forced.weather } : w;
}

function nightNow() {
  return forced && "night" in forced ? Boolean(forced.night) : document.documentElement.dataset.night === "1";
}

function state() {
  const w = weatherNow();
  const rain = forced && "rain" in forced
    ? (forced.rain ? RAIN_LEVEL[forced.rain] ?? RAIN_LEVEL.moderate : 0)
    : rainLevel(w);
  const warmth = forced?.warmth != null ? forced.warmth : skyWarmthFor(sunAlt);
  return {
    rain,
    warmth,
    amp: clockDim(sunAlt),
    thunder: forced?.thunder ?? Boolean(w?.thunder)
  };
}

/* Everything written to the root is clamped to 0..1 here, not trusted from the
   caller: `force({warmth: 5})` from a CDP probe would otherwise reach a calc()
   in the stylesheet. The curves themselves already clamp (skyWarmthFor,
   clockDim); this is the seam where a hand-driven value arrives. */
const unit = (n) => Math.max(0, Math.min(1, Number(n) || 0));

function setAttr(name, value) {
  const root = document.documentElement;
  if (value == null || value === false) delete root.dataset[name];
  else root.dataset[name] = String(value);
}

function paint() {
  if (!renderer) return;
  const s = state();
  const root = document.documentElement;
  root.style.setProperty("--atmo-rain", unit(s.rain).toFixed(3));
  root.style.setProperty("--atmo-warmth", unit(s.warmth).toFixed(3));
  root.style.setProperty("--atmo-amp", unit(s.amp).toFixed(3));
  if (s.rain > 0) root.dataset.atmoRaining = "1";
  else delete root.dataset.atmoRaining;
  paintEffects(s);
  renderer.apply?.(s);
}

/* The static half of each effect: attributes the stylesheet keys on. Each is
   written only while its own flag is on, so flag-off matches no rule. */
function paintEffects(s) {
  const w = weatherNow();
  if (effects.accent) {
    /* "none", never absent, while the flag is on: the 60 s settle is keyed on
       the attribute, so removing it on the way BACK would snap the hue home. */
    const a = forced?.accent !== undefined ? forced.accent : accentFor(w);
    setAttr("atmoAccent", a || "none");
    // A forced accent is a probe asking for the settled look: no walk.
    settleAccent(a || "none", forced?.accent !== undefined);
  }
  if (effects.textures) {
    const tex = Array.isArray(forced?.textures) ? forced.textures : texturesOf(w);
    setAttr("atmoTexture", tex.length ? tex.join(" ") : null);
  }
  if (effects.nightSky) {
    const clearNight = nightNow() && w?.category === "clear";
    setAttr("atmoNightSky", clearNight ? "1" : null);
  }
  if (effects.rainEpisodes) setAttr("atmoRainEpisodes", "1");
  syncLanes(s, w);
}

/* ── The accent's settle ─────────────────────────────────────────────────────
   The attribute flips at once and css/atmosphere.css holds the settled hue;
   this walks the ROOT's inline --atmo-hue from where it was to there in
   ACCENT_STEPS steps, then removes the inline value so the stylesheet owns
   the hue again. A CSS transition on the property measured gpu 51 / renderer
   68 for the minute on the G11 — every hue consumer restyled per frame; this
   is twelve restyles. At night nothing walks: night's 40 is CSS's alone. */
let hueNow = null;
let hueEnd = null;
let hueTimer = null;

function stopAccent() {
  clearInterval(hueTimer);
  hueTimer = null;
  document.documentElement.style.removeProperty("--atmo-hue");
}

function settleAccent(accent, jump = false) {
  const target = ACCENT_HUE[accent] ?? ACCENT_HUE.none;
  if (document.documentElement.dataset.night === "1") {
    stopAccent();
    hueNow = null;
    hueEnd = null;
    return;
  }
  // First sight (boot, or the first day paint after night), or a probe asking
  // for the settled look: nothing to ease FROM.
  if (hueNow === null || jump) {
    stopAccent();
    hueNow = target;
    hueEnd = target;
    return;
  }
  if (target === hueEnd) return;
  const from = hueNow;
  const root = document.documentElement;
  clearInterval(hueTimer);
  hueEnd = target;
  // Pin where it was BEFORE the attribute's settled value can show through.
  root.style.setProperty("--atmo-hue", from.toFixed(1));
  let step = 0;
  hueTimer = setInterval(() => {
    step++;
    hueNow = from + ((target - from) * step) / ACCENT_STEPS;
    if (step >= ACCENT_STEPS) {
      hueNow = target;
      stopAccent();
      return;
    }
    root.style.setProperty("--atmo-hue", hueNow.toFixed(1));
  }, ACCENT_SETTLE_MS / ACCENT_STEPS);
}

/* ── Episode lanes ───────────────────────────────────────────────────────────
   One setTimeout chain per lane. A lane is armed while its cause is live, and
   CANCELLED — its wait, its running episode and every sub-timer — the moment
   the cause ends. Nothing here is a loop: a lane that is not earned owns no
   timer at all. */

function syncLanes(s, w) {
  const want = lanesFor({
    weather: forced?.thunder != null ? { ...(w || {}), thunder: forced.thunder } : w,
    night: nightNow(),
    flags: effects
  });
  // Forced rain has no slice behind it; the rain lane follows the forced level.
  if (effects.rainEpisodes && forced && "rain" in forced) want.rain = forced.rain ? intensityOf({ intensity: forced.rain }) : null;
  for (const name of LANES) {
    const key = want[name] || null;
    const cur = lanes.get(name);
    if (!key) {
      if (cur) cancelLane(name);
      continue;
    }
    if (cur && cur.key === key) continue;
    if (cur) cancelLane(name);
    // Rain's first burst starts with the rain: the change IS the moment.
    arm(name, key, name === "rain" ? 0 : gapFor(name, key, rng));
  }
}

function arm(name, key, delayMs) {
  const lane = lanes.get(name) ?? { key, timer: null, dueAt: 0, active: false, endTimer: null, subTimers: [], fired: 0 };
  lane.key = key;
  lane.dueAt = performance.now() + delayMs;
  lane.timer = setTimeout(() => {
    lane.timer = null;
    fire(name);
  }, delayMs);
  lanes.set(name, lane);
}

function fire(name) {
  const lane = lanes.get(name);
  if (!lane || !renderer) return false;
  clearTimeout(lane.timer);
  lane.timer = null;
  endEpisode(lane);
  const durationMs = EPISODES[name](lane);
  lane.fired++;
  lane.active = true;
  lane.endTimer = setTimeout(() => {
    endEpisode(lane);
    // Re-arm only if the cause still holds — syncLanes may have cancelled it.
    if (lanes.get(name) === lane) arm(name, lane.key, gapFor(name, lane.key, rng));
  }, durationMs);
  return true;
}

function endEpisode(lane) {
  clearTimeout(lane.endTimer);
  lane.endTimer = null;
  for (const t of lane.subTimers) clearTimeout(t);
  lane.subTimers = [];
  if (lane.active) lane.stop?.();
  lane.active = false;
  lane.stop = null;
}

function cancelLane(name) {
  const lane = lanes.get(name);
  if (!lane) return;
  clearTimeout(lane.timer);
  endEpisode(lane);
  lanes.delete(name);
}

/* Each runner starts its episode, sets `lane.stop` to undo it, and returns how
   long it lasts. The attribute is the whole of the motion; CSS does the rest. */
const EPISODES = {
  lightning(lane) {
    const plan = planStrike(rng);
    strike(plan.peak);
    for (const a of plan.aftershocks) lane.subTimers.push(setTimeout(() => strike(a.peak), a.offsetMs));
    return plan.durationMs;
  },
  rain(lane) {
    setAttr("atmoRainMoving", "1");
    lane.stop = () => setAttr("atmoRainMoving", null);
    return lane.key === "heavy" ? RAIN_MOVE_MS.heavy : RAIN_MOVE_MS.moment;
  },
  twinkle(lane) {
    const root = document.documentElement;
    const stars = renderer?.stars?.() ?? [];
    const count = Math.round(band(rng, [2, BUDGETS.twinkle.maxStars]));
    for (let i = 1; i <= BUDGETS.twinkle.maxStars; i++) {
      const s = i <= count && stars.length ? stars[Math.floor(rng() * stars.length)] : null;
      // Off-screen when unused: the gradient layer still exists, it just paints nowhere.
      root.style.setProperty(`--atmo-tw-${i}`, s ? `${s.x.toFixed(1)}px ${s.y.toFixed(1)}px` : "-99px -99px");
    }
    setAttr("atmoTwinkle", "1");
    lane.stop = () => setAttr("atmoTwinkle", null);
    return TWINKLE_MS;
  },
  fog(lane) {
    const ms = Math.round(band(rng, FOG_MS));
    document.documentElement.style.setProperty("--atmo-fog-ms", `${ms}ms`);
    setAttr("atmoFogDrift", "1");
    lane.stop = () => setAttr("atmoFogDrift", null);
    return ms;
  },
  heat(lane) {
    document.documentElement.style.setProperty(
      "--atmo-heat-peak",
      band(rng, [0.15, BUDGETS.heatPulse.maxPeak]).toFixed(3)
    );
    setAttr("atmoHeatPulse", "1");
    lane.stop = () => setAttr("atmoHeatPulse", null);
    return HEAT_MS;
  }
};

/** The sun, from main.js syncSun — once a minute. Safe before init. */
export function atmosphereSun(altitudeDeg) {
  sunAlt = Number(altitudeDeg);
  paint();
}

/** One strike at `peak` (0..1). A one-shot the stylesheet plays; cleanup is a
    TIMER, never animationend, which does not fire under display:none. */
export function strike(peak = 1) {
  if (!renderer) return false;
  const root = document.documentElement;
  root.style.setProperty("--atmo-strike-peak", unit(peak).toFixed(3));
  delete root.dataset.atmoStrike;
  void root.offsetWidth; // restart the one-shot if one is already in flight
  root.dataset.atmoStrike = "1";
  clearTimeout(strikeTimer);
  strikeTimer = setTimeout(() => {
    strikeTimer = null;
    delete root.dataset.atmoStrike;
  }, STRIKE_MS + 200);
  return true;
}

function handle() {
  const out = {
    variant: renderer?.name ?? null,
    ...state(),
    sunAlt: Number.isFinite(sunAlt) ? Number(sunAlt.toFixed(2)) : null,
    forced,
    striking: strikeTimer !== null,
    effects: { ...effects }
  };
  /* Read off the timers themselves, not off lanesFor: a handle that reported
     the plan would say "armed" for a lane whose setTimeout was never made. */
  out.lanes = {};
  for (const [name, l] of lanes) {
    out.lanes[name] = {
      key: l.key,
      armed: l.timer !== null,
      inMs: l.timer !== null ? Math.max(0, Math.round(l.dueAt - performance.now())) : null,
      active: l.active,
      fired: l.fired
    };
  }
  return out;
}

/** @returns {boolean} false when the flag is off. */
export function initAtmosphereFx() {
  if (renderer) return true;
  const r = pick();
  if (!r) return false;
  renderer = r;
  effects = readEffects();
  document.documentElement.dataset.atmo = r.name;
  r.mount?.({ nightSky: effects.nightSky, textures: effects.textures });

  /* Only on the slice's IDENTITY: context-feed replaces the object only when a
     field changes, and presence pushes the store every minute for its own
     reasons — repainting three identical numbers on each is noise. */
  unsubscribe = subscribe((s) => {
    if (s.weather === lastWeather) return;
    lastWeather = s.weather;
    paint();
  });

  window.__v3Atmo = () => handle();
  /* The probe set: `{rain: "moderate"}`, `{strike: true}`, `{warmth: 0.8}`,
     `{thunder: true}`, `{weather: {category: "fog", tempC: 34}}`,
     `{night: true}`, `{accent: "cool"}`, `{textures: ["fog", "heat"]}` —
     combinable. `force(null)` hands the wall back to the real weather. This is
     how every effect is driven on the kiosk without waiting for the sky. */
  window.__v3Atmo.force = (f) => {
    forced = f ? { ...f } : null;
    if (forced) delete forced.strike;
    if (forced && !Object.keys(forced).length) forced = null;
    paint();
    if (f?.strike) strike();
    return handle();
  };
  window.__v3Atmo.strike = () => strike();
  /** Run a lane's episode NOW, if the lane is armed — the wall's way to see an
      effect without a 40-360 s wait. Returns false for an unearned lane. */
  window.__v3Atmo.fire = (name) => (lanes.has(name) ? fire(name) : false);

  paint();
  return true;
}

/** Test seam — the whole host back to flag-off. `opts.rng` seeds the lanes. */
export function __resetAtmosphereFx(opts = {}) {
  unsubscribe?.();
  unsubscribe = null;
  for (const name of [...lanes.keys()]) cancelLane(name);
  stopAccent();
  hueNow = null;
  hueEnd = null;
  renderer?.unmount?.();
  renderer = null;
  clearTimeout(strikeTimer);
  strikeTimer = null;
  forced = null;
  lastWeather = undefined;
  effects = {};
  rng = opts.rng ?? Math.random;
  const root = document.documentElement;
  for (const k of [
    "atmo", "atmoRaining", "atmoStrike", "atmoAccent", "atmoTexture", "atmoNightSky",
    "atmoRainEpisodes", "atmoRainMoving", "atmoTwinkle", "atmoFogDrift", "atmoHeatPulse"
  ]) delete root.dataset[k];
  for (const p of ["--atmo-rain", "--atmo-warmth", "--atmo-amp", "--atmo-strike-peak", "--atmo-fog-ms", "--atmo-heat-peak"]) {
    root.style.removeProperty(p);
  }
  for (let i = 1; i <= BUDGETS.twinkle.maxStars; i++) root.style.removeProperty(`--atmo-tw-${i}`);
}
