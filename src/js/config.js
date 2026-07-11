// static/js/config.js

/* ------------------------------------------------------------------
   ENV DETECTION
-------------------------------------------------------------------*/

const isLocalhost =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1";

/* ------------------------------------------------------------------
   GLOBAL CONFIG
-------------------------------------------------------------------*/

window.CONFIG = {
  // Used by app.js
  isLocalhost,

  /* --------------------------------------------------------------
     FEATURE FLAGS
     Toggle modules on/off without touching code
  --------------------------------------------------------------*/
  features: {
    // Core UI
    background: true,
    clock: true,
    commute: true,

    // Data-driven panels
    weather: true,
    calendar: true,

    // External integrations
    homeAssistant: true, // force enable
    plex: true,

    // Phase 1 presence runtime (docs/vision/phase-1-presence-runtime.md).
    // Verified live on the Pi 2026-07-11 (screensaver boundary drives
    // ambient<->glance; dead click-cycle suppressed) — now enabled.
    presenceRuntime: true,

    // Phase 2 attention engine (docs/vision/phase-2-attention-engine.md).
    // Unifies every focus-hero source into one scored, presence-gated queue.
    // Verified live on the Pi 2026-07-11 (DWELL reveals top-3 stack; AMBIENT
    // interrupt-only; GLANCE single hero) — now enabled.
    attentionEngine: true,

    // Phase 3 predictive candidates (docs/vision/phase-3-anticipate.md).
    // Grounded anticipatory rules (rain-incoming, bin-night, on-this-day) merged
    // into the attention queue. Verified live on the Pi 2026-07-11 (rain hero
    // fires at the confidence-scaled score, renders, and decays past its
    // window) — now enabled.
    predictiveCandidates: true,

    // Phase 5 ambient atmospherics (docs/vision/phase-5-atmospherics.md).
    // Mode 0 (screensaver) carries a slow-settling weather/light tint + the
    // occasional earned "on this day" memory. Verified live on the Pi
    // 2026-07-11: tint renders and adds zero GPU cost (80% Mode 0 baseline is
    // the pre-existing Ken Burns photo decode, unchanged by the token) — enabled.
    ambientAtmospherics: true,

    // Phase 6 House Model (docs/vision/phase-6-intent.md). A pure reducer fuses
    // presence + calendar + people-home into an `intent` posture the attention
    // gate reads (rushed → interrupt-only; unhurried → DWELL depth sooner).
    // Shipped flag-off in 155f451, then flipped on & live-verified on the Pi
    // 2026-07-11 (__intent tracks the real evening; __forceIntent raises the
    // gate floor; kiosk-metrics flat) — now enabled.
    houseIntent: true,

    // Phase 7 "Dissolve the dashboard" (docs/vision/phase-7-dissolve.md). Lifts
    // the Phase 5 atmo-* token off the screensaver root onto a shared app root
    // (body) so the intent-dressed, weather-tinted room persists across
    // AMBIENT → GLANCE → DWELL — the awake dashboard surfaces *over* the mood
    // instead of hiding it. Default OFF: byte-identical to Phase 5/6. Gated on a
    // measured GPU prerequisite (the Mode-0 Ken Burns photo-decode debt), which
    // PASSED on the Pi (Ken Burns → 6s settle+hold dropped Mode-0 steady-state
    // GPU 80%→0%). Enabled here in daylight to run the remaining awake
    // GLANCE/DWELL gpucpu + per-token legibility verification. Reversible (→ false).
    ambientSubstrate: true,

    // Phase 8 "Learn Without Asking" (docs/vision/phase-8-learn.md). A passive
    // observer on the signals already emitted (presence, person.* transitions,
    // attention hero) that folds household rhythms into bounded on-device
    // aggregates (data/routines/) and, only ABOVE a confidence threshold,
    // sharpens the House Model's timeBudget (learned departure) and nudges
    // attention ranking per source. Never announced, never sent upstream.
    // Shipped flag-off in f051f7b; enabled here to START the multi-day
    // observation window. Inert-until-confident: the runtime observes + persists
    // bounded aggregates, but the advisory feeds return null/{} until routines
    // cross the confidence threshold (several days of samples), so there is no
    // immediate behaviour change. Watch: aggregates stabilise + stay bounded +
    // /kiosk-metrics flat. One-line revert (→ false) if anything drifts.
    routineLearning: true
  },

  /* --------------------------------------------------------------
     REFRESH INTERVALS (milliseconds)
  --------------------------------------------------------------*/
  clock: {
    refreshMs: 1000
  },

  weather: {
    refreshMs: 10 * 60 * 1000 // 10 minutes
  },

  calendar: {
    refreshMs: 60 * 1000 // 1 minute
  },

  commute: {
    visibilityCheckMs: 60 * 1000,
    refreshMs: 10 * 60 * 1000
  },

  plex: {
    refreshMs: 30 * 1000
  }
};
