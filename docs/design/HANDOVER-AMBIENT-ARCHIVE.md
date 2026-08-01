# Handover — the Ambient Archive screensaver (calm law v3)

**Status:** not started. This is the deliberately-deferred half of "The Day, Rendered" v2.
The spine (§2–§7) shipped and is default-on — `docs/design/TEMPORAL-SPINE.md`.

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

## 6. The open design question — spine × archive

**This needs an answer before any code.** Today the spine renders *over* the screensaver
(z-202) and in Mode 0 shows the day as pure light with no words — that is §5's "nobody home:
photograph, light, spine, quiet numeral", and it is live and verified.

The archive is a **deep instrument space** that claims the whole surface: tilted planes, a
pivoting card, its own year strata along the bottom at `top: 904px`. The spine's line sits at
79.6% ≈ `y 860` — **they collide, and both draw year strata**.

Three ways out, roughly in order of how much I'd trust them:

1. **The archive absorbs the spine's job in Mode 0.** `#strip2` already *is* a horizontal
   ruler with lit year labels. Let the archive's lower strip carry today's marks, and hide
   `#temporal-spine` while `fx-archive-active`. One instrument, two readings. Most faithful
   to "the day is the surface", most work.
2. **The archive sits behind, the spine stays in front.** Drop the archive's `#strip2` and
   let the spine be the only ruler. Cheapest, keeps everything shipped today intact, but the
   archive loses part of its composition.
3. **Mode 0 is the archive; the spine is awake-only.** Simplest, and contradicts "the spine
   never leaves" — only take this if 1 and 2 both look wrong on the panel.

Ask the owner. This is a taste call about what the wall *is* when nobody is home, and it
determines the shape of the whole work package.

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

1. Settle §6 with the owner. Nothing else is safe to start.
2. Port the reference into `src/css/views/` + a builder in `screensaver.js`, behind the flag,
   reusing §7's data. Set `body.fx-archive-active` on Mode-0 entry, remove on exit.
3. Extend the two guardrails in the same change (§4.2), and add the tender-no-plate test
   (§4.3) and the blank-rule test (§4.1) *before* believing it works.
4. `npm test` → deploy flag-off (a real no-op this time — the archive is invisible without
   it) → flip on the Pi → **verify on the panel, with a hard reload** (§4.4).
5. The soak is the deliverable, not an afterthought: `heap-flat over 72 h + fps constant`.
   Run `/kiosk-metrics` at 0 h / 24 h / 72 h and write the numbers into
   `docs/audit/HOST-BASELINES.md` as a new "live ambient" row — it is currently unmeasured.

Do not flip this one on before seeing it, the way `temporalSpine` was flipped. That inversion
is why three defects reached `main` before being found rather than after.
