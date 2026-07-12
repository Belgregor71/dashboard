# HomeOS Design Track — Project Plan

Breaks the remaining surfaces from [`README.md`](README.md) ("Suggested order")
into flag-gated, Pi-verified work packages. Each WP is one PR/flag, shipped through
the full loop before the next starts — the same discipline that landed Phases 1–10
and study 02.

**Status:** Study 02 (the hero line) shipped + default-on (`features.heroType`).
**WP1 (ambient night clock, `features.ambientClock`) + WP2 (lean-in glass stack,
`features.leanInStack`) shipped + default-on + Pi-verified 2026-07-12**
(`21fe565`→`18a237b`→`708a2b2`; `7a054a3`→`d36ac34`). One surface remains after this;
**WP3 in progress.**

## Guardrails every surface follows (the shipping contract)

Constant across all four WPs — the packages below only call out deviations:

1. **New `features.*` flag** in `src/js/config.js`; **flag-off byte-identical**; one-line revert.
2. **Extend `src/css/base/variables.css`, don't fork** — no parallel CSS tree; touch the
   real component + its `src/css/` file; follow `STYLE_GUIDE.md`.
3. **0% GPU at rest is law** — `transform`/`opacity`/static `filter` only, no looping
   animation; verify Ambient stays 0% with `/kiosk-metrics`.
4. **Code-not-taste invariants hold:** silence is the default (`shouldSpeak`), one voice
   (`personality.phrase`), tender memories ambient-only + never captioned
   (`memoryEngine.toSurface`), glass is all-or-nothing (the 5 glass tokens travel together).
5. **Ship loop:** `npm test` green → deploy flag-off (no-op) → flip on the Pi → verify at
   3–4 m + `/kiosk-metrics` flat → commit default-on. Real photos (Immich/screensaver),
   never gradients. Dev-session rendering is unreliable — verify on the actual panel.

---

## WP1 — The Ambient Night Clock (study 05) ✅ SHIPPED (default-on, Pi-verified 2026-07-12)

| | |
|---|---|
| **Study** | `homeos-ambient-clock.html` |
| **Mode** | Ambient (0) only — the screensaver clock |
| **Target** | `src/js/modules/screensaver.js` + `src/css/**/screensaver.css` (+ `variables.css` tokens) |
| **Flag** | `ambientClock` |
| **Builds on** | Existing night-clock dimming (suncalc dim clock/photos, `__isNight`) — this elevates its *type & treatment*, it does not reinvent the dim logic |
| **Spec highlights** | Barlow Condensed jumbo scale; borrowed-light `--accent` only; legible-but-quiet at night; no second-hand tick, no looping motion (position drift / Ken Burns already own OLED protection) |
| **Verify** | Screensaver engaged → clock renders at spec day + night; `/kiosk-metrics` GPU **0%** (the idle-freeze must survive) |
| **Risk** | Low — isolated to Mode 0, no new motion. Main watch: don't reintroduce a per-second animation that unfreezes the idle GPU |

## WP2 — The Lean-in Glass Stack (study 01) ✅ SHIPPED (default-on, Pi-verified 2026-07-12)

| | |
|---|---|
| **Study** | `homeos-component-studies.html` (lean-in half) |
| **Mode** | Lean-in (2 / DWELL) — **the one mode where glass earns its edges** |
| **Target** | `src/css/components/home-panels.css` (`.focus-stack*`) + `src/js/modules/focusHero.js` (`renderStack` already exists) |
| **Flag** | `leanInStack` |
| **Spec highlights** | Apply the full **5-token glass system together** to the stack cards; type harmonised with the new hero scale (the next-3 curated items under the hero); reveal stays opacity-only with the existing `setTimeout` teardown (never `transitionend` while hidden) |
| **Verify** | DWELL reveals top-3 with glass edges; GLANCE collapses to 1 (unchanged); `/kiosk-metrics` DOM/heap flat across reveal/teardown cycles (leak-audit discipline) |
| **Risk** | Medium — touches the live DWELL path + the glass token system. Keep glass all-or-nothing; reuse `renderStack`'s teardown, don't add a new timer |

## WP3 — The Arrival "Welcome Home" Card (study 03) ◀ IN PROGRESS

| | |
|---|---|
| **Study** | `homeos-arrival-card.html` |
| **Trigger** | Presence arrival — a self-contained overlay |
| **Target** | `src/js/modules/arrivalGreeting.js` + its CSS (+ `variables.css`) |
| **Flag** | `arrivalCard` |
| **Ties to** | Phase 10 **delight registry** (`delight.js`, budgeted) + `personality.phrase`/`personality.timing` — arrival copy speaks in the one voice, celebration is rationed |
| **Spec highlights** | Glass overlay (5 tokens); enter/exit on `personality.timing`; opacity/transform only; copy routed through the temperament; respects the delight budget (can't fire twice) |
| **Verify** | Force an arrival on the Pi → card renders + auto-dismisses; delight budget spent once then blocks; `/kiosk-metrics` flat; overlay teardown cleans symmetrically (no blob/listener leak on repeated arrivals) |
| **Risk** | Medium — overlay lifecycle + delight-budget interaction |

## WP4 — The Ambient Memory Surface (study 01)

| | |
|---|---|
| **Study** | `homeos-component-studies.html` (ambient memory half, incl. the tender/wordless case) |
| **Mode** | Ambient (0) — subtle, grief-capable |
| **Target** | `src/js/modules/screensaver.js` + `src/js/services/memoryEngine.js` (+ memory CSS) |
| **Flag** | `ambientMemory` |
| **Ties to** | Memory engine + Immich photo source |
| **Hard invariant** | **Tender memories (`sensitivity:"tender"`) are ambient-only, never captioned, held longer** — enforced in `memoryEngine.toSurface`; a test must lock this |
| **Verify** | Force a tender + a non-tender memory → tender surfaces wordless/ambient-only, held longer; rarity budget holds; `/kiosk-metrics` GPU 0% |
| **Risk** | Highest-sensitivity (grief-capable) — **do last, once the surrounding system feels right** (README). The tender-gating test is non-negotiable |

---

## Sequencing & rationale

```
WP1 Ambient clock ─► WP2 Lean-in stack ─► WP3 Arrival card ─► WP4 Ambient memory
   (isolated,          (glass system,        (overlay +          (tender, grief-
    Mode-0, GPU-safe)   DWELL path)           delight registry)   capable — last)
```

- **Order = README's "lowest risk → highest signal."** WP1 is walled off in Mode 0;
  WP2 establishes the glass system that WP3's overlay reuses; WP4 waits until the
  memory/voice system around it is settled.
- **Cross-cutting dependency:** WP2 nails down the shared glass token treatment — do it
  before WP3 so the arrival card inherits a proven glass, not a one-off.
- **Each WP is one PR/flag**, shipped through the full loop before the next starts.

## Verify-file references (per surface)

- **Path conventions:** exact `src/css/` filenames per surface are confirmed at the start
  of each WP (glob the component), not assumed here.
- **Flags** land in `src/js/config.js` alongside `heroType`; `static/js/config.js` is
  gitignored and regenerated at build time by `scripts/copy-static-config.js`.
- **On-Pi CDP:** Node 20 on the Pi has no global WebSocket — use `scripts/kiosk/kiosk-drive.cjs`
  for reloads and `scripts/kiosk/heap-metrics.cjs` / `gpucpu.sh` for the metrics gate.
