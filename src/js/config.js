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
    routineLearning: true,

    // Phase 9 "Remember on Purpose" (docs/vision/phase-9-remember.md). Replaces
    // the keyword-matched on-this-day footer with STRUCTURED memory the house
    // holds (people/pets/places/first-times, authored into data/memories/), and a
    // rarity-budgeted, context-matched selector: at most one memory a day, a
    // per-entry cooldown in months, and a context-fit floor so an ordinary
    // afternoon stays silent. It rides the Phase 2 queue as a Low-band,
    // non-interrupt candidate — no new render path. Tender entries (a lost pet)
    // get the gentlest surface (ambient-only, no caption), enforced in code.
    // Default OFF -> byte-identical to Phase 3's on-this-day regex path. Flipped
    // ON here (2026-07-12) to enable the structured memory engine on the Pi with
    // authored data/memories/ entries. Verify __forceMemory surfaces gently, the
    // rarity budget holds, and /kiosk-metrics stays flat. One-line revert (-> false).
    memoryEngine: true,

    // Phase 9.5 "The Photo Source" (docs/vision/photo-source-immich.md). Points the
    // memory engine + screensaver at the household's Immich library on the Synology
    // (read-only, server-proxied, API key server-side only). The ambient frame draws
    // from the whole library and boosts on-this-day photos; the memory engine gains a
    // photo-backed "N years ago today" entry. Immich serves pre-downscaled renditions,
    // so the Pi never decodes a full-res original. Default OFF -> byte-identical
    // (static/photos/ screensaver, text-only memory). Needs IMMICH_URL + IMMICH_API_KEY
    // in the Pi's .env; degrades to the static path when unset/unreachable. Enabled
    // 2026-07-12 (key added to the Pi's .env). Revert (-> false).
    immichPhotos: true,

    // Phase 10 "One Character" (docs/vision/phase-10-temperament.md). One
    // temperament authority (personality.js) every surfacing path routes through,
    // so the house speaks/moves/celebrates the same way every time: attention +
    // memory phrasing pass through one voice, centralised silence thresholds
    // decide when to say nothing, the atmosphere settle timing is sourced from the
    // authority, and arrival copy speaks in the same register. Plus a tightly
    // rationed delight registry — rare moments (first rain after a dry spell, home
    // after being away, a birthday morning, Christmas Eve, power restored) on
    // signals the house already has, each with a hard budget persisted to
    // data/delight/ so it can't fire twice. Default OFF -> every module keeps its
    // current tone and no delight candidate is added (byte-identical). Shipped
    // flag-off in 4ecb213 (deployed + Pi-verified byte-identical: hooks live,
    // --atmo-settle unset, runtime inert). Flipped ON here to enable the one voice
    // + delight registry on the Pi. Verify at the kiosk: __forceDelight each moment
    // fires once then the budget blocks a re-fire, __voice preview matches the
    // consistency snapshot, /kiosk-metrics stays flat. One-line revert (-> false).
    personality: true,

    // Design study 02 "The Hero Line" (docs/design/homeos-hero-type.html). A
    // length-responsive type scale for the Mode-1 focus hero: three tiers by
    // character count (<=16 -> headline, 17–40 -> standard, 41+ -> the floor) so
    // short lines go big and long lines step down, but never below the 3–4 m
    // legibility floor on the 32" panel. Copy is trimmed by the temperament
    // (personality.phrase) before it's set, so type never shrinks to fit.
    // Sizing is set once per content change (never animated) — the only hero
    // motion stays the opacity cross-fade. Default OFF -> byte-identical to the
    // fixed 1.6rem line. Ships flag-off (no-op deploy) then flips on the Pi to
    // verify legibility at 3–4 m + /kiosk-metrics flat. One-line revert (-> false).
    heroType: false
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
