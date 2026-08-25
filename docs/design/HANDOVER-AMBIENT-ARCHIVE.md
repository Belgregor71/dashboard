# Handover — the Ambient Archive screensaver (calm law v3)

> **BUILT 2026-08-01. LIVE AND SEEN ON THE PANEL (owner, 2026-08-25).**
> `v3Archive` and `archiveFitToPrint` are both **default-on**; the flag-off framing this
> file was written under no longer describes the wall.
> `docs/design/AMBIENT-ARCHIVE.md` is now the implementation authority — read that for
> what shipped and what changed from the reference. This file stays as the record of the
> two owner decisions, the traps, and the reasoning behind the shape.
>
> Everything in §8 is done except step 4's live half: `npm test` and the pre-push gates
> pass, and the flag has NOT been flipped. §6.4's warning stands — put the clock demotion
> in front of the owner on the kiosk *before* the flag moves. The §8.5 soak is unstarted.

**Status:** not started, **unblocked**. This is the deliberately-deferred half of "The Day,
Rendered" v2. The spine (§2–§7) shipped and is default-on — `docs/design/TEMPORAL-SPINE.md`.

**Fully unblocked as of 2026-08-01.** Both owner decisions are in:

- §6 — **the archive absorbs the spine's job in Mode 0** (its horizontal year ruler goes; its
  plane takes the spine's hour axis; strata become year-rows receding in Z).
- §6.4 — **demote the Mode-0 clock** to the archive's 64px corner numeral.

Nothing is waiting on anyone. Start at §8.

**Read first:** `DESIGN_SYSTEM.md` §0 + §5 (law 1 and the cause test), then
`TEMPORAL-SPINE.md` (what already ships on this surface).

---

## 1. What is being built

Mode 0 stops being "a photo with a clock on it" and becomes **the archive**: the memory
as a lit card pivoting slowly in a deep instrument space — a desaturated tiled echo of
itself behind, engraved year strata as ruler planes, everything drifting on independent
90–150s periods. Cinematic grade, continuous life.

**Source files** (Claude Design project `5956fe63-1fcc-4e32-b815-02d7cd5382d9`, read via
the `claude_design` MCP / `DesignSync`):

| File | |
|---|---|
| `Ambient Archive Screensaver.html` | The runnable reference. Self-contained CSS/DOM, no build step — open it and watch it |
| `The Day Rendered - Proposal v2.html` | §11 is the argument and the discipline; Concept 07 embeds the above live |

The reference is **CSS keyframes on a 3D-transformed plane**, not WebGL, despite what §8
claims. See §5 below.

---

## 2. The owner's decision this rests on

> **Decision (owner): the ambient surface moves even in an empty room.**

This **supersedes §4's "0% unoccupied" for Mode 0 only**. `"0% unattributable"` survives
intact. Per the brief's own terms, taking the discipline away owes a replacement, and v3
is that replacement:

1. **Attributable cause, kept.** The cause every household member can name: *the house is
   leafing through its album*. A screensaver is the one motion vocabulary every room
   already understands.
2. **Too slow to catch.** Nothing completes a perceptible change within a passing glance
   (~3 s). Pivot ±3° over 84 s · drift 56 px over 130 s · zoom 7% over 96 s. Only the
   memory exchange (~5 min in production) and the 4 s sweep are catchable — and both are
   *events with ends*, not textures.
3. **One object lives.** A single card in a still instrument space — never many small
   moving things. **Particles, twinkle and dust-motion stay banned; the grain is static.**

**The CI gate changes shape rather than disappearing:** `empty-fps = 0` is replaced by
**`heap-flat over 72 h + fps constant`**. Budget it against `DESIGN_SYSTEM.md` §5.4 — this
is the "live ambient" row (≤25% sustained), not the quiescent one, and it is the state the
screen sits in for *hours*.

---

## 3. Geometry from the reference (measured at 1920×1080)

The whole scene is one `#canvas` scaled by `min(innerWidth/1920, innerHeight/1080)`.

```
--plane: rotateY(-12deg) rotateX(8deg) rotateZ(2deg)
#scene  perspective 1400px, perspective-origin 50% 42%
```

