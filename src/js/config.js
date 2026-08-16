/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces as a plain `<script src="/js/config.js">`, not an
   import — so no dependency graph shows this edge. It sets `window.CONFIG`,
   and every V3 flag read is optional-chained: lose this file and V3 boots
   with all features silently OFF rather than failing. Do not let it go.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

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

    // "Daily Memories" screensaver. Turns the ambient rotation into a curated,
    // FROZEN per-day "on this day" set: today's month/day across past years,
    // widened to the nearest neighbouring dates when a day is thin (up to 12), and
    // chosen ahead in the evening (while the NAS is awake) so it serves all next
    // day even after the Synology sleeps. Each frame carries a subtle bottom-left
    // "year · place, region" caption, plus a small static map tile for travel
    // photos (taken outside Australia — needs MAP_API_KEY in .env). Rides on top of
    // immichPhotos; when its frozen set is empty (Immich down / no memories) it
    // falls back to the immichPhotos blend. Enabled 2026-07-24: route live-verified
    // with real exif on the Pi (captions + travel gate correct), MAP_API_KEY added,
    // screensaver surface proven live via __ssPlace. Revert (-> false) restores the
    // immichPhotos blend exactly (routes/scheduler stay inert, build-on-demand only).
    dailyMemories: true,

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

    // The robot vacuum's "needs a human" states — the only thing it knows that
    // nobody is ever told: a `device_class: problem` sensor that is ON (empty
    // water tank, dirty/clean dock tank), or a consumable past its service life.
    // Selected by device_class rather than entity id, because the dock sensors
    // carry a room prefix that would silently stop matching if the robot moved.
    // A chore, so it is low-band and stackOnly — a water tank must never take the
    // centred hero — and it carries NO expiresAt, because unlike a camera trigger
    // this is a state, not an event: it should sit there until someone empties it.
    // Default OFF → no candidate at all (readState reads nothing). Flip only after
    // the flag-off no-op is proven on the panel.
    robotCandidate: false,

    // "Someone is gaming" (binary_sensor.gaming_hub_someone_is_gaming) is far more
    // useful as BEHAVIOUR than as a displayed fact, so it surfaces nothing: it
    // holds back the chatty end of the attention queue (anything below the High
    // band) and holds rationed delight. Interrupt and High still come through — a
    // storm warning is not chatter.
    // ⚠ It cannot silence the front door, and that is structural rather than a
    // threshold choice: the doorbell and security cameras drive their popup, TTS
    // and screen wake straight from doorbellAlert.js and never enter the queue.
    // Default OFF → isGamingQuiet() returns false and the gate is byte-identical.
    gamingQuiet: false,

    // Phase 4 "Give it a voice" (docs/vision/phase-4-voice.md) — the Mode 3
    // conversation infrastructure, built AHEAD of the hardware (no mic on the
    // Pi yet). An explicit wake (the wake-word pipeline once the mic lands;
    // until then __voiceTranscript over CDP, or Space-bar Web Speech on a DEV
    // MACHINE only — the kiosk has no keyboard/mic) opens a voice session: presence enters MODE.VOICE (the attention gate stands down),
    // the transcript walks three lanes — local commands → HA Assist device
    // control (/api/voice/assist) → Claude house-voice (/api/voice/converse,
    // Haiku primary / Ollama fallback) — the reply is spoken, the session
    // lingers ~8s for a follow-up, then recedes to GLANCE. GUARDRAIL: text
    // goes upstream only on explicit wake — there is no passive audio path.
    // Flipped ON 2026-07-21 (USB mic acquired) to run the live software-loop
    // verification on the Pi — the mic's own bridge into submitTranscripts is
    // not built yet, so with the flag on the lanes sit ARMED and are driven via
    // __voiceTranscript("...") over CDP for proof; no user-facing wake path
    // exists on the kiosk until the STT→forward bridge lands, so on is inert
    // for users. One-line revert (-> false) is the rollback path.
    voiceSession: true,

    // HALF DUPLEX — the house stops talking when someone says the wake word,
    // and never answers its own voice.
    //
    // The kiosk's microphone and its HDMI speakers share a room. The wake agent
    // cannot tell our voice from a person's, so on 2026-08-08/09 it transcribed
    // the dashboard's own replies back into the pipeline and the house answered
    // itself: "It's 18 degrees and clear." came back as a question. (Two agent
    // bugs made it far worse and are fixed unflagged in tools/voice-agent —
    // Model.reset() never cleared the feature buffer, and arecord's backlog was
    // replayed as live audio. This flag is the third leg: the agent knowing.)
    //
    // On: tts.speak() reports playback to /api/voice/speaking, the agent gates
    // capture while it is set, and a wake word held over a reply POSTs
    // /api/voice/barge-in, which silences the page mid-sentence and hands the
    // floor back. Off: no observer is installed, no request is made, and the
    // agent's speaking flag stays clear — which is exactly today's behaviour.
    // Flipped ON 2026-08-09 after the two agent bugs were measured fixed on the
    // G11 (feature buffer, melspectrogram and raw ring all byte-identical to
    // cold start after a flush; the OLD reset left 1.2 s of the wake word in
    // the detector). Verified on /v3/, the surface the wall actually runs.
    // One-line revert (-> false) is the rollback path.
    voiceHalfDuplex: true,

    // STREAMED REPLIES — speak sentence one while the model writes sentence two.
    //
    // The conversational turn is four blocking steps in series: wake+STT, a HA
    // Assist round trip, the whole model reply, then the whole Kokoro WAV.
    // Nothing streamed, so the room heard silence for the sum of all four —
    // 2-4 s by this file's own measurement, against the 200-500 ms that natural
    // turn-taking sits at.
    //
    // On: /api/voice/converse is POSTed with stream:true and answers over SSE,
    // emitting whole sentences as they are written; tts.createSpeech() plays
    // them in order, so time-to-first-audio is one sentence plus one synthesis
    // instead of the whole reply plus the whole synthesis.
    // Off: the JSON route, byte-identical to before — and the JSON route is
    // still the fallback whenever a stream fails before speaking anything.
    //
    // MEASURED ON THE KIOSK 2026-08-16 and flipped on the numbers. Paired runs,
    // same three questions in both states, time from __v3Transcript() to the
    // first play() call (muted, so the metric is unaffected):
    //
    //   question            off      on     saved
    //   washing in         1998ms  1731ms   0.27s
    //   eat outside        4514ms  1437ms   3.08s
    //   blinds             2043ms   958ms   1.09s
    //
    // The pattern is the point and it matches the mechanism: the saving scales
    // with reply LENGTH, because non-streaming waits for the whole answer while
    // streaming waits for one sentence. Short replies gain a little, long ones
    // gain seconds. Never slower in any sample, and one turn cleared the
    // sub-second target.
    //
    // ⚠ Kokoro synthesis is ~1.75s for a short uncached line, so that is the
    // floor TTFA cannot go below however good the streaming is. Chasing lower
    // means a faster TTS, not more work here.
    //
    // ⚠ An earlier 2-sample read showed a 2.1s saving and was WRONG — the two
    // baselines were ~5.9s outliers from the known ~6s first-fetch stall. Take
    // paired samples on the same questions; the variance here is large.
    //
    // Revert = false. It touches tts.js, the chokepoint for blob revocation and
    // the half-duplex mic gate on BOTH surfaces, so if audio ever misbehaves
    // this is the first thing to put back.
    voiceStreaming: true,

    // SOUND PRESENCE — the room's own noise as a second presence source.
    //
    // V3 reads presence from binary_sensor.kitchen_motion_detected, and that
    // camera's detection gets deliberately switched off by a member of the
    // household. recoveryService guard 1 then re-arms it, so the house has been
    // quietly undoing a person's choice. A second source means the camera can
    // just stay off.
    //
    // The mic is already open 24/7 for the wake word; nothing new listens. The
    // agent reports one level AND one silero speech probability per second over
    // loopback — no audio, no transcript, nothing logged — and
    // server/services/soundPresence.js requires BOTH: speech >= SPEECH_THRESHOLD
    // (0.3) AND level >= NEAR_DB (-24 dBFS), on CONSECUTIVE (2) seconds.
    //
    // Speech answers "is this a voice"; level answers "is it in THIS room".
    // Loudness alone CANNOT work at any threshold — a real conversation and the
    // empty room overlap (see the measured tables in soundPresence.js). The
    // neighbours' children are what forced the proximity half: their voices are
    // genuinely speech, so the VAD is right and the presence verdict was wrong.
    // CONSECUTIVE is load-bearing, not an impulse filter — outside noise through
    // a window produces isolated loud speech-positive samples but does not hold.
    //
    // ⚠ NEAR_DB is ABSOLUTE dBFS and is therefore COUPLED TO THE MIC'S CAPTURE
    // GAIN (+22.5 dB, 23/30). Change the gain and this number is void. Re-check
    // with GET /api/voice/ambient: floorDb should sit near -30 dB.
    //
    // On: a `sound:presence` bus event feeds presence.sawMotion(), additively
    // with the camera — whichever notices first wins, neither can veto. Off: the
    // event is still emitted and still ignored, so the surface behaves exactly
    // as it did before. One-line revert (-> false) is the rollback path.
    //
    // Flipped default-on 2026-08-12, after the failure it was built for actually
    // happened: four eufy cameras (incl. the kitchen) delivered nothing for days
    // because eufy-ws re-presented a stale FCM push token, so the wall sat
    // presence-blind while every automated recovery reported "ok". Verified the
    // same day: floorDb -30.9 (gain unchanged), decidedBy "speech", peakSpeech
    // 0.995. A second source means one dead sensor can no longer blind the room.
    soundPresence: true,

    // PRESENCE EARNS MEDIUM — the bar moves with the room.
    //
    // attention.js normally requires score >= 70 (High) before a candidate can
    // take the glance cell. That line exists so the wall never lights up for
    // nobody. When someone IS in the room that reason is spent — the house has
    // an audience, and the audience is the visible cause the calm law asks for.
    //
    // On: while isPresent(), the bar drops to the Medium floor (50), so things
    // that are worth a glance if you are already standing there — bin night, a
    // real change in the day — can earn depth 1. Off: the bar is 70 always, so
    // the flag-off surface is behaviourally identical to before.
    //
    // ⚠ Low band (40-49) never earns the screen at ANY presence. Commute, plex
    // and tonight's menu are the day's readouts — permanently true, and a wall
    // that surfaced them on every entry would be furniture inside a week.
    // ⚠ The bar is read PER TICK, not cached — presence changes between ticks
    // and the bar has to move with it. Live readout: `__v3().attention.bar`.
    presenceEarnsMedium: true,

    // TIMELY CANDIDATES — a fact that matters for twenty minutes is scored for
    // those twenty minutes, not for the whole day.
    //
    // Some candidates are permanently true and only sometimes worth the screen.
    // The drive to work is identical at 07:00 Tuesday, when it is the most
    // useful thing the wall can say, and at 23:00 Sunday, when it is noise — so
    // a fixed score (42, Low band) meant it could never be shown at all.
    //
    // On, the windows are:
    //   commute        weekdays 06:30–08:00  → 72 (High: earns the hero)
    //   tonight's menu every day 17:00–18:30 → 72, AND stackOnly lifted
    //
    // ⚠ The menu needed BOTH. attentionRank picks the hero with
    // `eligible.find(c => !c.stackOnly)`, so a stackOnly candidate can never be
    // the centred hero at any score — raising its number alone changes nothing.
    //
    // Off: every score and every stackOnly is exactly as before, so the flag-off
    // surface is behaviourally identical. One-line revert (-> false).
    //
    // ⚠ V3 only. focusHero (the incumbent) does not pass `timely`, so it keeps
    // the old flat scores — deliberate, since the incumbent is the rollback
    // surface and should not drift while it is the thing we fall back to.
    // ⚠ Windows are LOCAL time and half-open: 08:00 is already outside.
    timelyCandidates: true,

    // GROUND MEMORIES — the ambient photograph becomes "on this day".
    //
    // The ground held ONE photograph for the whole day by design (see the long
    // note at the top of v3/core/ground.js). In practice a day spent with a
    // picture you don't much like has no way out, and the wall stops being
    // looked at — which fails the only test that matters.
    //
    // On: /api/immich/on-this-day supplies the same date across every year in
    // the library (116 photographs from 2011–2023 on the day this shipped),
    // drawn ONCE per local day, walked in shuffled order, one cross-fade per
    // ten-minute tick — no new timer, and no repeat until the day's set is
    // exhausted. A caption names who / where / when where Immich knows them.
    //
    // ⚠ The screenshot and receipt filter rides along already: the memories
    // search requests `withExif`, which is what lets `isScreenshot` see the
    // dimensions and missing camera make at all. IMMICH_EXCLUDE_SCREENSHOTS=1
    // is set on the G11. ⚠ Two more aggressive filters were built and REJECTED
    // for dropping real memories — sample the library before building a third.
    //
    // ⚠ Falls back to the old random endpoint on a date with no memories; some
    // days have none, and a blank wall is worse than a random photograph.
    // ⚠ The caption is hidden at night, matching Daily Memories.
    //
    // ✅ DEFAULT-ON 2026-08-14. It was held off for two days by the caption's
    // contrast gate, which turned out to be a defect in the CAPTION, not in the
    // feature: `#ground-caption` sat inside `.photo`'s stacking context and
    // painted UNDER the scrim at 1.02:1 (4fb64fc), at a size 30% below the
    // system's type floor (ad4ec3f). Fixed, it measures 5.29:1 white / 5.77:1
    // sky in daylight, 4.60:1 worst-case under the presence rim. The gate now
    // PINS THIS FLAG ON and asserts the caption was actually measured — flag-off
    // green said nothing about flag-on, which is how a 1.02:1 survived four runs.
    //
    // Off: one random photograph held for the day, and no caption — byte-for-
    // byte the previous behaviour. One-line revert (-> false).
    groundMemories: true,

    // GROUND DIPTYCH — two portraits side by side instead of one, butchered.
    //
    // The arithmetic is the whole argument. An Immich preview of a portrait is
    // 1440x1920 and there is no larger rendition to fetch (measured 2026-08-12:
    // `?size=fullsize` 302s to the same file, `/original` is HEIC and Chromium
    // cannot render it). Full-bleed on the 1920x1080 wall that preview is
    // upscaled 1.33x and cropped to ~42% of the picture — the only upscale
    // anywhere in the path. In a 952x1080 half it is DOWNSCALED to 0.667x and
    // keeps ~84%: a better rendition than a landscape photograph gets today,
    // and a crop that goes from half-butchered to slightly tightened.
    //
    // On: portraits from the day's on-this-day pool are paired SAME YEAR,
    // NEAREST IN TIME — on-this-day means one date, so same-year portraits are
    // almost always the same occasion, which is what makes a pair read as one
    // moment and lets both halves share one true caption. 16px of the living
    // substrate sits between them, like matting between two framed prints.
    // Frames (landscapes and pairs alike) are then shuffled together, because a
    // paired portrait is no longer the case worth deferring.
    //
    // ⚠ AN ODD PORTRAIT IS OMITTED — not repeated, not shown full-bleed, not
    // held for tomorrow (owner's call, 2026-08-13). At most one per year.
    // ⚠ REQUIRES groundMemories: pairing needs `aspect` + `localDateTime`, and
    // only the on-this-day pool carries them. This flag alone does nothing.
    //
    // ✅ DEFAULT-ON 2026-08-14, after a real pair was SEEN — drawn from the live
    // on-this-day pool in the headless probe on the G11, wall untouched:
    // `pair: true`, two assets, one shared caption ("Nudgee · 2020"), and
    // `layers: 1` (the soak metric still counts PHOTOGRAPHS, not elements).
    // Both halves are visibly sharper than the full-bleed frame beside them and
    // the 16px seam reads as matting rather than a tear.
    //
    // ⚠ What the live pool says about the pairing rule, measured the same day:
    // 22 of 118 assets are portraits → 10 pairs, and NINE of them fall within
    // ~3 hours of each other (0, 1, 4, 43, 63, 113, 154, 166, 369 min). One
    // outlier at 1339 min — same date, same year, different day entirely. So
    // "same year, nearest in time" reads as one moment ~90% of the time, and
    // the failure mode when it doesn't is a harmless collage, not a wrong claim:
    // the shared caption names only place and year, which stays true of both.
    //
    // Off: landscape-first ordering, one photograph per frame — the previous
    // behaviour to the element. One-line revert (-> false).
    groundDiptych: true,

    // PHOTO VETO — "not this one", and the wall never shows it again.
    //
    // The ground holds a photograph for ten minutes at a time and there was no
    // way to say no to one. Every automatic alternative was measured and
    // rejected first (2026-08-14, 494 assets): favourites 0.2%, star ratings 0%,
    // Immich duplicate detection never run, and a sharpness sweep ranked the
    // photograph the owner actually objected to 20th of 118 while the soft end
    // of the distribution was almost all legitimate night photographs. There is
    // no signal to filter on, so this asks instead of guessing.
    //
    // On: "not this one" (and kin) hides every photograph currently on the
    // ground — both halves of a diptych, since that is the frame being looked
    // at — and moves on. "Bring that back" undoes the last one. The list lives
    // server-side in data/photos/hidden.json and is applied at the single choke
    // point every Immich search passes through, so a veto also holds on the
    // screensaver and in Daily Memories.
    //
    // ⚠ THE UNDO IS NOT A NICETY. A veto is spoken and speech misfires — the
    // television, a guest, half a sentence — so without a way back one
    // mishearing removes a photograph permanently and silently.
    //
    // ✅ DEFAULT-ON 2026-08-14, after the whole round trip was proven on the
    // live box: a real photograph vetoed, persisted to data/photos/hidden.json,
    // absent from the next on-this-day search, then restored by the undo and
    // back in the pool — the library left exactly as it was found.
    //
    // Off: the handler refuses and the turn falls through to the next lane
    // exactly as it did before this existed, so nothing can ever be added to
    // the list, and an empty list filters nothing. (The intent still MATCHES —
    // the matcher is pure and shared with the incumbent — which is why the
    // rollback is asserted on the POST never happening, not on the words.)
    // One-line revert (-> false).
    photoVeto: true,

    // Living-window Phase 1 (plan: review-the-design-scheme) — rain on glass.
    // A shared episode runtime (services/atmoFx/) draws bounded droplet/streak
    // "moments" on a front canvas, then hides it: the GPU-0% ambient baseline
    // is structural (display:none between episodes), honouring the idle-freeze
    // law "moments, not loops". Budgets live in atmoFx/planner.js as exported
    // constants with unit tests. Shipped OFF 9c851e6 (byte-identical proof
    // deploy) → flipped ON 2026-07-18; verify via __forceAtmoEpisode
    // ("rain-moment"/"rain-heavy") + /kiosk-metrics (ambient must sit at GPU 0%
    // between episodes). One-line revert (-> false).
    weatherFxRain: true,

    // Living-window Phase 1 — storm lightning. One-shot CSS keyframes on a
    // screen-blend horizon veil (zero rAF; utils/atmo-fx.css), big strike then
    // 0–2 weaker flickers, randomized 40–160s apart while thunder is live.
    // Shares the atmoFx runtime with weatherFxRain; either flag alone inits it.
    // Shipped OFF 9c851e6 → flipped ON 2026-07-18. __forceAtmoEpisode
    // ("lightning") to verify. One-line revert (-> false).
    weatherFxLightning: true,

    // Living-window Phase 2 — reactive glass. Pure CSS on the two-class
    // pattern (the living-accent precedent, layout/background.css): the atmo-*
    // token recolors the shared glass tokens — rain cools/darkens, storm
    // darker still, golden hour warms border+sheen (§6 borrowed light), night
    // adds a faint cool glow. Recolor/re-alpha only, blur radius never rises.
    // A lightning strike additionally pulses --glass-sheen via a short-lived
    // body.fx-lightning-active from the Phase-1 strike path (box-shadow 150ms
    // in / 1s out — finite transitions, zero rAF). Shipped OFF 75c214c →
    // flipped ON 2026-07-18. One-line revert (-> false).
    reactiveGlass: true,

    // Living-window Phase 3 — sunrise/sunset sky ramp. syncNight steps
    // --sky-warmth on <body> once a minute from the sun altitude (pure
    // skyWarmthFor in atmosphere.js; the --clock-dim pattern, zero loops);
    // body.sky-ramp.substrate::before color-mixes up to 22% warm into the
    // substrate tint, so golden hour arrives gradually instead of on the
    // mapper's hour-band edge (which stays as the flag-off fallback).
    // Shipped OFF 7023304 → flipped ON 2026-07-18. One-line revert (-> false).
    skyRamp: true,

    // Living-window Phase 3 — clear-night sky. The atmosphere mapper names
    // clear nights atmo-night-clear (opt-in via nightClear, so flag-off keeps
    // atmo-night) and the atmoFx canvas holds a static painted starfield
    // between episodes — a static composited layer, GPU-free like the rain
    // hold. The planner adds a twinkle moment (2–4 stars, ~2.5s) every 3–6
    // min, ambient-only. __forceAtmoEpisode("twinkle") to verify. Shipped OFF
    // 7023304 → flipped ON 2026-07-18. One-line revert (-> false).
    nightSky: true,

    // Living-window Phase 4 (final) — atmosphere textures. Static body states
    // synced from the weather slice by the atmoFx runtime (pure texturesFor:
    // fog category → fx-fog vignette + photo contrast drop; ≥32°C → fx-heat
    // warm top glow + desaturated photo; ≤8°C → fx-cold frost corners +
    // cooler reactive glass), two new bounded episode lanes (awake fog-drift
    // ≤30 blobs/≤10s; rare heat-pulse warm veil breath, zero rAF), windKph
    // leaning every rain/fog motion (pure streakAngleFor), and winter/summer
    // substrate hue biases riding body.season-*. __forceAtmoEpisode("fog"|
    // "heat-pulse") to verify. Shipped OFF a95beff → flipped ON 2026-07-18.
    // One-line revert (-> false).
    atmoTextures: true,

    // Dinner recipe panel. One hour before a Meal:-prefixed calendar dinner, a
    // glass panel slides in from the right with that night's recipe (title,
    // ingredients, method) fetched via /api/recipe (Claude web search, cached
    // to data/recipe-cache so a dish is searched once). Two-column, 2m-legible
    // (72px method floor), auto-scroll on overflow, auto-dismiss at dinner+45m.
    // Flipped ON 2026-07-22 (deadlock-break: flag-off has no verify hook, so
    // the only way to eyeball it live is a flag-on deploy). Verify on the Pi
    // via window.__recipePanel("<dish>"). One-line revert (-> false).
    recipePanel: true,

    // The voice rail. The local lane went from 8 phrases to 33, and a lane
    // nobody knows about is worth nothing — discoverability is second only to
    // recognition accuracy among the reasons voice interfaces fail, and the
    // research is that unprompted suggestions and help-on-request each beat
    // baseline on their own. So: one quiet line, rotating every 90s, plus a
    // "what can I say" card.
    //
    // Everything offered is filtered through the lane against live data first,
    // so it can only suggest phrases that would genuinely work right now — a
    // rail that suggests something which then falls through teaches the family
    // to stop reading it.
    //
    // Flipped ON 2026-08-07. Verified flag-on at 1920x1080 against the LIVE
    // Home Assistant: the truth filter offered 12 phrases and correctly
    // withheld the calendar ones while that upstream was cold, and the
    // "what can I say" card rendered its six. Suite green including the
    // worst-case contrast sweep over the real photographic backdrop, and the
    // reversibility check (scripts/verify/flag-reversibility.mjs) confirms the
    // off state still passes — the off state IS the rollback path.
    //
    // ⏳ Still owed: a legibility judgement at 3-4m on the physical panel, in
    // daylight with the display on. 30px italic at --ink-faint is the smallest
    // persistent text on the surface, and no screenshot can settle whether it
    // reads across the room. If it does not, raise the size — do not dim it.
    //
    // One-line revert (-> false): removes the element, the timer and the
    // listener entirely.
    voiceRail: true,

    // RETIRED 2026-08-15 — `motionWakeGate` was here, and the wall outgrew it.
    // Audit M5 built it to stop plain camera motion waking the kiosk (61 wakes
    // measured in 24h, 49 of them plain motion). It lived in
    // cameraPopupOverlay.js, which V3 does not import: 0 occurrences in
    // dist/assets/v3-*.js. V3's only unasked wake path is core/alerts.js ->
    // services/alertRouter.js, whose entire trigger set is doorbell-ring,
    // doorbell-person and side-gate-person — so plain motion cannot reach the
    // panel at all, and the gate's own rule is now structural and stricter.
    // A flag that cannot change what is on the wall is not a lever, it is a
    // reader's trap; the restraint is kept, the switch is gone.

    // "The Day, Rendered" v2 (docs/design/TEMPORAL-SPINE.md) — the
    // temporal spine. Replaces the centred hero + lean-in glass stack with ONE
    // surface: the household's day rendered as a thin line of light low across
    // the wall, 05:00→24:00 fixed left to right. Plans ahead are cool
    // anticipation, passed marks are warm embers (the day as it actually went,
    // not as it was planned), previous years run as fainter strata beneath, and
    // "now" is the brightest point, travelling at ~1.5px/min. Weight — the
    // EXISTING attention score — sets a mark's size and glow; there are no
    // categories, no per-domain colour and no icons. The scored queue survives
    // and now allocates LANGUAGE, not presence: presence rations the words
    // (nobody → silence · passing → one utterance anchored to its minute by a
    // hairline · staying → three rank-dimmed labels · voice → the spine stills).
    //
    // Motion (DESIGN_SYSTEM.md §5.1): no rAF loop at all — marks/embers/strata
    // are drawn into one canvas repainted only on a cause (minute rollover,
    // calendar refresh, bins, presence, resize). The single continuous element
    // is the now-point's breath, a CSS opacity swing bound to body.spine-alive,
    // which is set ONLY while media is playing AND someone is in the room, with
    // amplitude scaled by --clock-dim (§5.2). An empty room renders 0 fps.
    // The spine allocates nothing per mark (fixed 64-slot model, oldest-ember
    // eviction) and language is five permanent DOM nodes, reused not cloned.
    //
    // Shipped flag-off in 56650a8. Flipped ON here 2026-08-01 as a deadlock-break,
    // the recipePanel precedent: a flag-off build renders no spine at all, so the
    // only way to eyeball it on the real panel is a flag-on deploy. NOT yet
    // Pi-verified at the time of the flip — verify at the kiosk immediately after:
    // __spine() carries today's real calendar as marks (embers left of now, the
    // Meal: anchor warm), the utterance anchors to a live mark, DWELL shows three
    // labels and AMBIENT none, body.spine-alive absent with nothing playing, and
    // /kiosk-metrics quiescent ambient inside the §5.4 ≤8% row. If any of that
    // fails, the revert is this line (-> false): the hero + lean-in stack return
    // untouched, and their specs still pass pinned off (verified by
    // scripts/verify/flag-reversibility.mjs).
    temporalSpine: true,

    // "The Day, Rendered" v2 §11 — calm law v3 / the AMBIENT ARCHIVE
    // (docs/design/AMBIENT-ARCHIVE.md). The deliberately-deferred half of the
    // spine work. Mode 0 stops being "a photo with a clock on it" and becomes
    // the archive: the memory as a lit card pivoting slowly in a deep
    // instrument space, a desaturated tiled echo of itself behind, everything
    // drifting on independent 84–130s periods — and, beneath the card, the
    // spine's day rendered in three dimensions. ACROSS IS TODAY (05:00→24:00,
    // marks, embers, the travelling now-point); BACK IS THE YEARS (the strata
    // as rows receding in Z, the memory on the card lighting its own year-line
    // at the hour it was taken). One instrument, two readings. The archive's
    // own horizontal year ruler is deleted — two perpendicular meanings cannot
    // share a screen region, and the spine's axis is the one that survives.
    //
    // OWNER DECISIONS this rests on (2026-08-01): (1) the ambient surface may
    // move in an empty room, which supersedes "0% unoccupied" for Mode 0 only;
    // (2) the Mode-0 clock is DEMOTED to the archive's 64px corner numeral,
    // superseding "keep clock size" for Mode 0 only — the awake top-row time
    // and every other clock are untouched.
    //
    // Motion (DESIGN_SYSTEM.md §5.1): every loop hangs off
    // `body.fx-archive-active`, set on Mode-0 entry and removed on exit, so
    // leaving Mode 0 switches the surface off rather than hiding it. The cause
    // is nameable — the house is leafing through its album — and nothing
    // completes a perceptible change inside a ~3s glance. Amplitude rides
    // --clock-dim (§5.2): at 2am it drifts less FAR, not less often. The ruler
    // itself never moves: once the plane means time of day, sliding it is a
    // ~50-minute lie. Everything is compositor-only CSS — no rAF, no WebGL,
    // no per-frame allocation — and the deck is six canvases allocated once,
    // so a day that fills up allocates nothing.
    //
    // Shipped flag-off in 7ef1f18 and deployed as a PROVEN no-op (2026-08-02:
    // live kiosk showed 0 archive elements, no body marker, no hook, the 192px
    // centred clock and the spine still painted in Mode 0).
    //
    // Flipped ON here 2026-08-02 as the deadlock-break — the recipePanel /
    // temporalSpine precedent: a flag-off build renders no archive at all, so
    // the ONLY way to put this in front of the owner on the real panel is a
    // flag-on deploy. This flip is "come and look at it", NOT a sign-off.
    //
    // ⚠ NOT YET JUDGED ON THE PANEL. Two things need the owner's eye, and both
    // have a one-line lever if they are wrong:
    //   · the 64px corner clock — the ruling that supersedes "keep clock size"
    //     for Mode 0, and the most visible change in the package;
    //   · the -12deg yaw on the hour axis (--arch-deck-plane), which makes
    //     morning read slightly narrower than evening.
    // And the §8.5 soak is still owed: /kiosk-metrics at 0h/24h/72h into
    // docs/audit/HOST-BASELINES.md as a new "live ambient" row (§5.4, <=25%
    // sustained). heap-flat over 72h + fps constant IS the deliverable.
    //
    // One-line revert (-> false) is the rollback and it is cheap by
    // construction: no archive element is built, the class is never set, the
    // spine is not hidden, and Mode 0 is exactly the surface verified above.
    // Proven green by scripts/verify/flag-reversibility.mjs at flip time.
    ambientArchive: true,

    // Live Photo motion in the Ambient Archive: when an arriving memory has a
    // motion part, the card breathes for ~3.5s and then settles into the still.
    // Most of this library is Apple Live Photos — measured 2026-08-02, 25-54% of
    // on-this-day images across 2015-2025 carry one, so this is a few memories a
    // day, not every one.
    //
    // Law 1: the cause is THE PHOTOGRAPH CHANGING, which §5.1's causes table
    // names verbatim. The burst is bound to the exchange, plays once, and stops
    // — there is no loop, and a momentary cause rendered as a loop would be a
    // violation even though it is cheap. Off after sunset, off under
    // prefers-reduced-motion, and never on a tender memory (§4.3 — wordless, and
    // still).
    //
    // ⚠ TWO switches, and the other one is the server's. IMMICH_LIVE_MOTION in
    // .env controls the NAS fetch, the nightly transcode and the disk; this
    // controls the surface. With the env knob unset, `motion` never appears in
    // the daily-set payload, so flipping this on alone can never cause a fetch.
    // The transcode needs ffmpeg on the host — without it every memory stays a
    // still, silently and safely.
    //
    // Default-ON 2026-08-02, judged on the panel next to the exchange it rides
    // on, and measured there rather than reasoned about — the row is
    // docs/audit/HOST-BASELINES.md §"Live Photo motion — the burst" (`8fa8c95`,
    // daylight, Mode 0, today's set at 12/12 memories carrying a motion part, so
    // every exchange burst = the worst realistic case):
    //   · sustained gpu-process 21.7 / 21.8 vs a 21.0 baseline — inside the
    //     window-to-window noise, so §5.4's <=25 ceiling keeps its ~3 points;
    //   · the cost lands on the RENDERER at ~+2, which §5.4's gpu-stated
    //     ceilings do not see at all (a gap in the budget, not a free pass);
    //   · peak at 6x the natural exchange rate 34.7 vs a ceiling of 35 — but the
    //     no-motion control read 31.1, so 90% of that is the archive's own
    //     exchange machinery, not the burst;
    //   · `bursts` exactly one per 30s exchange, `anims` back to 4 between them
    //     (never a loop), 56 frames decoded 0 dropped / 0 corrupted.
    //
    // ⚠ The renderer figure is software decode. VA-API is installed on the G11
    // and unused — see ~/.claude/plans/g11-vaapi-hardware-decode.md. Hardware
    // decode would take this to roughly nothing; nothing here depends on that.
    //
    // One-line revert (-> false) builds no <video> at all — no element, no
    // timer, no listener, no fetch. Proven green by
    // scripts/verify/flag-reversibility.mjs at flip time.
    ambientArchiveMotion: true,

    // THE BURST HOLDS FOR THE WHOLE DWELL. Raised on the panel 2026-08-04: the
    // burst plays once and the card then sits still for the remaining ~26s of
    // the 30s dwell, and the settle back to the still "looks a bit awkward".
    // With this on the clip carries `loop` and runs until the NEXT memory
    // arrives — the exchange's own teardown is what stops it, exactly as it
    // already stops a burst interrupted mid-play.
    //
    // ⚠ THIS IS A KNOWN §5.1 EXCEPTION, not an oversight. The burst's cause —
    // the photograph changing — is instantaneous, and §5.1's second corollary
    // says a momentary cause rendered as a loop is a law-1 violation "even
    // though it is cheap". It is flagged OFF for exactly that reason: the loop
    // is a judgement to make on the panel in daylight, not a default. If it
    // ships on, DESIGN_SYSTEM.md §5.1 owes an amendment naming it — a shipped
    // surface that contradicts a written law silently repeals the law.
    //
    // ⚠ AND IT IS NOT CHEAP HERE. The burst's measured cost (see
    // ambientArchiveMotion above: ~+2 renderer points) is an average over a 30s
    // dwell in which the clip decodes for only ~3.6s — a ~12% duty cycle, in
    // SOFTWARE, because VA-API decode is a closed dead end on this box. Looping
    // takes that duty cycle to ~90%. Do not reason about the result: measure
    // sustained gpu-process AND renderer against the 21.0 baseline before
    // flipping, and record the row in docs/audit/HOST-BASELINES.md.
    //
    // One-line revert (-> false): no `loop` attribute is set and the hold
    // returns to MOTION_HOLD_MS — i.e. today's verified single burst, which is
    // the shipped surface.
    archiveMotionLoop: false,

    // THE CARD FOLLOWS THE PRINT. The archive card is a fixed 1040×585 = 1.78:1
    // rectangle with the photograph `object-fit: cover` inside it, so a
    // phone-shot library is shown through a letterbox it was never composed
    // for: a 4:3 landscape loses ~25% of its height, a 3:4 portrait ~58% —
    // heads and feet both. Raised on the panel 2026-08-02 ("a few of the photos
    // displayed today looked cropped"). Structural, not a glitch: Immich's
    // `preview` rendition is a resize, so the card geometry is the whole cause.
    //
    // With this on, the card takes each photograph's own aspect and nothing is
    // ever cut. The left edge stays pinned at 130 (owner's call over centring
    // it), so a portrait simply does not reach as far right and nothing else on
    // the wall moves. The box is in services/archiveModel.js.
    //
    // Law 1: the shape change rides the exchange's existing 300ms blur — the
    // reshape IS the memory arriving, the same cause the motion burst uses, and
    // it is an event with an end. Written instantly, never transitioned:
    // width/height/top are layout properties (§5.5).
    //
    // ⚠ A 16:9 memory lands on 1040×585 at (130, 212) — the shipped rectangle,
    // to the pixel. That is by construction, so flipping this must not move the
    // common landscape memory at all.
    //
    // FLIPPED ON 2026-08-02, and the flip is a DEADLOCK-BREAK, NOT A SIGN-OFF
    // — the same inversion the archive itself shipped under. Flag-off renders
    // the old fixed card, so the only way to put a portrait card on the wall to
    // be judged is a flag-on deploy. Owner's call, knowing that.
    //
    // Shipped flag-off in 8675dbc and proven a genuine no-op on the panel
    // first: __archive().card read {fit:false, 1040×585 @ (130,212),
    // wanted:null} with no style property written at all. The same probe caught
    // the defect live — the photo on the wall read photoAspect 0.75 inside a
    // cardAspect 1.778 card, i.e. a portrait losing ~58% of its height.
    //
    // ⚠ STILL UNJUDGED IN DAYLIGHT. Two things to look at, both needing a
    // portrait memory: whether a 457px-wide card still reads as the HERO of the
    // surface (45% of the reference's width, and "the photograph is the point
    // of a screensaver" is what killed rejected build 1), and whether the
    // reshape reads as arrival rather than as a glitch. It also owes its own
    // GPU reading — a resizing plane is layout-adjacent on a budget-tuned
    // surface and §5.4's ceilings have never seen one.
    //
    // One-line revert (-> false) is the rollback: no style property is written,
    // the CSS var() fallbacks ARE the verified rectangle, and a guardrail pins
    // those fallbacks so they cannot drift. Proven green by
    // scripts/verify/flag-reversibility.mjs at flip time.
    archiveFitToPrint: true,

    // Audit M11. The Pi's crontab already powers the panel down 21:00→05:00
    // (`xset dpms force off`), so a doorbell ring at 3am currently speaks its
    // alert and draws its popup to a dark screen. With this on, a live-worthy
    // trigger (person/ring — NOT kitchen presence, and not plain motion) POSTs
    // /api/display/wake, which lights the panel for DISPLAY_WAKE_HOLD_MS and
    // then lets it fall back. Outside the window the route is a no-op.
    // FLIPPED ON 2026-08-08 on the owner's call, having been shipped flag-off
    // since the audit. Prerequisites confirmed live on the G11 first: the
    // crontab survived the Pi→G11 migration (`0 21` / `0 5`), `xset` is present
    // and `GET /api/display/state` reports `dpmsEnabled: true, monitor: on`.
    //
    // ⚠ BOTH SURFACES. The incumbent's cameraPopupOverlay and V3's core/alerts
    // share this one flag deliberately — same rule, one answer. On V3 it also
    // requires `v3EnergySaver` below.
    //
    // ⚠ SCOPE IS WIDER THAN "THE DOORBELL". The gate is isLiveWorthy, which is
    // {person, doorbell} across all six triggerEntityIds — so a PERSON detected
    // on the driveway or in the backyard at 3am lights the panel too, not only a
    // ring. Plain motion, pets and cars never do. If that turns out to be too
    // much: narrow LIVE_WORTHY_DETECTIONS to ["doorbell"], or shorten the lit
    // period with DISPLAY_WAKE_HOLD_MS in the G11's .env (default 90s).
    //
    // Revert = `displayWake: false`. Proven reversible by
    // scripts/verify/flag-reversibility.mjs at flip time.
    displayWake: true,

    // V3 step 5.1. Whether V3 knows the panel's power state at all.
    //
    // NOT a port of modules/energySaver.js — the panel already goes dark on V3,
    // because DPMS belongs to the X display rather than to the URL and the
    // `xset` crontab survived the Pi→G11 migration. What V3 lacked is the two
    // things that follow from the panel being off: it kept animating the
    // substrate at 15fps for a dark screen on any windy night, and its alert
    // path — the one thing that puts itself on the wall unasked — announced a
    // doorbell to a screen nobody could see.
    //
    // With this on, V3 tracks the off-window (server-owned, confirmed against
    // X's own `monitor` reading so a broken DPMS cannot freeze a lit panel),
    // pauses the substrate while dark, and lets core/alerts.js ask for the
    // panel. That last part ALSO requires `displayWake` above: same rule, same
    // flag, both surfaces — security events only, never kitchen presence.
    //
    // FLIPPED ON 2026-08-14, the last actionable box on the V3 parity bar.
    // Verified across a GENUINE 21:00 crontab transition on the G11 — not a
    // forced belief and not a simulated window. At 21:01 X's own `monitor` read
    // `off`, `data-panel-dark` went to "1", and the substrate reported paused.
    // The saving is measured, not argued: 15.0 fps sustained beforehand (459
    // frames in 30.6 s), then ZERO frames in the next 30.6 s, with the
    // gpu-process falling 5.9% → 0.0% of one core and the renderer 5.3% → 0.0%.
    // Then a synthetic doorbell (`__v3Alert()`) took it all the way back: X went
    // `off` → `on`, `wakes` 1, depth forced to 3 `alert:doorbell`, substrate
    // resumed. Numbers and confounds in docs/audit/HOST-BASELINES.md.
    //
    // ⚠ THIS IS THE FLAG THAT MAKES `displayWake` REAL. displayWake has been on
    // since 2026-08-08 but has never once taken effect on the wall, because the
    // V3 half needs this flag too and `/` has served V3 since the cutover.
    //
    // ⚠ AND ITS SCOPE NOTE ABOVE IS STALE FOR THE LIVE SURFACE. "{person,
    // doorbell} across all six triggerEntityIds… a PERSON on the driveway or in
    // the backyard at 3am" describes cameraPopupOverlay, which is the INCUMBENT
    // and is cold standby. V3's night-wake scope is alertRouter.LOCATIONS:
    // THREE entities — doorbell_ringing, doorbell_person_detected,
    // side_gate_person_detected. No driveway, no backyard. Measured before the
    // flip: across the whole of the previous 21:00→05:00 window all three held
    // an unbroken `off` — zero wakes — and the doorbell person sensor is alive
    // (it fired that afternoon), so that is a quiet night and not a dead feed.
    //
    // ⚠ EVERY UNKNOWN IN THIS PATH FAILS TOWARDS LIT BY DESIGN — no window from
    // the server, an unparseable one, or an unreachable server all answer "not
    // dark". Do not "fix" a probe that reads lit; read the header of
    // src/v3/core/display.js first. The one deliberate exception is inside the
    // window with no `xset` at all (any dev box): monitor null is not "on", so
    // the clock wins. That is what makes the suite's night behaviour real.
    //
    // Revert = `v3EnergySaver: false` = no timer, no fetch, no attribute, and
    // the substrate never pauses. Proven reversible by
    // scripts/verify/flag-reversibility.mjs at flip time.
    v3EnergySaver: true,

    // V3's ambient now-playing surface. Whether the field says what the room
    // can hear.
    //
    // V3 has had a media surface since Phase 4 and nobody has ever seen it:
    // subjects/media.js is DEPTH 3 and VOICE-SUMMONED ("show me what's
    // playing"). Nothing in V3 has ever put music on the screen because music
    // STARTED. Confirmed by `DISPLAY=:0 scrot` on the G11 on 2026-08-09 while
    // media_player.living_room was playing: photograph and hour, nothing else.
    // The owner's call — "when plex or spotify is playing I would want it to
    // see it on the screen anyway" — is what this builds.
    //
    // On: core/now-playing.js subscribes to media_player entity updates and
    // writes a small band at the bottom right of DEPTH 0 ONLY — artwork,
    // artist, title, in the clock's measured voice. It reads houseSnapshot(),
    // the same reader subjects/media.js and the attention queue use, so the
    // ambient band, the depth-2 spread and the depth-3 subject can never
    // disagree about what is playing. Off: no subscription, no timer, no
    // attribute — the nodes sit in index.html inert at `visibility: hidden`,
    // the way every V3 mount does before its phase lands.
    //
    // ⚠ TV audio is not "what's playing" — owner's call, and the rule lives in
    // houseSnapshot.nowPlayingFrom (one authority, both surfaces) rather than
    // in the band, because the config scan is ordered and a filter at the band
    // would have blanked it while music played in the other room.
    //
    // Nothing else changes: the hour does not move (the band is absolutely
    // positioned), the rail cannot collide with it (rail is depths 1-2, this is
    // depth 0), and there is no per-second repaint — no progress bar, and the
    // glass is written only when the ANSWER changes, never per entity update.
    //
    // FLIPPED ON 2026-08-09, after being SEEN ON THE GLASS with the flag forced
    // on for one page load (CDP addScriptToEvaluateOnNewDocument, nothing
    // shipped) rather than flipped and hoped for. `DISPLAY=:0 scrot` at 17:33
    // showed the band bottom-right, the hour bottom-left, no collision, and the
    // band's box measured at x1482 y864 342x120 — bottom 984 and right 1824,
    // i.e. exactly the 96px safe inset on a 1920x1080 panel.
    //
    // That look caught two defects the 1035-green suite did not, because both
    // are about what the pixels LOOK like: the Plex episode was named by its
    // date ("2022-01-27") instead of its show, and a 16:9 still was being
    // centre-cropped into a square plate and read as a rendering fault. Both
    // fixed before this flip.
    //
    // Revert = `v3NowPlaying: false`. Proven reversible by
    // scripts/verify/flag-reversibility.mjs at flip time.
    v3NowPlaying: true,

    // ── V3 CELL CONTEXT ────────────────────────────────────────────────────
    // The eyebrow above every composed cell and above the glance line: what the
    // value underneath it IS. Owner's verdict on a photograph of the live wall,
    // 2026-08-13 — "we have gone too far minimalist and lost context on most of
    // the information". The spread was showing "11 min · 18 min" at 132px with
    // nothing saying whose drive either number was, and "Colin from Accounts"
    // with nothing saying it was the lounge room TV.
    //
    // Nothing is authored for this. Every candidate has carried `title`/`sub`
    // since the Tier-1a rich cards and V3 simply never rendered them; the flag
    // turns the existing field into a rendered line (core/spread.js labelNode).
    // `text` remains the line — attentionEngine rewrites `text` with the AI/
    // personality phrasing and leaves `title` alone, so rendering the title
    // instead would throw the house's own voice away.
    //
    // Flag-off is NO NODE and no attribute, not an empty label: the off DOM is
    // the one that shipped before this, which is what makes it the rollback.
    //
    // FLIPPED ON 2026-08-13, after being SEEN ON THE GLASS with the flag forced
    // on for one page load over CDP (nothing shipped) rather than flipped and
    // hoped for. `DISPLAY=:0 scrot` at 18:29 showed the three cells the owner
    // photographed, each now carrying its label: TONIGHT'S MENU over the dish,
    // DRIVE TO WORK over "Greg 11 min · Brett 18 min", LOUNGE ROOM TV over
    // "Colin from Accounts" — and no rail fragment in the corner. The same
    // probe read `commuteInQueue: false` at 18:28, which is the afternoon
    // commute gone from the live house rather than merely from a spec.
    //
    // Revert = `v3CellContext: false`. The off state is asserted by
    // tests/v3-cell-context.spec.js at both depths, so the rollback is a tested
    // state and not an assumption.
    v3CellContext: true,

    // ── V3 CURATED YEAR ────────────────────────────────────────────────────
    // Depth 3, "show me the year": lead the 3×3 with the memories the household
    // AUTHORED (data/memories/authored.json, 73 of them, every one photo-anchored
    // and titled in a person's own words through Memory Studio) and fill the rest
    // from raw on-this-day.
    //
    // This is the design decision src/v3/subjects/memories.js asked for by name
    // and refused to answer with a heuristic. What the wall showed on 2026-08-08
    // was seven lovely border collie photographs, a product shot of two
    // supplement bottles, and a close-up of a sandwich — real photographs of
    // unremarkable things, which no pixel rule can catch and which two previously
    // built, previously rejected filters prove is the wrong lane to fix it in.
    // Nothing is excluded here; something is PREFERRED.
    //
    // Depends on nothing else being on: the plates are read straight off
    // /api/memories, NOT through the memory runtime, which rations to one memory
    // a day behind a budget and months-long cooldowns. That rationing is right
    // for an unasked-for line and wrong for a screen somebody just asked to see.
    //
    // Flag-off ⇒ /api/memories is never fetched by the subject and the grid is
    // the raw on-this-day pool in its original order, which is what shipped
    // before — that is the rollback, and tests/v3-curated-year.spec.js asserts
    // it. (The runtime still loads the same file at boot for the attention
    // queue; this flag governs the SUBJECT, not the store.)
    //
    // ⚠⚠ FLIPPED ON 2026-08-15 ON THE OWNER'S CALL, and the honest caveat is
    // that it was NOT flipped after a sighting of the feature working — it
    // could not be. Measured on the G11 the same day: the 73 authored memories
    // land on 47 DISTINCT DAYS of the year, and 15 August is not one of them.
    // On the other 318 days a year this flag changes nothing at all, so what
    // was verified live is the flag-on build being INERT on a non-curated day
    // (the year still opened, nine raw plates, no extra behaviour), plus 11
    // specs covering the curated day itself.
    //
    // ⏳ THE SIGHTING IS STILL OWED, and it is dated: 2026-08-20, one memory,
    // "Boof loved his bear". August's curated days are 1,2,3,5,7,9,10,11,12,
    // 20,26 — and 38 of the 73 are anchored in JULY, so the feature is close to
    // invisible until then.
    //
    // ⚠ That first day is also a TENDER entry — 12 of the 73 are. A tender
    // photograph appears in the year and is captioned "20 years ago" and
    // nothing else: memoryEngine.toSurface's one rule about grief
    // (`caption: null`) is honoured rather than excepted for a screen that was
    // asked for. If the year should read those sentences back, that is a
    // deliberate change to make, not a default to drift into.
    v3CuratedYear: true,

    // ── The dinner panel, returned to V3 ────────────────────────────────────
    // The incumbent's recipePanel (flag `recipePanel`, above) has exactly one
    // caller — js/core/app.js — and V3 does not import it. Since the cutover
    // (77f5fb1, 2026-08-11) `/` serves V3, so that panel has not run on the
    // wall since, and it was the ONLY thing that auto-fetched each night's
    // Meal: dish into data/recipe-cache. Measured on the G11: a cache write at
    // 17:00 on every meal-day from 23 Jul to 6 Aug, then nothing at 17:00 ever
    // again; 11 Aug and 14 Aug have no cache entry at all. So the recipe book
    // stopped filling and the method stopped showing, from one cause.
    //
    // This is the same subsystem for V3: a 30 s tick over the calendar cache,
    // the same 1 h-before / 20 min-after window, forcing depth 3 with the
    // recipe subject the way alerts.js forces it with a camera. Warming the
    // cache is a side effect of showing the panel, which is what refills the
    // book — and it warms TOMORROW's dish too, so a dish gets two chances at
    // the same single billable web search.
    //
    // Flag-off ⇒ initDinner registers no tick and no handle, and the recipe
    // subject is reachable only by voice, exactly as it is today.
    //
    // FLIPPED ON 2026-08-16 after live verification on the G11: the strip, the
    // month and the recipe were each mounted over CDP and photographed on the
    // wall before this line moved. The panel itself could only be verified
    // armed — flag-off it registers no tick and no handle — which is the same
    // deadlock the recipePanel flag above records. One-line revert (-> false).
    v3DinnerPanel: true,

    // ── The week of weather ─────────────────────────────────────────────────
    // /api/weather/forecast has served 7 days of high/low/code/rain-chance all
    // along; nothing rendered it and the voice never saw it. houseDigest()
    // wrote only today's numbers into the model's context, so "the next seven
    // days" got an honest refusal. This adds the show.forecast subject (a
    // lottie week strip) and the digest line behind one flag, because a strip
    // nobody can ask for and an answer with nothing to look at are each half a
    // feature.
    //
    // ⚠ This flag is why V3 loads a lottie player at all — window.lottie was
    // set only in the incumbent's app.js. The player is imported unconditionally
    // (a bundle cannot be conditional), but with the flag off nothing ever
    // calls loadLottieAnimation on this surface and no animation is created.
    //
    // ⚠⚠ The digest half is the risky half. The character has invented weather
    // it was never given twice (039dfa2, cc30c89), so the line carries ONLY
    // days present in forecast.days and is absent entirely when the array is.
    //
    // FLIPPED ON 2026-08-16. Photographed on the wall: seven cells, seven
    // lottie icons actually rasterised, live Open-Meteo data. One-line revert.
    v3ForecastWeek: true,

    // ── The month ahead ─────────────────────────────────────────────────────
    // show.day is deliberately today-only (localIntents DAY_INTENTS) and the
    // incumbent's widest window was 9 days on a surface nobody sees. Nothing
    // on the wall could answer "what have I got on next month". This adds
    // show.ahead: an agenda grouped THIS WEEK / NEXT WEEK / LATER, listing only
    // days that carry something.
    //
    // ⚠ The horizon is a SERVER fact, not a rendering one. getRecurrenceWindow
    // expands recurring events only to last-of-month + 7 days, so on 16 Aug the
    // feed carried nothing between 27 Aug and 19 Nov. CALENDAR_LOOKAHEAD_DAYS
    // (server-side, default 0 = unchanged) widens it. This flag governs the
    // SUBJECT; without the env var the subject renders an honestly short month.
    //
    // FLIPPED ON 2026-08-16, and CALENDAR_LOOKAHEAD_DAYS=45 was set in the G11's
    // .env FIRST — verified by measurement, not assumption: before it the feed
    // carried nothing between 27 Aug and 19 Nov; after it, four September dates
    // appear. Flipping this without that env var draws a truthful picture of a
    // truncated feed, which is honest but not what was asked for.
    v3CalendarAhead: true,
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
