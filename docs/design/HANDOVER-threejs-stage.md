# HANDOVER — the three.js stage (dog glass effects + diorama with depth)

Planned 2026-11-13 on Fable 5.2, to be built on Opus 5.5. **Nothing here is built.**
Session state lives in memory (`project-threejs-dog-diorama-stage`); this file is the design.

## What the owner decided (2026-11-13, asked and answered; do not re-ask)

1. **Dogs: effects on the glass.** Today's peeks stay exactly as they are. three.js adds
   effects around them: a wet smear on a lick, nose fog on a boop, paw prints, and
   particles by occasion (snow, confetti, fireworks, bats).
2. **Diorama: the same picture, with depth.** The owner's illustration stays. It gains a
   gliding camera, walls that shift against the floor, light from the sun's real
   direction, a night look, headlights and rain.
3. **Dogs and house stay separate.** The dog art is front-on and the plate is top-down.
   They share the engine, never the scene.
4. **New art: as much as it takes.** The owner makes it in ChatGPT.

Standing rules that still bind (from memory, do not re-litigate): the dogs are never
rotated or reshaped (position and scale only); peek staging 37% / 63% and the 6 s hold are
signed off; run staging is signed off; the plate, cars and all coordinates stay out of
this public repo (`data/house-plan/` on the G11 only).

## What is built today (read 2026-11-13)

- **Dogs** — `src/v3/core/dog-occasion.js` (1,027 lines), DOM + CSS. Each frame is a
  window cut from a sprite sheet by `transform` + `clip-path`; frames are chained
  `setTimeout`s; there is deliberately no `requestAnimationFrame`. Overlay `.dogs` is
  appended to `<body>` at `z-index: 15` and removed after every show. 48 sheets, 7
  occasions, 84 MB. Only Christmas has a run sheet. Props (ball, bone) are painted into
  the frames.
- **Diorama** — `src/v3/core/diorama.js` (246 lines), DOM images + Web Animations. One
  flat plate (`plan-empty`, or a dressed plate), car cut-outs that slide in, CSS bins,
  the robot trail (`robot-layer.js`), a 6 s full-wall moment off the attention tick.
  Measured 60 fps median on the wall.
- **The field** — `src/v3/substrate/gl.js`, a hand-written WebGL shader. It holds the
  page's one WebGL context today and runs at about 15 fps (60 ms cap with the lift).
- **three.js is not a dependency.**

## The constraint that shapes everything: the GPU is charged per frame

`docs/audit/G11-GPU-CEILING-2026-09-22.md`: a full-panel layer costs about 0.13 to 0.21
gpu points per fps, largely independent of resolution; sustained ceiling 25%; live
ambient was 19.9 settled. So a second full-panel canvas at 30 fps is roughly 4 to 6
points on top of ambient, which is at or over the ceiling. **HYPOTHESIS until Phase 0
measures it:** the stage is affordable only if (a) it is capped near 30 fps and (b) the
field is held on its last frame while a stage moment plays. `gl.js` already has a
`paused`-shaped hold (see the comment near line 518); the diorama covers the whole wall
anyway.

## Architecture

- **`src/v3/stage3d/`**, reached only through a dynamic `import()`. three.js lands in its
  own chunk that is never fetched while both flags are off. That is what makes flag-off
  the build before this work.
- **One renderer for the life of the page, created on the first moment.** A WebGL context
  per popup (2 to 10 an hour, for weeks) is how a context leak happens. Between moments
  the canvas is `display: none`, the loop is stopped, and the scene is empty.
- **Scene contents are disposed after every moment**: every geometry, material, texture
  and render target. The proof is a number, not reasoning: `renderer.info.memory` must
  read `{ geometries: 0, textures: 0 }` after each moment. Expose it in `__v3().stage`.
- **The loop is `requestAnimationFrame`, capped, and alive only during a moment.** Every
  moment also has a hard `setTimeout` deadline that tears it down, because animation
  events and rAF do not fire behind `display: none`. `dog-occasion.js` keeps its own
  no-rAF rule; the stage is a separate module.
- **`webglcontextlost`** marks the stage dead for that page load and every caller falls
  back to today's DOM path.
