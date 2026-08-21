# The Ambient Archive — calm law v3

> ## ⛔ EVERYTHING BELOW DESCRIBES THE INCUMBENT SURFACE, WHICH IS NOT ON THE WALL
>
> **`/` has served V3 since the cutover, V3 has no screensaver, and there is no Mode 0.**
> The archive described in this file — `src/js/modules/ambientArchive.js` and
> `src/css/views/ambient-archive.css` — renders only on the incumbent dashboard, which
> nothing loads. `features.ambientArchive: true` is therefore true of a surface nobody
> sees, and it is why `archiveMotionLoop` has been "not assessable" for weeks.
>
> **The V3 rebuild is `src/v3/core/archive.js` + `src/v3/css/archive.css`, behind
> `features.v3Archive`.** Read [the V3 rebuild](#the-v3-rebuild-2026-08-18) before this
> file's geometry tables — most of them still hold, two of them deliberately do not, and
> one of them ("the year has no ruler") has been **reversed by the owner**.
>
> This file stays as the implementation authority for the *decisions*, the traps and the
> history. It is no longer a description of anything on the glass.
>
> Source: *The Day, Rendered — Proposal v2* §11 (Claude Design, July 2026) and
> `Ambient Archive Screensaver.html`, answering `BRIEF-AMBIENT-2030.md`. Built from
> `HANDOVER-AMBIENT-ARCHIVE.md`, which stays as the record of the two owner decisions
> and the traps.
>
> Flag: `features.ambientArchive` · default **on** since 2026-08-02 · incumbent only.
> Companion: `TEMPORAL-SPINE.md` (the day, rendered flat, which this absorbs in Mode 0).

## The V3 rebuild (2026-08-18)

Flag `features.v3Archive`, **default off**, not yet seen on the wall.

The archive stops being a screensaver and becomes **depth 0** — V3's resting wall, which
until now was a full-bleed photograph with the hour on it. There is no Mode 0 to enter and
no idle timer: `DEPTH.FIELD` *is* the resting state, so the composition is simply what the
wall looks like when nothing has pushed it deeper.

### The owner's five calls, and they are settled

Raised 2026-08-18 on the two reference frames, against the surface that shipped:
*"I was never quite happy with the layout. The background tiles were too many. The year
rail got lost on the screen."*

| | Call |
|---|---|
| **Where** | Replace depth 0's look. `ground.js` keeps the pool, the latch, the dissolve and the veto; the archive is a frame around it and owns none of its elements. |
| **The ghosts** | **TWO large ghosts**, ~1060 and ~810 wide, bleeding off opposite edges, drifting on co-prime periods. Not ~30 tile repeats of a 2900×1800 plane. |
| **The year rail** | **Back, and bold.** One strip, year numerals, red registration marks. The hour axis is **not** ported — one axis, and it is years. |
| **The hour** | Unchanged: 168px, bottom-left. The strip takes the *high* band instead, which at depth 0 is empty. |
| **Above depth 0** | The archive recedes to today's full-bleed photograph. One opacity cross-fade each way. |

### ⚠⚠ The year rail is the THIRD, and this file told you not to build it

"The year has no ruler" below records two rejected builds and says a third is furniture.
**The owner has reversed that**, having looked at the references again. Do not re-argue it
from this file — but do understand why this one is not those two, because that reasoning is
the constraint on any future change to it:

- **Build 1** drew the years as six rows receding in Z. **Build 2** drew them as a legible
  shelf on a far plane. Both restated a year the wall already gave twice, and both took
  vertical room from the photograph — build 1 cut the card to **53% of its area**.
- **This one carries information the wall does not otherwise have**: the years *this
  calendar date* reaches in the library, with the card's own year lit. "This date lives in
  2011, 2015, 2019 and 2023; you are looking at 2019" is not a third telling of the
  engraved numeral. The years come from `ground.poolYears()` — the **adopted pool**, never
  a second fetch, so the strip cannot light a year the card can never reach.
- **It costs the photograph nothing.** It takes the top band, which at depth 0 holds
  nothing, and the card keeps its full 1040×609 box. A spec measures the painted boxes.
- **It is bold enough to be read**: labels at `--t-rail` (32px) and the lit year at 48px,
  against the shipped rail's 22px mono. "It got lost" was partly a size problem.

**⚠⚠ AND ITS RIGHT-HAND END WAS OFF THE GLASS UNTIL 2026-08-20.** The axis endpoints were the
one part of this geometry derived in canvas space (`MARGIN - STRIP_LEFT`) rather than measured
against the projection, and the strip is a canvas on the deck plane under the scene's 1400px
perspective: it compresses the middle (canvas 1080 lands at frame 962) and flares the ends, so
canvas 1932 is frame **1912** — eight pixels from the edge — not the intended 1812. Because the
pool's newest year is *always* the axis maximum, every memory from the most recent year had its
48px lit label painted half off the screen. Reported as *"the highlight marked 2023 correctly
but because 2023 is at the extreme right it didn't look correct"* — a clipped label, not a
scaling choice.

The endpoints are now probed values (canvas **320 → frame 298**, canvas **1689 → frame 1614**)
with deliberate headroom past the safe margins, so ~250px of ruled line runs beyond the
outermost year at each end and off the glass. The ruling is unchanged, still painted edge to
edge. A spec projects the endpoints through a probe carrying the strip's own transform and
asserts the whole lit label clears the margin — a canvas-space unit test cannot see this class
of defect, and the one that shipped asserted the wrong numbers with the wrong reasoning in its
comment.

**What the axis does NOT do is scroll.** It rescales to the pool's minimum and maximum, so the
oldest year this date reaches is always at the left end and the newest always at the right. A
1973 photograph would put 1973 at the left end and compress 2011–2023 into the right quarter;
a 2026 one simply becomes the new maximum. The gaps stay true — that is the whole argument for
placing years by value — but the ends are always occupied by definition, which is exactly why
they need headroom rather than margins.

### What carried over unchanged, and what did not

**Unchanged:** the plane (`rotateY(-12) rotateX(8) rotateZ(2)`, perspective 1400 at
50%/42%), `cardRectFor()` from `services/archiveModel.js` — so a 16:9 memory lands on
**1040×585 at (130, 212), to the pixel** — the plate's shape and its "always speaks" rule,
the vignette, the static grain, and the motion periods.

**⚠ The ghost crush was on that list and is NOT any more (2026-08-20).** `grayscale(1)
brightness(.17) contrast(1.18)` came over unchanged from a surface that drew ~30 tile repeats
of one plane, where it read as texture. On TWO ghosts 1060 and 810 wide the identical numbers
read as two black rectangles — *"it's good for them to be subtle but really can't see them"* —
so the brightness is now `--arch-ghost`, **default 0.22**, turnable live with
`window.__archiveGhost(n)` and bounded at 0.6. The grayscale and the contrast are the
reference's and are not on trial.

**0.22 is the owner's call off an A/B on the wall**, and 0.30 was the first attempt at it.
Same 2017 photograph, seconds apart, both at depth 0: at 0.30 the bottom-right ghost reads as
a *second photograph* and the composition becomes three pictures competing; at 0.22 the card
is unambiguously the subject while the ghosts keep their structure. ⚠ Judge any future change
on a **bright** memory — that frame was a sunlit street, about as light as this crush can make
a ghost, and a dark one sits further back at the same setting.

The crush's ceiling is load-bearing, not decorative: it is why the plate over ghost a needs no
scrim of its own, and the plate's contrast spec is the gate on how far this can be pushed.

**⚠ There are FOUR loops at depth 0, and a FIFTH animation that ENDS** (amended 2026-08-20,
`b6a7d86`) — ghost-a 130s, ghost-b 104s, the engraved year 92s, the card's pivot 84s, and
Ken Burns 96s **as a settle**: `1 forwards`, once per photograph, coming to rest. It looped
until it was measured, and it alone cost 6.3 points of gpu-process — more than the whole
amount by which depth 0 was over §5.4's ceiling. Settled, depth 0 reads 21.1; during the move,
27.3. The incumbent ran four loops because its background was one tiled echo; this one has two
ghosts. **After dark it is three loops**: the night rule takes the engraved year to opacity 0
and its drift is gated off with it. Both numbers matter — a soak reading `anims` against a
wrong expectation is a wrong reading — and `anims` is no longer the one to read, because it
counts the settle while it runs (5 mid-move, 4 at rest). `__archive().loops` counts only what
never ends, and this was counted
off `document.getAnimations()` on the real wall rather than off the stylesheet.

**Deliberately not ported:** the hour axis and its `dayModel`/`daySources` chain (the strip
means years now), the 30s repaint interval (nothing left is time-driven), and the Live
Photo burst — `ambientArchiveMotion` / `archiveMotionLoop` stay incumbent-only pending
this surface's own GPU reading.

**New, and both are things the incumbent wanted and never had:**

- `:not([data-panel-dark="1"])` on every loop. DPMS fires no `visibilitychange`, so the
  shipped archive ran its four animations all night to a dark panel.
- `--arch-gain` has a **writer** (`window.__archiveGain(n)`), turnable on the kiosk over
  CDP without a deploy. It previously existed only as a `2` fallback inside a `calc()`
  with nothing setting it, so "the one number to turn" could not be turned.

### ⚠ It contradicts a written law, and the amendment shipped with it

`compose.css` and `DESIGN_SYSTEM.md` §5.4 both put depth 0 in the **quiescent** band, ≤8%
of one core, with "anything that animates here is a bug". Four continuous loops move it to
**live ambient**, ≤25% sustained. That is legal under law 1 as rewritten — the cause is
nameable by anyone in the room, *the house is leafing through its album* — but both places
now say so explicitly, because a shipped surface that contradicts a written law silently
repeals the law. **The reading itself is owed and is not optional.**

### What the wall said when it was driven, 2026-08-18

Deployed flag-off (a **proven** no-op on the panel: 0 children, no marker, no hook,
`__ground().layers` still 1), then looked at flag-on over CDP without flipping the default —
a `window.CONFIG` setter installed via `Page.addScriptToEvaluateOnNewDocument`, which is the
only way to see a boot-time flag without shipping it. Against the **live library**:

- **Eleven years on the strip** — 2011, 2013–2019, 2021–2023 — with 2012 and 2020 genuinely
  missing from this date. That gap is the argument for placing labels by **value**: an
  evenly-spaced comb would have claimed two years the library does not have.
- The memory up was a **portrait**: card `457×609 @ (130, 200)`, fit to the print exactly.
  ⚠ That is 45% of the reference's width, and *"the photograph is the point of a
  screensaver"* is what killed rejected build 1 — **the first thing to judge on the panel.**
- Strip `top 5 → bottom 187` against a card top of `197`. It clears, by ten pixels, on a
  real portrait card. The margin is thin by design and a spec measures it.
- `ghosts 2 · slots 4 · nodes 24 · groundLayers 1` — fixed allocation, ground's metric intact.
- **Depth 3 was up at one point and `anims` read 0.** The cause-binding, observed on the
  glass rather than asserted: something arriving switches the loops *off*, not out of sight.

⏳ **No verdict screenshot was taken, deliberately.** The look landed at 17:47 AEST with the
sun at −4.89° — night had just engaged, and the plate and engraved year hide at night by
design, so a capture then shows an empty right two-thirds and overstates the problem. **Judge
it in daylight.**

### Traps this rebuild found or inherited

- **⚠⚠ THE REBUILD TOOK THE CROSSFADE AND LEFT THE BLUR** (found 2026-08-22, on the
  owner's report that *"I don't see any animation except a really clunky slow
  transition"*). Two separate omissions compounding, and the second is the one that
  hid the first:
  - `.archive__card.is-exchanging { filter: blur(16px) brightness(0.8) }` shipped in
    the incumbent and was **never ported to V3** — `is-exchanging` appeared nowhere in
    `src/v3/`, and `archive.css` contained no `blur` at all. This document already
    named the blur as one of only **two** catchable things on the surface, so its
    absence did not merely cost polish: it left depth 0 with **no perceptible motion
    whatsoever**, everything else here being deliberately sub-threshold.
  - V3 drove the crossfade off `meta.settleMs` **raw**, and `ground.js` hands down its
    own `DISSOLVE_MS` — **sixty seconds**. That is the correct number for a full-bleed
    photograph nobody should notice changing, and the wrong one by a factor of ~23 for
    the card, which is the subject of the composition. Measured on the wall before the
    fix: the incoming slot climbed **0.60 → 1.00 across 27.5 s with three slots opaque
    throughout** — a half-minute double exposure.
  - 🔑 **The suite could not have caught it.** Every existing exchange assertion drives
    `__groundDissolve(20, 200)`, and a settle *under* the ceiling is exactly the case a
    clamp cannot fail. The ambient number is the one under test and it has to be driven
    explicitly; `tests/v3-archive.spec.js` now does.
  - ⚠ The clamp is a **ceiling, not a constant** (`CARD_EXCHANGE_MAX_MS = 2600`). A veto
    settles briskly *because someone just spoke*, and flattening that to a fixed value
    would discard real information invisibly — the surface would still look right and
    would simply stop distinguishing "you rejected this" from "ten minutes passed".
  - ⚠ **`getAnimations()` counts CSS transitions.** The blur's 2.8 s recovery is a sixth
    entry in `__archive().anims` until it finishes, which broke the pinned `anims: 5`.
    `loops` was unmoved, which is the whole reason that second number exists.

- **`__ground().layers` must stay 1 at rest.** The card's `<img>`s live in `#archive`,
  never in `.photo`, or every future soak reports a leak that is not there.
- **`#archive` is a child of `<body>`.** Inside `.photo` its z-index would be trapped in
  that element's stacking context — the fault that buried `#ground-caption` at 1.02:1.
  Inside `.stage` it would be torn down on every depth change.
- **A late hand-off from a superseded exchange** was a real defect *in `ground.js`*, found
  by driving this. Its second `onPhoto` fires from a timer armed a whole settle earlier, so
  a slow ambient dissolve interrupted by a brisk veto delivers the **old** frame last: the
  scrim re-solved for a photograph that had gone and the archive put it back on the card.
  Guarded on still being current.
- **The strip's geometry is measured against the PROJECTION, not the CSS box.** Its plane
  is stretched ~1.7× by the perspective; a 120px canvas at top 36 paints from y −23 to
  y 183. Reasoning from the stylesheet is wrong by ~60px at the top edge.
- **`plateFor()` in `archiveModel.js` cannot be called from V3.** It parses a caption whose
  year leads; V3's `ground.js` puts the year last. V3 builds its plate from the assets via
  `ground.frameParts()`.
- **The strip's year labels are drawn into a canvas**, so no DOM contrast sweep can ever
  see them. The sizes and ink alphas in `core/archive.js` are the whole defence, and the
  panel is the only real check.

---

## The idea

Mode 0 stops being "a photo with a clock on it" and becomes **the archive**: the memory
as a lit card pivoting slowly in a deep instrument space, a desaturated tiled echo of
itself behind, over one ruler — **today**, low and near, 05:00 → 24:00.

The card's own year is the 400 px engraving behind the plate. **There is no year ruler**,
and that is a decision rather than an omission — see "the year has no ruler" below.

## What this rests on

Two owner decisions, both 2026-08-01, recorded in the handover:

1. **The ambient surface may move in an empty room.** Supersedes "0% unoccupied" for
   Mode 0 only. `DESIGN_SYSTEM.md` §0.1 had already repealed the law it came from.
2. **The Mode-0 clock is demoted** to a 64 px corner numeral. Supersedes the standing
   "keep clock size" preference **for Mode 0 only** — the awake top-row time
   (`bareTopRow`) and every other clock are untouched.

And three from 2026-08-02, after the builds were seen on the panel: **no year ruler at
all**, **the plate always speaks**, **amplitude roughly doubled** (below).

## Geometry

The scene is one fixed 1920×1080 stage, `scale(min(iw/1920, ih/1080))`, centred — the
reference's own fit. Design for the wall; it letterboxes rather than reflowing.

| Element | Spec |
|---|---|
| Plane | `rotateY(-12deg) rotateX(8deg) rotateZ(2deg)`, `perspective 1400px` at `50% 42%` |
| Ruler plane | the same with roll cut to **0.8deg** (`--arch-deck-plane`) — see "what changed" |
| `.archive__echo` | ×2 (crossfaded). 2900×1800 at (−420,−340), tile 620×349 (follows the print — see below), `grayscale(1) brightness(.17) contrast(1.18)`, `translateZ(-280px)`, drift **130 s** |
| `.archive__ruler--today` | canvas 2160×320, line at frame y **904**, `translateZ(-40px)` — the reference's `#strip2` slot. The only ruler. |
| `.archive__ghost` | the memory's year, 400 px display, `rgba(238,243,251,.055)` + 1px stroke, `translateZ(-190px)`, drift **92 s** |
| `.archive__word` | "ARCHIVE" vertical, left −58, 150 px, ink .045 — the reference's `#gword` |
| `.archive__card-plane` | **(130, 212) 1040×585**, `translateZ(40px)` — the reference's own card. With `archiveFitToPrint` on, **left 130 pinned**, w/h/top from the print (see below) |
| `.archive__card-wrap` | pivot **84 s**, `translateZ(0 → 52px × gain)` |
| `.archive__img` | ×2 (crossfaded 2.6 s). Ken Burns **96 s** → `scale(1 + .075 × gain)`, visible slot only |
| `.archive__plate` | right 110, top 356, w 470. Rows `rgba(5,9,20,.72)` pad 14/22 |
| `.archive__vig` | `radial-gradient(1700px 1050px at 42% 44%, transparent 58%, rgba(2,4,10,.66) 98%)` |
| `.archive__grain` | static SVG `fractalNoise` .9 / 2 octaves, opacity .055, overlay |
| Clock | the existing `.screensaver__content`, repositioned to (108, 56) at 64 px |

**The axis.** The hour axis spans the frame's 108 px safe margins — the spine's own
geometry, so 05:00 and 24:00 land in the same place on both surfaces.

### The card follows the print (`features.archiveFitToPrint`)

Raised on the panel 2026-08-02: *"a few of the photos displayed today looked cropped."*
Structural, not a glitch. The card is a fixed **1.78:1** rectangle and the photograph is
`object-fit: cover` inside it with no `object-position`, so the crop is centred and this
is a ~71%-Apple, phone-shot library:

| The print | Under `cover` | Follows the print |
|---|---|---|
| 16:9 landscape | 1040×585, nothing lost | **1040×585 @ (130, 212)** — identical |
| 4:3 landscape | loses **~25%** of its height | 812×609 @ (130, 200) |
| 3:4 portrait | loses **~58%** — heads *and* feet | 457×609 @ (130, 200) |
| 9:16 portrait | loses ~68% | 343×609 @ (130, 200) |

Immich's `preview` rendition is a resize, not a crop, so the card geometry is the whole
cause. The ruling is that **the card takes the photograph's own aspect** — physically true
to a print, which has a shape before it has a frame.

The box (`services/archiveModel.js`, `cardRectFor`) is **max 1040 × 609, left pinned at
130, vertical centre held at 504.5**:

- **Left pinned** (owner's call over centring it, 2026-08-02): the card's left edge never
  moves, so a portrait simply does not reach as far right and nothing else on the wall
  shifts.
- **609** is as tall as the card may grow before it fouls anything — the demoted 64 px
  corner clock bottoms out near y=190, the today ruler draws its line at y=904 with marks
  rising above it, and 200 → 809 is the honest gap between them.
- **1040/609 = 1.708 is the hinge**, so a 16:9 memory is width-bound and lands on the
  shipped rectangle *to the pixel*. Flipping the flag must not move the common landscape
  memory, and that is by construction rather than by luck.
- Aspect is clamped to **[0.45, 3.2]**, so a true panorama keeps a modest crop rather than
  fitting to an unreadable strip. Every phone portrait is inside the range.
- The **echo tile follows too**, at constant *area* — a hard-coded 16:9 tile would stretch
  a portrait (the same lie one plane further back), and a tile that grew with the aspect
  would change what the echo costs to paint.

**Law 1.** The shape change rides the exchange's existing **300 ms blur**: the reshape *is*
the memory arriving, the same cause the motion burst uses, and it is an event with an end.
It is written **instantly, never transitioned** — `width`/`height`/`top` are layout
properties (§5.5), and the guardrail in `tests/ambient-archive.spec.js` pins that.

**Where the aspect comes from.** `naturalWidth/naturalHeight` of the `<img>` actually on
the card — deliberately **not** EXIF, which is pre-rotation and would put every portrait
iPhone photo in a landscape card, a worse crop than the one this replaces. It is also the
only source that works for a bare `src` string (the tender lane, the immichPhotos blend and
the static library all hand over strings with no metadata). Known aspects are remembered
(bounded at 200) and land inside the blur; a first-time rendition lands on its `load`, and
one that never loads leaves the card at the rectangle it had — the fallback is today's
shipped surface.

⚠ A rendition whose exchange has already been superseded **must not** reshape the card: on
a cold NAS the rotation outruns a fetch easily, and a card that resizes around a photograph
nobody is looking at is a move with no cause.

## The one ruler

It carries the 21 px minute ruling, the four hour numerals, marks rising as anticipation,
embers behind them, and **now** as the brightest point on the line.

`dayModel.js` is reused unmodified. The archive's own pure decision — what the plate may
say — lives in `services/archiveModel.js`, the same split `dayModel.js`/`temporalSpine.js`
already use.

### The year has no ruler

§6.1 of the handover says the archive's year ruler and the spine's hour axis collide
because they are "the same screen region, perpendicular meanings". **Two ways of keeping
both were built, and the panel rejected both:**

1. **Years as rows receding in Z** (§6.2 to the letter). Perspective drags each further
   row's left end rightward, so five faint lines joined into ONE DIAGONAL running
   bottom-left to top-right — a broken timeline, not depth. And six rows needed so much
   vertical room that the card fell to **53% of the reference's area**.
2. **Years as a horizontal shelf on a far plane.** Legible, and much closer to the
   reference — but it clashed with the card for attention while telling the room nothing
   it did not already know.

The year is already on the wall, 400 px high, behind the plate, and again in the plate's
own eyebrow. A third rendering of it is furniture, and law 3 says furniture does not
ship. **The archive draws one axis: today.**

The source readers moved out of `temporalSpine.js` into `modules/daySources.js`. Two
renderers, one day — if the spine and the archive could disagree about what happened
today, the instrument would be lying about which reading is true.

### The hour a photograph was taken

`hour` rides the Daily Memories set (`photoMemory.localHourOf` → `selectDailyMemories` →
`/api/immich/daily-set` → the screensaver's frame). **Nothing currently renders it** — it
was added for the year-row build's lit mark, which is gone. Kept rather than ripped out
because it is honest data about a photograph, already frozen into the day's set, and
"what time of day was this taken" is the obvious next thing to want.

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
- **⚠ The ruler never moves.** The reference drifts its strips ±80 px, which was fine
  when they were decoration. This one carries the hour axis, and ±80 px on it is a
  ~50-minute lie. Those keyframes are deliberately absent, and a test asserts it.
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
| `#strip2`'s year ruler **becomes the hour axis**; `#strip1` is **deleted** | §6.1's collision resolved by dropping one of the two meanings rather than relocating it. The year is already the 400 px engraving and the plate's eyebrow; a ruler is a third telling |
| **No strip drift** (`s1`/`s2` gone) | The ruler carries an axis now, and a sliding axis lies about what it measures |
| Ruler roll **2° → 0.8°** | 2° is 36 px of diagonal across the 1040 px card and 75 px across a 2160 px ruler — enough that the ruler stops reading as tilted and starts reading as wonky |
| Plate `who`: 16 px / ink .48, bare over the photo → **19 px / ink .72, on the plate's own backdrop** | Exactly the shape §4.5 warns about — the spine's third label hit 1.96:1 that way |
| Plate title **falls back to "N years ago today"** | Otherwise the plate is absent on most days, because most photos have no place |
| Motion amplitude **×2** | The reference's own amplitude was invisible on the wall; owner's call 2026-08-02 |
| Ken Burns runs on the **visible slot only** | The hidden image would composite for nothing, and a fresh memory earns a fresh move |

## History — two rejected builds, and what the panel said

**Build 1 (2026-08-01, `7ef1f18` / `baf08f8`)** — §6.2 to the letter: the years as six
ruler rows receding in Z. Rejected within the hour:

- **The recession did not read as recession.** Perspective pulls each further row's left
  end rightward, so the eye joined five faint lines into one diagonal running bottom-left
  to top-right. It looked like a broken timeline, not depth.
- **It cost the photograph.** Six stacked rows needed so much vertical room that the card
  shrank to 1040×585 → 760×428 — **53% of the reference's area**. A screensaver whose
  photograph is not the focus has lost the argument.
- **A bare-year caption dropped the year entirely** (`f0f9747`). `captionParts` correctly
  returned null with no place, but `litYear` was derived from those parts, so the ghost
  and the year-line went dark too — and that was 100% of that day's set.

**Build 2 (2026-08-02, `89311e6`)** — two planes: the years as a legible horizontal shelf
on the far plane, today near, card restored to 1040×585. Much closer to the reference, and
the shelf itself worked — but it clashed with the photograph for attention and duplicated
a year the wall already stated twice. Removed the same day.

The lesson is the handover's own §8: *"Do not flip this one on before seeing it."* The flag
had to be flipped to see it at all (a flag-off build renders no archive), so the inversion
was unavoidable — but both corrections arrived within the hour, because someone looked.

## Still open

- **The soak is the deliverable**, not an afterthought: `heap-flat over 72 h + fps
  constant`. Run `/kiosk-metrics` at 0 h / 24 h / 72 h and write the numbers into
  `docs/audit/HOST-BASELINES.md` as a new **live ambient** row (§5.4, ≤25% sustained) —
  it is currently unmeasured, and the amplitude ×2 makes it more interesting, not less.
- **Judge the yaw on the panel.** The −12° rotateY foreshortens the hour axis, so morning
  reads narrower than evening. `--arch-deck-plane` is the one-line lever.
- **`archiveFitToPrint` is default-off pending the panel.** Two things to judge, and both
  need a portrait memory on the wall: whether a **457 px-wide card still reads as the hero**
  of the surface (it is 45% of the reference's width, and "the photograph is the point of a
  screensaver" is what killed build 1), and whether the **reshape is legible as arrival**
  rather than as a glitch. It also wants its own GPU reading — a resizing plane is
  layout-adjacent on a budget-tuned surface, and §5.4's ceilings have never seen one.
  `window.__archive().card` reports the painted rectangle, the print's aspect and the
  card's, so a CDP read settles "is it actually fitting" without looking at a pixel.
- **The echo can read as visible tiling on a bright photograph.** `brightness(.17)` is the
  reference's number and it assumes a fairly dark frame.
- **Test fallout at flip time** (§6.5) was never needed — the specs asserting the old
  Mode-0 surface all passed unchanged, because the archive preserves what they check
  (tabular figures, the meridiem, the whisper's own element).
