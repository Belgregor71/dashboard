# Visual design and UX audit — 2026-11-12

Audit only. No code, flag, asset or config was changed. Nothing here has been implemented.

## How this was done, and what it can and cannot claim

- **Surface audited:** `src/v3/` — the only frontend since the incumbent was retired on 2026-10-03. 10 stylesheets (5,017 lines), 51 core modules, 14 subjects.
- **Target:** GMKtec G11, Chromium kiosk, **1920×1080 at DPR 1** on a 32" panel (`tokens.css:12`, `index.html:9`). Not 4K. All captures were taken at that size.
- **Captures:** 146 screenshots from a local build, driven through the same fixtures and seams the contrast sweep uses (`tests/verify/v3-contrast.spec.js`), with a local family photo as the ground. Five passes: Memory Journey day/night, the plane card day/night, and the bare photo ground. A second pass left CSS animations running. A third captured the week forecast at shipped default flags.
- **Evidence labels:** **[V]** seen in the running app. **[C]** supported by the code, not reproduced on screen. **[D]** a design judgement.

Limits, stated plainly:

- **Motion was not watched in real time.** Animation findings are from code, timings and still frames. Smoothness, easing feel and frame drops on the G11 are not verified.
- **Nothing was measured on the live kiosk.** Performance figures are quoted from `docs/audit/HOST-BASELINES.md`, not re-taken.
- **Not rendered at all:** radar/sky, robot plan, camera-plan dive, day lapse, diorama, arrival, dinner, Kath and Kim moments, the overseas travel map. Their fixtures returned no data. Findings on these are [C] only.
- **There is no BOM timeline in V3.** The brief asks about one; it belonged to the retired incumbent. V3 has the week-ahead subject and the BOM outlook as a spoken/glance line (`src/js/services/weather/bomOutlook.js`).
- The harness fires events back to back with no gaps. Collisions it produced are real code paths, but how often the house's own timing produces them is not known.
- The forecast capture ran a local server on the dev `.env`, so it read live Home Assistant state. Read-only; nothing was written.

Screenshots are in the session scratchpad and contain family photographs. They must not be committed — the repo is public.

---

## A. Executive visual assessment

This is not a dashboard of widgets that needs a design system. It already has one, and a strict one: one perceptual colour ramp in OKLCH, two typefaces with a rule for which speaks when, a 32px type floor derived from viewing distance, a fixed lattice, and a scrim whose opacity is solved per photograph. The core surfaces — the resting wall, the glance, the spread, the text subjects — look like one product. Most smart-home dashboards never get this far.

What gives away that parts were designed at different times is narrow and specific:

1. **The newest features bypass the system the older ones obey.** The parcel card, the house plan, the day lapse and the robot layer bring their own colours, sizes, radii and fonts. The parcel card is the clearest case: it is the only rounded opaque card on the wall, it is set in sizes the system forbids, and it draws over whatever is underneath, including the forecast.
2. **Overlays have no shared priority.** Dogs, parcels, the doorbell camera, the transcript and the pills each know their own corner but not each other. Two were caught covering content.
3. **The resting wall has three generations of the same caption** — year and place — in three unrelated typographic treatments, depending on which flags are on.
4. **The motion law is written but not followed.** `tokens.css:175` says "three durations and one curve; anything that needs a fourth is wrong". The stylesheets use 29 distinct durations and at least 8 curves.

The biggest single improvement is not a restyle. It is one overlay manager with a declared priority order and a single "moment card" component, then pulling the four late features back onto the tokens.

