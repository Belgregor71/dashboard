# HomeOS Design System

**The single source of truth for the dashboard's visual language.** Extracted from the
`design_handoff_homeos_home` prototype (HTML + 7 screenshots) and reconciled with the live
tokens in `src/css/base/variables.css`. Every surface — shipped or still to be retrofitted —
resolves to the values below. When code and this document disagree, this document is the
target and the code is the work item.

- **Canvas:** 1920×1080, viewed at 3–4 m. All sizes are **CSS px = kiosk px** (1:1). Design for
  the wall, not a phone — nothing here scales down responsively; it is a fixed-resolution surface.
- **Companion docs:** `README.md` (the handoff brief) · `PLAN.md` (the four shipped WP surfaces) ·
  `DESIGN_ROLLOUT.md` (the plan that brings the *rest* of the dashboard up to this spec) ·
  `STYLE_GUIDE.md` (repo CSS conventions) · `BRIEF-AMBIENT-2030.md` (forward-looking brief for
  the post-Pi hardware — extends this system, does not replace it).
- **How to use:** extend `src/css/base/variables.css` with the tokens here — **never fork it**.
  Reference tokens, not raw values, in component CSS. The token names below are the canonical ones;
  `§8` maps them to what already exists so nothing gets duplicated.

---

## 0. The three laws (non-negotiable, inherited from `PLAN.md`)

1. **0% GPU at rest.** `transform` / `opacity` / static `filter` only. No looping animation on any
   resting surface. The one permitted loop is the ambient clock's 240 s position drift, which
   already exists. Verify Ambient stays 0% with `/kiosk-metrics` after every change.
2. **Borrowed light, not chrome.** The weather lights the whole surface via a full-bleed tint + a
   living accent — **there is no weather icon/lottie**. The wall renders the condition.
3. **Silence is the default.** Most of the time the surface says almost nothing. Restraint is the
   aesthetic; every added element must earn its place at 4 m.

---

## 1. Color palette

All text colors derive from **one ink** at fixed alpha steps — ink never shifts with the accent,
and text is **never pure white**. Only the *accent* (the clock) and the *warm* hue move.

### 1.1 Ink (text)

| Token | Value | Role |
|---|---|---|
| `--ink` | `#eef3fb` | Primary text (the ink all alpha steps are cut from: `238,243,251`) |
| `--ink-dim` | `#9fb0d4` | Secondary / meta text |
| `--ink-faint` | `#5e6f96` | Labels, eyebrows, captions |

**Canonical ink alpha ladder** (apply as `rgba(238,243,251,α)` — do not invent intermediate steps):

| α | Used for |
|---|---|
| `.94` | Headline / welcome |
| `.85` | Body, stack-card title, event title |
| `.82` | Stack meta value |
| `.78` | Concierge line, tender memory title |
| `.72` | Memory whisper title |
| `.60` | Secondary line (date, status, condition) |
| `.56` | Card sub-label |
| `.50` | Metadata, meridiem, resting sub-label |
| `.42` | Eyebrow |
| `.40` | Resting note (mono) |
| `.32` | Clock, when a tender memory holds |

### 1.2 Ground (the canvas behind the photo)

| Token | Value |
|---|---|
| `--sky-0` | `#070b18` |
| `--sky-1` | `#0e1530` |
| `--sky-2` | `#1a2148` |

Base canvas: `linear-gradient(160deg, var(--sky-0), var(--sky-1) 55%, var(--sky-2))`. This is the
fallback ground **only** — production draws a real Immich photo over it. **Never ship gradients as
the final ground.**

### 1.3 Signals (status)

| Token | Value | Role |
|---|---|---|
| `--status-ok` | `#4dd57b` | OK / healthy |
| `--status-warn` | `#ffb347` | Warning (severity stripe, glow `rgba(255,179,71,.5)`) |
| `--status-error` | `#ff6b6b` | Error / critical |
| `--status-info` | `#79b8ff` | Links (resting), informational |

### 1.4 Living accent + reserved hues

