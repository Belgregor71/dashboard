# HANDOVER — the Live Photo motion burst on the V3 archive

Opened 2026-09-11 from the F1 flag census (family 4). **Owner's decision: build it.**
Blocked on two decisions below before any code. `ambientArchiveMotion` stays marked
`INERT-ON-V3`; `archiveMotionLoop` stays marked and out of scope.
`docs/design/AMBIENT-ARCHIVE.md:133-136` recorded why V3 left it out: "stay
incumbent-only pending this surface's own GPU reading."

## ▶▶ BOTH DECISIONS CALLED 2026-09-18 — read this before the sections below

**A. Warm the on-this-day pool.** ⚠ **This section's own premise below was
falsified by the live box.** It says most V3 frames would stay stills because
only daily-set photos are transcoded. Measured on the G11 the day the call was
made — `/api/immich/on-this-day`, 57 assets, **27 carrying `motionId` (47%)**,
against 91 clips already on disk at 41 MB and **zero `.none` tombstones**, i.e. a
100% transcode success rate. The supply is there and the encoder already works on
it. Sequential warm on the same lane as `warmSet`.

**B. The card stops for the burst.** ⚠ **The "never stops moving" premise below
is also stale**: `v3ArchivePlane` has been default-ON since the rebuild, and
`archive.css` sets `arch-pivot` to `animation: none` under it. What actually
moves at depth 0 is `arch-breathe` — **0.45deg** of yaw over 90 s on
`.archive__plane` — plus Ken Burns, which already settles after 96 s of a 600 s
rotation. So the clip's risk is an animated *ancestor*, not an animated *self*,
and the incumbent's measured 3.0–4.3-point guardrail is specifically about the
latter. The call: `animation-play-state: paused` on the plane and the top image
for the burst's ~3.6 s. Stopping a sub-degree rotation is imperceptible, it
sidesteps the untested ancestor case rather than betting on it, and it makes the
design statement **one thing moves at a time**.

⛔ Rejected, with reasons, so they are not re-proposed:
- *Move the burst outside the transformed subtree* — under the plane's lens the
  projected box is not the element box (`archive.css` records that trap), so a
  sibling positioned to the card is geometrically wrong.
- *Defer the burst past Ken Burns' 96 s settle* — a Live Photo's claim is that it
  is the moment the shutter fell; it belongs to the memory's arrival.

**HYPOTHESIS, not yet measured:** that a *paused* animation is as free as a
finished one. [[project-archive-kenburns-settle]] measured the finished case
(21.1 settled vs 21.5 suppressed); the paused case is inferred from it and needs
`/kiosk-metrics`. Headroom if the inference is wrong: depth 0 sits at gpu 21.1
against a live-ambient ceiling of 25, and a 3.6 s burst is a **peak** episode
(≤35), so even the full 4.3-point penalty fits.

### Shipped 2026-09-18 (server half only, COMMITTED — not deployed)

- `/api/immich/on-this-day` publishes `motion` / `motionPending` via the existing
  `publicPhoto()` and **strips `motionId`** — the leak recorded at the bottom of
  this file, confirmed live (`IMMICH_LIVE_MOTION=1` on the G11, the id was on the
  wire). `/random` and `/browse` leaked it too and now strip it as well.
- Pool warming behind a new **`IMMICH_POOL_MOTION`** env knob, AND-ed with
  `IMMICH_LIVE_MOTION`. Default off → not a byte fetched or encoded, and the
  route is what it was. Driven off the response with a once-per-day latch, not a
  second scheduler.
- `CLIP_MAX_BYTES` **48 → 128 MB in the same commit**, and the two must not be
  separated: the budget is shared with the daily set and `pruneClips` drops
  oldest first, so at 48 MB the pool's fresh clips would have evicted the daily
  set's — the incumbent screensaver silently losing motion from a change that
  never touched it.

⏳ **Still owed: the entire client half** — `v3ArchiveMotion`, the `<video>`, the
pause/resume, the teardown at step 4 below, and the `/kiosk-metrics` reading. The
server groundwork alone changes nothing on the wall.

## How the incumbent does it (`src/js/modules/ambientArchive.js`)

- Clip URL `/api/immich/asset/:id/clip` (`screensaver.js:201`); a frame carries
  `clipSrc` only when the server says `motion: true` (`:249`); `reconcileClips()`
  re-polls `/api/immich/daily-set` while any frame is `motionPending`.
- One `<video>` built only when the flag is on — `muted`, `playsInline`,
  `preload="none"`, **no `autoplay`, no `src` at rest** (`:695-713`).