| Category | Score | Evidence |
|---|---|---|
| Overall visual design | 7 | Core surfaces are restrained and coherent [V]. Pulled down by the parcel card and the dimmed-photo ground under dense text [V]. |
| Consistency between screens | 6 | Glance, spread and text subjects share one idiom [V]. Three caption idioms at depth 0, two pill sizes, a fault pill that changes corner between compositions [V]. |
| Typography | 7 | Two families, tabular figures, GRAD for night, a real italic. But 8 weights in use (100–600), four sizes under the stated floor, tracked lowercase, and one element falling back to Times New Roman [V]. |
| Layout and spatial balance | 6 | Safe inset and left edge hold everywhere [V]. Content anchors jump between bottom (glance, spread, camera, media) and top (day, list, status, briefing). Empty states leave three quarters of the wall blank [V]. Forecast columns sit 5–6px out of line [V]. |
| Animation quality | 7 | Individually considered: caused weather, a 15 fps field, long slow drifts, per-dog timing [C]. Not watched in motion. |
| Motion consistency | 5 | Declared: 3 durations, 1 curve. Used: `--m-calm` 26 times, `--m-base` once, `--m-quick` once, 29 raw durations, 8 curves [C]. |
| Readability at distance | 7 | 48–132px for anything that matters [V]. Weakened by the 200-weight hour over busy photographs, the faint struck-through transcript, and 24–26px text [V]. |
| Ambient screen experience | 8 | The Memory Journey makes the photograph the hero with almost no chrome [V]. Loses a point for the caption straddling the photo edge and for no visible night grade in the capture [V]. |
| Visual performance | 8 | Recorded 3.1% of one core at rest and ~21% settled at depth 0 against a 25% ceiling. Mid-settle 31.6 against 35 — about 1.1× headroom. Not re-measured. |
| Personality and originality | 9 | Two dogs with distinct movement, seasonal wardrobe, a house that speaks in its own voice, a wall that reflects the real sky. Nothing else looks like it [V]. |

---

## B. Screen-by-screen audit

### B1. Resting wall, Memory Journey (depth 0, live default)

Files: `css/journey.css`, `core/journey.js`, `css/compose.css` (hour), `core/sun-clock.js`.

- **Strengths [V]:** photograph fills the frame; blurred mats instead of black bars; date and hour bottom-left on the safe line; year in a warm italic. Calm, almost no interface.
- **Weaknesses:**
  - **[V] The year and place straddle the photo's right edge.** The block spans roughly x 1555–1820; the photograph ends near x 1700. Half the year sits on the photo, half on the mat, so its two halves have different backgrounds.
  - **[V] The hour is weight 200 at 168px** (`compose.css:300`). Over a mid-tone, textured area of a photograph the strokes are hairlines. It relies on the text shadow.
  - **[V] In the night capture (23:30) the photograph is as bright as by day.** Only the inks dim. May be mitigated on the wall by the display power schedule; needs a look on the glass.
  - **[C]** `.journey__place` is weight 450, the plane's date is 400, the journey date is 450 — three near-identical weights for the same role (`journey.css:231`).
  - **[C]** Three `!important` margins to fight an inherited rule (`journey.css:225,229,238`).
- **Improvements:** keep the caption wholly on the mat or wholly on the photo; raise the hour to weight 300 when it sits over a photograph; add a night grade to the journey photo.
- **Priority:** medium. **Impact:** high, because this is what the wall shows most of the day.

### B2. Resting wall, plane card (depth 0, flag-off path of the journey)

Files: `css/archive.css`, `core/archive.js`.

- **Strengths [V]:** the tilted card with a real shadow is distinctive; the living field behind it is atmospheric.
- **Weaknesses:**
  - **[V]** The photo occupies about a third of the wall; the right half holds a ghost of the same photo and a 400px weight-100 year that is nearly invisible (`archive.css:310-311`). The photograph is not the hero here.
  - **[V]** "On this day · 2021 · Nudgee" is lowercase at 0.16em tracking, and the eyebrow is weight 600 at 0.26em (`archive.css:593-594`). Wide-tracked lowercase reads as a different product from the tight Figtree elsewhere.
  - **[V]** The fault pill moves to the bottom-right here; it is top-left on the journey.
  - **[V]** At night the moon renders as a pale blob directly behind the first digit of the hour and reads as a smudge.
- **Improvements:** if the journey stays on, treat this as a fallback and stop polishing it. If it is kept as a peer, align its caption to the journey's.
- **Priority:** low while `v3MemoryJourney` is on.

### B3. Resting wall, bare photo ground (`v3Archive` off)

