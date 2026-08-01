# The Ambient Archive — calm law v3

> Source: *The Day, Rendered — Proposal v2* §11 (Claude Design, July 2026) and
> `Ambient Archive Screensaver.html`, answering `BRIEF-AMBIENT-2030.md`. Built from
> `HANDOVER-AMBIENT-ARCHIVE.md`, which stays as the record of the two owner decisions
> and the traps. **This file is the implementation authority for what shipped.**
>
> Flag: `features.ambientArchive` · default **on** since 2026-08-02 · one-line revert.
> Companion: `TEMPORAL-SPINE.md` (the day, rendered flat, which this absorbs in Mode 0).

## The idea

Mode 0 stops being "a photo with a clock on it" and becomes **the archive**: the memory
as a lit card pivoting slowly in a deep instrument space, a desaturated tiled echo of
itself behind, between two ruler planes at different depths.

> **the far plane is the years · the near plane is today**

One instrument, two readings, and the depth between them is **literal** — the years are
further away than today, because they are.

## What this rests on

Two owner decisions, both 2026-08-01, recorded in the handover:

1. **The ambient surface may move in an empty room.** Supersedes "0% unoccupied" for
   Mode 0 only. `DESIGN_SYSTEM.md` §0.1 had already repealed the law it came from.
2. **The Mode-0 clock is demoted** to a 64 px corner numeral. Supersedes the standing
   "keep clock size" preference **for Mode 0 only** — the awake top-row time
   (`bareTopRow`) and every other clock are untouched.

And three from 2026-08-02, after the first build was seen on the panel: **two planes not
a stack of rows**, **the plate always speaks**, **amplitude roughly doubled** (below).

## Geometry

The scene is one fixed 1920×1080 stage, `scale(min(iw/1920, ih/1080))`, centred — the
reference's own fit. Design for the wall; it letterboxes rather than reflowing.

| Element | Spec |
|---|---|
| Plane | `rotateY(-12deg) rotateX(8deg) rotateZ(2deg)`, `perspective 1400px` at `50% 42%` |
| Ruler plane | the same with roll cut to **0.8deg** (`--arch-deck-plane`) — see "what changed" |
| `.archive__echo` | ×2 (crossfaded). 2900×1800 at (−420,−340), tile 620×349, `grayscale(1) brightness(.17) contrast(1.18)`, `translateZ(-280px)`, drift **130 s** |
| `.archive__ruler--years` | canvas 2160×200, line at frame y **96**, `translateZ(-150px)` — the reference's `#strip1` slot |
| `.archive__ruler--today` | canvas 2160×320, line at frame y **904**, `translateZ(-40px)` — `#strip2` |
| `.archive__ghost` | the memory's year, 400 px display, `rgba(238,243,251,.055)` + 1px stroke, `translateZ(-190px)`, drift **92 s** |
| `.archive__word` | "ARCHIVE" vertical, left −58, 150 px, ink .045 — the reference's `#gword` |
| `.archive__card-plane` | **(130, 212) 1040×585**, `translateZ(40px)` — the reference's own card |
| `.archive__card-wrap` | pivot **84 s**, `translateZ(0 → 52px × gain)` |
| `.archive__img` | ×2 (crossfaded 2.6 s). Ken Burns **96 s** → `scale(1 + .075 × gain)`, visible slot only |
| `.archive__plate` | right 110, top 356, w 470. Rows `rgba(5,9,20,.72)` pad 14/22 |
| `.archive__vig` | `radial-gradient(1700px 1050px at 42% 44%, transparent 58%, rgba(2,4,10,.66) 98%)` |
| `.archive__grain` | static SVG `fractalNoise` .9 / 2 octaves, opacity .055, overlay |
| Clock | the existing `.screensaver__content`, repositioned to (108, 56) at 64 px |

**Axes.** The hour axis spans the frame's 108 px safe margins — the spine's own geometry,
so 05:00 and 24:00 land in the same place on both surfaces. The year axis runs frame x
**380 → 1812**, deliberately *not* sharing that margin: different plane, different
quantity, and the corner clock owns the top-left.

## The two planes

| Plane | Carries |
|---|---|
| **Far — the years** | the 21 px ruling, a taller tick per year, the year numerals, and the card's own year lit warm with a riser. This is the only thing on this plane that points at the photograph. |
| **Near — today** | the minute ruling, the four hour numerals, marks rising as anticipation, embers behind them, and **now** as the brightest point |

