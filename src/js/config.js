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

    // Tier-1a spec-fidelity upgrade of the lean-in stack (2026-07-15 conformance
    // audit vs docs/design/design_handoff_homeos_home). Requires leanInStack for
    // the glass. The one-line chips become the study's rich cards: candidates may
    // carry optional {title, sub, meta, metaLabel} (sources with real parts emit
    // them — media/plex source+title, menu name, next-event name+relative; the
    // rest fall back to their text rendered in the title slot, one type system).
    // Card: 48px icon slot, 44/600 title + 22/ink-56 sub, right meta block
    // 40/600/tabular + 17/ink-50 label, padding 26/34, 18px stack gap, stack
    // centred at --content-max. The top card takes the hero-glass variant, an
    // interrupt candidate earns the 3px --status-warn stripe + warm icon glow
    // (never a coloured card), and a mono "+N more" resting note counts the
    // queue below the fold. Flag-off adds no class and renderStack keeps the
    // one-line chips → byte-identical. Enabled 2026-07-15 after the 4663e71
    // flag-off deploy; Pi live proof in the project memory. Revert (-> false).
    stackCards: true,

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

    // Tier-1b spec-fidelity reshape of the arrival card (2026-07-15 conformance
    // audit vs docs/design/design_handoff_homeos_home). Requires arrivalCard.
    // The card moves to the study geometry — bottom-center (bottom 8%, 760px),
    // sliding UP (translateY 46px→0 + opacity on timing("arrival")) instead of
    // dropping from the top — and takes the spec type: welcome 64px/500 with
    // the NAME in --warm/600 (the handoff's sanctioned --warm text exception,
    // alongside the crown), status 24px/ink-60, event times warm tabular 600,
    // titles 26px/ink-85, padding 38/46. Flag-off adds no class → byte-identical
    // (the shipped top-slide WP3 card stands). Enabled 2026-07-15 after the
    // 4663e71 flag-off deploy; Pi live proof in the project memory. Revert (-> false).
    arrivalBottom: true,

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

    // WP-D follow-up #1 (DESIGN_SYSTEM.md §6) — the weather-based living accent.
    // The atmosphere already tints the ground per condition (the shipped atmo-*
    // substrate token); this makes --accent follow the same weather instead of
    // the time-of-day tint-* cycle, so the ambient clock warms at golden hour,
    // cools under rain/storm, and rests white on plain days — the wall lit by
    // one light source, not two. Pure CSS: body.living-accent.atmo-* overrides
    // the tint-* accent (background.css); the clock/dateline colour settles on
    // --atmo-settle (60s) so it moves with the ground, not ahead of it. The
    // golden warm value is the sanctioned §6 atmosphere accent, not --warm.
    // Flag-off adds no body class → byte-identical (accent stays time-based).
    // Pi-verified 2026-07-15 (634a616 flag-off → default-on here): live CDP probe
    // walked every atmo token → the exact §6 accent (golden warm .94, rain/storm
    // cool .97, night .92, clear/day white .95); the real evening state showed the
    // point — tint-evening periwinkle vs atmo-night → the flag gives night blue,
    // the clock lit by the actual sky. Revert (-> false).
    livingAccent: true,

    // WP-D follow-up #2 — the day-boundary photo cross-dissolve. The awake
    // ground photo no longer holds for the whole session: when the calendar
    // day flips, background.js fetches one new Immich photo and cross-fades it
    // over the old on --t-settle (60s), then removes the old node (setTimeout,
    // never transitionend — the hidden-element cleanup rule). STILL static at
    // rest: no rotation timer, one slow settle per day — the 0%-GPU invariant
    // holds. Immich down at the boundary → the old photo simply stays.
    // __forcePhotoDissolve({settleMs}) debug hook. Flag-off → no day check, no
    // hook; the photo holds for the session (WP-D v1 behaviour).
    // Pi-verified 2026-07-15 (634a616 flag-off → default-on here): forced live
    // dissolve → two .awake-photo imgs during the settle, old node removed on
    // the timer, id handed to the survivor, latch released (second dissolve
    // works), 0 page errors, DOM count flat. Revert (-> false).
    awakePhotoDissolve: true,

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
    mediaCandidate: true,

    // Design-system follow-up (docs/design/DESIGN_ROLLOUT.md) — fold the remaining
    // home tiles (Tonight's Menu + Bins) off the presence surface. Tonight's
    // dinner rides the attention queue as the quietest low-band candidate (🍽
    // name), and the #home-stack tiles are hidden. Bins are already represented in
    // attention by the shipped bin-night predictive candidate (predictiveCandidates
    // fetches /api/bins), so the bins tile just hides. Tiles stay in the DOM.
    // Pi-verified 2026-07-14 (a1d64b7 flag-off → default-on here): a simulated
    // dinner surfaced "🍽 Stuffed Capsicums for dinner" (score 40) in the attention
    // queue and #home-stack was display:none (tiles stayed in the DOM). Now
    // default-on; flag-off byte-identical (the tiles show, no menu candidate).
    // One-line revert (-> false).
    foldHomeTiles: true,

    // Old-chrome audit (memory: project-next-session) — fold the near-always-visible
    // #camera-last-trigger-pill ("Driveway · Last triggered 3:42pm") off the home
    // surface into the one attention queue. With this on, a recent camera trigger
    // rides the lean-in stack as a low-band stack-only candidate (📹 name · last
    // triggered) that DECAYS on its own (expiresAt = trigger + 15 min) instead of
    // lingering as fixed chrome, and the standalone pill is hidden (stays in the DOM;
    // the candidate reads the same module state the pill did). Rides
    // features.attentionEngine for the queue. Default OFF → the pill shows, no
    // candidate (byte-identical). Flipped ON here 2026-07-16 (shipped flag-off in
    // be69ebe → default-on) to fold the pill on the Pi; verify at the kiosk that a
    // recent trigger rides the stack (📹 name · last triggered) and decays, and the
    // standalone pill is display:none. One-line revert (-> false).
    cameraCandidate: true,

    // Phase 4 "Give it a voice" (docs/vision/phase-4-voice.md) — the Mode 3
    // conversation infrastructure, built AHEAD of the hardware (no mic on the
    // Pi yet). An explicit wake (Space-bar Web Speech today; the wake-word
    // pipeline when the mic lands; __voiceTranscript over CDP) opens a voice
    // session: presence enters MODE.VOICE (the attention gate stands down),
    // the transcript walks three lanes — local commands → HA Assist device
    // control (/api/voice/assist) → Claude house-voice (/api/voice/converse,
    // Haiku primary / Ollama fallback) — the reply is spoken, the session
    // lingers ~8s for a follow-up, then recedes to GLANCE. GUARDRAIL: text
    // goes upstream only on explicit wake — there is no passive audio path.
    // Default OFF → byte-identical (voiceCommands keeps today's local-only
    // matching; unknown commands still dead-end at "Didn't catch that.").
    // Flip ON when the mic lands — or to drive it hardware-free via
    // __voiceTranscript("...") / __voiceSession(). One-line revert (-> false).
    voiceSession: false
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