- **[V] The ground caption renders in Times New Roman.** `.ground-caption` (`compose.css:1630`) sets no font family, and neither does `body`. It also sits at y≈1040, inside the 96px safe inset, crowded under the hour.
- Not the live configuration, but it is the documented fallback. **Priority:** low; the fix is one line on `body`.

### B4. Glance (depth 1) and spread (depth 2)

Files: `css/compose.css`, `css/type.css`, `core/composer.js`, `core/spread.js`.

- **Strengths [V]:** this is the best-designed part of the wall. One sentence at 96–132px, a label in tracked uppercase, two supporting cells. The said/measured split is legible from across a room.
- **Weaknesses:**
  - **[V]** Under the sweep's journey fixture the photograph stays behind the text, dimmed to near-black with faces still recognisable. It is a muddy ground. The default-flag forecast capture, with no photo loaded, showed the plain dark field instead, and that looked cleaner.
  - **[V]** The rail ("what's next") is 32px italic in `--ink-faint`. It is the dimmest text on the wall by design; it is close to not being received.
- **Improvements:** at depth 1 and above, drop the photograph to the field rather than dimming it. **Priority:** medium.

### B5. Text subjects: day, list, recipe, month ahead, briefing, status (depth 3)

Files: `subjects/*.js`, `css/compose.css`.

- **Strengths [V]:** consistent title (48px uppercase, tracked) then body. Status is ten rows of 48px and still readable.
- **Weaknesses:**
  - **[V] Empty states waste the wall.** "Nothing on today.", "Nothing's planned for tonight." and "Nothing on for the next month." each put one 96px line at the top and leave about 75% of the screen empty.
  - **[V] Anchor inconsistency.** These subjects start at the top. Glance, spread, camera and media are anchored to the bottom. Moving from a glance to "show me my day" jumps the eye from bottom-left to top-left.
  - **[C]** Status showed "re-armed switch.kitchen_motion_detection" from the fixture. If the live recovery log is worded the same way, raw entity ids are reaching the wall.
  - **[V]** In the briefing, the last word of the first line is cut by a fade near x 1680.
- **Improvements:** bottom-anchor short and empty subjects in the glance position so the whole wall shares one anchor; humanise recovery-log labels.
- **Priority:** medium.

### B6. Week forecast (depth 3)

Files: `subjects/forecast.js`, `src/js/helpers/lottie.js`, `static/icons/weather/lottie/` (55 files, 936 KB).

- **Strengths [V]:** seven even columns, 72px highs with 48px lows, tabular figures, rain chance beneath. No crowding, no overflow, no overlap between columns. Readable at distance.
- **Weaknesses:**
  - **[V] Columns are out of line.** Days with no rain figure ("Today", "Fri") sit 5–6px lower than their neighbours: day names at y 375 against 370, highs at y 611 against 605. The column is being centred on its own height.
  - **[V] The parcel card covered the Friday and Saturday columns** when a parcel moment fired during the forecast.
  - **[D]** The Lottie icons are bright, flat, cartoon-styled. They are the only illustration on a wall that is otherwise type and photography. They do not look wrong, but they look bought-in.
  - **[V]** The block floats in the middle band (y 370–800); the bottom third is empty.
  - **[V]** With no forecast data the subject renders a completely blank wall. Other subjects say something.
  - **[C]** This subject is not in the contrast sweep's surface list.
- **Priority:** high for the alignment and the overlap (both are plain defects), low for the icon style.

### B7. Camera and doorbell (depth 3)

Files: `core/alerts.js`, `subjects/camera-plan.js`, `css/compose.css`.

- **Strengths [V]:** full-bleed frame, one 96px caption bottom-left, a bottom gradient for legibility. Same position and style as the media subject. Correctly minimal.
- **Weaknesses:**
  - **[V] A doorbell does not stand the dogs down.** With a dog show running, the camera opened underneath and the dogs covered the caption ("The front do…"). Reproduced with CSS animations running. In code, the only caller that hides the dogs is the voice handler (`core/voice.js:653-654`); `alerts.js` never does. The dog layer is z-index 15, the stage is 10.
  - **[V]** The parcel card also stayed over the doorbell frame.
  - **[V]** The lingering transcript from the previous turn stays top-right over the camera for up to 8 s (`voice.js:43`).
