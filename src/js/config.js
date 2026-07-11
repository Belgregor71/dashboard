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
    // into the attention queue. Default off for the first deploy; flip on the Pi
    // after live verification, then default on (the Phase 1/2 rollout pattern).
    predictiveCandidates: false
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
