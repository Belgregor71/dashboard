# HANDOVER — three.js ambient ideas (round 2): photo transitions + 5 more

Written 2026-11-14 on Opus 5.5 for a **planning session on Fable**. Nothing here is built,
and the owner has **not yet chosen** which of these to build. The planner's first job is to
get that choice, then plan only the chosen items.

Builds on `HANDOVER-threejs-stage.md` (dog glass effects + the depth diorama). Read its
"Phase 0 results" first: the costs below come from there.

---

## What already exists (reuse it, don't rebuild it)

| Thing | Where | State |
|---|---|---|
| One shared three.js stage: one renderer for the page's life, rAF capped at 30 fps, scene emptied after every moment | `src/v3/stage3d/stage.js` (`play(effect, deadlineMs, { glass, world, owner })`, `stop(owner)`, `state()`) | live |
| three.js `0.187.0`, behind a dynamic `import()` so a flag-off build never fetches it | `package.json` | live |
| The sky field: a WebGL substrate at a 15 fps ceiling, separate from the stage | `src/v3/substrate/gl.js` | live |
| Photo exchange: a CSS opacity cross-fade (2.6 s) then the Ken Burns settle (`arch-kenburns`) | `src/v3/core/archive.js`, `src/v3/css/archive.css` | live |
| Live-photo motion clip: starts at `settleMs + MOTION_START_PAD_MS` after an exchange | `archive.js` ~L1075-1150 | `v3ArchiveMotion` ON |
| Photo URLs are SAME-ORIGIN (proxied): `/api/immich/asset/<id>/thumb` | `src/v3/core/ground.js:115` | so a WebGL texture upload will not taint (verify at plan time) |
| Sun position / dayparts | `src/v3/core/sun-clock.js` | live |
| Rain state, gusts, humidity, the moon | `gl.js` uniforms (`uCauses`, `uMoon`, …) | `v3FieldWeather` + `v3FieldCauses` ON |
| Memory Journey map | `src/v3/core/journey.js`, `src/v3/css/journey.css` | `v3MemoryJourney` ON; ⏳ overseas map never seen live |
| Now playing | `src/v3/core/now-playing.js`, `src/v3/subjects/media.js` | live |

## Measured limits (G11, from Phase 0; don't re-measure for planning)

- Stage at 30 fps: **+2.6–2.9 gpu points**; at 60: +6.9. Ceiling 25%, ambient ~19.9
  (`docs/audit/G11-GPU-CEILING-2026-09-22.md`). **Anything that runs CONTINUOUSLY on the
  stage is the expensive kind.** Brief moments are cheap.
- Sky field under a running stage: +0.2. There's no need to hold the field still while the stage plays.
- 34+ moments on one renderer: `renderer.info.memory` back to 0 each time, heap flat.
  Every new effect must keep that proof (the live gates `~/depth-gate.cjs` /
  `~/glass-gate.cjs` on the G11 are the template).

## Lessons that constrain every idea below

1. **Displacing a flat image smears it.** Phase 3's height-map lift was rejected on the wall:
   lifted edges stretch a strip of pixels into streaks. So there is **no depth-parallax "3D photo"**
   on family photos. Keep images flat and do the effect in colour, light or opacity.
2. **WebGL cannot read the page behind its canvas.** An effect can only bend or refract an
   image that is *itself a texture in the scene*. Otherwise the most it can do is a translucent
   sheen, as the lick smear is.
3. **Bake the per-moment work once, never per pixel per frame.** Phase 3's per-pixel shadow
   march striped *and* cost 16 taps/px/frame. Drawing it once per moment fixed both.
4. **The stage has one owner at a time** (`owner` in `play`/`stop`). A new owner has to define
   what happens if a dog popup or a diorama moment arrives mid-effect.
5. **Show the owner a still before building**, and only build once they've said yes. Phase 3
   skipped this gate and the build was thrown away.
6. House rules apply: flag-gated and default-off, flag-off byte/behaviour identical, suite in
   both flag states, `/inject-defect` in both directions, live gate, owner's eye, `/flag-flip`.

---

## 0. Photo transitions: Opus verdict **YES-BUT**

**What it is:** for the 2.6 s of an exchange only, the stage draws old→new photo as two
textures with a shader dissolve, then hands back to the normal DOM `<img>` and the Ken
Burns settle. Between exchanges it costs nothing.

**Three looks to show the owner as stills/clips:**
- **Developing print:** the new photo comes in by its own brightness, highlights first and
  shadows last, like a print developing in a tray. Different every time, calm.
- **Light leak:** a warm film-burn bloom crosses the old photo and leaves the new one.
  Kept for occasion photos (birthday lean, on-this-day) so it stays special.