| Element | Spec |
|---|---|
| `.echo` | B&W tiled memory behind. 2900×1800 at (−420,−340), tile 620×349, `grayscale(1) brightness(.17) contrast(1.18)`, `translateZ(-280px)`, drift **130 s** alternate → `translate3d(-96px,-42px,0) scale(1.05)` |
| `#strip1` | Ruler plane, top 96px, `translateZ(-150px)`, opacity .75, **150 s** → `translateX(-80px)` |
| `#strip2` | Ruler plane, top 904px, `translateZ(-40px)`, opacity .95, h 70px, **115 s** → `translateX(64px)`. Carries the year labels at `300 + i*192` px |
| strip texture | `repeating-linear-gradient(90deg, rgba(238,243,251,.14) 0 1px, transparent 1px 21px)` |
| `#ghost` | The year, 400px Barlow, `rgba(238,243,251,.055)` + 1px text-stroke, `translateZ(-190px)`, **92 s** → `translate3d(-46px,30px,0)` |
| `#cardPlane` | (130, 212) 1040×585, `translateZ(40px)` |
| `#cardWrap` | pivot **84 s** alternate, `translateZ(0 → 52px)` |
| `#card img` | Ken Burns **96 s** alternate → `scale(1.075)`; opacity xfade 2.6 s |
| `#card` | `0 48px 110px rgba(0,0,0,.62)`, outline `1px rgba(255,255,255,.18)`, inset lip |
| `#plate` | right 110, top 356, w 470. Rows `rgba(5,9,20,.72)` pad 14/22. Eyebrow 600/19px/.26em; title 500/56px display/ink .86; who 500/16px/.16em + 3px `rgba(255,205,140,.85)` left rule |
| `.vig` | `radial-gradient(1700px 1050px at 42% 44%, transparent 58%, rgba(2,4,10,.66) 98%)` |
| `.grain` | static SVG `fractalNoise` baseFrequency .9, 2 octaves, opacity .055, `mix-blend-mode: overlay` |

Exchange: card `filter: blur(16px) brightness(.8)` for 300 ms; plate + ghost fade out, swap
at 2400 ms, fade back. Lit year label → `rgba(255,205,140,.95)` + glow.

---

## 4. ⚠ The traps — read before writing code

### 4.1 The blank rule will hide whatever you add

`screensaver.css` ends with:

```css
body.screensaver-active > *:not(#screensaver):not(.recipe-panel):not(#temporal-spine) {
  visibility: hidden;
}
```

The spine shipped **invisible in Mode 0** because of this — every JS assertion passed
(`__spine()` reads its own bookkeeping, not paint) and only `checkVisibility()` on the
panel disagreed. If the archive adds any new body-level element, it goes in that list.
Regression test pattern: `tests/temporal-spine.spec.js` → *"the spine survives the
screensaver blank rule"*.

### 4.2 The new guardrails will reject the archive's loops as written

I rewrote `insights.spec.js` and `atmo-fx.spec.js` on 2026-08-01 to assert **cause-binding**
instead of absence. An `infinite` animation must hang off a selector its cause removes:

```js
// tests/atmo-fx.spec.js
const CAUSE_BOUND = /\.(atmo-(rain|storm|fog|cloudy)|fx-[a-z0-9-]+-(active|live)|spine-alive)\b/;
```

The archive's cause is *"Mode 0 is running"*. So **name the marker to satisfy the existing
pattern** — `body.fx-archive-active`, set on entering Mode 0 and removed on exit — and it
passes with no change to the regex. If you pick another name you must widen the allowlist
deliberately, in the same change, with the reason written down. §11 requires the archive
never runs outside Mode 0, so this marker *is* the honest cause binding, not a workaround.

Also: `insights.spec.js` now forbids `infinite` on anything in `screensaver.css` that is not
bound to a weather condition token. The archive's rules live in that file today — either
move them to their own stylesheet or extend that test's allowlist alongside the marker.

### 4.3 Tender memories must not be captioned

`memoryEngine.toSurface` enforces `sensitivity:"tender"` → ambient-only, **caption: null**,
held longer, and the render boundary re-checks it. The archive's `#plate` captions *every*
memory with year/title/who. **A tender memory must reach the archive with no plate at all.**
This is a code-not-taste invariant (`DESIGN_SYSTEM.md` §9) and the easiest thing in this
whole package to break silently. Test: `tests/ambient-memory.spec.js`.

### 4.4 `kiosk-drive.cjs reload` does not bypass cache

A CSS-only deploy is correct on disk, correct in the deploy log, and still absent on the
panel — it reads as "my selector is wrong". Check the loaded stylesheet hash first:

```js
[...document.styleSheets].map(s => (s.href || "inline").split("/").pop())
```

