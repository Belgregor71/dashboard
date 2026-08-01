# The Ambient Archive — calm law v3

> Source: *The Day, Rendered — Proposal v2* §11 (Claude Design, July 2026) and
> `Ambient Archive Screensaver.html`, answering `BRIEF-AMBIENT-2030.md`. Built from
> `HANDOVER-AMBIENT-ARCHIVE.md`, which stays as the record of the two owner decisions
> and the traps. **This file is the implementation authority for what shipped.**
>
> Flag: `features.ambientArchive` · default **off** · one-line revert.
> Companion: `TEMPORAL-SPINE.md` (the day, rendered flat, which this absorbs in Mode 0).

## The idea

Mode 0 stops being "a photo with a clock on it" and becomes **the archive**: the memory
as a lit card pivoting slowly in a deep instrument space, a desaturated tiled echo of
itself behind, everything drifting on independent 84–130 s periods.

Beneath the card, the temporal spine's day is rendered in three dimensions:

> **across is today · back is the years**

One instrument, two readings. That is the whole reason this shape was chosen over
layering the spine under the reference: §6 of the proposal says a birthday is the one day
"the depth of the axis becomes the point", and here the depth of the axis is *literal
depth*.

## What this rests on

Two owner decisions, both 2026-08-01, both recorded in the handover:

1. **The ambient surface may move in an empty room.** This supersedes "0% unoccupied"
   for Mode 0 only. `DESIGN_SYSTEM.md` §0.1 had already repealed the law it came from.
2. **The Mode-0 clock is demoted** to a 64 px corner numeral. This supersedes the
   standing "keep clock size" preference **for Mode 0 only** — the awake top-row time
   (`bareTopRow`) and every other clock are untouched, and it is not licence to resize
   type elsewhere.

## Geometry

The scene is one fixed 1920×1080 stage, `scale(min(iw/1920, ih/1080))`, centred — the
reference's own fit. Design for the wall; it letterboxes rather than reflowing.

| Element | Spec |
|---|---|
| Plane | `rotateY(-12deg) rotateX(8deg) rotateZ(2deg)`, `perspective 1400px` at `50% 42%` |
| Deck plane | the same, **roll cut to 0.8deg** — see "What changed from the reference" |
| `.archive__echo` | ×2 (crossfaded). 2900×1800 at (−420,−340), tile 620×349, `grayscale(1) brightness(.17) contrast(1.18)`, `translateZ(-280px)`, drift **130 s** |
| `.archive__row` | ×7 canvases, 2160×320, `left −120`, line at local y 110. Row *r*: `top 892 − 26r`, `translateZ −(40 + 78r)` |
| — deep drawer | row 6, placed at step **6.9** so the skipped year reads as a gap |
| `.archive__ghost` | the memory's year, 400 px display, `rgba(238,243,251,.055)` + 1px stroke, `translateZ(-190px)`, drift **92 s** |
| `.archive__card-plane` | (130, 178) **760×428**, `translateZ(40px)` |
| `.archive__card-wrap` | pivot **84 s**, `translateZ(0 → 52px)` |
| `.archive__img` | ×2 (crossfaded 2.6 s). Ken Burns **96 s** → `scale(1.075)`, on the visible slot only |
| `.archive__plate` | right 110, top 356, w 470. Rows `rgba(5,9,20,.72)` pad 14/22 |
| `.archive__vig` | `radial-gradient(1700px 1050px at 42% 44%, transparent 58%, rgba(2,4,10,.66) 98%)` |
| `.archive__grain` | static SVG `fractalNoise` .9 / 2 octaves, opacity .055, overlay |
| Clock | the existing `.screensaver__content`, repositioned to (108, 56) at 64 px |

The hour axis spans the frame's 108 px safe margins — the spine's own geometry, so
05:00 and 24:00 land in the same place on both surfaces.

## The deck — across is today, back is the years

| Row | Carries |
|---|---|
| **0 — today** | the minute texture, the four hour numerals, marks rising as anticipation, embers behind, and **now** as the brightest point |
| **1…5 — years** | a faint line and its year numeral, receding in Z. A year lights when a memory from it is on the card, taking a mark at the hour the photograph was taken and reaching forward toward today |
| **6 — the deep drawer** | opens, past a gap, only for a memory older than the consecutive rows reach |