- **Sun wipe:** a soft edge sweeps in from the real sun's direction (`sun-clock.js`).

**Rejected:** depth parallax / "3D Ken Burns" (lesson 1, and the G11 has no torch to run a
depth model).

**Questions for the plan:**
- The hand-off from GL to DOM must not flash: same crop, same Ken Burns start transform,
  same pixel. The settle begins as the texture leaves. How is that proved in a spec?
- What happens to the caption/word swap timing (`EXCHANGE_SWAP_MS` is a *ratio* of the
  cross-fade, see `archive.js` ~L275-305) and the motion clip's start, which is derived from `settleMs`?
- What happens on a veto exchange (1.2 s, not 2.6 s)? And under reduced motion (plain fade)?
- What happens if the stage is busy (a dog moment)? The probable answer is to fall back to the CSS fade.
- Texture memory per exchange is 2 photos at the thumb size: dispose both, then prove `info.memory` 0.

**Suggested flag:** `v3PhotoTransitions`.

## 1. Rain on the glass

**What it is:** only while the field says it is really raining, drops form and run down the
screen and **refract the photo behind them**.

**Dependency:** lesson 2 means real refraction needs the photo as a texture, so this
**depends on item 0's photo-in-GL plumbing**. Without that it can only be a sheen. Opus
recommends building items 0 and 1 as one arc for that reason.

**Cost risk:** rain can last hours, so this is a *continuous* stage load, the expensive
kind. The plan needs a budget: lower fps (drops are slow, so 15 may be enough), fewer
drops, or bursts rather than constant running. Measure on the G11; don't assume.

**Suggested flag:** `v3RainGlass`.

## 2. Golden-hour light

**What it is:** for roughly 40 minutes either side of sunrise and sunset, soft light shafts
and slow dust motes cross the wall at the real sun's angle, and fade out with the light.

**Notes:** this is time-boxed, so cost is bounded. Cloud cover should dim or skip it, so
read the same causes the field reads. Check it against the contrast sweep: text over a
brightened band must still pass. It could be a field layer (`gl.js`) instead of a stage
effect. The planner should say which and why.

**Suggested flag:** `v3GoldenHour`.

## 3. Cold-morning glass (condensation / frost)

> Replaces the "real moon" idea Opus first pitched in chat: **the moon already exists**,
> drawn at its real place and phase with moonlight on the cloud rims (`gl.js` ~L236,
> `uMoon`, `v3FieldCauses` ON). Don't plan it again.

**What it is:** on a cold or humid morning (outside temperature and humidity from the
weather feed), a faint mist or frost sits on the glass edges and clears as the day warms
or the sun comes up. It's driven by real data, so it says something true about outside.

**Notes:** it should stay at the edges and never sit over text (contrast sweep). It is a
slow overlay, so it can be one baked texture with an opacity curve, not a running
simulation. The thresholds need the owner's call (how cold counts as "cold" here).

**Suggested flag:** `v3ColdGlass`.

## 4. Globe flight for overseas memories

**What it is:** when the Memory Journey shows an overseas photo, a globe turns and flies
from home to the photo's place, then fades into the photo.

**⚠ Gate:** the current flat overseas map has **never been seen live**. Get the owner's eye on
that first. This item replaces or extends it, so planning it blind risks redoing the
journey twice.

**Notes:** the public repo must not carry the home location. Read it at runtime from the
existing config path the journey already uses. Coastline data size matters for the chunk;
measure it.

**Suggested flag:** `v3JourneyGlobe`.

## 5. Album-art glow

**What it is:** while music plays, the cover's dominant colours bleed slowly into the wall's
light, and the cover sits with a slight tilt and a soft reflection.

**Notes:** **not beat-reactive**, because the kiosk does not receive the audio. Pull the
colours once per track, not per frame. Cover art must be same-origin or proxied to sample
it (check). Music can play for hours, so like item 1 this is continuous: budget it, or
make it a CSS/field tint with no stage at all. The planner should consider the no-three.js
version first.

**Suggested flag:** `v3AlbumGlow`.

---

## Opus's recommendation (the owner decides)

1. **Items 0 + 1 as one arc.** They share the hard part (the photo as a texture, the GL↔DOM hand-off).
2. Item 2 or 3 as a cheap standalone.
3. Item 4 only after the flat overseas map has been seen live.
4. Item 5: try the no-stage version first.

Owner's pending queue at the time of writing: `v3DogFx` flip and Phase 4 `v3DioramaNight`
(another session is handling both). Don't stack new owner-eye gates on top without saying so.