against `ls dist/assets/*.css` on the Pi. Force it with `Page.reload {ignoreCache:true}`
after `Network.setCacheDisabled`.

### 4.5 Never carry alpha in a colour that also sits under a dimming opacity

They multiply. The spine's third label hit **1.96:1** against AA 4.5 that way. The archive
has the same shape everywhere — `.strip` opacity .75/.95 over label colours that already
carry alpha, plus `--clock-dim` at night. The contrast gate (`tests/verify/contrast.spec.js`,
pre-push) walks every visible text node, so it *will* catch this — but it will catch it at
push time, which is late. The plate's `who` line at 16px is the one to watch.

### 4.6 One reading is not a measurement

A single `gpucpu.sh` sample right after a hard reload read **10.4%**; settled steady state
was **0.7%**. Prefer the show/hide A/B on the live panel (`display:none` the element, sample,
restore) — it controls for everything else on the box at that moment.

---

## 5. Recommendation: build it in CSS, not WebGL

§8 says "the spine is a shader" and §11 says the archive "runs the same uniforms-only WebGL2
pipeline". **There is no WebGL pipeline in this repo to inherit** — that claim describes v1's
*proposal*, not shipped code. `atmoFx` is canvas 2D; nothing else takes a 3D context.

The reference is already CSS keyframes on `transform`/`opacity`/`filter` across ~6 elements.
That is **compositor-only, zero rAF, zero allocations per frame** — which is strictly better
than the 30 fps rAF §11 proposes, and it satisfies the same soak condition by construction.
The spine's canvas took this route and A/B'd at **0.0% marginal cost**.

Build it in CSS. If a measurement later says CSS can't hold it, that is the moment to
justify a context — not before.

---

## 6. RESOLVED — the archive absorbs the spine's job in Mode 0

**Owner's decision, 2026-08-01.** Of the three options, this is the one that keeps "the day
is the surface" true. It is also the most work, because it is not a layering fix — it changes
what the archive's lower plane *means*.

### 6.1 The problem it has to solve: two rulers, two different axes

They collide, and it is worse than an overlap:

| | Axis | Where |
|---|---|---|
| Spine | **hours of today**, 05:00→24:00 left to right; years are *rows offset downward* | y ≈ 860 |
| Archive `#strip2` | **years**, 2016→2025 left to right (`ylab` at `300 + i*192`px) | top 904px |

Same screen region, perpendicular meanings. You cannot layer your way out of that — one of
the two mappings has to go.

### 6.2 The resolution: the archive's plane takes the spine's axis, and the tilt supplies the years

Keep the **spine's** mapping and throw away the archive's horizontal year ruler:

- **Horizontal is time of day.** `#strip2` becomes the day: 05:00→24:00, marks, embers, the
  travelling now-point. The `ylab` spans and their `300 + i*192` layout are deleted.
- **Years become rows receding into the plane.** §2 "Reach" already says the strata are
  "the same axis, scrolled down by years" — parallel lines *beneath*, sharing the hour axis.
  The archive is already tilted `rotateY(-12deg) rotateX(8deg)` on a 1400px perspective, so
  those rows stop being a flat stack and become **year-rows receding in Z**.

That is the whole reason this option is worth the work. §6 of the proposal says a birthday is
the one day "the depth of the axis becomes the point" — in the archive, the depth of the axis
is *literal depth*. The lit year-line for the memory currently on the card is a row further
back, joined to today's row by the hairline the spine already draws.

One instrument, two readings: across is today, back is the years.

### 6.3 What this means concretely

1. **The spine element hides in Mode 0**, it does not get deleted:
   `body.fx-archive-active #temporal-spine { display: none }`. Keep the blank-rule exemption
   added in §4.1 — with `ambientArchive` flag-off the archive never mounts, the class is never
   set, and Mode 0 falls back to exactly today's verified spine. **That is the rollback path,
   and it costs one CSS rule.**
2. **`dayModel.js` is reused unchanged.** It is pure and already produces `{marks, nowT,
   strata[]}` with `row` and `t` per stratum. The archive needs a *renderer* for that model on
   a 3D plane, not a new model. `buildStrata` already returns exactly the rows this needs.
3. **`STRATA_ROWS` will want raising from 3.** Three rows is right for a flat surface read at
   4 m; a receding plane can carry more before it turns to mush, and the archive's whole point
   is depth. Try it on the panel — it is one constant.
