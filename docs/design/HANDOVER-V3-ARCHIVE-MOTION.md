# HANDOVER — the Live Photo motion burst on the V3 archive

Opened 2026-09-11 from the F1 flag census (family 4). **Owner's decision: build it.**
Blocked on two decisions below before any code. `ambientArchiveMotion` stays marked
`INERT-ON-V3`; `archiveMotionLoop` stays marked and out of scope.
`docs/design/AMBIENT-ARCHIVE.md:133-136` recorded why V3 left it out: "stay
incumbent-only pending this surface's own GPU reading."

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

⚠ **`motionId` leaks to the browser today.** With `IMMICH_LIVE_MOTION=1`,
`/api/immich/on-this-day` returns raw `slim()` assets (`immichClient.js:282,442`), so the
internal `motionId` reaches the page unstripped — the daily-set route strips it.
Not probed live: whether the switch is on in the G11's `.env`.