- **Priority:** high. The doorbell is the most time-critical thing the wall shows.

### B8. Media: now playing, media rooms, media subject

Files: `css/media.css`, `core/media-rooms.js`, `core/now-playing.js`, `subjects/media.js`.

- **Strengths [V]:** room label, title, artist, right-aligned in the bottom-right corner. Clean.
- **Weaknesses:** **[V]** a long title runs left to x≈1060 and collides with anything in the lower middle (it ran under a dog). **[C]** the same shadow is written six times with three slightly different opacities (`media.css:169,216,309,338`).
- **Priority:** low.

### B9. Voice: transcript, presence light, vocabulary

Files: `css/light.css`, `css/type.css`, `core/voice.js`, `core/presence-light.js`, `core/vocabulary-card.js`.

- **Strengths [V]:** no orb, no waveform. The screen's own lower edge lights while listening. The transcript is in the measured face because it is the recogniser's readout, not the house speaking. This is a real idea and it is carried through.
- **Weaknesses:**
  - **[V] The misheard state is hard to read.** 48px weight 300, struck through, in a dim red (`type.css:135-139`). Over a photograph it is the lowest-contrast text captured.
  - **[C]** The states are distinguished only by the rim and the strike. Processing, speaking, timeout and cancelled were not individually captured; the code has `listening`, a fail pulse (1400 ms) and a fail dissolve (1100 ms).
  - **[V]** The transcript is top-right, not top-centre as the brief assumes. That is fine, but it shares the corner with the timer pill, the journey caption and the parcel card, and each pairing has its own special-case rule.
- **Priority:** medium.

### B10. Pills: fault and timers

- **[V]** Fault pill: 24px, filled, red-tinted border (`compose.css:415`). Timer pill: 32px, filled, neutral border (`compose.css:662-680`). Same idiom, two sizes. The 24px size was a deliberate owner call and is documented; the result is still two pill scales.
- **Priority:** low.

### B11. Parcel moment

Files: `css/parcels.css` (44 lines), `core/parcel-animation.js`.

- **[V]** A 480px opaque card with a 24px radius, top-right, with a flat-colour van and box.
- **[C]** It breaks more system rules than any other element: font named literally instead of by token (`parcels.css:33`); 36px and 26px text, both off the scale and one under the floor (`:34-35`); weight 550; eleven hex colours (`:19-32`); `right: 72px` rather than the 96px safe inset (`:3`); z-index 20, level with the presence light (`:7`).
- **[V]** It has no awareness of depth. It covered two forecast columns and sat over a doorbell frame.
- **Priority:** high.

### B12. Dogs

Files: `css/dog-occasion.css`, `core/dog-occasion.js`, `core/dog-show.js`, `core/dog-schedule.js`, `static/assets/dogs/` (84 MB; 88 WebP, 8 PNG).

- **Strengths [V]:** clean cut-outs with no visible edge fringe at 1:1, peeking over the bottom edge. Benji and Teddy have different entrance times (650 against 1100 ms), different bob rates and different run curves (`dog-occasion.js:149-154`). That is characterisation, not decoration.
- **Weaknesses:** **[V]** they cover whatever is bottom-centre: the camera caption, a long media title. **[C]** their easing curves are their own (`dog-occasion.css:80,91`). **[C]** the schedule will not start a show during a subject, but nothing ends one when a subject arrives.
- **Priority:** medium. Keep the dogs exactly as they are; fix who yields.

---

## C. Animation inventory

