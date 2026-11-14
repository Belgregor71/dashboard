# HANDOVER for Opus: three.js ambient ideas, round 2 (build plan)

## ⚠⚠ RETARGETED 2026-11-14 (Opus) — read this before anything below

The plan below targets two surfaces **that are not on the wall**. `v3MemoryJourney` is ON:

- `archive.js:1447-1458` latches `journeyMode`, which sets `planeMode = false`. **There is no
  `.archive__card` and no perspective plane.** Phases C/D's "canvas inside the card" have no node to go in.
- `.journey` is opaque and covers the whole wall (`journey.css:34-42`), so `main.js:135-138` counts
  it as a cover and **pauses the sky field at depth 0** (live: `__substrate().paused === true`,
  `data-journey="1"`). Phase B's golden hour in `substrate/gl.js` would never be seen.
- The owner noticed it first: "since we changed the ambient photos to full screen … the
  weather/time of day/night tinting background hasn't been visible".

**Owner's answer (⛔ don't re-ask): weather and time of day go ON THE PHOTO ITSELF.** So:

| Phase | Was | Now |
|---|---|---|
| B `v3GoldenHour` | uniform in the field shader | **a grade layer** inside `.journey`, over both `.journey__frame`s, under the words. Tint + opacity from a pure `gradeOf({ sunAltDeg, cloud, raining })`: warm at golden hour, cool and dim at night, grey and soft in rain. CSS only. The journey's per-photo corner shades (journey.js solves them per photo) must be re-solved **with the grade included**, or the year/place/hour lose contrast |
| C `v3PhotoTransitions` | canvas in `.archive__card`, fed from `present()` | **one transparent canvas over the two journey frames**, fed from `journeyPresent` (`archive.js:1186`). UVs follow `data-fit` (cover vs contain on its backdrop). The journey's WAAPI moves must be matched, or the canvas is skipped while they run |
| D `v3RainGlass` | drops on the card | drops over the full-screen photo, same canvas as C |
| E `v3ColdGlass` | fixed edge layer | unchanged in shape; it now sits over the journey |

Cost risk changes too: the second WebGL context is **full-wall (1920×1080), not card-sized**.
Phase A measures that one. A card-sized measurement would answer the wrong question.

Also found the same day: the field's luminance envelope was set as a dim MAT, so a spread's
backdrop (`v3SubjectField` hides the photo at depths 2/3) read as black in daylight. Fixed
separately with `uExposure` (shader v6, `SPREAD_EXPOSURE` in `main.js`). The grade in B must not
assume the field is visible anywhere except behind a spread.

Planned 2026-11-14 on Fable. **Nothing is built. No repo file was changed.** This file is the
whole handover; it follows `docs/design/HANDOVER-threejs-ambient-ideas.md` (`cd009dc`, local,
unpushed), which has the idea descriptions and the measured G11 limits.

## Start here (Opus)

1. Copy this file to `docs/design/HANDOVER-threejs-ambient-build.md` and commit it (the
   planning session was in plan mode and could not write into the repo or the memory dir).
2. Add one line to the memory entry `project-threejs-dog-diorama-stage.md`: owner's picks and
   the pointer to that doc.
3. Run **Phase A** (spike + stills). Build nothing before the owner has seen the stills.

## Owner's answers (asked 2026-11-14, ⛔ don't re-ask)

- Build: photo transitions + rain on glass (one arc), golden-hour light, cold-morning glass.
- Globe flight: **wait** until the flat overseas map has been seen live. Album glow: not picked.
- Cold glass rule: **mist on humid dawns (90%+ humidity), a frostier look below about 8 °C**,
  both clearing as the sun climbs.
- Not yet asked: which of the three transition looks to keep. The stills decide that.

## What was read, and what was not

- Read: `stage3d/stage.js` (whole), `archive.js` `present()` and the timing constants,
  `archive.css` card / plane / Ken Burns rules, `substrate/index.js` `toCauses`, the `gl.js`
  uniform list and `frameMsFor`.
- **Not verified (check before relying on it):** that `data-atmo-raining` is the right rain
  signal for the card; how `archive.js` knows a frame is an occasion photo; the z-order of
  `#substrate` against the archive plane (is the field visible around the card at depth 0?);
  the contrast sweep spec's file name and how it forces a state; where `v3FieldCauses` is
  read in `main.js`. No Plan/Explore subagent was run.

