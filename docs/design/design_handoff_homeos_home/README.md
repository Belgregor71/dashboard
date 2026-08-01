# Handoff: HomeOS Home Surface

## Overview

A redesign of the family-dashboard home surface (the "HomeOS" design track) for a 1920×1080 wall display at 3–4 m viewing distance. One continuous room; **presence sets the floor**: four modes (Ambient / Glance / Lean-in / Voice) exchange content over a shared photographic ground lit by the weather. This handoff covers every surface in `docs/design/PLAN.md`: the hero line (study 02, shipped), the ambient clock (WP1, shipped), the lean-in glass stack (WP2), the arrival card (WP3), the ambient/tender memory surface (WP4), plus the concierge idle line.

## About the Design Files

The files in this bundle are **design references created in HTML** — a single interactive prototype showing intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the existing dashboard codebase** (`Belgregor71/dashboard` — vanilla JS modules + plain CSS, no framework), following its established patterns: one `features.*` flag per surface, extend `src/css/base/variables.css` (never fork it), touch the real component files listed per-surface below.

- `HomeOS Home.html` — the full prototype. All four modes, seven atmospheres, arrival card, concierge, tender memory.
- `homeos-tweaks.jsx`, `tweaks-panel.jsx`, `image-slot.js` — prototype-only scaffolding (the demo control panel and photo drop-zone). **Do not port these.**

## Fidelity

**High-fidelity.** Colors, type scale, spacing, motion curves and copy voice are final and specified below in canvas px (1920×1080 = 1:1 CSS px on the Pi kiosk). Recreate pixel-perfectly. The photographic backgrounds are gradient stand-ins — production draws real photos from Immich (the existing screensaver source); never ship gradients.

## The Shipping Contract (from PLAN.md — applies to every surface)