| Animation | Location | Purpose | Issues | Recommendation | Priority |
|---|---|---|---|---|---|
| Depth exchange (opacity) | `compose.css:242-246` | Move between field, glance, spread, subject | None. 350 ms, system curve | Keep. This is the reference | — |
| Hour step-down (scale) | `compose.css:324-329` | Hour shrinks at depth 1 | None; transform, no reflow | Keep | — |
| Ground dissolve | `core/ground.js:57,69` | Photo change, 60 s; veto 1.2 s | Fine | Name the two durations as tokens | Low |
| Archive plane drifts | `archive.css:236,242,329,366,822,921,961` | Slow life in the card, ghosts, year | Seven infinite loops of 84–130 s, each a different length | Reduce to two periods | Low |
| Archive Ken Burns | `archive.css:473` | 96 s settle per photo, once | Drives the mid-settle peak (31.6 against a 35 ceiling) | Leave; watch headroom | Low |
| Archive card exchange | `core/archive.js:244-273`, `archive.css:409` | Photo swap with a 300 ms `blur(16px)` | Uses blur, which `tokens.css:186` says is not a material | Accept as transient or replace with a dip to mat | Low |
| Archive motion clip (video) | `core/archive.js:308-310` | 3.6 s live photo, 600 ms fade | Not rendered | Verify on the wall | Low |
| Memory Journey (Web Animations) | `core/journey.js:38-73` | Wash in, map, zoom, photo surfaces | Own curve `cubic-bezier(0.33,0,0.2,1)`; 9 private timings | Move curve and timings to tokens | Medium |
| Living field (WebGL canvas) | `substrate/gl.js:64-91,604` | Sky, sun, cloud, rain behind the wall | 15 fps cap, stops when nothing is moving. Well built | Keep | — |
| Atmosphere overlay | `atmosphere.css:49,99,215,232,265` | Rain, lightning, fog, heat, stars | Rain is `0.9s linear infinite`; draws over photographs and camera frames at depth 3 | Stand the pane down over a camera | Medium |
| Presence light | `light.css:132,164`, `core/presence-light.js` | Listening level, fail pulse, fail dissolve | 1400 and 1100 ms are off-scale | Tokenise | Low |
| Timer ring | `compose.css:707` | Finished timer breathes | 1.6 s × 58 | Fine | — |
| Media disc and progress | `media.css:192-419` | Spinning art, progress fill | Linear infinite while playing | Confirm it stops at depth ≥ 1 | Low |
| Dogs: peek, bob, run, exit | `dog-occasion.css:80-201`, `dog-occasion.js:149-173` | Personality | Private curves; do not yield to alerts | Keep motion; add yield | Medium |
| Parcel moment | `parcels.css:14,36-39` | Van arrives, box settles, tick | 8 s fixed; ignores depth | Rebuild on the moment card | High |
| Diorama | `core/diorama.js:31-36` | Car rolls in, bins go out | Not rendered | Tokenise the 350/700 fades | Low |
| Camera plan dive | `subjects/camera-plan.js:21-26` | House plan zooms to the camera | Not rendered | Same | Low |
| Day lapse | `subjects/day-lapse.js:18-23` | 20 s replay of the day | Not rendered. Sizes in `vw` on a fixed panel (`compose.css:987,992`) | Use px tokens | Low |
| Forecast Lottie icons | `subjects/forecast.js:175` | Seven animated weather icons | Only Lottie on the wall; different visual language | See D-15 | Low |
| Recipe scroll | `subjects/recipe.js` | Uses `requestAnimationFrame` | Not inspected | Inspect before Phase 3 | Low |
| Weather videos | `static/assets/weather_bg/` (12 files, 18 MB) | None | **No reference in `src/` or `server/`** | Candidate for removal, after a template-literal grep | Low |

Shared-standard opportunities: every fade in the diorama, camera plan, day lapse, journey and archive is a private constant between 300 and 700 ms. Two tokens would cover all of them.

`@media (prefers-reduced-motion)` zeroes the CSS tokens and all CSS animations (`tokens.css:249-260`). It does not reach Web Animations. The journey handles this itself; the diorama, camera plan and day lapse were not checked. [C]

---

## D. Top 20 visual improvements

Ranked by impact on the wall, then by cost.

**1. One overlay manager with a declared priority.**
Problem: dogs, parcels, alerts, transcript and pills arbitrate pairwise with special-case CSS. Two collisions were caught [V].
Why: the doorbell is the one moment the wall must be unambiguous.
Target: doorbell and camera clear everything; a subject clears dogs and moments; moments queue rather than stack.
Files: new small module beside `core/depth.js`; `core/alerts.js`, `core/dog-show.js`, `core/parcel-animation.js`, `core/voice.js`.
Approach: a single `claim(layer, priority)` and `release` pair on the existing event bus; each overlay asks before it paints and listens for a higher claim.
Impact high. Effort medium. Depends on nothing. Risk: timing regressions in dog and parcel specs; flag-gate it.