- **Reduced motion:** no stage at all. The dogs' still portrait and the flat diorama are
  the reduced-motion forms.
- **CSP:** `script-src 'self'` holds because three is bundled; textures are same-origin.
  No workers, no eval, no CDN.
- **Pin three to an exact version** in `package.json`. Measure the chunk size in Phase 0
  (expect roughly 150 KB gzipped; unmeasured).

### How the dog effects meet the dog frames

- The stage canvas sits just above `.dogs` (z-index 16), full panel, transparent. Glass
  effects are in front of the dog by nature (the smear is on the glass).
- WebGL cannot read the page behind it, so the smear and fog are translucent sheens with
  highlights. They do not bend the photo behind them. Say this to the owner before they
  expect refraction.
- `dog-occasion.js` gets one optional hook: `onFrame(dog, drawnFrameIndex, rect)`, called
  from `paintFrame`. Null when the flag is off. With `v3DogSmooth` on, cues are keyed by
  the DRAWN frame (`artFor` already maps drawn index to smooth index).
- A new hand-authored `src/v3/core/dog-fx-cues.js`, shaped like `CHOREOGRAPHY`:
  occasion → dog → look → `[{ frame, effect, x, y }]`, x/y as fractions of the cell (the
  tongue tip, the nose, each paw). Read off contact sheets, one comment per cue. A look
  with no entry has no effect.

### How the diorama gets depth

- A **height map** for the plate, made offline on the PC, pixel-aligned with
  `plan-empty`, shipped by `scp` to `data/house-plan/plan-depth.webp`, and added to the
  `LAYERS` allowlist in `server/routes/housePlan.js` (with its contract test). The
  dressed plates are pixel-aligned with the plain one, so one map serves all of them.
- **HYPOTHESIS:** a usable map comes from thresholding the wall tops (they are near-black
  strips) plus a soft ramp for furniture. A monocular depth model is the second try.
  Either way the map is a greyscale image the owner can retouch.
- The plate becomes a subdivided plane displaced by the map. The camera glides in and
  drifts by a small angle (start at 8° or less): the picture has perspective painted in
  and a steep tilt will fight it.
- Cars stay as cut-out quads on the plane. Bins become small boxes. The robot trail is a
  line on the plane. The moment's length, triggers and "never at depth 3" rule do not
  change: `dioramaSee` still decides, and only `play()` chooses flat or deep.
- No depth file on the box, or a dead stage: today's flat diorama plays.
- **Night:** ask the owner for a pixel-aligned night version of the plate (same prompt,
  lights on) and cross-fade by sun elevation. That is cheaper and prettier than computing
  window glow from a mask. Headlights are a cone on the rolling car after sunset.
- Out of scope: the camera Zoom (`camera-plan.js`) and the day montage (`day-lapse.js`)
  keep the flat plate.

## Phases (each is its own deploy; flags default off)

| # | What | Flag | Gate to pass |
|---|---|---|---|
| 0 | Spike on the wall, nothing shipped: pinned three in a lazy chunk, an empty stage at 30 fps with the field running and with it held. Offline: try both height-map methods on the plate. | none | Measured gpu/renderer, heap, chunk size, context count. The owner sees one still of the displaced plate. Decide the fps cap and the field hold from the numbers. |
| 1 | Stage core + occasion particles over the peeks: snow (Christmas), confetti (birthday), fireworks (New Year), bats (Halloween). Easter, Australia Day and generic get none at first. | `v3DogFx` | Suite green in both flag states; inject-defect both directions; `/kiosk-metrics` over 40 forced shows: heap flat, `info.memory` back to zero, contexts constant. |
| 2 | Glass effects for the generic looks: lick smear (`lickscreen`), nose fog (`noseboop`), paw prints (`pawsup`). Needs the cue table. | `v3DogFx` (same) | Owner watches each look pinned on the wall, then `/flag-flip v3DogFx`. |
| 3 | Diorama with depth: displaced plate, camera glide, sun direction, rain on wet days, cars, bins, robot trail. | `v3DioramaDepth` | Owner's eye on an arrival and a bin night, forced; `/kiosk-metrics`; `/flag-flip`. |
| 4 | Night plate cross-fade + headlights. Needs the owner's night plate. | `v3DioramaDepth` (same) | Seen after sunset on the wall. |