| Token | Value | Role |
|---|---|---|
| `--accent` | *set per atmosphere* (see §6) | **The ambient clock only.** JS writes it from the weather. |
| `--warm` | `#ffcd8c` | **Reserved.** Sun/lightning glyphs, and the arrival name + arrival event times. **Never UI chrome, never body text.** |
| `--cool` | `#9fc4ff` | Link hover, the voice waveform |
| `--arrival-crown` | `rgba(255,205,140,.34)` | The arrival card's top-edge crown only (shipped WP3) |

### 1.5 Glass (frosted panels — 5 tokens that travel together, all-or-nothing)

| Token | Value |
|---|---|
| `--glass-bg` | `linear-gradient(180deg, rgba(24,28,40,.48), rgba(10,12,18,.34))` |
| `--glass-border` | `1px solid rgba(255,255,255,.10)` |
| `--glass-blur` | `blur(18px) brightness(.87)` (apply as `backdrop-filter` **and** `-webkit-backdrop-filter`) |
| `--glass-shadow` | `0 8px 28px rgba(0,0,0,.30)` |
| `--glass-sheen` | `inset 0 1px 0 rgba(255,255,255,.07)` |

**Hero-glass variant** (brighter — the stack's top card + the arrival card):
`--glass-bg-hero: linear-gradient(180deg, rgba(42,47,66,.62), rgba(16,20,32,.48))` ·
border-color `rgba(255,255,255,.14)` · shadow `0 12px 30px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.09)`.

> **Rule:** glass is opt-in per surface and always the full recipe. It belongs to **Lean-in** cards
> and the **arrival** overlay only. It must **not** wrap the clock, the weather, or the hero line —
> those are bare over the photographic ground (this is the core "old chrome" removal, see `DESIGN_ROLLOUT.md`).

---

## 2. Typography

Two families do all the work; a mono is reserved for system/resting notes.

| Token | Stack | Role | Weights loaded |
|---|---|---|---|
| `--font-display` | `"Barlow Condensed", "Inter", sans-serif` | All display, headline, numerals, titles | 200–600 |
| `--font-body` | `"Inter", Arial, sans-serif` | Body, captions, condition lines, eyebrows | 300–600 |
| `--font-mono` | `"JetBrains Mono", ui-monospace, monospace` | Resting notes, reserved tags only | 400–500 |

Fonts self-host (the prototype used Google Fonts). `font-variant-numeric: tabular-nums` on **every**
number that updates in place (clock, temp, times, percentages) so digits never jitter.

### 2.1 The type scale (role → exact spec)

Each row is one role. `size / line-height / weight / letter-spacing / color`. Sizes are the
1920-px canvas values; the hero uses the length-responsive tiers in `§2.2`.

| Role | Font | Size | LH | Weight | Tracking | Color |
|---|---|---|---|---|---|---|
| **Ambient clock** | display | 192 | .82 | 500 | .008em | `--accent` (dims per §6) |
| — meridiem | display | .34em | — | 400 | — | inherit @ .72 |
| **Ambient date** | display | 26 | — | 500 | .22em ·UPPER | `--ink` @ .60 |
| **Top-row time** | display | 64 | 1 | 500 | — | `--ink` |
| — meridiem | display | .5em | — | 500 | .1em | ink .60 |
| **Top-row temp** | display | 64 | 1 | 600 | — | `--ink` |
| **Top-row condition** | body | 19 | — | 500 | .14em ·UPPER | ink .60 |
| **Hero line** | display | *tier* | .96 | 500 | .006em | `--ink` |
| **Concierge line** | display | *tier* | .96 | 500 | .006em | ink .78 (matte) |
| **Stack card title** | display | 44 | 1.05 | 600 | .01em | `--ink` |
| **Stack card sub** | body | 22 | — | 400 | — | ink .56 |
| **Stack meta value** | display | 40 | — | 600 | .01em | ink .82 |
| **Stack meta sub** | body | 17 | — | 500 | .04em | ink .50 |
| **Resting note** | mono | 18 | — | 400 | .04em | ink .40 |
| **Memory eyebrow** | body | 19 | — | 600 | .22em ·UPPER | ink .42 |
| **Memory title** | display | 44 | 1.02 | 500 | .01em | ink .72 |
| **Arrival welcome** | display | 64 | 1 | 500 | .01em | ink .94 (name → `--warm` @600) |
| **Arrival status** | body | 24 | — | 400 | — | ink .60 |
| **Arrival event time** | display | 26 (min-w 3.4em) | — | 600 | .01em | `--warm` |
| **Arrival event title** | body | 26 | — | 400 | — | ink .85 |
| **Voice label** | display | 56 | — | 500 | .02em | `--ink` |
| **Voice sub** | body | 24 | — | 400 | — | ink .50 |

### 2.2 Hero length-responsive tiers (shipped as `features.heroType`)

The temperament trims copy *before* it reaches the hero, so type never shrinks to fit. Character
count picks the tier; recompute on every text change (`applyHeroTier` in `focusHero.js`).

| Tier | Chars (prod `focusHero.js`) | Text size | Glyph size | Notes |
|---|---|---|---|---|
| A | ≤16 | 144 | 116 | headline |
| B | 17–40 | 104 | 84 | standard (default) |
| C | 41+ | 72 (LH 1.02) | 58 | the 4 m legibility floor |

Hero text: `max-width: 26ch`, `text-wrap: balance`, text-shadow `0 2px 34px rgba(0,0,0,.55)`.
Hero glyph: `filter: drop-shadow(0 0 24px rgba(120,160,220,.35))`.
**Concierge** reuses the tiers but goes **matte**: text ink .78, softer shadow `0 2px 24px rgba(0,0,0,.4)`,
glyph ✨ with **no glow** (`filter:none`, opacity .8).

> Live tokens `--fs-hero-line-a/b/c` are currently `clamp()`-based (viewport-relative). At the fixed
> 1920 canvas they resolve close to 144/104/72 but not exactly — the rollout pins them to the fixed
> px so the surface is pixel-accurate (see `DESIGN_ROLLOUT.md` §Foundations).

---

## 3. Spacing rhythm

A base-**4** rhythm. Component padding/gaps snap to this scale; the wall margin and content
max-width are fixed constants.

### 3.1 The scale

| Token | px | Typical use |
|---|---|---|
| `--space-1` | 4 | Hairline gaps (meta sub, tight stacks) |
| `--space-2` | 8 | Top-row weather column gap |
| `--space-3` | 12 | Memory eyebrow↔title, arrival event rows |
| `--space-4` | 16 | Resting-note gap, small padding |
| `--space-5` | 18 | Stack card gap, glass radius sibling |
| `--space-6` | 26 | Stack card icon↔body gap, vertical card padding |
| `--space-7` | 28 | Hero glyph↔text gap |
| `--space-8` | 34 | Stack card horizontal padding |
| `--space-9` | 46 | Arrival card horizontal padding |
| `--space-10` | 64 | Large block rhythm |

> These are **display-tuned** (larger than a typical 4/8/16 web scale) because the surface is read at
> 3–4 m. Keep the base unit 4 so everything stays on a shared grid, but reach for the bigger steps.

### 3.2 Fixed layout constants

| Token | Value | Meaning |
|---|---|---|
| `--safe-margin` | **108px** | Content inset from all four wall edges (was 72; tightened after wall-distance review). Every mode layer pads by this. |
| `--content-max` | **1240px** | Max width of the stack + resting notes |
| `--hero-offset` | **+120px** | The hero/concierge line sits this far below true vertical center (to clear the top row) |
| `--arrival-bottom` | **8%** | Arrival card distance from the bottom edge |
| `--arrival-width` | **760px** | Arrival card width |

### 3.3 Radii

| Token | px | Use |
|---|---|---|
| `--glass-radius` | 18 | Glass cards, arrival card |
| `--glass-radius-sm` | 14 | Smaller glass elements |
| `--radius-pill` | 999 | Pills, reserved tags |

---

## 4. Component states

This is a **wall display with no pointer** — so hover/focus are for the few interactive surfaces
that exist (dev/presenter chrome, any future links) and for accessibility completeness, **not** for
the ambient surface itself. The states that *do* carry meaning are the content states: severity,
selected (hero-glass), and the presence-mode exchange.

### 4.1 Interactive states (links, buttons, presenter chrome)

| State | Spec |
|---|---|
| **Link rest** | `color: var(--status-info)` (`#79b8ff`), no underline |
| **Link hover** | `color: var(--cool)` (`#9fc4ff`) |
| **Button rest** | `color: rgba(238,243,251,.6)`, transparent bg |
| **Button hover** | `color: var(--ink)` |
| **Button active/selected** | `background: rgba(255,255,255,.12)`, `color: var(--ink)` |
| **Focus ring** | `outline: 2px solid var(--cool); outline-offset: 2px` — never remove focus outlines; the wall has no pointer but keyboard/AT still need them |
| **Disabled** | `opacity: .4; pointer-events: none` |

### 4.2 Content states (the ones that matter on the wall)

| State | Spec |
|---|---|
| **Selected / winner** (stack top card, arrival) | **Hero-glass** variant (§1.5) — brighter bg, `rgba(255,255,255,.14)` border, stronger sheen. Never size alone. |
| **Severity: warn** | 3px left stripe `var(--status-warn)`, glow `0 0 14px rgba(255,179,71,.5)`; icon gets `drop-shadow(0 0 8px rgba(255,179,71,.45))`. **Never a coloured card.** |
| **Severity: error** | Same geometry, `var(--status-error)` + matching glow (reserved; use sparingly) |
| **Reveal** (stack cards) | opacity 0→1 on `--t-hero`, staggered `0 / 180 / 360ms`. Teardown via the existing `renderStack` `setTimeout` (700ms) — **never a new timer, never `transitionend` on a hidden node.** |
| **Mode exchange** | opacity-only on `--t-hero` (700ms); flip `visibility` after the fade with a `setTimeout`, never `transitionend`. |
| **Tender memory hold** | Photo takes the whole statement; atmosphere layers yield; clock recedes to ink .32; held on `--t-settle`. Ambient-only, never captioned (enforced in `memoryEngine.toSurface`). |
| **Reduced motion** | `@media (prefers-reduced-motion:reduce)`: all animation/transition off; arrival drain bar static at 62% width. |

---

## 5. Motion

Three named durations (from `personality.timing`). **Opacity/transform only** — transform on a
layer breaks fixed descendants, so mode exchanges are opacity-only (see the `focusHero` leak-audit note).

| Token | Value | Used by |
|---|---|---|
| `--t-hero` | `700ms cubic-bezier(.4,0,.2,1)` | All mode-layer exchanges, stack reveal, hero text swap |
| `--t-settle` | **`60s linear`** (prod) — 2.5s in the prototype for demo speed | Atmosphere tint/accent/photo crossfade, memory surfacing |
| `--t-arrival` | `550ms cubic-bezier(.22,1,.36,1)` | Arrival card enter/exit (overshoot then settle) |

Every timing routes through `personality.timing()` so the room moves with one set of manners.

---

## 6. The atmosphere system ("borrowed light")

The weather sets a full-bleed **tint** over the photo and a **living accent** (the clock color). JS
maps the weather condition → one row; all changes crossfade on `--t-settle`. **No weather icon —
this replaces it.**

| Condition | Tint (over photo) | Accent (`--accent`) | Clock dim |
|---|---|---|---|
| golden | `rgba(150,95,40,.20)` | `rgba(255,185,130,.94)` | .66 |
| clear | `rgba(30,66,120,.12)` | `rgba(255,255,255,.95)` | .90 |
| cloudy | `rgba(66,78,96,.24)` | `rgba(255,255,255,.95)` | .90 |
| rain | `rgba(36,66,98,.30)` | `rgba(196,230,255,.97)` | .90 |
| storm | `rgba(28,38,66,.38)` | `rgba(196,230,255,.97)` | .78 |
| fog | `rgba(120,130,145,.22)` | `rgba(255,255,255,.95)` | .90 |
| night | `rgba(4,10,28,.42)` | `rgba(130,215,255,.92)` | .50 |

**Layer order (bottom → top):**

```
photo (Immich)
  → atmosphere tint
  → readability gradient: linear-gradient(180deg, rgba(0,0,0,.08) 0%, transparent 44%, rgba(0,0,0,.70) 100%)
  → content (the mode layer)
```

> Live state: `atmosphere.js` (shipped `ambientAtmospherics`/`ambientSubstrate`) already maps
> condition → an `atmo-*` token and lifts a resting tint onto `<body>`. The rollout reconciles that
> mapper's values against this table and extends it to carry the **accent** + **photo** into the
> awake modes (today only the screensaver shows a photo).

---

## 7. Surface inventory (where the system applies)

| Surface | Mode | Status | Glass? | Notes |
|---|---|---|---|---|
| Ambient clock + date | 0 | **shipped** (`ambientClock`) | no | Accent color + sky-dim per §6 |
| Memory whisper (captioned) | 0 | partial | no | Bottom-right, faint |
| Tender memory | 0 | **shipped** (`ambientMemory`) | no | Wordless, ambient-only |
| Top row (time · temp/condition) | 1·2 | **needs retrofit** | **no** (strip old cards) | Bare over the ground |
| Hero line | 1 | **shipped** (`heroType`) | **no** (strip container) | Tiers §2.2, +120px offset |
| Concierge line | 1 | partial | no | Matte variant of the hero |
| Lean-in stack | 2 | **shipped** (`leanInStack`) | **yes** | The one place glass earns its edges |
| Arrival card | overlay | **shipped** (`arrivalCard`) | yes (hero-glass) | Warm name, drain bar |
| Voice | 3 | reserved | no | Undesigned; behind presence VOICE |
| News ticker | — | **remove** | — | Not in the design; drop entirely (WP-A) |
| Weather / Briefing / System views | — | **delete** | — | Confirmed: removed entirely (presence-first). WP-E. |
| Cameras view | overlay | **keep, force-only** | — | Confirmed: reachable via doorbell/voice only, off navigation; not a refresh target |

---

## 8. Token reconciliation (map to `src/css/base/variables.css`)

What already exists vs. what the rollout adds. **Extend, never fork.**

### Already present & correct (keep)
`--ink`, `--ink-dim`, `--ink-faint`; `--sky-0/1/2`; `--status-ok/warn/error/info`; `--warm`,
`--arrival-crown`; all five glass tokens + `--glass-radius`, `--glass-radius-sm`, `--radius-pill`;
`--font-display/body/mono`; `--fs-hero-line-a/b/c` (values to be pinned, below).

### Add
- `--cool: #9fc4ff` (used by links/voice; currently only `--accent-2: #9fc4ff` exists — alias or rename).
- `--glass-bg-hero`, `--glass-border-hero`, `--glass-shadow-hero` (the hero-glass variant, currently inlined in shipped CSS — lift to tokens).
- The spacing scale `--space-1 … --space-10` (§3.1). Current `--space-xs…xl` are rem-based and coarse; **keep them for legacy panels**, add the px scale for HomeOS surfaces, migrate over time.
- Layout constants `--safe-margin: 108px`, `--content-max: 1240px`, `--hero-offset: 120px`.
- Motion tokens `--t-hero`, `--t-settle` (60s), `--t-arrival` (some inlined in shipped CSS — lift + unify).
- Atmosphere accent + tint tokens per §6 (accent is set by JS; expose the tint values as `--atmo-tint-*` if not already in `atmosphere.js`).

### Reconcile (conflicts to resolve — see `DESIGN_ROLLOUT.md`)
- `--layout-gutter: 40px` → the HomeOS surfaces use **108px** (`--safe-margin`). Legacy panels keep 40 until retired; do not globally change `--layout-gutter`.
- `--accent` default is `rgba(255,255,255,.95)` — fine as the pre-atmosphere fallback; the atmosphere mapper overwrites it. Confirm the mapper emits the §6 accents exactly.
- `--fs-hero-line-a/b/c` are `clamp()`; pin to the fixed 144/104/72px for pixel accuracy on the wall.

---

## 9. Invariants (code-not-taste — a test guards each)

1. **Glass is all-or-nothing** — the five tokens travel together; no partial glass.
2. **Tender memories are ambient-only, never captioned, held longer** — enforced in `memoryEngine.toSurface`; scope every tender style to Ambient so it can't leak into awake modes.
3. **Silence is the default** — `shouldSpeak`; the concierge only fills an empty scored queue, awake modes only.
4. **One voice** — all copy through `personality.phrase`.
5. **`--warm` is reserved** — sun/lightning glyphs + the arrival name/times only. Never chrome, never body text.
6. **0% GPU at rest** — no new loops; verify with `/kiosk-metrics`.

Each surface ships behind one `features.*` flag, flag-off byte-identical, one-line revert — the
shipping contract in `PLAN.md` §Guardrails applies to every change that touches this system.