**Verdict: YES-BUT.** All four chosen items are buildable inside the G11's budget, but only
two of them should use three.js, and none of them should use the shared full-screen stage.

## Context

`docs/design/HANDOVER-threejs-ambient-ideas.md` (`cd009dc`) pitched six ideas. The owner chose
(2026-11-14):

1. Photo transitions (`v3PhotoTransitions`)
2. Rain on the glass (`v3RainGlass`)
3. Golden-hour light (`v3GoldenHour`)
4. Cold-morning glass (`v3ColdGlass`): mist on humid dawns (90%+ humidity), frost look below about 8 °C

Not planned: globe flight (wait until the flat overseas map has been seen live) and album glow (not picked).

## What the code says that the handover did not

- **The photo card is not flat on the screen.** It sits on a perspective plane
  (`archive.css` `.archive__scene` perspective 2800px, `.archive__plane` rotateY) that
  *breathes* on a 90 s loop (`arch-breathe`). A quad on the full-screen stage canvas would
  have to track a moving 3D transform to line up, which is the "flash at hand-off" risk.
- **Fix: put a canvas inside the card**, as a sibling of `.archive__img` with the same box.
  CSS then applies the plane, the breathe and the mask to it for free, so alignment is not
  computed at all.
- **The CSS cross-fade keeps running underneath, unchanged.** The canvas only covers it for
  `settleMs`. So the fallback (stage dead, image not decoded, flag off) is simply "don't show
  the canvas", and the plate swap (`PLATE_SWAP_RATIO`) and motion clip start
  (`settleMs + MOTION_START_PAD_MS`) need no change.
- **A separate card canvas removes the stage-owner problem.** Dogs and the diorama keep
  `stage3d/stage.js`; the card never competes for it. The cost is a second small WebGL
  context for the life of the page (created once, on first use). That cost is unmeasured:
  Phase A measures it.
- **Golden hour belongs in the sky field (`substrate/gl.js`), not on the stage.** The field
  already has `uSunAlt`, `uSunAz`, `uCloud` and `uInkGuard` (the text contrast guard), and its
  15 fps cost is already budgeted. A 40-minute stage moment would also block every dog popup
  (`play()` refuses a second owner). Trade-off: the light crosses the wall around the card,
  not the photo itself.
- **Cold glass needs no WebGL**: one static texture layer with an opacity driven by data.
- Temperature and humidity are already on the page: `weather.now.temp_c`,
  `weather.now.humidity_pct` (`main.js:317`, `archive.js:541`).

## Build order (each is its own flag, default off, its own deploy and owner's eye)

### Phase A: spike on the wall, ships nothing
- A card-sized second WebGL context beside the live page: gpu points at 30 fps for 2.6 s,
  and at 15 fps continuous, alone and with a dog moment playing on the stage. Template:
  `~/stage-ceiling.cjs` on the G11.
- Confirm `texImage2D` from a `/api/immich/asset/<id>/thumb` `<img>` does not taint.
- **Stills for the owner before any build** (handover lesson 5), rendered headless with a
  real photo into the scratchpad (never committed):
  developing print, light leak, sun wipe at 25/50/75%; rain drops on the card; golden-hour
  field at three sun altitudes; mist and frost edges.
- Gate: owner says yes/no per look. A "no" removes that look from the plan.

### Phase B: `v3GoldenHour` (first: cheapest, visible twice a day)
- `src/v3/substrate/index.js` `toCauses()`: add `golden = goldenOf(sunAltitudeDeg) * (1 - cloud)`,
  a pure function like the diorama's `duskOf` (window about −1° to +8° altitude, both dawn and dusk).
- `src/v3/substrate/gl.js`: `uGolden` uniform, shafts at `uSunAz` plus slow motes, drawn
  before the ink guard; `SHADER_VERSION` 6; `frameMsFor()` returns the base 66 ms while
  `golden > 0` so motes move on a still day. Zero when the flag is off (same pattern as `uCauses`).
- Flag wired in `main.js` where `v3FieldCauses` is.
- Spec: extend `tests/v3-field-causes.spec.js` pattern (uniform value by altitude, zero under
  full cloud, zero flag-off, loop idle again after the window). Add the state to the contrast sweep
  and FORCE it there, not just pin the flag.

