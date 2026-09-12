/* ═══════════════════════════════════════════════════════════════════════════
   THE LIVING WINDOW ON V3 — the host (design arc, step 2: the variants).

   docs/design/HANDOVER-LIVING-WINDOW-V3.md. Seven incumbent weather effects have
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

   Flag-off: no attribute, no node, no handle, no subscription — the build that
   shipped before.
   ═══════════════════════════════════════════════════════════════════════════ */

import { get as getContext, subscribe } from "../../js/core/contextStore.js";
import { skyWarmthFor } from "../../js/services/atmosphere.js";
import { clockDim } from "./sun-clock.js";
import { overlay } from "../atmo/overlay.js";

const flag = (name) => Boolean(globalThis.window?.CONFIG?.features?.[name]);

/** The incumbent's strike: 1.6 s one-shot (atmoFx/planner.js STRIKE_DECAY_MS). */
export const STRIKE_MS = 1600;
/** Rain intensity → level. The incumbent's three tiers, and moderate when unsaid. */
export const RAIN_LEVEL = { light: 0.35, moderate: 0.65, heavy: 1 };

/** @returns {number} 0..1 — 0 unless the slice says it is raining or storming. */
export function rainLevel(weather) {
  if (!weather || (weather.category !== "rain" && weather.category !== "storm")) return 0;
  return RAIN_LEVEL[weather.intensity] ?? RAIN_LEVEL.moderate;
}

let renderer = null;
let unsubscribe = null;
let strikeTimer = null;
let lastWeather = undefined;
let sunAlt = NaN;
let forced = null;

function pick() {
  // A literal read — tests/flag-surface.spec.js derives which flags V3 reads
  // from exactly this form.
  if (flag("v3AtmoOverlay")) return overlay;
  return null;
}

function state() {
  const w = getContext().weather;
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

function paint() {
  if (!renderer) return;
  const s = state();
  const root = document.documentElement;
  root.style.setProperty("--atmo-rain", unit(s.rain).toFixed(3));
  root.style.setProperty("--atmo-warmth", unit(s.warmth).toFixed(3));
  root.style.setProperty("--atmo-amp", unit(s.amp).toFixed(3));
  if (s.rain > 0) root.dataset.atmoRaining = "1";
  else delete root.dataset.atmoRaining;
  renderer.apply?.(s);
}

/** The sun, from main.js syncSun — once a minute. Safe before init. */
export function atmosphereSun(altitudeDeg) {
  sunAlt = Number(altitudeDeg);
  paint();
}

/** One strike. A one-shot the stylesheet plays; cleanup is a TIMER, never
    animationend, which does not fire under display:none (CLAUDE.md, memory). */
export function strike() {
  if (!renderer) return false;
  const root = document.documentElement;
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
  return {
    variant: renderer?.name ?? null,
    ...state(),
    sunAlt: Number.isFinite(sunAlt) ? Number(sunAlt.toFixed(2)) : null,
    forced,
    striking: strikeTimer !== null
  };
}

/** @returns {boolean} false when the flag is off. */
export function initAtmosphereFx() {
  if (renderer) return true;
  const r = pick();
  if (!r) return false;
  renderer = r;
  document.documentElement.dataset.atmo = r.name;
  r.mount?.();

  /* Only on the slice's IDENTITY: context-feed replaces the object only when a
     field changes, and presence pushes the store every minute for its own
     reasons — repainting three identical numbers on each is noise. */
  unsubscribe = subscribe((s) => {
    if (s.weather === lastWeather) return;
    lastWeather = s.weather;
    paint();
  });

  window.__v3Atmo = () => handle();
  /* The probe set: `{rain: "moderate"}`, `{strike: true}`, `{warmth: 0.8}` —
     combinable. `force(null)` hands the wall back to the real weather. This is
     how the effect is driven on the kiosk without waiting for a storm. */
  window.__v3Atmo.force = (f) => {
    forced = f ? { ...f } : null;
    if (forced) delete forced.strike;
    if (forced && !Object.keys(forced).length) forced = null;
    paint();
    if (f?.strike) strike();
    return handle();
  };
  window.__v3Atmo.strike = () => strike();

  paint();
  return true;
}

/** Test seam — the whole host back to flag-off. */
export function __resetAtmosphereFx() {
  unsubscribe?.();
  unsubscribe = null;
  renderer?.unmount?.();
  renderer = null;
  clearTimeout(strikeTimer);
  strikeTimer = null;
  forced = null;
  lastWeather = undefined;
  const root = document.documentElement;
  delete root.dataset.atmo;
  delete root.dataset.atmoRaining;
  delete root.dataset.atmoStrike;
  for (const p of ["--atmo-rain", "--atmo-warmth", "--atmo-amp"]) root.style.removeProperty(p);
}