- `armMotionBurst()` (`:539-598`): never on Mode-0 entry, never tender, never at night
  (checked in JS — "`display: none` on a <video> hides it and keeps decoding it"),
  never under reduced motion. `MOTION_START_MS 2800` (after the crossfade),
  `MOTION_HOLD_MS 3600` (> the server's 3.5 s clip bound), `MOTION_FADE_MS 600`.
- **Two plain timers, never `ended`/`canplay`/`transitionend`.** The reveal is inside
  `play().then(ok, noop)` and re-checks the timer. `stopClip()` = `pause();
  removeAttribute("src"); load()` — `load()` is what frees the decoder — on EVERY exit:
  next memory, Mode-0 exit, natural end, teardown, failed play.
- No `URL.createObjectURL` anywhere — the clip is a plain URL.
- Cost: renderer +2, GPU unchanged (`HOST-BASELINES.md:577`), decode in SOFTWARE
  permanently (`:584`); **a transform on a decoding layer cost 3.0–4.3 points**
  (`ambient-archive.css:255-258`).
- Server: `GET /api/immich/asset/:id/clip` (`server/routes/immich.js:297-309`, range
  requests, never reaches Immich); clips are transcoded ONLY for the daily set
  (`dailyMemories.js:135`), gated by `IMMICH_LIVE_MOTION=1`, capped 3.5 s / 48 MB.
  ⚠ Both halves of that last clause are now out of date — see the 2026-09-18 block
  at the top: the pool is warmed too (behind `IMMICH_POOL_MOTION`) and the cap is
  128 MB. Kept as written because the rest of this section is the incumbent's
  design, which is unchanged.

## Why it is not a contained port — the two decisions

**A. Where V3's clips come from.** V3's archive pool is `/api/immich/on-this-day`
(`ground.js:139,471`), ~116 raw assets with **no `motion` field** and, for most, **no
clip on disk** — only daily-set photos are ever transcoded. Options: warm clips for the
pool the V3 rotation will actually show (NAS load, disk, pruning), or accept that most
V3 frames stay stills and only daily-set overlaps ever move.

**B. V3's card never stops moving.** `.archive__card-wrap` runs `arch-pivot` (a
transform) and the top image runs Ken Burns (`archive.css:335,417`). A clip inside the
card decodes under a moving transform — the measured 3.0–4.3-point defect class. The
burst would have to pause the pivot and Ken Burns for its ~3.6 s, or sit outside the
transformed subtree.

## Port plan, once A and B are called

1. Server: on-this-day publishes `motion`/`motionPending` and strips `motionId`
   (reuse `publicPhoto()`); clip warming per decision A; contract test in `api.spec.js`.
2. `v3ArchiveMotion: false` in `src/js/config.js`, read per call; mark
   `ambientArchiveMotion` `· V3 lever: v3ArchiveMotion`.
3. `src/v3/core/archive.js`: `<video class="archive__clip">` only when the flag is on;
   `armBurst` / `stopClip` / `clearMotionTimers` driven from `present()`; start delay
   derived from `settleMs`, not a hard 2800 (a 1.2 s veto would start late); ignore the
   duplicate same-photo `onPhoto`; no burst on the first frame or after a DPMS wake.
4. **V3 has no archive teardown today** — `.archive` is only `visibility: hidden` above
   depth 0 (`archive.css:107`), which does not stop decode. Add an exported stop and
   wire it to `onDepth` in `main.js`, plus `data-panel-dark` and the night check.
5. CSS: `.archive__clip` opacity only — no animation, no transform (mirror the
   incumbent guardrail test).
6. Tests: mirror `tests/ambient-archive.spec.js:674-1143` (flag-off no video; burst then
   `src === null`; no burst on entry / at night / reduced motion; exit mid-burst releases;
   25 memories → DOM unchanged) plus depth-exit mid-burst, veto mid-burst, the portrait
   half-swap, and the duplicate `onPhoto`. Route the SSE streams to 204 or the clip
   request starves.
7. `/kiosk-metrics` before any flip — the +2 figure came from a 30 s rotation; V3
   rotates every 10 min, and depth 0 has no GPU reading of its own.

## Found on the way, independent of the port

✅ **FIXED 2026-09-18 — `motionId` leaked to the browser.** With
`IMMICH_LIVE_MOTION=1`, `/api/immich/on-this-day` returned raw `slim()` assets, so
the internal `motionId` reached the page unstripped — the daily-set route stripped
it. **Probed live and confirmed**: the switch IS on in the G11's `.env`, and the
response keys were `id,localDateTime,city,state,country,lat,lng,people,aspect,motionId`.

⚠ It was **three routes, not one** — `/random` and `/browse` map the same `slim()`
and leaked it too. Fixing only the route this note named would have left two
thirds of it open. `/random` and `/browse` get a bare strip rather than a `motion`
boolean: nothing warms those pools, so the boolean would be structurally false
forever, which looks exactly like a feature that is switched off.