### Phase C: `v3PhotoTransitions`
- New `src/v3/stage3d/card-stage.js`, dynamic `import()` only (three stays out of a flag-off
  build): one `WebGLRenderer` on a canvas appended to `.archive__card`, one quad, one
  `ShaderMaterial` with `uOld`, `uNew`, `uT`, `uLook`, `uSunAz`. Cover-crop UVs computed from
  image and card aspect (matches `object-fit: cover`). New texture sampled at the Ken Burns
  start scale `1 + 0.075 * --arch-amp` (it moves under 0.2 px in 2.6 s, so a constant is enough).
- Same rules as `stage.js`: rAF capped at 30, `setTimeout` deadline at `settleMs`, both
  textures disposed, `renderer.info.memory` back to 0, `webglcontextlost` marks it dead.
- `src/v3/core/archive.js` `present()`: after the slots swap, call
  `cardStage.run(oldImg, newImg, settleMs, look)` when flag on, depth 0, not panel-dark, both
  images `complete`, not journey mode. When it runs, skip the `is-exchanging` blur on the card
  (the dissolve is the cover). Nothing else in `present()` changes.
- Looks: developing print by default; light leak only when the frame is an occasion photo
  (birthday lean / on-this-day, already known to `archive.js`); sun wipe if approved, using
  `sun-clock.js` azimuth. Veto exchanges use the same look at their own shorter `settleMs`.
- Spec `tests/v3-photo-transitions.spec.js`: canvas exists and is shown mid-exchange (assert
  the node first); hidden and memory 0 after `settleMs`; **hand-off proof**: screenshot the card
  on the last canvas frame and just after hide, per-channel difference under a small threshold;
  flag off creates no canvas and never fetches the chunk; plate swap and clip start times
  unchanged in both flag states.

**✅ BUILT 2026-11-14 (`8b95103`, `13b51c6`), DEPLOYED OFF, live gate passed. What was built
differs from the bullets above in four places:**
- Module is `src/v3/stage3d/journey-stage.js` (not `card-stage.js`). Its canvas goes **inside the
  incoming `.journey__frame`**, over the photo and **under `.journey__grade`**, not over both
  frames: that way the grade and corner shades sit on top without being re-modelled.
- Textures are **composed 2D canvases** (surface colour + backdrop + drop shadow for a contained
  photo + the photo at its fit and scale), not the raw `<img>`, so no UV maths in the shader. The
  photo's 30 s rest ease is held at its start scale (`delay` + `fill: backwards`) until the canvas
  hides, so the shader and the photo meet on the same pixels.
- It replaces **only the daytime home wash**. The map, cut (first photo, veto, reduced motion,
  dark panel) and night (photo at 0.72 opacity over the surface) keep their own reveals.
- **The look follows the grade, not occasions** (`transitionLook` in `journey-grade.js`): leak in
  golden/late light, wipe when there is no grade, print in dusk/rain. The occasion rule needed
  plumbing that does not exist (the birthday lean is server-side). ⚠ With `v3GoldenHour` OFF every
  transition is a wipe.
- Known shortcut: the outgoing picture sits under the INCOMING frame's grade, so a change of light
  between two photos snaps at the start instead of crossing.
- Live gate (`~/transition-gate.cjs` on the G11, flag set in-page, `data-night` cleared per
  exchange): 49/49 shader moments ended `done`, `info.memory` 0 every time, no context loss,
  0 page errors, 0 CSP. Heap/nodes/listeners flat on the warm renderer (6.17→6.15 MB, 223→223,
  25→25). The first batch's +1.4 MB / +2 nodes / +4 listeners is the one-time cost of three + the renderer.