`dayModel.js` is reused unmodified. The archive's own pure decisions — which years the
shelf spans, and what the plate may say — live in `services/archiveModel.js`, the same
split `dayModel.js`/`temporalSpine.js` already use.

The source readers moved out of `temporalSpine.js` into `modules/daySources.js`. Two
renderers, one day — if the spine and the archive could disagree about what happened
today, the instrument would be lying about which reading is true.

### The shelf always reaches the lit year

`yearSpan()` gives at least a decade and always extends back far enough to contain the
memory on the card. **A lit year off the end of its own ruler is the one thing this
instrument must never do**, and the album reaches back much further than ten years, so
that is the common case rather than the edge one.

### The hour a photograph was taken

`hour` rides the Daily Memories set (`photoMemory.localHourOf` → `selectDailyMemories` →
`/api/immich/daily-set` → the screensaver's frame). It is plumbed through and available;
the current renderer does not place a mark with it, because the years are an axis now
rather than rows sharing the hour axis. Kept because it is the honest field to have.

⚠ `localDateTime` carries a trailing `Z` it does not mean. Reading it through `Date`
shifts a 9 am photo to 7 pm in Brisbane. `localHourOf` reads the fields, exactly as
`localMonthDay` already does.

## Motion — how this passes law 1

`DESIGN_SYSTEM.md` §0 law 1: *never move for a reason the room can't see.*

- **The cause is `body.fx-archive-active`**, set on Mode-0 entry and removed on exit.
  Every loop in `ambient-archive.css` hangs off it, so leaving Mode 0 switches the
  surface **off** rather than hiding it. The cause is nameable by anyone in the room:
  *the house is leafing through its album*.
- **Too slow to catch.** Pivot 84 s, drift 130 s / 92 s, zoom 96 s. Only the memory
  exchange and its 300 ms blur are catchable, and both are *events with ends*.
- **Amplitude** = `--arch-gain` × the `--clock-dim` curve (§5.2). Gain is **2** — the
  owner's 2026-08-02 call after the reference's own amplitude proved invisible on the
  wall. Periods never scale; a slow effect that still travels far is what wakes someone
  up. **`--arch-gain` is the one number to turn** if the wall wants more or less life.
- **⚠ Neither ruler moves.** The reference drifts its strips ±80 px, which was fine when
  they were decoration. Both planes carry an axis now: ±80 px on the hour ruler is a
  ~50-minute lie and on the year ruler it is most of a year. Those keyframes are
  deliberately absent, and a test asserts it.
- **One object lives.** Particles, twinkle and dust-motion stay banned; the grain is
  **static**.
- **The archive never breathes.** The now-point's breath is bound to media playing **and**
  someone in the room, which in Mode 0 is false by definition.
- **Compositor-only.** No `requestAnimationFrame`, no WebGL (there is no WebGL pipeline
  in this repo to inherit — that claim in §8/§11 describes v1's *proposal*, not shipped
  code), no per-frame allocation.
- `prefers-reduced-motion: reduce` switches all of it off.

## What the archive takes over in Mode 0

| Surface | Under `fx-archive-active` |
|---|---|
| `#temporal-spine` | `display: none` — hidden, never deleted. **This is the rollback path, and it costs one CSS rule.** |
| `.screensaver__photo-bg` | hidden; the echo is the memory now |
| `.screensaver__overlay` | **kept** — it carries the atmosphere tint, and borrowed light is a composition law the archive does not opt out of |
| `.screensaver__content` | repositioned to the top-left corner, clock at 64 px |
| `.screensaver__info` / `__footer` | hidden — nobody is home, and the awake queue owns those words |
| `.screensaver__place` | hidden; its caption **moves into the plate** |
| `.screensaver__memory` | hidden — the plate says "On this day · 2022" now, so the whisper would be the house saying it twice |
| the plate, at night | hidden outright, exactly as the Daily Memories caption already is |

### The plate is relocated language, never new language

`year · place · who` is the caption `dailyMemories` and the vault×Immich relationship work
already render in Mode 0. `captionParts` is the inverse of `captionFor`.

**Most of this library has no GPS and no named faces**, so the caption is very often a
bare year — on 2026-08-02 it was the whole day's frozen set. The plate still speaks: the
title falls back to *"Four years ago today"*, the year said in words. That is not invented
data (the year is already a 400 px engraving behind it) and it is the phrasing
`buildOnThisDayMemory` already uses. **No year at all → no plate**: silence is the default.

**A tender memory reaches the wall with no plate**, enforced three ways: `toSurface` sets
`caption: null`, the tender lane passes `{ tender: true }`, and the archive refuses either.

## Memory discipline

- **Nothing is allocated per mark, per year or per memory.** Two ruler canvases, two card
  images, two echo planes, one plate — all created once in `build()`.
- The exchange's staged swap is a **`setTimeout`**, never `transitionend` — which never
  fires while an ancestor is `display:none`, i.e. most of the day.
- `stopAmbientArchive()` is symmetric with the Mode-0 entry; `stopAmbientArchiveAll()` is
  the full teardown.
- No `URL.createObjectURL` anywhere — nothing to revoke.

## Verification

- `window.__archive()` — the shelf's span, the lit year, `nowHour`, the mark count, the
  live `--clock-dim` and `--arch-amp`, the plate (or `null`, which is the tender invariant
  readable from outside), the ghost year, the photo on the card.
- `window.__ssSetFrame({ src, caption })` — put a specific memory up. The Pi cannot wait
  for one to come round.
- Tests: `tests/ambient-archive.spec.js` — the pure shelf + plate model, the four handover
  traps (blank rule → **paint**, cause binding, tender-no-plate, no dimming opacity over
  text), the clock demotion, the card's size, the two-plane depth, and DOM flatness.

## What changed from the reference, and why

| Change | Why |
|---|---|
| `#strip2`'s year ruler **becomes the hour axis**; `#strip1` **becomes the year ruler** | §6.1's collision is "the same screen region, perpendicular meanings". The reference already solves that its own way: two planes 800 px apart. Years far, today near — the spatial metaphor and §6.2's "depth is literal" both survive |
| **No strip drift** (`s1`/`s2` gone) | Both planes carry an axis now, and a sliding axis lies about what it measures |
| Ruler roll **2° → 0.8°** | 2° is 36 px of diagonal across the 1040 px card and 75 px across a 2160 px ruler — enough that the ruler stops reading as tilted and starts reading as wonky |
| Plate `who`: 16 px / ink .48, bare over the photo → **19 px / ink .72, on the plate's own backdrop** | Exactly the shape §4.5 warns about — the spine's third label hit 1.96:1 that way |
| Plate title **falls back to "N years ago today"** | Otherwise the plate is absent on most days, because most photos have no place |
| Motion amplitude **×2** | The reference's own amplitude was invisible on the wall; owner's call 2026-08-02 |
| Ken Burns runs on the **visible slot only** | The hidden image would composite for nothing, and a fresh memory earns a fresh move |

## History — the first build, and what the panel said

Built 2026-08-01 to §6.2's letter: the years as **six ruler rows receding in Z**. Shipped
flag-off (`7ef1f18`), flipped on (`baf08f8`). The panel rejected it within the hour, and
the reasons are worth keeping:

- **The recession did not read as recession.** Perspective pulls each further row's left
  end rightward, so the eye joined five faint lines into one diagonal running bottom-left
  to top-right. It looked like a broken timeline, not depth.
- **It cost the photograph.** Six stacked rows needed so much vertical room that the card
  shrank to 1040×585 → 760×428 — **53% of the reference's area**. A screensaver whose
  photograph is not the focus has lost the argument.
- **A bare-year caption dropped the year entirely** (`f0f9747`). `captionParts` correctly
  returned null with no place, but `litYear` was derived from those parts, so the ghost
  and the year-line went dark too — and that was 100% of that day's set.

The lesson is the handover's own §8: *"Do not flip this one on before seeing it."* The
flag had to be flipped to see it at all (a flag-off build renders no archive), so the
inversion was unavoidable — but the fix arrived within the hour because someone looked.

## Still open

- **The soak is the deliverable**, not an afterthought: `heap-flat over 72 h + fps
  constant`. Run `/kiosk-metrics` at 0 h / 24 h / 72 h and write the numbers into
  `docs/audit/HOST-BASELINES.md` as a new **live ambient** row (§5.4, ≤25% sustained) —
  it is currently unmeasured, and the amplitude ×2 makes it more interesting, not less.
- **Judge the yaw on the panel.** The −12° rotateY foreshortens the hour axis, so morning
  reads narrower than evening. `--arch-deck-plane` is the one-line lever.
- **The echo can read as visible tiling on a bright photograph.** `brightness(.17)` is the
  reference's number and it assumes a fairly dark frame.
- **Test fallout at flip time** (§6.5) was never needed — the specs asserting the old
  Mode-0 surface all passed unchanged, because the archive preserves what they check
  (tabular figures, the meridiem, the whisper's own element).