Dates: Christmas season starts 3 December, so snow is the natural first debut. The 17
November birthday is too close for confetti to be verified and flipped safely.

## Phase 0 results (2026-11-13, measured; nothing shipped)

**Wall probe** (`~/stage-ceiling.cjs` on the G11, `field-ceiling.cjs`'s A/B/A /proc method, 60 s
windows, depth 0, archive on, real field paused by the cover rule, 18:02–18:12 AEST, psi10 0.00
throughout). three 0.187.0 bundled as an IIFE and injected over CDP; one renderer, transparent
full-panel canvas at z-index 16. Every probe row hit its fps cap (monotonic counter).

| window | gpu | renderer | fps got |
|---|---|---|---|
| control-1 | 12.3 | 8.5 | — |
| stage empty @30 | 14.9 | 13.5 | 30.0 |
| stage snow (2,000 points) @30 | 15.3 | 12.4 | 30.0 |
| control-2 | 12.4 | 10.5 | — |
| stage snow @60 | **19.3** | 16.5 | 60.0 |
| snow @30 + field stand-in @15 | 15.5 | 12.5 | 30.0 / 15.0 |
| field stand-in @15 alone | 13.0 | 11.0 | 15.0 |
| control-3 | 8.5 | 6.7 | — |

Against the bracketing controls (12.35): **@30 costs +2.6 to +2.9 gpu, @60 costs +6.9.** On the
September settled ambient (19.9) that is 22.8 at 30 fps (under the 25 ceiling) and 26.8 at 60
(over it). Adding the field under a 30 fps stage cost +0.2: the compositor is already producing
frames for the stage, and the field's frames come along with them.

- **Decided: cap at 30 fps** (`minGap = 1000/30 - 4` ms; a plain 33 ms gap loses frames to vsync).
- **Decided: no field hold needed for cost.** ⚠ The field row used `field-ceiling.cjs`'s
  byte-identical shader at z-index 0, not `#substrate` itself; at depth 0 the real field is
  already paused under the archive, and the diorama covers it. Re-measure if Phase 1 shows otherwise.
- **Lifecycle holds:** 34 moments on one renderer, `info.memory` `{0,0}` after every one, the
  context never lost, and no context warnings. Heap: three + renderer +1.2 MB; 30 moments +0.21 MB;
  back to baseline (6.19 vs 6.18 MB) after `destroy`.
- **Chunk:** everything Phases 1–4 import is **541 KB raw / 134 KB gzip** (esbuild, minified).
  Parsing it took 117–176 ms on the wall.
- 🔑 three sets `window.__THREE__` on load and warns "Multiple instances" on a second load. A cached
  dynamic `import()` loads it once; the probe saw the warning only because it injected twice.

**Height map, method A** (thresholds; script in the session scratchpad, not the repo): walls =
lum < 0.20 and sat < 0.35, closed by a 1.2 px blur; hedges = busy green × 0.45; furniture = soft
"differs from its surroundings" ramp × 0.18 inside the footprint. Walls come out clean, and the
window strips stay low. Flaws: **black sofas and the BBQ read as full-height walls**, and the
**right-hand fence edge looks torn**. A morphological opening to split them ate the thick outer walls,
so it was dropped. Both flaws are a retouch job for the owner. Rendered with CPU displacement plus
`computeVertexNormals` (`displacementMap` leaves the normals flat, so walls get no shading), a
750-segment plane, and scale 0.035 of the width. **Method B (monocular depth model): NOT tried**
because torch is not installed. Method A was good enough for the still, and a model trained on
perspective photos is a poor bet for a top-down illustration.

**Owed for the gate:** the owner's eye on the stills (8° = what would ship, 25° = exaggerated to
judge the map). They are in the session scratchpad only, ⛔ never in the repo.

## Phase 1 results (2026-11-13, `b8860d7`, DEPLOYED with the flag OFF)