**2. Doorbell stands the dogs down.**
The narrow fix inside item 1, shippable alone: `alerts.js` calls the same two functions `voice.js:653-654` already calls.
Impact high. Effort low. Risk low.

**3. Rebuild the parcel card as a system "moment card".**
Problem: eleven hex colours, off-scale type, literal font, own radius, own inset [C][V].
Target: same corner, system surface, `--t-measured-2` title and `--t-rail` detail, safe inset, hidden at depth 3.
Files: `css/parcels.css`, `core/parcel-animation.js`.
Impact high. Effort low. Risk: the illustration needs recolouring to the palette.

**4. Fix forecast column alignment.**
Problem: columns without a rain figure sit 5–6px low [V].
Approach: align columns to the top, or always reserve the rain row.
Files: `css/compose.css` (forecast block), `subjects/forecast.js`.
Impact medium. Effort low. Risk low.

**5. Stop dimming the photograph under dense text; use the field.**
Problem: recognisable faces at 10% brightness under ten rows of status [V].
Target: depth 2 and 3 text subjects sit on the plain living field.
Files: `css/journey.css`, `css/compose.css`, `core/journey.js`.
Impact high. Effort medium. Depends on confirming on the wall with a real photo. Risk: contrast sweep floors will move.

**6. One anchor for short content.**
Problem: empty and one-line subjects sit at the top; everything else short sits at the bottom [V].
Target: a subject with three lines or fewer uses the glance position.
Files: `subjects/dom.js`, `css/compose.css`.
Impact medium. Effort low. Risk: several subject specs assert positions.

**7. Set a font family on `body`.**
Problem: anything unclassed falls to Times New Roman; seen on the ground caption [V].
Files: `css/type.css:145`.
Impact low today, but it removes a whole class of future defect. Effort trivial. Risk none.

**8. Motion tokens that match reality.**
Problem: 29 raw durations, 8 curves, against a stated 3 and 1 [C].
Target: five durations and three curves (see section E), used everywhere including JS.
Files: `css/tokens.css`, all stylesheets, `core/journey.js`, `core/diorama.js`, `subjects/camera-plan.js`, `subjects/day-lapse.js`, `core/archive.js`.
Impact medium (felt, not seen). Effort medium. Risk: subtle timing changes; do one file per commit.

**9. Journey caption wholly on one ground.**
Problem: year and place straddle the photo edge [V].
Files: `css/journey.css:216-240`.
Impact medium. Effort low. Risk: portrait photos have wider mats; test both.

**10. Heavier hour over photographs.**
Problem: weight 200 hairlines over texture [V].
Approach: weight 300 when the journey photo is behind the hour; keep 200 on the field.
Files: `css/compose.css:300`.
Impact medium. Effort trivial. Risk: a taste call — look at it on the glass first.

**11. A readable misheard state.**
Problem: dim red, thin, struck through [V].
Target: `--ink-dim` text with a 2px `--error` strike, so the words stay legible and only the line carries the failure.
Files: `css/type.css:135-139`.
Impact medium. Effort trivial.

**12. Night grade on the journey photograph.**
Problem: full-brightness photo at 23:30 in the capture [V].
Files: `css/journey.css`, driven by the existing `data-night`.
Impact medium. Effort low. Depends on what the display schedule already does.

**13. Atmosphere pane stands down over camera frames.**
Problem: rain streaks draw across full-bleed photographs and would across a doorbell frame [V on photos, C on camera].
Files: `css/atmosphere.css`, `core/atmosphere-fx.js`.
Impact medium. Effort low.

**14. One pill.**
Problem: two sizes, two borders [V].
Target: one `.pill` class; the fault variant keeps its dot and its 24px by documented exception.
Files: `css/compose.css:396-420,662-690`.
Impact low. Effort low.