4. **The now-point still belongs on the front row** (today), even while the card shows 2019.
   Its breath stays bound to `spine-alive` = media playing **and** someone in the room, which
   in Mode 0 is false by definition. So **the archive never breathes** — correct, and it means
   the archive's motion budget is entirely its own drift/pivot/zoom.

### 6.4 The clock — RESOLVED: demote it

Today's Mode 0 has the large centred clock (verified live at 6:48pm). The archive's `#qclock`
is a **64px numeral, top-left**. These disagreed, and the standing preference on record was
"keep clock size as-is".

**Owner ruled 2026-08-01: demote it.** Mode 0 takes the archive's quiet corner numeral. The
standing preference is superseded *for Mode 0 only* — the awake top-row time (64px,
`bareTopRow`) and every other clock are untouched, and this is not licence to resize type
elsewhere.

Why it is the right call and not just a smaller clock: §2 promises this exact trade. Once the
day is legible as **position** on the spine, the clock stops being the primary readout. It is
kept as redundancy — *"because reading glasses are in another room"* — not because it leads.
Demoting it is what buys the archive its surface.

⚠ It is still the most visible change in this package — the thing on screen twenty hours a
day. **Put it in front of the owner on the panel before the flag flips**, not after. And
`tests/ambient-clock.spec.js` + `night-clock-mode.spec.js` assert the current treatment; they
move to the pinned-off rollback set (§6.5).

### 6.4b ⚠ One more thing the decision drags in

**The plate is not new language.** It looks like the archive adds words to a silent surface,
which would read as a "silence is the default" violation. It does not: year · title · who is
the caption `dailyMemories` + the vault×Immich relationship work already render in Mode 0
today. The archive **relocates** it into the plate. Say so in the commit, or a future audit
will flag it. (And §4.3 still holds — tender memories arrive with no plate at all.)

### 6.5 Test fallout to expect

Same shape as the spine flip: specs that assert the *old* Mode-0 surface now cover the
rollback path and should pin `ambientArchive: false` deliberately — likely
`night-clock-mode`, `ambient-clock`, `memory-whisper`, `ambient-memory`, `daily-memories`.
Pin them, do not weaken them; and re-run `flag-reversibility.mjs` before flipping, because
that pinned-off state *is* the rollback.

---

## 7. What the archive can reuse (do not rebuild)

`screensaver.js` (~850 lines) already owns all of this, and it is Pi-verified:

- **The photo pool** — Immich proxy, `dailyMemories` frozen per-day "on this day" set chosen
  the evening before so it survives the NAS sleeping. ⚠ The frozen set never rebuilds within
  its day; `rm` it or nothing changes until tomorrow.
- **The plate's content, already computed.** Year · place · region captions, and the
  vault×Immich relationship captions (*"2019 · Nudgee, Queensland · our niece Melanie"*) that
  name people **and** how they are related. That is the archive's `#plate` almost verbatim.
- **`--clock-dim`** — the sun-altitude curve (~0.9 day → 0.3 floor). §5.2 says amplitude
  follows it: the archive should drift *less far* at 2 a.m., not stop. Scale displacement,
  not duration.
- The atmosphere token, the memory whisper, the tender lane, the night clock, `__ssPlace`.

Init options are wired in `core/app.js` → `initScreensaver({...})`; add the flag there.

---

## 8. Suggested shape of the work

Flag `ambientArchive`, default off, one-line revert — the standard contract.

1. Nothing to settle first — §6 and §6.4 are both ruled. Start here.
2. Port the reference into `src/css/views/` + a builder in `screensaver.js`, behind the flag,
   reusing §7's data. Set `body.fx-archive-active` on Mode-0 entry, remove on exit. Render
   `dayModel`'s existing `{marks, nowT, strata}` onto the tilted plane per §6.2 — across is
   today, back is the years — and hide `#temporal-spine` while the class is set.
3. Extend the two guardrails in the same change (§4.2), and add the tender-no-plate test
   (§4.3) and the blank-rule test (§4.1) *before* believing it works.
4. `npm test` → deploy flag-off (a real no-op this time — the archive is invisible without
   it) → flip on the Pi → **verify on the panel, with a hard reload** (§4.4).
5. The soak is the deliverable, not an afterthought: `heap-flat over 72 h + fps constant`.
   Run `/kiosk-metrics` at 0 h / 24 h / 72 h and write the numbers into
   `docs/audit/HOST-BASELINES.md` as a new "live ambient" row — it is currently unmeasured.

Do not flip this one on before seeing it, the way `temporalSpine` was flipped. That inversion
is why three defects reached `main` before being found rather than after.