Built: `src/v3/core/dog-fx.js` (flag, occasion → effect, the one `import()`, generation
guard), `src/v3/stage3d/stage.js` (the chunk: 523 KB / 131 KB gzip), two lines in
`dog-occasion.js`, `__v3().stage`, `window.dogFx`. Shapes are drawn in one fragment shader
(no textures). Effects: snow 260, confetti 220, fireworks 360 (bursts), bats 9.

- Spec `tests/v3-dog-fx.spec.js` (isolated project), 6 tests. It caught two real defects
  while it was being written: a dead stage still played (`ensure()` returned true for the
  lost renderer), and dormant fireworks sparks put NaN into the position buffer.
- Inject-defect: all six went RED for the named reason. They were: begin never called;
  flag ignored; reduced motion ignored; geometry not disposed; no deadline; no generation
  check. Every restore was proven byte-identical.
- Full suite: flag off 2696 passed / 1 skipped; flag on (temporary flip, restored)
  2696 / 1. `flag-reversibility.mjs` skips flags whose default is off, so the
  flag-on half was done by hand.
- **Live (G11, flag set on in the running page, then off again):** 40 forced peeks, 10 per
  occasion. Every one drew its effect (all particles, alpha 1), and `info.memory` was 0/0
  after each. There was one stage canvas throughout, no context loss and 0 exceptions;
  CSP showed 0 violations. Heap was 4.11 → 6.10 MB across the first 40 (the one-time
  load), then a second batch of 20 on the loaded stage went 6.10 → 6.22 MB with listeners
  flat (25 → 25), so per-show growth is flat. Snow was seen over the Christmas peek in
  a CDP capture. The probe is `~/fx-gate.cjs` on the box.
