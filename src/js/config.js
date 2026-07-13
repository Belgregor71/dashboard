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
    // motion stays the opacity cross-fade. Shipped flag-off in 003b1cb (no-op
    // deploy), flipped ON live on the Pi and verified: tier mapping exact
    // (13ch->144px / 32ch->104px / 52ch->72px), heap + GPU flat (80% = the
    // pre-existing awake-home baseline, unchanged by a static type change).
    // Now default-on. One-line revert (-> false).
    heroType: true,

    // Design study 05 "The Ambient Clock" (docs/design/homeos-ambient-clock.html),
    // WP1 of docs/design/PLAN.md. The Mode-0 screensaver clock gets the study
    // treatment: tabular figures + a quieter/smaller meridiem, and its brightness
    // tracks the *sun altitude* on a smooth curve (dims with the sky, ~0.9 day →
    // ~0.3 the small-hours floor) instead of the binary sunset→sunrise night
    // switch. Pure opacity/type, no new motion — the idle GPU stays frozen (0%).
    // Pi-verified 2026-07-12 (18a237b flag-off → default-on here): at night the
    // clock clamped to the 0.3 floor, tabular face + quieter "pm", gpu-process
    // 0% over 25s, legible over a real photo. Now default-on. One-line revert
    // (-> false); flag-off is byte-identical (plain string, binary dimming).
    ambientClock: true,

    // Design study 01 "The Lean-in stack" (docs/design/homeos-component-studies.html),
    // WP2 of docs/design/PLAN.md. In DWELL — the one mode where glass earns its
    // edges — the curated stack cards under the hero get the full 5-token glass
    // system together (--glass-bg/-border/-blur/-shadow/-sheen), and their type
    // firms up to sit as deliberate cards under the study-02 hero scale. The
    // reveal stays opacity-only with the existing setTimeout teardown (never
    // transitionend while hidden). Glass shows only in DWELL; the stack is hidden
    // at rest, so Ambient stays 0% GPU. Pi-verified 2026-07-12 (7a054a3 flag-off
    // → default-on here): DWELL cards showed blur(18px) + the glass shadow/sheen,
    // DOM flat 2265→2265 across 40 reveal/teardown cycles, heap 54MB / listeners
    // 64 (no leak). Now default-on; flag-off stays byte-identical (flat cards).
    // One-line revert (-> false).
    leanInStack: true,

    // Design study 03 "The Arrival card" (docs/design/homeos-arrival-card.html),
    // WP3 of docs/design/PLAN.md. The away->home greeting card gets the study
    // treatment — the warmest surface in the system: the full glass overlay with
    // a hairline warm "crown" (--arrival-crown), enter/exit sourced from
    // personality.timing("arrival"), and a transform-driven countdown drain (no
    // per-arrival JS timer). A >=2-day absence trips the budgeted home-after-away
    // delight -> the card shows its warm variant (warmth replaces logistics),
    // rationed by the same budget (can't fire twice). Copy already routes through
    // personality.phrase. Pi-verified 2026-07-13 (eb87382 flag-off → default-on
    // here): normal card showed full glass blur(18px) + warm crown 0.34 + the
    // arrival-drain CSS animation + agenda; warm variant (delight home-after-away,
    // budget spent-then-blocked) strengthened the crown to 0.55 and dropped the
    // agenda; DOM flat 2265→2265 over 40 arrivals, heap 54MB / 64 listeners (no
    // leak). Now default-on; flag-off stays byte-identical (cool card, JS drain).
    // One-line revert (-> false).
    arrivalCard: true,

    // Design study 01 "The Ambient memory surface" (ambient half of
    // docs/design/homeos-component-studies.html), WP4 of docs/design/PLAN.md.
    // The tender ambient lane — the documented Phase-9 follow-up. A tender memory
    // (sensitivity:"tender") surfaces ONLY in Mode 0 (the screensaver), WORDLESS:
    // its photo fills the frame + a faint 🕯 mark bottom-right, held longer, then
    // fades — never a caption, never the text hero. The gentleness is enforced in
    // memoryEngine.toSurface (ambientOnly/caption:null/longer hold) and re-checked
    // at the render boundary (the ambient lane refuses any non-tender surface).
    // Rides the memoryEngine flag for data + budget. Pure opacity/type, no loop —
    // idle GPU stays frozen. Pi-verified 2026-07-13 (8ff58e8/e30e5f5 flag-off →
    // default-on here): forced tender surface rendered wordless (🕯 mark opacity
    // 0.5, no caption in the content), its photo filled the frame, held, budget
    // spent (lastSurfacedDay set), a non-tender surface was refused by the lane,
    // gpu-process 0% over 25s. Now default-on; flag-off stays byte-identical (no
    // mark element, tender memories stay dropped). One-line revert (-> false).
    ambientMemory: true,

    // Design-system rollout WP-B (docs/design/DESIGN_ROLLOUT.md) — the bare top
    // row. Strips the old chrome off the awake Glance/Lean-in top row so the time
    // and weather sit bare over the ground, per docs/design/DESIGN_SYSTEM.md §2.1:
    // left = time only (display 500 / 64px / tabular / --ink, quiet meridiem, NO
    // date — the date lives in the Ambient clock); right = temp (600 / 64px) over
    // a single "LOCATION · CONDITION" line (Inter 500 / 19px / .14em / uppercase /
    // ink .6). Removes the weather icon (borrowed-light law — the wall renders the
    // condition, no lottie), the wind line, the hi/lo range, and the middle-slot
    // commute/next-event cards (their content flows into the attention/hero queue).
    // Adds body.bare-top-row (CSS-driven) + skips the weather/wind lottie loads so
    // no hidden rAF keeps running. Pi-verified 2026-07-13 (faf24b3 flag-off →
    // default-on here): time bare top-left (tabular, 500, --ink, quiet meridiem),
    // "15°" over "NUDGEE · CLEAR" bare top-right, no icon/wind/range/date/middle
    // slot; weather lottie did NOT load (0 wrappers, no zombie rAF);
    // #current-conditions textContent stayed "Clear" so the screensaver dateline
    // is unaffected; concierge hero unaffected. Now default-on; flag-off stays
    // byte-identical (old cards + icon + wind + range return). Revert (-> false).
    bareTopRow: true,

    // Design-system rollout WP-C (docs/design/DESIGN_ROLLOUT.md) — un-chrome the
    // hero. Strips the container box off #focus-hero so the scored line sits bare
    // over the ground (DESIGN_SYSTEM.md §2.1): glyph + text only, 28px gap,
    // vertically centred +120px below true centre, glyph with a borrowed-light
    // glow. The idle concierge fallback (✨) gets the matte variant — lower ink,
    // softer shadow, no glyph glow — so it reads as the house making conversation,
    // not a scored alert. The stack is bottom-anchored so it doesn't sit above the
    // centred hero. Relies on features.heroType (shipped) for the tier sizes.
    // Pi-verified 2026-07-13 (c51fe47 flag-off → default-on here): concierge hero
    // rendered bare (backgroundImage none, borderTop none), fixed + centred (rect
    // y587 h147 → centre 660 = 540 + 120px), matte (glyph no glow, ink .78),
    // legible; no overlap with the legacy media panel. Now default-on; flag-off
    // byte-identical (the boxed hero returns). Revert (-> false).
    bareHero: true,

    // Design-system rollout WP-D (docs/design/DESIGN_ROLLOUT.md) — the awake
    // photographic ground. Today only the screensaver draws a photo; the awake
    // Glance/Lean-in modes show the animated aurora/stars. With this on, the awake
    // modes get the same layered ground as Mode 0 (DESIGN_SYSTEM.md §6): a single
    // Immich photo, held STATIC (fetched once, no rotation timer — the 0%-GPU-at-
    // rest invariant), the weather atmosphere tint (the shipped substrate ::before)
    // over it, and a readability gradient beneath the content. The animated aurora
    // /stars/time-tint are retired (a net GPU *reduction* awake — one fewer loop).
    // Immich down → the base sky gradient shows through (never a blank frame).
    // FOLLOW-UPS (not in v1): the weather-based living accent (§6) and a day-
    // boundary photo cross-dissolve — the accent stays time-based, the photo holds
    // for the session. Pi-verified 2026-07-13 (f6502b0 flag-off → default-on here):
    // awake home renders content over a real Immich family photo lit by the weather
    // tint + readability gradient (top row / concierge hero legible); aurora
    // retired; gpu-process 0% over 25s in Mode 0 (idle-freeze intact) AND 0% awake-
    // idle (the retired aurora loop = a net GPU reduction). Now default-on; flag-off
    // byte-identical (aurora returns, no photo). One-line revert (-> false).
    awakeGround: true,

    // Design-system rollout WP-E (docs/design/DESIGN_ROLLOUT.md) — the captioned
    // memory whisper: the Mode-0 bottom-right "on this day" surface (the non-tender
    // counterpart to the shipped wordless tender lane). Elevates the existing
    // screensaver on-this-day footer line into the study-01 whisper treatment
    // (DESIGN_SYSTEM.md §2.1): a faint eyebrow (🕰 ON THIS DAY) + a display title,
    // right-aligned, surfacing on the 60s settle. When on, the footer drops the
    // on-this-day line (it moves to the whisper). Pure opacity/type — no loop, GPU
    // stays 0% at rest. Pi-verified 2026-07-14 (809e777 flag-off → default-on here):
    // forced today-anniversary surfaced the whisper bottom-right ("🕰 ON THIS DAY"
    // + the display title), legible over the night photo, footer dropped its line;
    // hidden when no anniversary (silence). Now default-on; flag-off byte-identical
    // (footer keeps the line, no whisper element). One-line revert (-> false).
    memoryWhisper: true,

    // Design-system follow-up (docs/design/DESIGN_ROLLOUT.md) — fold the standalone
    // "Now Playing" media panel into the one attention queue. With this on, what's
    // playing rides the hero/stack as the lowest low-band candidate (🎬 source —
    // title) like commute/next-event, and the standalone glass media panel is
    // hidden on the presence surface (it stays in the DOM so the candidate + the
    // screensaver info line can still read it). Rides features.attentionEngine
    // (shipped) for the queue. Pi-verified 2026-07-14 (378805a flag-off →
    // default-on here): a simulated player surfaced "🎬 Lounge Room — The Parent
    // Trap" (score 41) in the attention queue and, as the only candidate, rendered
    // through the bare hero line; the standalone #media-stack was display:none but
    // stayed in the DOM. Now default-on; flag-off byte-identical (panel shows, no
    // candidate). One-line revert (-> false).
    mediaCandidate: true
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