**15. Decide the forecast icon style.**
Problem: the only cartoon illustration on the wall [D].
Options: keep (they are friendly and legible); or desaturate and dim them toward `--ink` so they sit in the palette.
Files: `subjects/forecast.js`, `css/compose.css`.
Impact low to medium. Effort low for the tint.

**16. Colour tokens for the house plan, lapse and robot.**
Problem: about 30 raw `rgb()`/hex values in `compose.css:916-1065`, including `#fff` and `#23272a`, which the token file forbids by name [C].
Target: `--plan-amber`, `--plan-night`, `--robot-path` and friends, defined once.
Impact low on screen, high for future consistency. Effort low.

**17. Radius and shadow tokens.**
Problem: radii of 2, 6, 8, 10, 12, 24 and 999 with no scale; one shadow written six ways [C].
Files: `css/tokens.css`, `css/media.css`, `css/compose.css`, `css/archive.css`.
Effort low.

**18. Remove `vw`/`vh` from a fixed panel.**
Problem: `4.2vw`, `2.2vw`, `34vh` on a wall defined as exactly 1920×1080 [C].
Files: `css/compose.css:987,992`, `css/dog-occasion.css:22`.
Effort trivial.

**19. Tracking discipline.**
Problem: lowercase at 0.16em and 0.26em on the plane card [V].
Target: tracking above 0.02em only on uppercase.
Files: `css/archive.css:590-600`.
Impact low while the journey is on.

**20. Fault pill in one corner.**
Problem: top-left on the journey, bottom-right on the plane [V].
Files: `css/archive.css`, `css/compose.css`.
Impact low. Effort low.

---

## E. Proposed unified design system

Keep what exists. The colour ramp, the two voices, the type floor, the lattice and the solved scrim are right and should not be reopened. The proposal is to finish the token file so the late features have somewhere to stand.

```css
:root {
  /* Type: add the two sizes that are in use and unnamed */
  --t-display: 400px;        /* the engraved year */
  --t-memory:  128px;        /* the journey's year */
  --t-fyi:      24px;        /* the ONE exception under the floor: pills with their own ground */

  /* Weights: five, not eight */
  --w-hair: 200;             /* the hour on the field only */
  --w-said: 300;
  --w-read: 400;
  --w-label: 500;
  /* 100, 450, 550, 600 retire */

  /* Tracking */
  --track-tight: -0.026em;   /* said */
  --track-read:   0.004em;   /* measured */
  --track-label:  0.06em;    /* uppercase labels only */

  /* Space: the values already in use, named */
  --s-1: 8px; --s-2: 16px; --s-3: 28px; --s-4: 48px; --s-5: 96px;   /* --s-3 = gutter, --s-5 = safe */

  /* Radius */
  --r-hair: 2px; --r-tile: 6px; --r-card: 12px; --r-pill: 999px;

  /* Elevation: two shadows */
  --lift-1: 0 6px 20px oklch(0.05 0 0 / 0.55), 0 1px 2px oklch(0.05 0 0 / 0.6);
  --lift-2: 0 24px 80px oklch(0.05 0 0 / 0.5);

  /* Motion: what the wall actually needs */
  --m-quick: 150ms; --m-base: 250ms; --m-calm: 350ms;      /* exist */
  --m-scene: 700ms;          /* overlay in and out, map in, diorama fades */
  --m-settle: 1200ms;        /* photo exchange, veto */
  --ease:       cubic-bezier(0.22, 1, 0.36, 1);            /* arrive */
  --ease-leave: cubic-bezier(0.55, 0, 0.8, 0.3);           /* depart (the dogs' exit curve, promoted) */
  --ease-drift: cubic-bezier(0.4, 0, 0.2, 1);              /* long slow moves */

  /* Layers: named once, used everywhere */
  --z-field: 0; --z-photo: 1; --z-scrim: 2; --z-archive: 3; --z-atmo: 4;
  --z-stage: 10; --z-character: 15; --z-moment: 16; --z-alert: 18; --z-presence: 20;
}
```