- ⏳ NOT measured: GPU cost of the moment with the canvas on top (Phase A's open hypothesis) and the
  owner's eye in daylight.

### Phase D: `v3RainGlass` (needs C)
- Same card canvas. While `data-atmo-raining` is set (the diorama's rain source) and the card
  is visible: about 40 drops simulated in JS, drawn as point sprites that sample the current
  photo texture with a lens offset. The canvas is transparent between drops, so cost follows
  drop area, not card area.
- 15 fps cap, and **the loop stops when no drop is moving and the Ken Burns has settled**
  (the canvas keeps its last frame). Rain can last hours; idle frames must cost nothing.
- Holds one texture while raining; released (memory 0) when rain ends, at depth > 0, at night-off.
- Drops are on the card only. Outside the photo WebGL can only draw a sheen (lesson 2): skipped.
- Spec: no drops when dry; drops and a live texture when raining; loop idle when drops rest;
  memory 0 after rain ends; an exchange mid-rain swaps the texture.

### Phase E: `v3ColdGlass`
- One fixed, `pointer-events:none` layer with a static edge texture (`src/v3/assets/`, SVG
  `feTurbulence` or painted art if the owner prefers), masked to the edges, two variants (mist, frost).
- `coldGlassOf({ tempC, humidityPct, sunAltDeg })` pure function in a small new module: mist
  when humidity ≥ 90% near sunrise, frost when temp ≤ 8 °C, both fade to 0 as the sun climbs
  (about 10°). Opacity set on the element on the weather tick with a CSS transition on the
  element (never on `:root`).
- Spec: thresholds on the pure function; layer absent flag-off; contrast sweep with the state forced.
- ⚠ Frost cannot be seen for real until about May. Mist can.

### Every phase B–E, in this order (house rules)
`/inject-defect` in both directions → full suite in both flag states (check `lms ps`, port 3210)
→ push → deploy OFF → live gate on the G11 (copy of `~/glass-gate.cjs`: 30+ moments,
`info.memory` 0, heap/nodes/listeners flat, CSP 0) → owner's eye with the flag set in-page →
`/flag-flip <flag>` with rollback proof → `/kiosk-metrics` for the continuous ones (B, D)
→ `node scripts/mirror-agents.mjs` if CLAUDE.md changes → memory entry.

## Files touched
- `src/v3/substrate/gl.js`, `src/v3/substrate/index.js`, `src/v3/main.js` (B)
- `src/v3/stage3d/card-stage.js` (new), `src/v3/core/archive.js` `present()`, `src/v3/css/archive.css` (C, D)
- new small cold-glass module + CSS + one asset (E)
- `src/js/config.js`: four flags, default off
- `tests/`: three new specs, `v3-field-causes.spec.js`, `v3-contrast.spec.js`, `flag-surface` picks the flags up itself
- `docs/design/HANDOVER-threejs-ambient-ideas.md`: results per phase

## Phase F (added 2026-11-14): `v3JourneyGlobe`, the overseas reveal as a globe flight

**Why now.** Ideas doc item 4 was gated on "get the owner's eye on the flat map first". That
happened 2026-11-14: the flat reveal was forced on the wall (Riomaggiore, then Paris and London,
via a CDP intercept of `/api/immich/on-this-day`, nothing deployed). Owner: "it's ok. but we
could build better with the three.js". **Design only. Nothing is built. Owner's yes/no on the
stills comes before any code.**

**What the wall does today** (`journey.js`, `mode === "map"`): a flat SVG of the destination
country fades in (`mapInMs`), a pin lands at 450 ms, the SVG zooms 1.7x over 1.9 s, and the
photograph cross-fades over it from 2.3 s (`mapPhotoMs` 1.5 s). Seen live it reads as "a map,
then a photo". It doesn't say **how far away** the place is, and that distance is the memory.

**The proposal, in four beats, inside the same ~3.8 s budget as today's reveal:**

| Beat | ms (start) | What is on the glass |
|---|---|---|
| 1 Home | 0 | A globe, centred on home, a small warm dot on home. Night side dimmed, not black |
| 2 Turn | ~300 | The globe turns along the great circle home → place, an arc drawing itself with it; the camera lifts a little mid-flight on a long hop |
| 3 Arrive + dive | ~1700 | Centred on the place, destination country lit gold, pin + ring land; camera closes in until the country fills the middle third |
| 4 Bloom | ~2300 | The photograph opens **out of the pin** (a soft radial reveal from the pin's screen point), not a cross-fade over the whole map; the year and place come in after it settles, as now |

- **The terminator is real**: the globe is lit for the photo's own moment (subsolar point from
  `localDateTime` + the place's offset). Riomaggiore at 18:41 in March has the line running
  through Liguria, so the journey quietly says "dusk" before the photo shows it. That's a pure
  function, so it can be unit-tested.
- **Night mode stays a wash**, exactly as today (`plan && !night`): no globe motion after dark.
- Short hops (NZ, Vanuatu) skip the lift; the turn is shorter, and so is the beat.
- Country-only photos (no point): the country lights, no pin, the bloom comes from the country's
  centroid (`mapPlan` already returns `precision`).

**Stills, 2026-11-14** (real three.js 0.187, the journey's own Natural Earth data, headless
software GL; scratchpad only, ⚠ they hold a family photograph and are never committed):
`1-home`, `2-turning`, `3-arrived`, `4-dive`, `5-bloom`, `6-settled`. Seen and judged:
- Works: the turn shows distance, the gold country reads at a glance, the pin bloom is clearly
  better than the full-wall cross-fade.
- ⚠ The lifted arc pokes out past the globe's limb on its way home (`3-arrived`). Fade the arc's
  far end, or clip it at the horizon.
- ⚠ The dusk band at the terminator reads as a vertical stripe at whole-globe zoom. Narrow it.
- The first dive tried was too deep (pin filled the wall, texture visibly blurred at a
  4096×2048 equirect). Stop at about one country across the middle third.

**How it's built (fits round 2, doesn't add to it):**
- **The same full-wall canvas as Phase C**, not a third WebGL context. The globe is one more
  scene on it; C's transition shader does the bloom (the pin's screen point becomes the wipe
  origin). Hence: **F needs C**.
- Globe texture: an equirect canvas drawn **once per page** from `journey-world.js` (already
  lazy, 56 KB), destination country re-tinted per reveal (repaint one country, re-upload). No
  Mapbox, no tiles, nothing leaves the house: same guarantee as today.
- Geometry: one sphere (128×96), one tube arc rebuilt per reveal and disposed, two small pins,
  a ring. `renderer.info.memory` must be back to the canvas's own baseline after each reveal.
- ⚠ **Home must not enter the public repo.** It's needed only to ~1° (it's a dot on a planet).
  Serve it rounded from the server, from the location the weather route already reads, never as
  a literal in `src/`. (Found while checking: `server/routes/fuel.js:28` already carries a
  4-decimal fallback latitude as a literal. Separate issue, owner's call.)
- `~/three-iife.js` on the box is TRIMMED (no `Texture`): the globe needs `CanvasTexture`,
  `SphereGeometry`, `TubeGeometry`, `CatmullRomCurve3`, `RingGeometry`. Check the trim before
  building, or the dynamic `import("three")` route C uses.
- Fallback: any failure (context lost, world chunk failed, texture not ready by beat 1) →
  today's flat SVG reveal, which stays in the code behind the flag-off path.

**Spec (when built):** globe canvas present during an overseas reveal (assert the node first);
the pin's projected screen point is inside the lit country's screen box; bloom origin equals
that point; AU, at-sea and night photos never start the globe; flag off never fetches the
chunk; memory back to baseline after the reveal; the terminator function against two known
dates (equinox noon at Greenwich → subsolar ≈ 0°,0°). Inject both directions: globe forced on
for an AU photo must go RED; globe forced off for a non-AU photo must go RED.

**Cost: UNMEASURED.** The Phase A spike measured a full-wall 2D dissolve at 30 fps (22.1 gpu
points). A 128×96 sphere + fragment lighting at 1920×1080 is more fill, for ~3 s, a few times a
day. Measure it in the Phase C canvas before promising 30 fps.

**Order:** owner's yes/no on the stills → C built and seen → F as its own flag, own deploy,
own owner's eye, then `/flag-flip`.

## Not in this plan
- Album glow, depth parallax (rejected), rain outside the card, beat reaction. (Globe flight
  moved to Phase F above, 2026-11-14.)
- Owner gates already queued by another session (`v3DogFx` flip, `v3DioramaNight`): this plan
  adds four more owner's-eye gates behind them, one per flag.

## Open risks
- The second WebGL context's cost is a HYPOTHESIS ("small") until Phase A measures it. If it
  is not small, C and D fall back to the stage canvas with a tracked quad, which is a bigger build.
- Golden hour in the field does not light the photo. If the stills say it must, that is a
  different (CSS overlay) design with a contrast cost.