- Not done: the owner has not watched the effects on the wall. `/flag-flip v3DogFx` waits
  for that and for Phase 2 (the handover's order).

## Phase 2 results (2026-11-13, `e7b735e`, DEPLOYED with the flag OFF)

Built: `src/v3/core/dog-fx-cues.js` (occasion → dog → look → `[{ frame, effect, x, y, size, angle }]`,
read off gridded contact sheets of the drawn art). Only Benji has the three generic looks, so all
11 cues are his: lickscreen 4 smears (frames 3-6), noseboop 2 fogs (5, 6), pawsup 5 prints (5, 8, 9).
`paintFrame` reports every painted frame through `dogFx.frame()`; with `v3DogSmooth` on, `artFor`
now returns `keys` (smooth index of each drawn frame) so cues fire on the drawn key, never on an
in-between. The stage gained a dormant `glass` layer (24 slots) that `mark()` wakes; shape is now a
per-particle attribute. Marks are drawn in the shader, no textures: a light body plus a faint dark
edge. On a light-only first try, prints vanished over white fur and the fog vanished over the black
nose, so they would have read only over the photo.

- Spec: two new tests (smooth on / off): every cue fires, in order, on its kind, no earlier than
  its drawn frame's choreographed start, and lands inside the dog's box. Flag off with a cued look
  fires nothing, and the uncued `tennisball` look plays no moment. `v3-dog-smooth` asserts `keys`.
- Inject-defect, all RED for the named reason: raw smooth index (fired at 186 ms, before 445);
  marks never land (0 of 4); y not flipped (171 vs ≥515); cues for any look (tennisball moment);
  flag ignored for glass (flag-off test); keys off by one (dog-smooth). Every restore was clean.
- Full suite: flag off 2698 / 1 skipped; flag on (temporary flip, restored) 2698 / 1.
- **Live (G11, flag on in the page, then off):** 30 forced peeks cycling the three looks: bad 0
  (every show fired its full cue count, `info.memory` 0/0 after each), one stage canvas, 0
  exceptions, CSP 0. Heap 4.18 → 6.07 MB (the one-time three load, as in Phase 1); a second
  batch of 15 on the loaded stage went 6.06 → 6.10 MB, nodes 213 → 213, listeners 25 → 25. CDP
  captures of each look over the real photo: sheen across the tongue, fog on the nose, prints on
  the fur. Probe: `~/glass-gate.cjs` on the box; captures in `~/glass-gate/` (they hold a family
  photo, ⛔ never commit).
- Placement is approximate by design: the dog keeps rising after a mark lands, and the mark stays
  where the glass was touched.

**Owed:** the owner watches each look pinned on the wall
(`CONFIG.features.v3DogFx=true; dogOccasion.show("generic",{dogs:["benji"],looks:{benji:0}})`,
then 1 and 2), then `/flag-flip v3DogFx` before 3 December.

## Phase 3 results (2026-11-14, `v3DioramaDepth`, default off)

**First build (`a65719b`): REJECTED by the owner on the wall** ("it doesn't look good at all").
It did what the plan said: the plate lifted by the height map in the vertex shader, slope
shading in the fragment shader, a 6° tilt. On the real plate, every floor looked crumpled
(method A's furniture ramp), every raised edge smeared a white streak (a displaced vertical face
stretches a 1 px strip of the picture), and a black bar showed at the crop's edge. The cause is
the approach, not a tuning slip: **displacing a painted illustration smears it.** 🔑 The phase
had skipped its own gate. The owner never saw the Phase 0 stills before Phase 3 was built.

**Direction B (owner's choice, built after stills were approved):** the picture stays flat.
- **Wall shadows from the real sun.** The height map only says where the walls are
  (depth > 0.6, so furniture and hedges cast nothing). The shadow is drawn **once per moment**
  on a half-res canvas: 12 offset copies of the wall mask along the shadow direction, blurred,
  with the wall tops cut out. Length = 22 px ÷ tan(elevation), capped at 48 px; darkness 0.6;
  none at night. A first try marched toward the sun per pixel in the shader. It striped, and it
  cost 16 texture taps per pixel per frame for a sun that does not move in six seconds.
- **A push-in, never a pull-back.** Zoom goes from 1 to 1/0.92 over the moment, so the view
  never leaves the crop.
- **Cars:** the cut-outs, with a shadow cast away from the sun. **Bins:** drawn from above as
  `.diorama__bin` draws them, dropping in the same way. **Robot:** the run painted on a canvas
  over the plate. **Rain:** the stage's particle layer (`data-atmo-raining`).
- `stage.js` gained a `world` slot under the particles and an `owner`, so the dogs and the
  diorama never stop or replace each other. A refused deep moment plays flat.
- `window.__dioramaShow(moment)` plays a moment by hand with no candidate, so a live probe
  leaves nothing in the wall's log.

Spec `tests/v3-diorama-depth.spec.js` (isolated): 11 tests. Inject-defect 16/16 RED, both
directions where there is an off state (rain always/never, shadows by day/at night, flag
ignored, refused moment claiming it played). `v3-diorama` and `v3-robot-plan` pin the flag off.

**Owed:** the live gate on B, the owner's eye on a forced arrival and bin night on the wall,
then `/flag-flip v3DioramaDepth`. Phase 4 replaces the night tint with the owner's night plate
(received 11-14 in chat, portrait; it needs saving to disk, rotating and an alignment check).

## Art to ask the owner for (they said "as much as it takes")

- A night version of the house plate, pixel-aligned (Phase 4).
- A retouch pass on the height map if the generated one has holes (Phase 0 or 3).
- Optional later: run sheets for occasions other than Christmas; props as separate
  transparent images for thrown-prop gags. Neither is needed for Phases 0 to 4.

## Testing notes for the builder

- Assert stage STATE (`__v3().stage`: live, effect names, particle counts,
  `info.memory`), not pixels. Assert the node is there before asserting where it is.
- Three WebGL pages in parallel already flake (`v3-field-weather.spec.js:155`). Put the
  stage specs in the `isolated` project.
- Pin `v3DogFx` off in `v3-dog-occasion.spec.js` and `v3-dog-smooth.spec.js`, and
  `v3DioramaDepth` off in `v3-diorama.spec.js`, as `v3DogSmooth` was pinned.
- Every new flag must be read by a module V3 loads (`tests/flag-surface.spec.js`).
- Inject both directions: effect missing when cued, and effect present on a look with no
  cue or with the flag off.

## Not checked while planning

- No GPU, heap or bundle number for three.js on the G11 exists yet. Phase 0 is that.
- The height-map method is untested on the real plate.
- `robot-layer.js`, `camera-plan.js`, `day-lapse.js` and `dog-schedule.js` were not read
  in full.