Overlay hierarchy, highest first: doorbell and alerts → voice turn (transcript, presence) → subject → moment cards (parcel, arrival, dinner) → characters (dogs) → resting wall. A higher layer arriving ends or hides the lower ones; equal layers queue.

Shared components worth extracting:

| Component | Replaces |
|---|---|
| `.pill` | `.fault`, `.timers` |
| `.moment` (corner card) | `.parcel-moment`, and the diorama and arrival notes |
| `.label` (uppercase, tracked, `--t-rail`) | `.cell__label`, `.subject__title`, `.now-playing__sub`, room labels |
| `.caption-memory` (year + place) | the journey words, the archive plate, `.ground-caption` |
| `.veil` | `.heard::before`, the rail's veil, each subject's veil |

Day and night: already handled by `data-night` on the inks. Extend it to photographs (item 12) and nothing else.

Responsive behaviour: none, deliberately. The wall is one rectangle. Remove the three viewport units so that statement is true.

---

## F. Roadmap

**Phase 1 — Visual corrections.** Items 2, 3, 4, 7, 9, 11.
Files: `core/alerts.js`, `css/parcels.css`, `core/parcel-animation.js`, `css/compose.css`, `subjects/forecast.js`, `css/type.css`, `css/journey.css`.
Validation: add `3-forecast` and a "doorbell during dog show" surface to the contrast sweep; a spec asserting forecast day names share one `top`; inject each defect back to prove the spec fails; look at the wall.

**Phase 2 — Design unification.** Items 6, 14, 16, 17, 18, 19, 20, and the token additions.
Files: `css/tokens.css` first, then one stylesheet per commit.
Dependency: Phase 1's parcel rebuild, so it is not tokenised twice.
Validation: a lint-style spec that fails on a raw px font size, hex colour or radius outside `tokens.css`. The floor check in `type.css` is the model.

**Phase 3 — Motion refinement.** Items 1, 8, 13.
Files: new overlay module; `core/journey.js`, `core/diorama.js`, `subjects/camera-plan.js`, `subjects/day-lapse.js`, `core/archive.js`, `css/atmosphere.css`.
Dependency: behind a default-off flag; `/flag-flip` with both suite states.
Validation: `/kiosk-metrics` before and after, because timers and teardown are touched.

**Phase 4 — Premium experience.** Items 5, 10, 12, 15.
These change how the wall looks at rest and need the owner's eye on the glass before and after. Validation: contrast sweep, then a day and a night on the wall.

**Phase 5 — Long-term polish.**
Reduce the archive's seven drift periods to two. Confirm media loops stop when hidden. Audit Web Animations for reduced motion. Review the 18 MB of unreferenced weather video. Check burn-in exposure: the hour, the date and the pills sit at fixed pixels for hours; a few pixels of slow drift on the hour would cost nothing.
Validation: a 72-hour soak row.

---

## G. Before and after

**Resting wall.** Today: a photograph with a caption that half-sits on its edge and a hairline clock. After: the caption belongs clearly to the mat, the hour holds over any photo, and at night the picture dims with the room.

**Weather.** Today: a clean week that sits a few pixels crooked and can be covered by a parcel card. After: seven columns on one line, icons tinted into the palette, nothing allowed on top of it.

**Camera notifications.** Today: the doorbell opens under whatever was already there. After: the doorbell clears the wall. Dogs duck, the parcel card waits, the rain pane lifts, the old transcript goes. One frame, one caption.

**Voice.** Today: a strong idea with one weak state. After: a misheard line you can still read, struck through in red; the transcript's corner is its own.

**Personality.** The dogs do not change. What changes is that they behave like members of the household: they turn up when the wall is quiet and get out of the way when someone is at the door. That reads as more character, not less.

**Parcels and other moments.** Today: each new moment brings its own card. After: one card, one corner, the house's own type and surface, with the illustration as the only thing that differs.

**Transitions.** Today: 350 ms between depths, and a private number everywhere else. After: five durations and three curves. Things arrive on one curve and leave on another, everywhere, so the dogs, the map, the parcel van and the depth change all feel like the same hand.

Taken together the change is small on any one screen. Its effect is that nothing on the wall looks like it was added later.