`dayModel.js` is reused unmodified except for one added constant. `buildStrata` already
takes a `count`, so the archive asks for `ARCHIVE_STRATA_ROWS` (5) while the spine keeps
`STRATA_ROWS` (3) — a receding plane separates its rows by perspective as well as
position, so it carries more before it turns to mush. **The spine's constant was
deliberately not raised**: it is default-on and Pi-verified at three, and the archive
must not reach outside its own flag.

The source readers moved out of `temporalSpine.js` into `modules/daySources.js`. Two
renderers, one day — if the spine and the archive could disagree about what happened
today, the instrument would be lying about which reading is true.

### The deep drawer

The consecutive rows reach back five years; the photo library reaches back a great deal
further, so nearly every real memory would light nothing and the join above — the whole
payload of this design — would almost never happen. Rather than pretend, the deck opens
**one** more row, further back and past a visible gap, and puts the card's year in it.

That is what an archive drawer looks like: the recent years in order, then a gap, then
the one you pulled out. **The gap is the honest part** — it says "there are years between
these", which is true. It is a fixed slot allocated at build; nothing grows with how far
back the album goes.

### The hour a photograph was taken

`hour` now rides the Daily Memories set (`photoMemory.localHourOf` → `selectDailyMemories`
→ `/api/immich/daily-set` → the screensaver's frame). Without it the lit year-line has
nothing to point at.

⚠ `localDateTime` carries a trailing `Z` it does not mean. Reading it through `Date`
shifts a 9 am photo to 7 pm in Brisbane — a ten-hour lie on the one axis that must not
lie. `localHourOf` reads the fields, exactly as `localMonthDay` already does. A frozen
set built before the field existed simply has no hour, and the year-line stays a plain
lit line: **we know the year, so we say the year, and nothing more.**

## Motion — how this passes law 1

`DESIGN_SYSTEM.md` §0 law 1: *never move for a reason the room can't see.*

- **The cause is `body.fx-archive-active`**, set on Mode-0 entry and removed on exit.
  Every loop in `ambient-archive.css` hangs off it, so leaving Mode 0 switches the
  surface **off** rather than hiding it. The cause is nameable by anyone in the room:
  *the house is leafing through its album*.
- **Too slow to catch.** Nothing completes a perceptible change within a passing glance
  (~3 s): pivot 84 s, drift 130 s / 92 s, zoom 96 s. The only catchable things — the
  memory exchange and its 300 ms blur — are *events with ends*.
- **One object lives.** A single card in a still instrument space. Particles, twinkle and
  dust-motion stay banned; **the grain is static**.
- **⚠ The ruler never moves.** The reference drifts its strips ±80 px. Once the plane
  means time of day that is a ~50-minute lie, so those keyframes are deliberately absent
  and the motion budget belongs entirely to the card and its backdrop. This is the one
  place the owner's decision *costs* the reference something, and it is worth it.
- **The archive never breathes.** The now-point's breath is bound to media playing **and**
  someone in the room, which in Mode 0 is false by definition.
- **Amplitude follows `--clock-dim`** (§5.2) via `--arch-amp`: at 2 a.m. it drifts less
  *far*, not less often. Displacement scales; duration does not.
- **Compositor-only.** No `requestAnimationFrame`, no WebGL (there is no WebGL pipeline
  in this repo to inherit — that claim in §8/§11 describes v1's *proposal*, not shipped
  code), no per-frame allocation. CSS keyframes on `transform`/`opacity`/`filter`.
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
| the plate, at night | hidden outright, exactly as the Daily Memories caption already is |

### The plate is relocated language, never new language

It looks like the archive adds words to a silent surface. It does not: `year · place ·
who` is the caption `dailyMemories` and the vault×Immich relationship work already render
in Mode 0. `captionParts` is the inverse of `captionFor`, so nothing is invented — and a
caption carrying only a year yields no plate at all, because the ghost engraving already
says the year and silence is the default.

**A tender memory reaches the wall with no plate**, enforced three ways: `toSurface` sets
`caption: null`, the tender lane passes `{ tender: true }`, and the archive refuses to
build a plate for either.

## Memory discipline

The 24/7 rules in `CLAUDE.md`, applied:

- **Nothing is allocated per mark or per memory.** Seven row canvases, two card images,
  two echo planes, one plate — all created once in `build()`. Marks are drawn into the
  canvases; the plate is filled, shown, hidden.
- The exchange's staged swap is a **`setTimeout`**, never `transitionend` — which never
  fires while an ancestor is `display:none`, i.e. most of the day.
- `stopAmbientArchive()` is symmetric with the Mode-0 entry; `stopAmbientArchiveAll()`
  is the full teardown.
- No `URL.createObjectURL` anywhere: the card and echo take the same proxied URLs the
  screensaver pool already holds, so there is nothing to revoke.

## Verification

- `window.__archive()` — the deck's years, which one is lit, `nowHour`, the mark count,
  the live `--clock-dim`, the plate (or `null`, which is the tender invariant readable
  from outside), the ghost year, the photo on the card.
- `window.__ssSetFrame({ src, caption, hour })` — put a specific memory up. The Pi cannot
  wait for one to come round.
- Tests: `tests/ambient-archive.spec.js` — the pure reach + caption model, the four
  handover traps (blank rule → **paint**, cause binding, tender-no-plate, no dimming
  opacity over text), the clock demotion, the deep drawer, and DOM flatness under cycling.

## What changed from the reference, and why

| Change | Why |
|---|---|
| The horizontal **year ruler is deleted** (`#strip2`'s `ylab` spans, `#strip1` entirely) | Two perpendicular meanings cannot share a screen region. The spine's axis is the one that survives (§6.2) |
| **No strip drift** (`s1`/`s2` gone) | A sliding hour axis misreads as ~50 minutes |
| Deck roll **2° → 0.8°** | 2° is 31 px of diagonal across the 760 px card and 75 px across the 2160 px ruler — enough to walk today's evening off the bottom of the frame and to read as wonky rather than tilted |
| Card **1040×585 → 760×428**, moved to (130, 178) | The reference's card leaves no room under it for seven receding rows, and overlapped the corner clock. The card yields; the day is why this surface changed shape |
| Year numerals moved to the **left margin** | The right-hand end is nearer, but it is also where the rows converge toward the vanishing point: numerals there stack and clip |
| `#gword` ("Archive", vertical) **dropped** | A word the wall says about itself. Law 3 |
| Plate `who`: 16 px / ink .48, bare over the photo → **19 px / ink .72, on the plate's own backdrop** | Exactly the shape §4.5 warns about — the spine's third label hit 1.96:1 that way |
| Plate eyebrow: `On this day · YEAR` → **the year alone** | The memory whisper already says "on this day" bottom-right; two of them is the house repeating itself |
| Ken Burns runs on the **visible slot only** | The hidden image would composite for nothing, and a fresh memory earns a fresh move |

## Still open

- **Nobody has seen this on the panel.** The flag is off and must stay off until the
  clock demotion has been in front of the owner on the kiosk — it is the most visible
  change in the package, the thing on screen twenty hours a day. Do not flip it the way
  `temporalSpine` was flipped; that inversion is why three defects reached `main` before
  being found rather than after.
- **The soak is the deliverable**, not an afterthought: `heap-flat over 72 h + fps
  constant`. Run `/kiosk-metrics` at 0 h / 24 h / 72 h and write the numbers into
  `docs/audit/HOST-BASELINES.md` as a new **live ambient** row (§5.4, ≤25% sustained) —
  it is currently unmeasured.
- **Judge the yaw on the panel.** The −12° rotateY foreshortens the hour axis, so morning
  reads narrower than evening. It is a constant perspective rather than a wrong reading —
  the hour numerals are drawn *on* the plane and foreshorten with it — but if it reads as
  a time error at 4 m, `--arch-deck-plane` is the one-line lever.
- **Test fallout at flip time** (§6.5): pin `ambientArchive: false` in the specs that
  assert the old Mode-0 surface — likely `night-clock-mode`, `ambient-clock`,
  `memory-whisper`, `ambient-memory`, `daily-memories` — and re-run
  `scripts/verify/flag-reversibility.mjs`, because that pinned-off state *is* the rollback.