1. New `features.*` flag in `src/js/config.js`; flag-off byte-identical; one-line revert.
2. Extend `variables.css`, don't fork. No parallel CSS tree.
3. ~~**0% GPU at rest is law**~~ — **SUPERSEDED 2026-08-01.** This bundle is a frozen conformance spec for what shipped under the *old* law; it is not being rewritten. New work follows `DESIGN_SYSTEM.md` §0 law 1 (*never move for a reason the room can't see*) and the §5.4 budget. Motion may now be continuous and may live on the resting surface if it reports an external cause.
4. Code-not-taste invariants: silence is the default (`shouldSpeak`); one voice (`personality.phrase`); tender memories ambient-only + never captioned (`memoryEngine.toSurface`); glass is all-or-nothing (the 5 glass tokens travel together).
5. Ship loop: `npm test` green → deploy flag-off → flip on the Pi → verify at 3–4 m + `/kiosk-metrics` flat → commit default-on.

## Design Tokens (extend `src/css/base/variables.css`)

### Ink (fixed — never shifts with the accent)
- `--ink: #eef3fb` — primary text
- `--ink-dim: #9fb0d4`; `--ink-faint: #5e6f96`
- Common alpha steps used on `--ink` (238,243,251): .94 headline · .85 body · .78 concierge · .72 memory title · .6 secondary · .56 card sub · .5 metadata · .42 eyebrow · .4 resting note

### Ground
- `--sky-0: #070b18` · `--sky-1: #0e1530` · `--sky-2: #1a2148`
- Base canvas: `linear-gradient(160deg, var(--sky-0), var(--sky-1) 55%, var(--sky-2))`

### Signals
- `--status-ok: #4dd57b` · `--status-warn: #ffb347` · `--status-error: #ff6b6b` · `--status-info: #79b8ff`
- `--warm: #ffcd8c` — **reserved**: sun/lightning glyphs and the arrival name only. Never UI chrome.
- `--cool: #9fc4ff`

### Glass (the 5 tokens — all or nothing)
- `--glass-bg: linear-gradient(180deg, rgba(24,28,40,.48), rgba(10,12,18,.34))`
- `--glass-border: 1px solid rgba(255,255,255,.10)`
- `--glass-blur: blur(18px) brightness(.87)` (as `backdrop-filter` + `-webkit-` prefix)
- `--glass-shadow: 0 8px 28px rgba(0,0,0,.30)`
- `--glass-sheen: inset 0 1px 0 rgba(255,255,255,.07)`
- `--glass-radius: 18px`
- "Hero" glass variant (brighter, for the stack's top card and the arrival card): bg `linear-gradient(180deg, rgba(42,47,66,.62), rgba(16,20,32,.48))`, border-color `rgba(255,255,255,.14)`, shadow `0 12px 30px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.09)`.

### Type
- `--font-display: "Barlow Condensed", "Inter", sans-serif` — all display/headline/number type
- `--font-body: "Inter", Arial, sans-serif` — body, captions
- `--font-mono: "JetBrains Mono", monospace` — resting/system notes only
- Weights loaded: Barlow Condensed 200–600; Inter 300–600.

### Motion (`personality.timing`)
- `timing('hero')` — 700ms `cubic-bezier(.4,0,.2,1)` — all mode-layer exchanges. **Opacity-only** (transform breaks fixed descendants; see focusHero leak-audit note).
- `timing('settle')` — **60s linear in production** (2.5s in the prototype for demo speed) — atmosphere tint/photo crossfades, memory surfacing.
- `timing('arrival')` — 550ms `cubic-bezier(.22,1,.36,1)` — arrival card enter/exit (overshoot then settle).

### Layout constants
- Safe margin: **108px** all edges (was 72px; tightened after wall-distance review).
- Content max-width (stack, notes): 1240px.

## The Atmosphere System ("borrowed light")

The weather lights the whole surface — there is **no weather icon/lottie** (a looping lottie violates the 0%-GPU law; the wall itself renders the condition). Each condition sets a full-bleed tint over the photo and a "living accent" used by the ambient clock:

| Condition | Tint (over photo) | Accent |
|---|---|---|
| golden | rgba(150,95,40,.20) | rgba(255,185,130,.94) |
| clear | rgba(30,66,120,.12) | rgba(255,255,255,.95) |
| cloudy | rgba(66,78,96,.24) | rgba(255,255,255,.95) |
| rain | rgba(36,66,98,.30) | rgba(196,230,255,.97) |
| storm | rgba(28,38,66,.38) | rgba(196,230,255,.97) |
| fog | rgba(120,130,145,.22) | rgba(255,255,255,.95) |
| night | rgba(4,10,28,.42) | rgba(130,215,255,.92) |

Layer order (bottom→top): photo (Immich) → atmosphere tint → readability gradient `linear-gradient(180deg, rgba(0,0,0,.08) 0%, transparent 44%, rgba(0,0,0,.70) 100%)` → content. All atmosphere changes crossfade on `timing('settle')`.

## Screens / Views

All modes live in one document; each mode is an absolutely-positioned full-bleed layer, exchanged **opacity-only** on `timing('hero')` (700ms), with `visibility` flipped after the fade (setTimeout, never `transitionend` on a hidden node).

### Mode 0 · Ambient (screensaver)
- **Purpose**: the resting house. Photo + clock, nothing else. 0% GPU at rest.
- **Clock** (bottom-left, inside the 108px margin): time in `--font-display` weight 500, **192px**, line-height .82, letter-spacing .008em, `font-variant-numeric: tabular-nums`, color = the atmosphere **accent**. Meridiem suffix at .34em, opacity .72, weight 400. Date below (14px gap): weight 500, 26px, letter-spacing .22em, uppercase, `--ink` at 60%.
- Clock block opacity dims with the sky: golden .66 · night .5 · storm .78 · default .9.
- OLED protection: the clock block drifts on a 240s ease-in-out loop (max ±30px) — `transform` only. No per-second tick; minutes only (5s poll in prototype). **This is the one permitted loop and it already exists in production (position drift / Ken Burns own it); do not add more.**
- **Memory whisper** (captioned memories only) — bottom-right, right-aligned, max-width 52%: eyebrow row (icon + label) Inter 600, 19px, letter-spacing .22em, uppercase, ink 42%; title below (10px gap) display 500, 44px, line-height 1.02, ink 72%. Surfaces on `timing('settle')`. Silence is the default — only golden/clear demo one.
- **Tender memory (WP4, the hard invariant)** — `sensitivity:"tender"` memories are **ambient-only, never captioned, held longer**. When one surfaces: the photo takes the whole statement (no words anywhere), the atmosphere layers yield to it, and the clock recedes to **opacity .32**. Held on the settle curve, longer than a normal rotation. Enforced in `memoryEngine.toSurface`; a test must lock the gating. Scope every tender style to Ambient (`[data-mode="ambient"]` equivalent) so it cannot leak into awake modes.

### Top row (shared by Glance + Lean-in)
- Left: time — display 500, 64px, tabular-nums, `--ink`; meridiem .5em at ink 60%.
- Right, right-aligned column (8px gap): temp — display 600, 64px, `--ink`; condition line — Inter 500, 19px, letter-spacing .14em, uppercase, ink 60%. Copy format: `NUDGEE · CLEAR`.

### Mode 1 · Glance — the hero line
- **Purpose**: one scored line, readable at 4 m, vertically centered (offset +120px below true center to clear the top row).
- Row: glyph + text, 28px gap, flex center.
- **Length-responsive tiers** (character count picks the tier; the temperament trims copy before it gets here):
  - Tier A (≤18 chars in prototype; production `focusHero.js` uses ≤16): text 144px, glyph 116px
  - Tier B (≤44; production 17–40): text 104px, glyph 84px
  - Tier C (else): text 72px, line-height 1.02, glyph 58px
- Text: display 500, line-height .96, letter-spacing .006em, `--ink`, max-width 26ch, `text-wrap: balance`, text-shadow `0 2px 34px rgba(0,0,0,.55)`. Glyph: `filter: drop-shadow(0 0 24px rgba(120,160,220,.35))`.
- **Concierge variant** (idle fallback — when the scored queue is empty, awake modes only, never Ambient/Voice): same slot and tiers but **matte** — text ink .78, softer text-shadow `0 2px 24px rgba(0,0,0,.4)`, glyph ✨ with **no** glow filter, opacity .8. Copy: one dry sentence, ≤12 words, weather/time only, generated by Claude Haiku via `POST /api/ai/brief` (`type:"concierge"`), refreshed at most every 20 min (`CONCIERGE_MIN_INTERVAL_MS`). Existing plumbing in `focusHero.js` `maybeFetchConcierge()` — this WP only restyles its presentation.

### Mode 2 · Lean-in — the glass stack (WP2)
- **Purpose**: DWELL reveals the next 3 curated items; **the one mode where glass earns its edges**.
- Stack bottom-anchored, grid, 18px gap, max-width 1240px.
- Card: flex row, 26px gap, padding 26px 34px, the full 5-token glass recipe. Icon 48px. Title display 600, 44px, line-height 1.05, `--ink`; sub Inter 22px, ink 56%, 4px below. Right meta block: display 600, 40px, tabular-nums, ink 82%; sub-label Inter 500, 17px, ink 50%.
- Top card uses the **hero glass** variant (brighter — see tokens).
- **Severity**: a 3px left stripe in `--status-warn` with glow `0 0 14px rgba(255,179,71,.5)` + warm drop-shadow on the icon. Never a coloured card.
- Reveal: cards fade in opacity-only, staggered 0/180/360ms on `timing('hero')`. Teardown via the existing `renderStack` `setTimeout` path (700ms `STACK_FADE_MS`) — do not add a new timer.
- Resting note below (16px gap, centered): mono 18px, ink 40%, letter-spacing .04em — e.g. `+ 5 more candidates resting below the fold`.
- When idle (no hero): the stack yields entirely and the concierge line shows instead (matches `updateAttention`: `renderStack([])` + concierge fallback for glance/dwell).

### Mode 3 · Voice — reserved
- Deliberately undesigned (no mic hardware yet). The prototype shows a centered placeholder: 6-bar waveform in `--cool` (animates **only while the mode is active**), "Listening…" display 500 56px, sub Inter 24px ink 50%. Keep behind the presence engine's VOICE state; do not build further.

### The Arrival Card (WP3)
- **Trigger**: a genuine away→home presence crossing. Self-contained overlay over any mode. Respects the **delight budget** (`delight.js`) — fires once, then blocks; copy through `personality.phrase`.
- Geometry: bottom-center, `bottom: 8%`, width 760px, hero-glass variant, padding 38px 46px 0, overflow hidden.
- Entrance/exit: `timing('arrival')` — translateY(46px→0) + opacity, 550ms overshoot curve. Auto-dismiss after **15s**.
- Welcome: display 500, 64px, line-height 1, ink 94% — `Welcome home, <b>Greg</b>.` with the **name in `--warm`, weight 600** (the only UI use of `--warm` besides sun/lightning glyphs).
- Status: Inter 24px, ink 60%, 10px below — e.g. `Brett's already home.`
- Events list (24px above, 34px below, 12px row gap): time — display 600, tabular, `--warm`, min-width 3.4em; title — Inter 26px, ink 85%.
- Drain bar: 3px full-bleed track `rgba(255,255,255,.08)` at the card's bottom edge; fill in a warm gradient draining 100%→0% width over 15s linear. `prefers-reduced-motion`: no animation, static 62% width.
- Teardown must be symmetric — no listener/node leak across repeated arrivals (verify with repeated forced arrivals + heap metrics).

## Interactions & Behavior

- **Presence transitions**: all mode exchanges are opacity-only on 700ms; `visibility` handled by timeout. Presence itself comes from the existing `presence.js` engine (`presence:changed` event) — the prototype's chip/keys are demo stand-ins.
- **Atmosphere changes**: tint, accent and photo crossfade on 60s settle. Weather source: existing weather service; condition→atmosphere mapping per the table above.
- **Hero tiering**: recompute tier on every text change (`applyHeroTier` already exists behind `features.heroType`).
- **Reduced motion**: all animation/transitions off; arrival bar static.
- Links (if any ever appear): `a { color: var(--status-info) }`, hover `var(--cool)`.

## State Management

No new state layers. Each surface hangs off existing services: `presence.js` (mode), `attentionEngine`/`focusEngine` (hero + stack selection), `memoryEngine` (memory surfacing + tender gating), `delight.js` (arrival budget), weather service (atmosphere), `/api/ai/brief` (concierge text). Flags: `heroType` (shipped), `ambientClock` (shipped), `leanInStack`, `arrivalCard`, `ambientMemory` — one per WP in `src/js/config.js`.

## Sequencing (from PLAN.md)

WP2 lean-in stack → WP3 arrival card → WP4 tender memory. WP2 first: it proves the shared glass recipe that WP3's overlay inherits. WP4 last — it is grief-capable; land it once the surrounding system feels right, with the tender-gating test locked in.

## Assets

- Fonts: Barlow Condensed, Inter, JetBrains Mono (Google Fonts in the prototype; the product self-hosts).
- Photography: production draws the Immich library (existing screensaver source). The prototype's gradients and drop-zone are stand-ins only.
- Glyphs: system emoji (existing product convention).

## Files

- `screenshots/` — one capture per state (photo background hidden; gradient stand-ins only): ambient captioned, ambient tender, glance hero (rain/warn), glance concierge idle, lean-in stack, voice reserved, arrival card.
- `HomeOS Home.html` — the interactive reference. Keys 0–3 switch modes, `A` fires the arrival; the Tweaks panel drives atmosphere, memory (off/captioned/tender) and the concierge idle state.
- `homeos-tweaks.jsx`, `tweaks-panel.jsx`, `image-slot.js` — demo scaffolding, not for porting.
- In-repo references: `docs/design/PLAN.md`, `docs/design/README.md`, the `homeos-*.html` studies, `STYLE_GUIDE.md`, `src/js/modules/focusHero.js` (tiering, concierge, stack teardown), `server/routes/ai.js` (concierge voice).
